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
import { GoodsReceipt, GoodsReceiptDocument, PurchaseOrder, PurchaseOrderDocument } from './schemas/purchase-docs.schema';
import { DocLine } from './schemas/sales-docs.schema';
import { DocLineInput, docAmounts, isInterState, lineAmount, lineProblem } from './doc-lines';
import { MatchLine, PoLine, threeWayMatch } from './three-way-match';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

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
    private bills: PurchaseBillsService,
    private items: ItemsService,
    private posting: PostingService,
    private mailer: MailerService,
    private audit: AuditService,
  ) {}

  async createPo(orgId: string, actorId: string, input: { vendorId: string; date?: string; expectedBy?: string | null; lines: DocLineInput[]; notes?: string | null }) {
    const vendor = await this.vendor(orgId, input.vendorId);
    const date = input.date ?? todayIst();
    if (!DATE.test(date)) throw new BadRequestException('date must look like 2026-11-04');
    const { lines, amounts } = await this.priced(orgId, vendor, input.lines);
    const po = await this.poModel.create({
      orgId, vendorId: vendor._id, number: await this.number(orgId, 'PURCHASE_ORDER', 'PO', date), date, expectedBy: input.expectedBy ?? null,
      status: 'open', lines, amountsPaise: amounts, notes: input.notes?.trim() || null, createdBy: actorId,
    });
    await this.audit.record({ orgId, entityType: 'PurchaseOrder', entityId: po._id.toString(), action: 'CREATE', performedBy: actorId, after: { number: po.number, totalPaise: amounts.total } });
    return po;
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

  /** A draft bill for what was received and not yet billed; posted as any bill is. */
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
    const chosen = pick.map((l) => ({ ...this.plain(po.lines[l.poLine]), qty: l.qty }));
    const { amounts, resolved } = await this.priced(orgId, vendor, chosen);
    const date = input.billDate ?? todayIst();
    const bill = await this.bills.create({
      orgId, actorId, vendorId: String(po.vendorId), billNumber: input.billNumber.trim(), billDate: date, dueDate: addDays(date, 30), amountsPaise: amounts,
      lineItems: resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 })), notes: `Against purchase order ${po.number}`,
      source: { kind: 'purchase_order', id: poId, lines: pick },
    });
    await this.closeIfDone(orgId, poId);
    return bill;
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
    const content = renderInvoicePdf({
      seller: { name: seller, address: settings?.address ?? null, gstin, pan: settings?.pan ?? null, stateCode: gstin?.slice(0, 2) ?? settings?.stateCode ?? null, phone: settings?.phone ?? null, email: settings?.email ?? null },
      buyer: { name: vendor?.name ?? 'Vendor', address: vendor?.address ?? null, gstin: vendor?.gstin ?? null, stateCode: vendor?.gstin?.slice(0, 2) ?? null },
      number: po.number, date: po.date, dueDate: null,
      lines: po.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, qty: l.qty, ratePaise: l.ratePaise, amountPaise: l.amountPaise, taxRatePct: l.taxRatePct })),
      amounts: po.amountsPaise, notes: po.notes, footer: 'Please quote this PO number on your invoice.', draft: false,
      title: 'PURCHASE ORDER', numberLabel: 'PO no.', partyLabel: 'TO', extraRows: po.expectedBy ? [['Needed by', po.expectedBy]] : [],
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

  private async priced(orgId: string, vendor: VendorDocument, input: DocLineInput[]) {
    if (!input?.length) throw new BadRequestException('Add at least one line.');
    input.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });
    const resolved = await this.items.resolveLines(orgId, input.map((l) => ({ description: l.description.trim(), itemId: l.itemId ?? null, hsnSac: l.hsnSac ?? null, uqc: l.uqc ?? null, qty: l.qty, ratePaise: l.ratePaise, amountPaise: lineAmount(l), taxRatePct: l.taxRatePct })), 'purchase');
    const lines = resolved.map((l) => ({ description: l.description, itemId: l.itemId, hsnSac: l.hsnSac ?? null, uqc: l.uqc, qty: l.qty ?? 1, ratePaise: l.ratePaise, amountPaise: l.amountPaise, taxRatePct: l.taxRatePct ?? 0 }));
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    return { lines, resolved, amounts: docAmounts(lines, isInterState(settings?.gstin?.slice(0, 2) ?? settings?.stateCode, vendor.gstin?.slice(0, 2) ?? null)) };
  }

  private plain(l: DocLine): DocLineInput {
    return { description: l.description, itemId: l.itemId ? String(l.itemId) : null, hsnSac: l.hsnSac, uqc: l.uqc, qty: l.qty, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct };
  }

  private async number(orgId: string, series: 'PURCHASE_ORDER' | 'GRN', prefix: string, date: string) {
    const fy = financialYearOf(date);
    return `${prefix}/${fy}/${String(await this.posting.nextDocumentNumber(orgId, series, fy)).padStart(4, '0')}`;
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
