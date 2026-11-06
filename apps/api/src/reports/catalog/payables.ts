/**
 * Payables: what is owed to vendors and by how late, bills, purchase
 * orders, vendor credits, and MSME dues under section 43B(h). From posted
 * bills and debit notes; purchase orders as they stand.
 */
import { Types } from 'mongoose';
import { bucketOf } from '../management';
import { outstandingPaise } from '../../gl/schemas/settlement.schema';
import { msmePayBy, msmeProtected } from '../../purchase/msme';
import { fyMonths } from '../management';
import { Cell, FilterDef, ReportDef, RunCtx, asOfDate, daysBetween, listTable, money, num, rangeDates, statusLabel, text } from './types';
import { DONE_BILL, gstOf, issuedTo, owedAsOf } from './documents';

const VENDOR: FilterDef = { key: 'vendorId', label: 'Vendor', kind: 'vendor' };
const BUCKETS = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'];
const oid = (id?: string | null) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const party = (ctx: RunCtx) => (oid(ctx.p.vendorId) ? { vendorId: oid(ctx.p.vendorId) } : {});

async function billsBy(ctx: RunCtx, asOf: string) {
  return ctx.data.bills.find({ orgId: ctx.orgId, status: { $in: DONE_BILL }, billDate: { $lte: asOf }, ...party(ctx) }).sort({ billDate: 1 }).lean().exec();
}

type Bill = Awaited<ReturnType<typeof billsBy>>[number];
const billState = (b: Bill, owed: number, asOf: string) => (owed <= 0 ? 'Paid' : (b.dueDate ?? b.billDate) < asOf ? 'Overdue' : (b.amountPaidPaise ?? 0) > 0 ? 'Partly paid' : 'Open');

const apAgeingDetails: ReportDef = {
  key: 'ap_ageing_details', title: 'AP ageing details', category: 'payables', params: 'asof', shape: 'list', filters: [VENDOR],
  description: 'Every bill still owed at a date, how many days overdue, and its ageing bucket.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const bills = await billsBy(ctx, asOf);
    const names = await ctx.data.names('vendors', ctx.orgId, bills.map((b) => b.vendorId));
    const rows: Cell[][] = bills
      .map((b) => ({ b, owed: owedAsOf(b, asOf) }))
      .filter((x) => x.owed > 0)
      .sort((a, b) => (a.b.dueDate ?? a.b.billDate).localeCompare(b.b.dueDate ?? b.b.billDate))
      .map(({ b, owed }) => [b.billDate, b.billNumber ?? '', issuedTo(b, names, b.vendorId, 'Unknown vendor'), b.dueDate ?? '', Math.max(0, daysBetween(b.dueDate ?? b.billDate, asOf)), BUCKETS[bucketOf(b.dueDate, b.billDate, asOf)], b.amountsPaise.total, owed]);
    const columns = [text('date', 'Date'), text('number', 'Bill'), text('vendor', 'Vendor'), text('due', 'Due date'), num('days', 'Days overdue'), text('bucket', 'Bucket'), money('total', 'Bill total'), money('balance', 'Balance due')];
    return listTable({ key: 'ap_ageing_details', title: 'AP ageing details', subtitle: `As at ${asOf}`, columns, rows, sum: ['total', 'balance'], notes: ['What the vendor is owed after TDS deducted. Overdue counts from the due date, or the bill date when there is none.'] });
  },
};

const billDetails: ReportDef = {
  key: 'bill_details', title: 'Bill details', category: 'payables', params: 'range', shape: 'list',
  filters: [VENDOR, { key: 'status', label: 'Status', kind: 'select', options: [['open', 'Open'], ['overdue', 'Overdue'], ['partly_paid', 'Partly paid'], ['paid', 'Paid']] }],
  description: 'Every posted bill in the period with its status, tax, TDS, total and balance.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const bills = await ctx.data.bills.find({ orgId: ctx.orgId, status: { $in: DONE_BILL }, isOpeningBalance: { $ne: true }, billDate: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx) }).sort({ billDate: 1 }).lean().exec();
    const names = await ctx.data.names('vendors', ctx.orgId, bills.map((b) => b.vendorId));
    const want = ctx.p.status ? statusLabel(ctx.p.status) : null;
    const rows: Cell[][] = bills
      .map((b) => { const owed = outstandingPaise(b); return { b, owed, state: billState(b, owed, ctx.today) }; })
      .filter((x) => !want || x.state === want)
      .map(({ b, owed, state }) => [b.billDate, b.billNumber ?? '', issuedTo(b, names, b.vendorId, 'Unknown vendor'), state, b.dueDate ?? '', b.isReverseCharge ? 'Yes' : '', b.amountsPaise.taxableValue, gstOf(b.amountsPaise), b.tds?.amountPaise ?? 0, b.amountsPaise.total, owed]);
    const columns = [text('date', 'Date'), text('number', 'Bill'), text('vendor', 'Vendor'), text('status', 'Status'), text('due', 'Due date'), text('rcm', 'Reverse charge'), money('taxable', 'Taxable value'), money('gst', 'GST'), money('tds', 'TDS'), money('total', 'Total'), money('balance', 'Balance due')];
    return listTable({ key: 'bill_details', title: 'Bill details', subtitle: r.label, columns, rows, sum: ['taxable', 'gst', 'tds', 'total', 'balance'], notes: ['Posted bills by their date. Balance due is as it stands today, after TDS.'] });
  },
};

