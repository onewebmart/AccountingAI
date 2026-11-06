import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { ItemsService } from '../items/items.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { MailerService } from '../mail/mailer.service';
import { renderInvoicePdf } from '../sales/invoice-pdf';
import { todayIst, addDays } from '../automation/schedule';
import { GoodsReceipt, GoodsReceiptDocument, PoDeliverTo, PurchaseOrder, PurchaseOrderDocument, PurchaseOrderLine } from './schemas/purchase-docs.schema';
import { DOC_NUMBER, DiscountInput, DocLineInput, adjustmentOf, docAmounts, isInterState, lineAmount, lineProblem, priceDoc, text } from './doc-lines';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { bookableForBill } from '../purchase/bills-from-lines.service';
import { PartyAddress, isPaymentTerms, termsDueDate } from '../gl/party-profile';
import { MatchLine, PoLine, threeWayMatch } from './three-way-match';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A PO line as typed: a document line, and the account its bill books it to. */
export interface PoLineInput extends DocLineInput {
  accountId?: string | null;
}

/** What a new purchase order may carry besides the vendor and its lines. All optional. */
export interface PoInput {
  vendorId: string;
  /** Typed by a person; blank takes the next number in the series. */
  number?: string | null;
  date?: string;
  /** The delivery date. */
  expectedBy?: string | null;
  lines: PoLineInput[];
  referenceNumber?: string | null;
  /** Blank takes the vendor's. */
  paymentTerms?: string | null;
  shipmentPreference?: string | null;
  /** Our own address (the default), or a customer's, for goods sent straight to them. */
  deliverTo?: { kind: 'organisation' | 'customer'; customerId?: string | null } | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  discount?: DiscountInput | null;
  adjustment?: { label?: string | null; paise?: number | null } | null;
}

/** An address as it prints: the lines that are filled, one to a line. */
export function addressText(a: Partial<PartyAddress> | null | undefined): string | null {
  if (!a) return null;
  const place = [a.city, a.pincode].filter((x) => x?.trim()).join(' ');
  const lines = [a.attention, a.street1, a.street2, place, a.stateCode && STATE_NAMES[a.stateCode] ? STATE_NAMES[a.stateCode] : null].filter((x): x is string => !!x?.trim());
  return lines.length ? lines.join('\n') : null;
}

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const TERMS_WORDS: Record<string, string> = { due_on_receipt: 'Due on receipt', end_of_month: 'Due end of the month', end_of_next_month: 'Due end of next month' };
export const termsWords = (t: string | null | undefined) => (!t ? null : TERMS_WORDS[t] ?? (/^net_(\d+)$/.test(t) ? `Net ${t.slice(4)}` : t));

/**
 * Purchase orders, goods received and the bill matched to both. Nothing
 * here posts: a bill made from a PO is a draft, posted as any bill is.
 */
@Injectable()
export class PurchaseDocsService {
  constructor(
    @InjectModel(PurchaseOrder.name) private poModel: Model<PurchaseOrderDocument>,
    @InjectModel(GoodsReceipt.name) private grnModel: Model<GoodsReceiptDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private bills: PurchaseBillsService,
    private items: ItemsService,
    private posting: PostingService,
    private mailer: MailerService,
    private audit: AuditService,
  ) {}

