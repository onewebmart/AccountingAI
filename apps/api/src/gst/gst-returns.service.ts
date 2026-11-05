import { partyAsIssued } from '../gl/party-as-issued';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteDocument } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteDocument } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import {
  buildGstr1,
  buildGstr3b,
  gstr1PortalJson,
  gstr3bPortalJson,
  Gstr1,
  Gstr3b,
  Issue,
  PurchaseIn,
  SaleIn,
} from './gst-returns';
import { Gstr2bLine, Gstr2bLineDocument } from './schemas/gstr2b-line.schema';
import { DirectExpense, DirectExpenseDocument } from '../direct-expenses/schemas/direct-expense.schema';
import { ExpenseClaim, ExpenseClaimDocument } from '../expenses/schemas/expense-claim.schema';
import { itcOf, type ClaimLine } from '../expenses/claim-rules';
import { BillForItc, Line2bForItc, claims, match2b, periodOf, rule37, rule37Watchlist, sumRows } from './itc';
import { explain2b } from './explain-2b';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Dates are stored as YYYY-MM-DD strings, so a month is a string range. */
function inPeriod(period: string) {
  return { $gte: `${period}-01`, $lte: `${period}-31` };
}

const ids = (values: Array<{ toString(): string }>) => [...new Set(values.map((v) => v.toString()))].map((id) => new Types.ObjectId(id));

/**
 * The month's GSTR-1 and GSTR-3B, worked out from posted documents.
 *
 * Only what reached the ledger counts: posted and paid invoices and bills, and
 * credit and debit notes not since reversed. A reversed invoice goes back to
 * draft, so it drops out of the return with its entry. The filing rules live in
 * gst-returns.ts; this only loads the month.
 */