const vendorBalances: ReportDef = {
  key: 'vendor_balance_summary', title: 'Vendor balance summary', category: 'payables', params: 'asof', shape: 'list', filters: [VENDOR],
  description: 'For each vendor at a date: billed, TDS, vendor credits, paid, and the balance still due.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const bills = await billsBy(ctx, asOf);
    const names = await ctx.data.names('vendors', ctx.orgId, bills.map((b) => b.vendorId));
    const by = new Map<string, number[]>();
    for (const b of bills) {
      const k = String(b.vendorId);
      const x = by.get(k) ?? by.set(k, [0, 0, 0, 0, 0]).get(k)!;
      x[0] += b.amountsPaise.total;
      x[1] += b.tds?.amountPaise ?? 0;
      x[2] += (b.adjustments ?? []).filter((a) => a.noteDate <= asOf).reduce((s, a) => s + a.amountPaise, 0);
      x[3] += (b.payments ?? []).filter((p) => p.paidOn <= asOf).reduce((s, p) => s + p.amountPaise + (p.tdsPaise ?? 0), 0);
      x[4] += owedAsOf(b, asOf);
    }
    const rows: Cell[][] = [...by].map(([id, x]) => [names.get(id) ?? 'Unknown vendor', ...x] as Cell[]).filter((r) => r.slice(1).some((v) => v !== 0)).sort((a, b) => (b[5] as number) - (a[5] as number) || String(a[0]).localeCompare(String(b[0])));
    const columns = [text('vendor', 'Vendor'), money('billed', 'Billed'), money('tds', 'TDS deducted'), money('credits', 'Vendor credits'), money('paid', 'Paid'), money('balance', 'Balance due')];
    return listTable({ key: 'vendor_balance_summary', title: 'Vendor balance summary', subtitle: `As at ${asOf}`, columns, rows, sum: ['billed', 'tds', 'credits', 'paid', 'balance'], notes: ['Bills to the date with credits and payments dated by then. Under reverse charge the vendor is owed the bill before GST.'] });
  },
};

const payableSummary: ReportDef = {
  key: 'payable_summary', title: 'Payable summary', category: 'payables', params: 'asof', shape: 'list', filters: [VENDOR],
  description: 'Every bill with something still due at a date: status, total and balance.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const bills = await billsBy(ctx, asOf);
    const names = await ctx.data.names('vendors', ctx.orgId, bills.map((b) => b.vendorId));
    const rows: Cell[][] = bills
      .map((b) => ({ b, owed: owedAsOf(b, asOf) }))
      .filter((x) => x.owed > 0)
      .map(({ b, owed }) => [issuedTo(b, names, b.vendorId, 'Unknown vendor'), b.billNumber ?? '', b.billDate, b.dueDate ?? '', billState(b, owed, asOf), b.amountsPaise.total, owed]);
    const columns = [text('vendor', 'Vendor'), text('number', 'Bill'), text('date', 'Date'), text('due', 'Due date'), text('status', 'Status'), money('total', 'Total'), money('balance', 'Balance due')];
    return listTable({ key: 'payable_summary', title: 'Payable summary', subtitle: `As at ${asOf}`, columns, rows, sum: ['total', 'balance'], notes: ['Posted bills with a balance at the date.'] });
  },
};