  /**
   * A purchase order, priced on the server: each line checked and filled from
   * its item, with the account its bill will book it to; the discount spread
   * over the lines before tax; tax for where the vendor is; the adjustment
   * after. It posts nothing.
   */
  async createPo(orgId: string, actorId: string, input: PoInput) {
    const vendor = await this.vendor(orgId, input.vendorId);
    const date = input.date ?? todayIst();
    if (!DATE.test(date)) throw new BadRequestException('date must look like 2026-11-04');
    if (input.expectedBy && (!DATE.test(input.expectedBy) || input.expectedBy < date)) throw new BadRequestException('The delivery date is on or after the order date.');
    const terms = input.paymentTerms?.trim() || vendor.paymentTerms || null;
    if (terms && !isPaymentTerms(terms)) throw new BadRequestException('Payment terms are due on receipt, net 7 to net 90 or a number of days, or the end of the month.');
    const { lines, amounts, discount, adjustment } = await this.priced(orgId, vendor, input.lines, { discount: input.discount, adjustment: input.adjustment });
    const deliverTo = await this.deliverTo(orgId, input.deliverTo);
    const number = await this.number(orgId, 'PURCHASE_ORDER', 'PO', date, input.number);
    const po = await this.poModel.create({
      orgId, vendorId: vendor._id, number, date, expectedBy: input.expectedBy || null, status: 'open', lines, amountsPaise: amounts, discount, adjustment,
      referenceNumber: text(input.referenceNumber, 60), paymentTerms: terms, shipmentPreference: text(input.shipmentPreference, 60), deliverTo,
      notes: text(input.notes, 2000), termsAndConditions: text(input.termsAndConditions, 3000), createdBy: actorId,
    });
    await this.audit.record({
      orgId, entityType: 'PurchaseOrder', entityId: po._id.toString(), action: 'CREATE', performedBy: actorId,
      after: { number: po.number, totalPaise: amounts.total, discountPaise: discount?.amountPaise ?? 0, adjustmentPaise: adjustment?.paise ?? 0, deliverTo: deliverTo.kind },
    });
    return po;
  }

  /** Where the goods go, with the address as it is today: ours from settings, or the customer's shipping address. */
  private async deliverTo(orgId: string, input: PoInput['deliverTo']): Promise<PoDeliverTo> {
    if (input?.kind === 'customer') {
      if (!input.customerId || !Types.ObjectId.isValid(input.customerId)) throw new BadRequestException('Choose the customer to deliver to.');
      const c = await this.customerModel.findOne({ _id: input.customerId, orgId }).lean().exec();
      if (!c) throw new NotFoundException('Customer not found');
      return { kind: 'customer', customerId: c._id as Types.ObjectId, name: c.name, address: addressText(c.shippingAddress) ?? addressText(c.billingAddress) ?? c.address ?? null };
    }
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    return { kind: 'organisation', customerId: null, name: settings?.displayName?.trim() || 'Our business', address: settings?.address?.trim() || null };
  }

  /** Each PO with its lines' ordered, received and billed quantities. */
  async listPos(orgId: string, id?: string): Promise<Array<Record<string, unknown>>> {
    if (id !== undefined && !Types.ObjectId.isValid(id)) throw new NotFoundException('Purchase order not found');
    const pos = await this.poModel.find(id === undefined ? { orgId } : { orgId, _id: new Types.ObjectId(id) }).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const vendors = await this.vendorModel.find({ orgId, _id: { $in: pos.map((p) => p.vendorId) } }, { name: 1 }).lean().exec();
    const name = new Map(vendors.map((v) => [String(v._id), v.name]));
    const progress = await this.progress(orgId, pos.map((p) => String(p._id)));
    return pos.map((p) => {
      const pr = progress.get(String(p._id))!;
      return { ...p, vendorName: name.get(String(p.vendorId)) ?? 'Unknown', lines: p.lines.map((l, i) => ({ ...l, receivedQty: pr.received.get(i) ?? 0, billedQty: pr.billed.get(i) ?? 0 })) };
    });
  }