@Injectable()
export class GstReturnsService {
  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(CreditNote.name) private creditNoteModel: Model<CreditNoteDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(DebitNote.name) private debitNoteModel: Model<DebitNoteDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(Gstr2bLine.name) private gstr2bModel: Model<Gstr2bLineDocument>,
    // Credit also comes from expenses paid straight from bank or cash, and from employees' claims.
    @Optional() @InjectModel(DirectExpense.name) private expenseModel?: Model<DirectExpenseDocument>,
    @Optional() @InjectModel(ExpenseClaim.name) private claimModel?: Model<ExpenseClaimDocument>,
  ) {}

  async gstr1(orgId: string, period: string): Promise<Gstr1> {
    this.checkPeriod(period);
    const [org, invoices, unpostedCount, notes] = await Promise.all([
      this.org(orgId),
      this.invoiceModel
        .find({ orgId, invoiceDate: inPeriod(period), isOpeningBalance: { $ne: true }, status: { $in: [InvoiceStatus.POSTED, InvoiceStatus.PAID] } })
        .sort({ invoiceDate: 1 })
        .lean()
        .exec(),
      this.invoiceModel
        .countDocuments({ orgId, invoiceDate: inPeriod(period), status: { $in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] } })
        .exec(),
      this.creditNoteModel.find({ orgId, noteDate: inPeriod(period), status: 'posted' }).sort({ noteDate: 1 }).lean().exec(),
    ]);

    // A note's invoice can be from an earlier month; its place and lines decide where the note goes.
    const noteInvoices = await this.invoiceModel.find({ orgId, _id: { $in: ids(notes.map((n) => n.invoiceId)) } }).lean().exec();
    const customers = await this.customerModel
      .find({ orgId, _id: { $in: ids([...invoices, ...noteInvoices].map((i) => i.customerId)) } })
      .lean()
      .exec();
    const customerById = new Map(customers.map((c) => [c._id.toString(), c]));
    const sale = (inv: (typeof invoices)[number]): SaleIn => {
      const customer = partyAsIssued(inv, customerById.get(inv.customerId.toString()), 'Unknown customer');
      return {
        id: inv._id.toString(),
        number: inv.invoiceNumber,
        date: inv.invoiceDate,
        customerName: customer.name,
        customerGstin: customer.gstin,
        customerState: customer.stateCode,
        amounts: inv.amountsPaise,
        // Each line at the value it was taxed on: its amount less its share of any discount.
        lines: (inv.lineItems ?? []).map((l) => ({ ...l, amountPaise: l.amountPaise - (l.discountPaise ?? 0) })),
        exportType: inv.exportType ?? null,
        shippingBill: inv.shippingBill ?? null,
      };
    };
    const noteInvoiceById = new Map(noteInvoices.map((i) => [i._id.toString(), i]));

    const result = buildGstr1({
      period,
      orgGstin: org.gstin,
      orgState: org.stateCode ?? '',
      invoices: invoices.map(sale),
      creditNotes: notes.flatMap((n) => {
        const inv = noteInvoiceById.get(n.invoiceId.toString());
        if (!inv) return [];
        // An itemised note is split by its own lines; a note by value, by its invoice's.
        const lines = (n.lines ?? []).map((l) => ({ ...l, amountPaise: l.amountPaise - (l.discountPaise ?? 0) }));
        return [{ id: n._id.toString(), number: n.noteNumber, date: n.noteDate, amounts: n.amountsPaise, invoice: sale(inv), ...(lines.length ? { lines } : {}) }];
      }),
      unpostedCount,
    });
    if (!org.stateCode) {
      result.issues.unshift({ level: 'block', message: 'Set your GST state in Settings — every place of supply is judged against it.' });
    }
    return result;
  }

  async gstr3b(orgId: string, period: string): Promise<Gstr3b> {
    const gstr1 = await this.gstr1(orgId, period);
    const org = await this.org(orgId);
    const [bills, notes] = await Promise.all([
      this.billModel
        .find({ orgId, billDate: inPeriod(period), isOpeningBalance: { $ne: true }, status: { $in: [BillStatus.POSTED, BillStatus.PAID] } })
        .lean()
        .exec(),
      this.debitNoteModel.find({ orgId, noteDate: inPeriod(period), status: 'posted' }).lean().exec(),
    ]);
    const noteBills = await this.billModel.find({ orgId, _id: { $in: ids(notes.map((n) => n.billId)) } }).lean().exec();
    const vendors = await this.vendorModel
      .find({ orgId, _id: { $in: ids([...bills, ...noteBills].map((b) => b.vendorId)) } })
      .lean()
      .exec();
    const vendorById = new Map(vendors.map((v) => [v._id.toString(), v]));
    const purchase = (bill: (typeof bills)[number]): PurchaseIn => {
      const vendor = partyAsIssued(bill, vendorById.get(bill.vendorId.toString()), 'Unknown vendor');
      return {
        id: bill._id.toString(),
        number: bill.billNumber,
        vendorName: vendor.name,
        vendorGstin: vendor.gstin,
        isReverseCharge: bill.isReverseCharge ?? false,
        amounts: bill.amountsPaise,
      };
    };
    const noteBillById = new Map(noteBills.map((b) => [b._id.toString(), b]));

    const itc = await this.itcFor(orgId, period);
    const others = await this.otherInward(orgId, `${period}-01`, `${period}-31`, org.stateCode);
    return buildGstr3b({
      gstr1,
      orgState: org.stateCode ?? '',
      itc: itc.forReturn,
      bills: [...bills.map(purchase), ...others.map((o) => ({ id: o.id, number: o.number, vendorName: o.vendorName, vendorGstin: o.vendorGstin, isReverseCharge: false, amounts: o.amounts }))],
      debitNotes: notes.flatMap((n) => {
        const bill = noteBillById.get(n.billId.toString());
        return bill ? [{ id: n._id.toString(), amounts: n.amountsPaise, bill: purchase(bill) }] : [];
      }),
    });
  }

  async gstr1Json(orgId: string, period: string): Promise<Record<string, unknown>> {
    return gstr1PortalJson(await this.gstr1(orgId, period));
  }

  async gstr3bJson(orgId: string, period: string): Promise<Record<string, unknown>> {
    return gstr3bPortalJson(await this.gstr3b(orgId, period));
  }

  /** Each 2B mismatch in plain words, with what to do and the message for the vendor. */
  async explain2b(orgId: string, period: string) {
    this.checkPeriod(period);
    const ctx = await this.itcContext(orgId, period);
    const org = await this.org(orgId);
    const items = explain2b({ period, ourGstin: org.gstin, lines: ctx.lines, bills: ctx.bills, matches: ctx.matches });
    return { period, has2b: ctx.periodsWith2b.has(period), items };
  }

  /** Bills whose 180 days to pay end soon, or have, with the credit they would cost. */
  async rule37Watchlist(orgId: string, asOf: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new BadRequestException('asOf must be a date like 2026-11-04');
    const ctx = await this.itcContext(orgId, periodOf(asOf));
    return rule37Watchlist(asOf, ctx.bills, ctx.claimed);
  }

  private async itcFor(orgId: string, period: string) {
    const ctx = await this.itcContext(orgId, period);
    const has2b = ctx.periodsWith2b.has(period);
    const mine = [...ctx.claimed.values()].filter((c) => c.period === period);
    const claimed = sumRows(mine);
    const { reversed, reclaimed } = rule37(period, ctx.bills, ctx.claimed);
    const notes: Issue[] = [];
    const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const gst = (h: { iamt: number; camt: number; samt: number; csamt: number }) => h.iamt + h.camt + h.samt + h.csamt;
    if (!has2b) {
      notes.push({ level: 'note', message: `No GSTR-2B imported for ${period}: credit is claimed on every bill dated in the month. Credit is only allowed for what your suppliers report, so import the 2B to claim it correctly.` });
    } else {
      const waiting = ctx.bills.filter((b) => periodOf(b.billDate) === period && !b.isReverseCharge && gst(b.heads) > 0 && !ctx.claimed.has(b.id));
      if (waiting.length) {
        notes.push({
          level: 'note',
          message: `${waiting.length} bill${waiting.length === 1 ? ' is' : 's are'} not in your 2B for ${period} (${rs(waiting.reduce((s, b) => s + gst(b.heads), 0))} of GST). That credit waits until the vendor reports it; see the 2B explanations.`,
        });
      }
      const late = mine.filter((c) => ctx.bills.find((b) => b.id === c.billId && periodOf(b.billDate) < period));
      if (late.length) notes.push({ level: 'note', message: `${late.length} earlier bill${late.length === 1 ? ' is' : 's are'} claimed this month, now that the vendor has reported ${late.length === 1 ? 'it' : 'them'}.` });
    }
    if (reversed.length) {
      notes.push({
        level: 'note',
        message: `${rs(gst(sumRows(reversed)))} of credit reversed (table 4(B)(2)) on ${reversed.length} bill${reversed.length === 1 ? '' : 's'} not paid within 180 days. It is claimed again in the month you pay. Interest may be due on it.`,
      });
    }
    return { forReturn: { basis: has2b ? ('twoB' as const) : ('date' as const), claimed, reversed: sumRows(reversed), reclaimed: sumRows(reclaimed), notes }, reversed, reclaimed };
  }

  /**
   * The bills and 2B lines the ITC rules need: two years back, so a bill
   * reported late, or reversed and paid late, is still seen.
   */
  private async itcContext(orgId: string, period: string) {
    const [y, m] = period.split('-').map(Number);
    const from = `${y - 2}-${String(m).padStart(2, '0')}`;
    const [bills, lines] = await Promise.all([
      this.billModel
        .find({ orgId, billDate: { $gte: `${from}-01`, $lte: `${period}-31` }, isOpeningBalance: { $ne: true }, status: { $in: [BillStatus.POSTED, BillStatus.PAID] } })
        .lean()
        .exec(),
      this.gstr2bModel.find({ orgId, period: { $gte: from, $lte: period } }).lean().exec(),
    ]);
    const vendors = await this.vendorModel.find({ orgId, _id: { $in: ids(bills.map((b) => b.vendorId)) } }).lean().exec();
    const vendorById = new Map(vendors.map((v) => [v._id.toString(), v]));
    const forItc: BillForItc[] = bills.map((b) => {
      const vendor = partyAsIssued(b, vendorById.get(b.vendorId.toString()), 'Unknown vendor');
      const a = b.amountsPaise;
      return {
        id: b._id.toString(),
        number: b.billNumber,
        vendorName: vendor.name,
        vendorGstin: vendor.gstin,
        billDate: b.billDate,
        isReverseCharge: b.isReverseCharge ?? false,
        heads: { txval: a.taxableValue, iamt: a.igst, camt: a.cgst, samt: a.sgst, csamt: a.cess },
        totalPaise: a.total,
        tdsPaise: b.tds?.amountPaise ?? 0,
        // A bill marked paid before part payments were tracked counts as paid on its date.
        settlements: b.status === BillStatus.PAID && !(b.payments ?? []).length && !(b.adjustments ?? []).length
          ? [{ date: b.billDate, amountPaise: a.total }]
          : [
              ...(b.payments ?? []).map((p) => ({ date: p.paidOn, amountPaise: p.amountPaise })),
              ...(b.adjustments ?? []).map((n) => ({ date: n.noteDate, amountPaise: n.amountPaise + (n.tdsPaise ?? 0) })),
            ],
      };
    });
    const org = await this.org(orgId);
    for (const o of await this.otherInward(orgId, `${from}-01`, `${period}-31`, org.stateCode)) {
      const a = o.amounts;
      forItc.push({
        id: o.id, number: o.number, vendorName: o.vendorName, vendorGstin: o.vendorGstin, billDate: o.date, isReverseCharge: false,
        heads: { txval: a.taxableValue, iamt: a.igst, camt: a.cgst, samt: a.sgst, csamt: a.cess },
        totalPaise: a.total, tdsPaise: 0,
        // Paid when it was spent: an expense from the bank, a claim the employee paid.
        settlements: [{ date: o.date, amountPaise: a.total }],
      });
    }
    const forLines: Line2bForItc[] = lines
      .filter((l) => (l.documentType ?? 'B2B') === 'B2B')
      .map((l) => ({
        id: l._id.toString(),
        period: l.period,
        gstin: l.supplierGstin,
        supplierName: l.supplierName,
        number: l.invoiceNumber,
        date: l.invoiceDate,
        isReverseCharge: l.isReverseCharge ?? false,
        heads: { txval: l.taxableValuePaise, iamt: l.igstPaise, camt: l.cgstPaise, samt: l.sgstPaise, csamt: l.cessPaise },
      }));
    const periodsWith2b = new Set(lines.map((l) => l.period));
    return {
      bills: forItc,
      lines: forLines,
      periodsWith2b,
      matches: match2b(forLines, forItc, periodsWith2b),
      claimed: claims(forLines, forItc, periodsWith2b),
    };
  }

  /**
   * Inward supplies with input credit that are not bills: posted expenses whose
   * GST is claimed, and posted claim lines whose GST can be claimed, split as
   * the claim was booked. Each as a document the credit rules can match to 2B.
   */
  private async otherInward(orgId: string, fromDate: string, toDate: string, orgState: string | null) {
    const out: Array<{ id: string; number: string | null; vendorName: string; vendorGstin: string | null; date: string; amounts: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number } }> = [];
    if (this.expenseModel) {
      const expenses = await this.expenseModel
        .find({ orgId, status: 'posted', claimable: true, date: { $gte: fromDate, $lte: toDate } })
        .lean()
        .exec();
      const withTax = expenses.filter((e) => e.cgstPaise + e.sgstPaise + e.igstPaise > 0);
      const vendors = await this.vendorModel.find({ orgId, _id: { $in: ids(withTax.flatMap((e) => (e.vendorId ? [e.vendorId] : []))) } }).select('name').lean().exec();
      const vendorName = new Map(vendors.map((v) => [v._id.toString(), v.name]));
      for (const e of withTax) {
        out.push({
          id: e._id.toString(),
          number: e.reference ?? e.number,
          vendorName: (e.vendorId && vendorName.get(e.vendorId.toString())) || 'Supplier',
          vendorGstin: e.vendorGstin,
          date: e.date,
          amounts: { taxableValue: e.taxablePaise, cgst: e.cgstPaise, sgst: e.sgstPaise, igst: e.igstPaise, cess: 0, total: e.totalPaise },
        });
      }
    }
    if (this.claimModel) {
      const claims = await this.claimModel.find({ orgId, status: { $in: ['posted', 'paid'] }, 'lines.date': { $gte: fromDate, $lte: toDate } }).lean().exec();
      for (const c of claims) {
        c.lines.forEach((l, i) => {
          if (l.date < fromDate || l.date > toDate) return;
          const { itcPaise } = itcOf(l as unknown as ClaimLine);
          if (itcPaise <= 0) return;
          const intra = !!orgState && l.merchantGstin?.slice(0, 2) === orgState;
          const half = Math.round(itcPaise / 2);
          out.push({
            id: `${c._id.toString()}:${i}`,
            number: `${c.number} line ${i + 1}`,
            vendorName: l.merchant ?? 'Merchant',
            vendorGstin: l.merchantGstin,
            date: l.date,
            amounts: { taxableValue: l.amountPaise - itcPaise, cgst: intra ? half : 0, sgst: intra ? itcPaise - half : 0, igst: intra ? 0 : itcPaise, cess: 0, total: l.amountPaise },
          });
        });
      }
    }
    return out;
  }

  /** The org's GSTIN and state; the GSTIN's first two digits win over a picked state. */
  private async org(orgId: string): Promise<{ gstin: string | null; stateCode: string | null }> {
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const gstin = settings?.gstin?.trim().toUpperCase() || null;
    return { gstin, stateCode: gstin?.slice(0, 2) ?? settings?.stateCode ?? null };
  }

  private checkPeriod(period: string) {
    if (!PERIOD.test(period ?? '')) throw new BadRequestException('period must be a month like 2026-09');
  }
}