const payableDetails: ReportDef = {
  key: 'payable_details', title: 'Payable details', category: 'payables', params: 'asof', shape: 'list', filters: [VENDOR],
  description: 'The lines of every bill still owed at a date, with the bill’s balance.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const bills = (await billsBy(ctx, asOf)).map((b) => ({ b, owed: owedAsOf(b, asOf) })).filter((x) => x.owed > 0);
    const [names, items] = await Promise.all([
      ctx.data.names('vendors', ctx.orgId, bills.map((x) => x.b.vendorId)),
      ctx.data.names('items', ctx.orgId, bills.flatMap((x) => (x.b.lineItems ?? []).map((l) => l.itemId))),
    ]);
    const rows: Cell[][] = bills.flatMap(({ b, owed }) =>
      (b.lineItems ?? []).map((l, n) => [issuedTo(b, names, b.vendorId, 'Unknown vendor'), b.billNumber ?? '', b.billDate, (l.itemId && items.get(String(l.itemId))) || l.description, l.qty, l.ratePaise, l.amountPaise - (l.discountPaise ?? 0), n === 0 ? owed : null]),
    );
    const columns = [text('vendor', 'Vendor'), text('number', 'Bill'), text('date', 'Date'), text('item', 'Item'), num('qty', 'Quantity'), money('rate', 'Rate'), money('amount', 'Line amount'), money('balance', 'Bill balance')];
    return listTable({ key: 'payable_details', title: 'Payable details', subtitle: `As at ${asOf}`, columns, rows, sum: ['amount', 'balance'], notes: ['Line amounts before GST. The bill balance is on each bill’s first line.'] });
  },
};

const poDetails: ReportDef = {
  key: 'purchase_order_details', title: 'Purchase order details', category: 'payables', params: 'range', shape: 'list',
  filters: [VENDOR, { key: 'status', label: 'Status', kind: 'select', options: [['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled']] }],
  description: 'Purchase orders in the period: vendor, status, expected date and value.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const orders = await ctx.data.purchaseOrders.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx), ...(ctx.p.status ? { status: ctx.p.status } : {}) }).sort({ date: 1, number: 1 }).lean().exec();
    const names = await ctx.data.names('vendors', ctx.orgId, orders.map((o) => o.vendorId));
    const rows: Cell[][] = orders.map((o) => [o.date, o.number, names.get(String(o.vendorId)) ?? 'Unknown vendor', statusLabel(o.status), o.expectedBy ?? '', o.referenceNumber ?? '', (o.lines ?? []).length, o.amountsPaise.taxableValue, o.amountsPaise.total]);
    const columns = [text('date', 'Date'), text('number', 'Purchase order'), text('vendor', 'Vendor'), text('status', 'Status'), text('expected', 'Expected by'), text('reference', 'Reference'), num('lines', 'Lines'), money('taxable', 'Taxable value'), money('total', 'Total')];
    return listTable({ key: 'purchase_order_details', title: 'Purchase order details', subtitle: r.label, columns, rows, sum: ['lines', 'taxable', 'total'], notes: ['Purchase orders are commitments: they are not in the books until billed.'] });
  },
};

const vendorCredits: ReportDef = {
  key: 'vendor_credit_details', title: 'Vendor credit details', category: 'payables', params: 'range', shape: 'list', filters: [VENDOR],
  description: 'Posted debit notes (vendor credits) in the period: the bill, the reason, tax and total.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const notes = await ctx.data.debitNotes.find({ orgId: ctx.orgId, status: 'posted', noteDate: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx) }).sort({ noteDate: 1, noteNumber: 1 }).lean().exec();
    const [names, bills] = await Promise.all([
      ctx.data.names('vendors', ctx.orgId, notes.map((n) => n.vendorId)),
      ctx.data.bills.find({ orgId: ctx.orgId, _id: { $in: notes.map((n) => n.billId) } }, { billNumber: 1 }).lean().exec(),
    ]);
    const number = new Map(bills.map((b) => [String(b._id), b.billNumber]));
    const rows: Cell[][] = notes.map((n) => [n.noteDate, n.noteNumber, n.vendorCreditNumber ?? '', names.get(String(n.vendorId)) ?? 'Unknown vendor', number.get(String(n.billId)) ?? '', n.reason, n.amountsPaise.taxableValue, gstOf(n.amountsPaise), n.tdsPaise ?? 0, n.amountsPaise.total]);
    const columns = [text('date', 'Date'), text('number', 'Debit note'), text('vendorNumber', 'Vendor’s credit note'), text('vendor', 'Vendor'), text('bill', 'Bill'), text('reason', 'Reason'), money('taxable', 'Taxable value'), money('gst', 'GST'), money('tds', 'TDS given back'), money('total', 'Total')];
    return listTable({ key: 'vendor_credit_details', title: 'Vendor credit details', subtitle: r.label, columns, rows, sum: ['taxable', 'gst', 'tds', 'total'], notes: ['Posted debit notes by their date.'] });
  },
};