  /** One PO, with what has been received and billed against each line. */
  async getPo(orgId: string, id: string) {
    const [po] = await this.listPos(orgId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  /** Emails the PO to the vendor when there is mail to send it; marks it sent either way. */
  async sendPo(orgId: string, actorId: string, id: string) {
    const po = await this.po(orgId, id);
    const vendor = await this.vendor(orgId, String(po.vendorId));
    let emailed = false;
    if (vendor.email && this.mailer.configured) {
      const { content, seller } = await this.pdfOf(orgId, po);
      await this.mailer.send({
        to: vendor.email, fromName: seller, subject: `Purchase order ${po.number} from ${seller}`,
        text: [`Dear ${vendor.name},`, '', `Please find our purchase order ${po.number}${po.expectedBy ? `, needed by ${po.expectedBy}` : ''}. Kindly quote it on your invoice.`, '', 'Thank you.', seller].join('\n'),
        attachments: [{ filename: `PO-${po.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, content, contentType: 'application/pdf' }],
      });
      emailed = true;
    }
    po.sentAt = new Date();
    await po.save();
    await this.audit.record({ orgId, entityType: 'PurchaseOrder', entityId: id, action: 'SEND', performedBy: actorId, after: { emailedTo: emailed ? vendor.email : null } });
    return { po, emailed };
  }

  async setPoStatus(orgId: string, actorId: string, id: string, status: 'closed' | 'cancelled') {
    const po = await this.po(orgId, id);
    if (po.status !== 'open') throw new BadRequestException(`This PO is ${po.status}.`);
    if (status === 'cancelled' && (await this.grnModel.exists({ orgId, purchaseOrderId: po._id, status: 'received' }).exec())) {
      throw new BadRequestException('Goods have been received against this PO: close it instead of cancelling.');
    }
    po.status = status;
    await po.save();
    await this.audit.record({ orgId, entityType: 'PurchaseOrder', entityId: id, action: status === 'closed' ? 'CLOSE' : 'CANCEL', performedBy: actorId, before: { status: 'open' }, after: { status } });
    return po;
  }

  /** Goods in against a PO: never more of a line than is still to come. */
  async receive(orgId: string, actorId: string, poId: string, input: { date?: string; lines: Array<{ poLine: number; qty: number; rejectedQty?: number }>; vendorChallanNo?: string | null; notes?: string | null }) {
    const po = await this.po(orgId, poId);
    if (po.status !== 'open') throw new BadRequestException(`This PO is ${po.status}.`);
    const date = input.date ?? todayIst();
    const received = (await this.progress(orgId, [poId])).get(poId)!.received;
    const lines = input.lines.filter((l) => l.qty > 0 || (l.rejectedQty ?? 0) > 0);
    if (lines.length === 0) throw new BadRequestException('Enter what was received.');
    for (const l of lines) {
      const line = po.lines[l.poLine];
      if (!line) throw new BadRequestException(`No line ${l.poLine + 1} on this PO.`);
      const left = round3(line.qty - (received.get(l.poLine) ?? 0));
      if (l.qty > left + 1e-9) throw new BadRequestException(`"${line.description}": ${left} still to come, not ${l.qty}.`);
    }
    const grn = await this.grnModel.create({
      orgId, vendorId: po.vendorId, purchaseOrderId: po._id, number: await this.number(orgId, 'GRN', 'GRN', date), date,
      lines: lines.map((l) => ({ poLine: l.poLine, qty: l.qty, rejectedQty: l.rejectedQty ?? 0 })), vendorChallanNo: input.vendorChallanNo?.trim() || null, notes: input.notes?.trim() || null, status: 'received', createdBy: actorId,
    });
    await this.audit.record({ orgId, entityType: 'GoodsReceipt', entityId: grn._id.toString(), action: 'RECEIVE', performedBy: actorId, after: { number: grn.number, purchaseOrderId: poId, lines: grn.lines } });
    return grn;
  }

  async listGrns(orgId: string): Promise<Array<Record<string, unknown>>> {
    const grns = await this.grnModel.find({ orgId }).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const pos = await this.poModel.find({ orgId, _id: { $in: grns.map((g) => g.purchaseOrderId) } }, { number: 1, lines: 1 }).lean().exec();
    const byId = new Map(pos.map((p) => [String(p._id), p]));
    return grns.map((g) => {
      const po = byId.get(String(g.purchaseOrderId));
      return { ...g, poNumber: po?.number ?? null, lines: g.lines.map((l) => ({ ...l, description: po?.lines[l.poLine]?.description ?? '' })) };
    });
  }

  async cancelGrn(orgId: string, actorId: string, id: string) {
    const grn = Types.ObjectId.isValid(id) ? await this.grnModel.findOne({ _id: id, orgId }).exec() : null;
    if (!grn) throw new NotFoundException('Goods receipt not found');
    if (grn.status !== 'received') throw new BadRequestException('Already cancelled.');
    const billed = (await this.progress(orgId, [String(grn.purchaseOrderId)])).get(String(grn.purchaseOrderId))!;
    for (const l of grn.lines) {
      if ((billed.billed.get(l.poLine) ?? 0) > (billed.received.get(l.poLine) ?? 0) - l.qty + 1e-9) throw new BadRequestException('Part of what this note received is billed: reverse the bill first.');
    }
    grn.status = 'cancelled';
    await grn.save();
    await this.audit.record({ orgId, entityType: 'GoodsReceipt', entityId: id, action: 'CANCEL', performedBy: actorId, before: { status: 'received' }, after: { status: 'cancelled' } });
    return grn;
  }

  /**
   * A draft bill for what was received and not yet billed; posted as any
   * bill is. Each line keeps the PO's rate, its account, and its share of the
   * PO's discount, in proportion to the quantity billed: the bill that
   * completes a line takes exactly what is left of its discount, so the
   * bills of a PO add up to it to the paisa. The PO's adjustment goes on a
   * bill that bills all of it at once; a part bill rounds on its own.
   */
  async billFromPo(orgId: string, actorId: string, poId: string, input: { billNumber: string; billDate?: string; lines?: Array<{ poLine: number; qty: number }> }) {
    const po = await this.po(orgId, poId);
    if (!input.billNumber?.trim()) throw new BadRequestException("Enter the vendor's bill number.");
    const pr = (await this.progress(orgId, [poId])).get(poId)!;
    const open = po.lines.map((l, i) => round3((pr.received.get(i) ?? 0) - (pr.billed.get(i) ?? 0)));
    const pick = (input.lines ?? open.map((qty, poLine) => ({ poLine, qty }))).filter((l) => l.qty > 0);
    if (pick.length === 0) throw new BadRequestException('Nothing received is waiting to be billed.');
    for (const l of pick) {
      if (!po.lines[l.poLine]) throw new BadRequestException(`No line ${l.poLine + 1} on this PO.`);
      if (l.qty > open[l.poLine] + 1e-9) throw new BadRequestException(`"${po.lines[l.poLine].description}": ${open[l.poLine]} received and not billed.`);
    }
    const vendor = await this.vendor(orgId, String(po.vendorId));
    const billedDiscount = await this.discountBilled(orgId, poId);
    const chosen = pick.map((p) => {
      const line = po.lines[p.poLine];
      const lineDiscount = line.discountPaise ?? 0;
      const completes = p.qty >= round3(line.qty - (pr.billed.get(p.poLine) ?? 0)) - 1e-9;
      const share = completes ? lineDiscount - (billedDiscount.get(p.poLine) ?? 0) : Math.round((lineDiscount * p.qty) / line.qty);
      return { ...this.plain(line), qty: p.qty, discountPaise: Math.max(0, Math.min(share, lineAmount({ qty: p.qty, ratePaise: line.ratePaise }))), accountId: line.accountId ?? null };
    });
    const resolved = await this.items.resolveLines(
      orgId,
      chosen.map((l) => ({ description: l.description, itemId: l.itemId ?? null, hsnSac: l.hsnSac ?? null, uqc: l.uqc ?? null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: lineAmount(l), taxRatePct: l.taxRatePct })),
      'purchase',
    );
    const lineItems = resolved.map((l, i) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0, discountPaise: chosen[i].discountPaise, accountId: chosen[i].accountId ?? l.accountId ?? null }));
    const amounts = docAmounts(lineItems, await this.interState(orgId, vendor));
    const whole = pr.billed.size === 0 && po.lines.every((l, i) => pick.some((p) => p.poLine === i && Math.abs(p.qty - l.qty) < 1e-9));
    const adjustment = whole ? adjustmentOf(po.adjustment, amounts.total) : null;
    if (adjustment) amounts.total += adjustment.paise;
    const billed = lineItems.reduce((s, l) => s + l.discountPaise, 0);
    const date = input.billDate ?? todayIst();
    const bill = await this.bills.create({
      orgId, actorId, vendorId: String(po.vendorId), billNumber: input.billNumber.trim(), billDate: date, dueDate: termsDueDate(po.paymentTerms, date) ?? addDays(date, 30), amountsPaise: amounts,
      lineItems, notes: `Against purchase order ${po.number}`, orderNumber: po.number, paymentTerms: po.paymentTerms ?? null,
      discount: billed > 0 ? { percent: po.discount?.percent ?? null, amountPaise: billed } : null, discountLevel: billed > 0 ? 'transaction' : null, adjustment,
      source: { kind: 'purchase_order', id: poId, lines: pick.map((p, i) => ({ poLine: p.poLine, qty: p.qty, discountPaise: lineItems[i].discountPaise })) },
    });
    await this.closeIfDone(orgId, poId);
    return bill;
  }

  /** The PO's discount already on bills made from it, per PO line. */
  private async discountBilled(orgId: string, poId: string): Promise<Map<number, number>> {
    const bills = await this.billModel.find({ orgId, 'source.kind': 'purchase_order', 'source.id': poId }, { source: 1 }).lean().exec();
    const out = new Map<number, number>();
    for (const b of bills) for (const l of b.source?.lines ?? []) out.set(l.poLine, (out.get(l.poLine) ?? 0) + (l.discountPaise ?? 0));
    return out;
  }

  /** A bill already in the books (typed or scanned), tied to its PO: its lines paired by item or name. */
  async linkBill(orgId: string, actorId: string, poId: string, billId: string) {
    const po = await this.po(orgId, poId);
    const bill = Types.ObjectId.isValid(billId) ? await this.billModel.findOne({ _id: billId, orgId }).exec() : null;
    if (!bill) throw new NotFoundException('Bill not found');
    if (String(bill.vendorId) !== String(po.vendorId)) throw new BadRequestException('The bill is from another vendor.');
    if (bill.source) throw new BadRequestException('This bill is already matched to a purchase order.');
    const pr = (await this.progress(orgId, [poId])).get(poId)!;
    const match = threeWayMatch({ bill: this.billLines(bill), po: this.poLines(po, pr) });
    const lines = match.pairs.flatMap((at, i) => (at === null ? [] : [{ poLine: at, qty: bill.lineItems[i].qty ?? 1 }]));
    if (lines.length === 0) throw new BadRequestException("None of the bill's lines is on this PO.");
    bill.source = { kind: 'purchase_order', id: poId, lines };
    bill.markModified('source');
    await bill.save();
    await this.audit.record({ orgId, entityType: 'PurchaseBill', entityId: billId, action: 'LINK_PO', performedBy: actorId, after: { purchaseOrderId: poId, lines } });
    await this.closeIfDone(orgId, poId);
    return this.match(orgId, billId);
  }

  /** The bill against its PO and what was received, each difference in words; else the vendor's open POs to link. */
  async match(orgId: string, billId: string) {
    const bill = Types.ObjectId.isValid(billId) ? await this.billModel.findOne({ _id: billId, orgId }).exec() : null;
    if (!bill) throw new NotFoundException('Bill not found');
    if (!bill.source) {
      const open = await this.poModel.find({ orgId, vendorId: bill.vendorId, status: 'open' }, { number: 1, date: 1, amountsPaise: 1 }).sort({ date: -1 }).lean().exec();
      return { linked: false as const, candidates: open.map((p) => ({ id: String(p._id), number: p.number, date: p.date, totalPaise: p.amountsPaise.total })) };
    }
    const po = await this.po(orgId, bill.source.id);
    const pr = (await this.progress(orgId, [bill.source.id], billId)).get(bill.source.id)!;
    const lastRates = await this.lastRates(orgId, bill);
    const result = threeWayMatch({ bill: this.billLines(bill), po: this.poLines(po, pr), lastRates });
    return { linked: true as const, po: { id: String(po._id), number: po.number }, ...result };
  }

  async pdf(orgId: string, id: string) {
    const po = await this.po(orgId, id);
    const { content } = await this.pdfOf(orgId, po);
    return { filename: `PO-${po.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, content };
  }

  private async pdfOf(orgId: string, po: PurchaseOrderDocument) {
    const [settings, vendor] = await Promise.all([this.settingsModel.findOne({ orgId }).lean().exec(), this.vendorModel.findOne({ _id: po.vendorId, orgId }).lean().exec()]);
    const gstin = settings?.gstin?.trim().toUpperCase() || null;
    const seller = settings?.displayName?.trim() || 'Your business';
    const row = (label: string, value: string | null | undefined): Array<[string, string]> => (value?.trim() ? [[label, value.trim()]] : []);
    const deliverTo = po.deliverTo ? [po.deliverTo.name, po.deliverTo.address].filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', ') : null;
    const discount = po.discount && po.discount.amountPaise > 0 ? po.discount : null;
    const content = renderInvoicePdf({
      seller: { name: seller, address: settings?.address ?? null, gstin, pan: settings?.pan ?? null, stateCode: gstin?.slice(0, 2) ?? settings?.stateCode ?? null, phone: settings?.phone ?? null, email: settings?.email ?? null },
      buyer: { name: vendor?.name ?? 'Vendor', address: vendor?.address ?? null, gstin: vendor?.gstin ?? null, stateCode: vendor?.gstin?.slice(0, 2) ?? null },
      number: po.number, date: po.date, dueDate: null,
      // Each line at the value it is taxed on: its amount less its share of any discount.
      lines: po.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, qty: l.qty, ratePaise: l.ratePaise, amountPaise: l.amountPaise - (l.discountPaise ?? 0), taxRatePct: l.taxRatePct })),
      amounts: po.amountsPaise,
      discount: discount ? { label: discount.percent ? `Discount (${discount.percent}%)` : 'Discount', paise: discount.amountPaise, subTotalPaise: po.lines.reduce((s, l) => s + l.amountPaise, 0) } : null,
      adjustmentLabel: po.adjustment?.label ?? null,
      notes: po.notes, terms: po.termsAndConditions ?? null, footer: 'Please quote this PO number on your invoice.', draft: false,
      title: 'PURCHASE ORDER', numberLabel: 'PO no.', partyLabel: 'TO',
      extraRows: [
        ...row('Reference', po.referenceNumber),
        ...row('Delivery date', po.expectedBy),
        ...row('Payment terms', termsWords(po.paymentTerms)),
        ...row('Shipment', po.shipmentPreference),
        ...row('Deliver to', deliverTo),
      ],
    });
    return { content, seller };
  }

  private billLines(bill: PurchaseBillDocument): MatchLine[] {
    return (bill.lineItems ?? []).map((l) => ({ description: l.description, itemId: l.itemId ? String(l.itemId) : null, qty: l.qty ?? 1, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct ?? 0 }));
  }

  private poLines(po: PurchaseOrderDocument, pr: { received: Map<number, number>; billed: Map<number, number> }): PoLine[] {
    return po.lines.map((l, i) => ({ description: l.description, itemId: l.itemId ? String(l.itemId) : null, qty: l.qty, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct, receivedQty: pr.received.get(i) ?? 0, billedQty: pr.billed.get(i) ?? 0 }));
  }

  /** What this vendor charged last time for each bill line's item. */
  private async lastRates(orgId: string, bill: PurchaseBillDocument) {
    const out = new Map<number, number>();
    const earlier = await this.billModel
      .find({ orgId, vendorId: bill.vendorId, _id: { $ne: bill._id }, billDate: { $lte: bill.billDate }, status: { $in: [BillStatus.POSTED, BillStatus.PAID] } }, { lineItems: 1, billDate: 1 })
      .sort({ billDate: -1 })
      .limit(20)
      .lean()
      .exec();
    (bill.lineItems ?? []).forEach((l, i) => {
      for (const b of earlier) {
        const hit = (b.lineItems ?? []).find((x) => (l.itemId && x.itemId && String(x.itemId) === String(l.itemId)) || x.description.trim().toLowerCase() === l.description.trim().toLowerCase());
        if (hit) { out.set(i, hit.ratePaise); break; }
      }
    });
    return out;
  }

  /** Received and billed quantity per PO line. A bill being matched is left out of "billed before". */
  private async progress(orgId: string, poIds: string[], exceptBillId?: string) {
    const out = new Map<string, { received: Map<number, number>; billed: Map<number, number> }>();
    for (const id of poIds) out.set(id, { received: new Map(), billed: new Map() });
    const [grns, bills] = await Promise.all([
      this.grnModel.find({ orgId, purchaseOrderId: { $in: poIds.map((i) => new Types.ObjectId(i)) }, status: 'received' }, { purchaseOrderId: 1, lines: 1 }).lean().exec(),
      this.billModel.find({ orgId, 'source.kind': 'purchase_order', 'source.id': { $in: poIds }, ...(exceptBillId ? { _id: { $ne: new Types.ObjectId(exceptBillId) } } : {}) }, { source: 1 }).lean().exec(),
    ]);
    for (const g of grns) {
      const m = out.get(String(g.purchaseOrderId))!.received;
      for (const l of g.lines) m.set(l.poLine, round3((m.get(l.poLine) ?? 0) + l.qty));
    }
    for (const b of bills) {
      const m = out.get(b.source!.id)!.billed;
      for (const l of b.source!.lines) m.set(l.poLine, round3((m.get(l.poLine) ?? 0) + l.qty));
    }
    return out;
  }

  private async closeIfDone(orgId: string, poId: string) {
    const po = await this.po(orgId, poId);
    const pr = (await this.progress(orgId, [poId])).get(poId)!;
    if (po.status === 'open' && po.lines.every((l, i) => (pr.billed.get(i) ?? 0) >= l.qty - 1e-9)) {
      po.status = 'closed';
      await po.save();
    }
  }

  /**
   * PO lines checked and filled from their items, each with the account its
   * bill books it to (chosen, else the item's, else Purchases), the discount
   * spread over them, tax for the vendor's state and the adjustment after.
   */
  private async priced(orgId: string, vendor: VendorDocument, input: PoLineInput[], opts: { discount?: DiscountInput | null; adjustment?: { label?: string | null; paise?: number | null } | null } = {}) {
    if (!input?.length) throw new BadRequestException('Add at least one line.');
    input.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const resolved = await this.items.resolveLines(orgId, input.map((l) => ({ description: l.description.trim(), itemId: l.itemId ?? null, hsnSac: l.hsnSac ?? null, uqc: l.uqc ?? null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: lineAmount(l), taxRatePct: l.taxRatePct })), 'purchase');
    const chosen = await this.lineAccounts(orgId, input);
    const plain = resolved.map((l, i) => ({ description: l.description, itemId: l.itemId, hsnSac: l.hsnSac ?? null, uqc: l.uqc, qty: l.qty ?? 1, ratePaise: l.ratePaise, amountPaise: l.amountPaise, taxRatePct: l.taxRatePct ?? 0, accountId: chosen[i] ?? l.accountId ?? null }));
    const priced = priceDoc(plain, await this.interState(orgId, vendor), opts);
    const lines: PurchaseOrderLine[] = priced.lines.map((l) => ({ description: l.description, itemId: l.itemId, hsnSac: l.hsnSac, uqc: l.uqc, qty: l.qty, ratePaise: l.ratePaise, amountPaise: l.amountPaise, taxRatePct: l.taxRatePct, discountPaise: l.discountPaise, accountId: l.accountId }));
    return { lines, amounts: priced.amounts, discount: priced.discount, adjustment: priced.adjustment };
  }

  /** Each line's chosen account, checked as a bill line's is: an expense, or an asset bought. Null where none was chosen. */
  private async lineAccounts(orgId: string, lines: PoLineInput[]): Promise<Array<Types.ObjectId | null>> {
    const ids = [...new Set(lines.map((l) => l.accountId).filter((id): id is string => !!id))];
    if (ids.length === 0) return lines.map(() => null);
    if (ids.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('That account is not one of yours.');
    const found = await this.accountModel.find({ orgId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).lean().exec();
    const byId = new Map(found.map((a) => [String(a._id), a]));
    return lines.map((l, i) => {
      if (!l.accountId) return null;
      const a = byId.get(l.accountId);
      if (!a) throw new BadRequestException(`Line ${i + 1}: that account is not one of yours.`);
      if (!bookableForBill(a)) throw new BadRequestException(`Line ${i + 1}: a purchase cannot be booked to ${a.name}. Pick an expense account, or an asset such as equipment.`);
      return a._id as Types.ObjectId;
    });
  }

  private async interState(orgId: string, vendor: VendorDocument) {
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    return isInterState(settings?.gstin?.slice(0, 2) ?? settings?.stateCode, vendor.gstin?.slice(0, 2) ?? null);
  }

  private plain(l: PurchaseOrderLine): DocLineInput {
    return { description: l.description, itemId: l.itemId ? String(l.itemId) : null, hsnSac: l.hsnSac, uqc: l.uqc, qty: l.qty, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct };
  }

  /**
   * The PO's or goods note's number: for a PO, the one a person typed,
   * checked unused, or the next in the series for the year. The series skips
   * a number typed by hand, so the two never collide.
   */
  private async number(orgId: string, series: 'PURCHASE_ORDER' | 'GRN', prefix: string, date: string, typed?: string | null) {
    const taken = async (n: string) => !!(series === 'PURCHASE_ORDER' ? await this.poModel.exists({ orgId, number: n }).exec() : await this.grnModel.exists({ orgId, number: n }).exec());
    const own = typed?.trim();
    if (own) {
      if (!DOC_NUMBER.test(own)) throw new BadRequestException('A number is up to 16 letters, digits, "/" and "-".');
      if (await taken(own)) throw new BadRequestException(`${own} is already used. Leave the number blank for the next one.`);
      return own;
    }
    const fy = financialYearOf(date);
    for (let i = 0; i < 100; i++) {
      const n = `${prefix}/${fy}/${String(await this.posting.nextDocumentNumber(orgId, series, fy)).padStart(4, '0')}`;
      if (!(await taken(n))) return n;
    }
    throw new BadRequestException('Could not find a free number. Type one.');
  }

  private async vendor(orgId: string, id: string): Promise<VendorDocument> {
    const v = Types.ObjectId.isValid(id) ? await this.vendorModel.findOne({ _id: id, orgId }).exec() : null;
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  private async po(orgId: string, id: string): Promise<PurchaseOrderDocument> {
    const p = Types.ObjectId.isValid(id) ? await this.poModel.findOne({ _id: id, orgId }).exec() : null;
    if (!p) throw new NotFoundException('Purchase order not found');
    return p;
  }
}