/** One bill under section 43B(h): its pay-by date and where it stands at a date. */
export function msmeStanding(bill: { payBy: string; owed: number; paidOffOn: string | null }, asOf: string): { status: string; daysLate: number; atRisk: number } {
  if (bill.owed <= 0) {
    const late = bill.paidOffOn ? Math.max(0, daysBetween(bill.payBy, bill.paidOffOn)) : 0;
    return { status: late > 0 ? 'Paid late' : 'Paid on time', daysLate: late, atRisk: 0 };
  }
  if (bill.payBy >= asOf) return { status: `Due by ${bill.payBy}`, daysLate: 0, atRisk: 0 };
  return { status: 'Overdue: pay before the year ends to keep the deduction', daysLate: daysBetween(bill.payBy, asOf), atRisk: bill.owed };
}

const msme43bh: ReportDef = {
  key: 'msme_43bh', title: 'MSME dues (section 43B(h))', category: 'payables', params: 'asof', shape: 'list', filters: [VENDOR],
  description: 'Bills of micro and small enterprises this financial year: the day each must be paid by, and what is late.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const fy = fyMonths(asOf.slice(0, 7));
    const vendors = await ctx.data.vendors.find({ orgId: ctx.orgId, msme: { $ne: null }, ...(oid(ctx.p.vendorId) ? { _id: oid(ctx.p.vendorId) } : {}) }, { name: 1, msme: 1 }).lean().exec();
    const protectedVendors = new Map(vendors.filter((v) => msmeProtected(v.msme)).map((v) => [String(v._id), v]));
    const bills = protectedVendors.size
      ? await ctx.data.bills.find({ orgId: ctx.orgId, status: { $in: DONE_BILL }, vendorId: { $in: [...protectedVendors.keys()].map((id) => new Types.ObjectId(id)) }, billDate: { $gte: `${fy.from}-01`, $lte: asOf } }).sort({ billDate: 1 }).lean().exec()
      : [];
    const rows: Cell[][] = bills.map((b) => {
      const v = protectedVendors.get(String(b.vendorId))!;
      const payBy = msmePayBy(b.billDate, b.dueDate, v.msme)!;
      const owed = owedAsOf(b, asOf);
      const paidOffOn = owed <= 0 ? [...(b.payments ?? []).map((p) => p.paidOn), ...(b.adjustments ?? []).map((a) => a.noteDate)].filter((d) => d <= asOf).sort().pop() ?? null : null;
      const s = msmeStanding({ payBy, owed, paidOffOn }, asOf);
      return [v.name, v.msme!.udyamNumber, statusLabel(v.msme!.category), b.billNumber ?? '', b.billDate, payBy, paidOffOn ?? '', s.status, s.daysLate, b.amountsPaise.total, owed, s.atRisk];
    });
    const columns = [text('vendor', 'Vendor'), text('udyam', 'Udyam number'), text('category', 'Category'), text('bill', 'Bill'), text('date', 'Bill date'), text('payBy', 'Pay by'), text('paidOn', 'Paid off on'), text('status', 'Status'), num('daysLate', 'Days late'), money('total', 'Bill total'), money('owed', 'Unpaid'), money('atRisk', 'Deduction at risk')];
    return listTable({
      key: 'msme_43bh', title: 'MSME dues (section 43B(h))', subtitle: `Financial year ${fy.fy}, as at ${asOf}`, columns, rows, sum: ['total', 'owed', 'atRisk'],
      notes: [
        'Section 43B(h) of the Income-tax Act with section 15 of the MSMED Act: a micro or small enterprise (manufacturing or services) must be paid within 15 days, or the agreed day up to 45 days with a written agreement.',
        'Paid later, the expense is deductible only in the year it is actually paid: what is still unpaid on 31 March is the deduction at risk. The bill date stands in for the day of acceptance.',
      ],
    });
  },
};

export const PAYABLE_REPORTS: ReportDef[] = [apAgeingDetails, billDetails, vendorBalances, payableSummary, payableDetails, poDetails, vendorCredits, msme43bh];
