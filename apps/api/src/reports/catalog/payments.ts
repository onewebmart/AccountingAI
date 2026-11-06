/**
 * Payments Received and Payments Made: every receipt and payment, credit
 * notes, refunds, and how long customers take to pay. From posted party
 * payments and the settlements on posted invoices and bills.
 */
import { Types } from 'mongoose';
import { Cell, FilterDef, ReportDef, RunCtx, daysBetween, listTable, money, num, rangeDates, statusLabel, text } from './types';
import { DONE_INVOICE, gstOf, issuedTo } from './documents';

const CUSTOMER: FilterDef = { key: 'customerId', label: 'Customer', kind: 'customer' };
const VENDOR: FilterDef = { key: 'vendorId', label: 'Vendor', kind: 'vendor' };
const oid = (id?: string | null) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

const MODE: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', upi: 'UPI', card: 'Card', other: 'Other', bank: 'Bank', gateway: 'Online' };

/**
 * Money that came in from customers (or went out to vendors) in a period:
 * each posted receipt or payment, and each settlement recorded straight on
 * an invoice or bill. An advance applied later moves no money, so it is not
 * counted again.
 */
async function moneyMoves(ctx: RunCtx, side: 'receipt' | 'payment', fromDate: string, toDate: string) {
  const partyId = side === 'receipt' ? oid(ctx.p.customerId) : oid(ctx.p.vendorId);
  const payments = await ctx.data.payments
    .find({ orgId: ctx.orgId, kind: side, status: 'posted', source: 'money', date: { $gte: fromDate, $lte: toDate }, ...(partyId ? { partyId } : {}) })
    .sort({ date: 1, number: 1 })
    .lean()
    .exec();
  const docModel = side === 'receipt' ? ctx.data.invoices : ctx.data.bills;
  const partyField = side === 'receipt' ? 'customerId' : 'vendorId';
  const docs = (await (docModel as unknown as import('mongoose').Model<Record<string, unknown>>)
    .find({ orgId: ctx.orgId, 'payments.paidOn': { $gte: fromDate, $lte: toDate }, ...(partyId ? { [partyField]: partyId } : {}) })
    .lean()
    .exec()) as unknown as Array<{ _id: Types.ObjectId; invoiceNumber?: string | null; billNumber?: string | null; customerId?: Types.ObjectId; vendorId?: Types.ObjectId; partyAtIssue?: { name?: string } | null; payments?: Array<{ journalId: Types.ObjectId; paidOn: string; amountPaise: number; tdsPaise?: number }> }>;
  const settlements = docs.flatMap((d) => (d.payments ?? []).filter((p) => p.paidOn >= fromDate && p.paidOn <= toDate).map((p) => ({ d, p })));
  const journalIds = settlements.map((s) => s.p.journalId);
  // Settlements made by a receipt or payment voucher, or by applying an advance.
  const viaPayments = journalIds.length
    ? await ctx.data.payments.find({ orgId: ctx.orgId, kind: side, $or: [{ journalId: { $in: journalIds } }, { 'allocations.journalId': { $in: journalIds } }] }, { journalId: 1, allocations: 1 }).lean().exec()
    : [];
  const covered = new Set(viaPayments.flatMap((p) => [String(p.journalId), ...(p.allocations ?? []).map((a) => String(a.journalId))]));
  const direct = settlements.filter((s) => !covered.has(String(s.p.journalId)));
  const names = await ctx.data.names(side === 'receipt' ? 'customers' : 'vendors', ctx.orgId, direct.map((s) => s.d[partyField]));
  return { payments, direct, names };
}

function moneyTable(ctx: RunCtx, side: 'receipt' | 'payment', m: Awaited<ReturnType<typeof moneyMoves>>, label: string) {
  const rows: Array<{ date: string; cells: Cell[] }> = [
    ...m.payments.map((p) => ({
      date: p.date,
      cells: [
        p.date, p.number ?? '', p.partyName, MODE[p.mode ?? p.via] ?? statusLabel(p.mode ?? p.via), p.depositAccountName ?? '',
        (p.allocations ?? []).filter((a) => String(a.journalId) === String(p.journalId)).map((a) => a.documentNumber).filter(Boolean).join(', '),
        p.amountPaise, p.tdsPaise ?? 0, p.unappliedPaise,
      ] as Cell[],
    })),
    ...m.direct.map(({ d, p }) => ({
      date: p.paidOn,
      cells: [p.paidOn, '', issuedTo(d, m.names, side === 'receipt' ? d.customerId : d.vendorId), 'Recorded on the document', '', (side === 'receipt' ? d.invoiceNumber : d.billNumber) ?? '', p.amountPaise, p.tdsPaise ?? 0, 0] as Cell[],
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const receipt = side === 'receipt';
  const columns = [
    text('date', 'Date'), text('number', receipt ? 'Receipt' : 'Payment'), text('party', receipt ? 'Customer' : 'Vendor'), text('mode', 'Mode'),
    text('account', receipt ? 'Deposited to' : 'Paid from'), text('documents', receipt ? 'Invoices' : 'Bills'), money('amount', 'Amount'), money('tds', 'TDS'), money('unused', 'Advance not yet applied'),
  ];
  return listTable({
    key: receipt ? 'payments_received' : 'payments_made', title: receipt ? 'Payments received' : 'Payments made', subtitle: label, columns, rows: rows.map((r) => r.cells), sum: ['amount', 'tds', 'unused'],
    notes: [receipt ? 'Every posted receipt, and payments recorded straight on an invoice. An advance applied to an invoice later is not counted again.' : 'Every posted payment, and payments recorded straight on a bill. TDS is what the customer deducted on a receipt.'],
  });
}

const paymentsReceived: ReportDef = {
  key: 'payments_received', title: 'Payments received', category: 'payments_received', params: 'range', shape: 'list', filters: [CUSTOMER],
  description: 'Every receipt from customers in the period, how it came in and what it paid.',
  async run(ctx) {
    const r = rangeDates(ctx);
    return moneyTable(ctx, 'receipt', await moneyMoves(ctx, 'receipt', r.fromDate, r.toDate), r.label);
  },
};

const paymentsMade: ReportDef = {
  key: 'payments_made', title: 'Payments made', category: 'payables', params: 'range', shape: 'list', filters: [VENDOR],
  description: 'Every payment to vendors in the period, from which account and against which bills.',
  async run(ctx) {
    const r = rangeDates(ctx);
    return moneyTable(ctx, 'payment', await moneyMoves(ctx, 'payment', r.fromDate, r.toDate), r.label);
  },
};

const creditNoteDetails: ReportDef = {
  key: 'credit_note_details', title: 'Credit note details', category: 'payments_received', params: 'range', shape: 'list', filters: [CUSTOMER],
  description: 'Posted credit notes in the period: the invoice, the reason, tax and total.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const c = oid(ctx.p.customerId);
    const notes = await ctx.data.creditNotes.find({ orgId: ctx.orgId, status: 'posted', noteDate: { $gte: r.fromDate, $lte: r.toDate }, ...(c ? { customerId: c } : {}) }).sort({ noteDate: 1, noteNumber: 1 }).lean().exec();
    const [names, invoices] = await Promise.all([
      ctx.data.names('customers', ctx.orgId, notes.map((n) => n.customerId)),
      ctx.data.invoices.find({ orgId: ctx.orgId, _id: { $in: notes.map((n) => n.invoiceId) } }, { invoiceNumber: 1 }).lean().exec(),
    ]);
    const number = new Map(invoices.map((i) => [String(i._id), i.invoiceNumber]));
    const rows: Cell[][] = notes.map((n) => [n.noteDate, n.noteNumber, names.get(String(n.customerId)) ?? 'Unknown customer', number.get(String(n.invoiceId)) ?? '', n.reason, n.amountsPaise.taxableValue, gstOf(n.amountsPaise), n.amountsPaise.total]);
    const columns = [text('date', 'Date'), text('number', 'Credit note'), text('customer', 'Customer'), text('invoice', 'Invoice'), text('reason', 'Reason'), money('taxable', 'Taxable value'), money('gst', 'GST'), money('total', 'Total')];
    return listTable({ key: 'credit_note_details', title: 'Credit note details', subtitle: r.label, columns, rows, sum: ['taxable', 'gst', 'total'], notes: ['Posted credit notes by their date; reversed notes are left out.'] });
  },
};

function refunds(side: 'receipt' | 'payment'): ReportDef {
  const receipt = side === 'receipt';
  return {
    key: receipt ? 'customer_refund_history' : 'vendor_refund_history',
    title: receipt ? 'Refund history (customers)' : 'Refund history (vendors)',
    category: receipt ? 'payments_received' : 'payables', params: 'range', shape: 'list', filters: [receipt ? CUSTOMER : VENDOR],
    description: receipt ? 'Money paid back to customers out of their advances and credit notes.' : 'Money vendors paid back to you out of advances and vendor credits.',
    async run(ctx) {
      const r = rangeDates(ctx);
      const partyId = receipt ? oid(ctx.p.customerId) : oid(ctx.p.vendorId);
      const list = await ctx.data.payments.find({ orgId: ctx.orgId, kind: side, 'refunds.date': { $gte: r.fromDate, $lte: r.toDate }, ...(partyId ? { partyId } : {}) }).lean().exec();
      const rows: Cell[][] = list
        .flatMap((p) => (p.refunds ?? []).filter((x) => x.date >= r.fromDate && x.date <= r.toDate).map((x) => [x.date, p.partyName, p.number ?? '', p.source === 'money' ? 'Advance' : p.source === 'credit_note' ? 'Credit note' : 'Vendor credit', MODE[x.via] ?? x.via, x.amountPaise] as Cell[]))
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const columns = [text('date', 'Date'), text('party', receipt ? 'Customer' : 'Vendor'), text('number', 'From'), text('source', 'Refund of'), text('via', 'Paid by'), money('amount', 'Amount')];
      return listTable({ key: receipt ? 'customer_refund_history' : 'vendor_refund_history', title: receipt ? 'Refund history (customers)' : 'Refund history (vendors)', subtitle: r.label, columns, rows, sum: ['amount'], notes: ['Refunds are posted against the advance or credit they come out of.'] });
    },
  };
}

/** Per customer: how many of the invoices paid off in the period were paid within 15, 30, 45 days or later. */
export function timeToGetPaid(facts: Array<{ customer: string; days: number; amountPaise: number }>) {
  const by = new Map<string, { n: number; b: number[]; weighted: number; amount: number }>();
  for (const f of facts) {
    const x = by.get(f.customer) ?? by.set(f.customer, { n: 0, b: [0, 0, 0, 0], weighted: 0, amount: 0 }).get(f.customer)!;
    x.n++;
    x.b[f.days <= 15 ? 0 : f.days <= 30 ? 1 : f.days <= 45 ? 2 : 3]++;
    x.weighted += f.days * f.amountPaise;
    x.amount += f.amountPaise;
  }
  const pctOf = (v: number, n: number) => (n ? Math.round((v / n) * 1000) / 10 : null);
  const rows: Cell[][] = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([name, x]) => [name, x.n, ...x.b.map((v) => pctOf(v, x.n)), x.amount ? Math.round(x.weighted / x.amount) : null]);
  const all = [...by.values()].reduce((t, x) => ({ n: t.n + x.n, b: t.b.map((v, i) => v + x.b[i]), weighted: t.weighted + x.weighted, amount: t.amount + x.amount }), { n: 0, b: [0, 0, 0, 0], weighted: 0, amount: 0 });
  return { rows, total: ['Total', all.n, ...all.b.map((v) => pctOf(v, all.n)), all.amount ? Math.round(all.weighted / all.amount) : null] as Cell[] };
}

const timeToPay: ReportDef = {
  key: 'time_to_get_paid', title: 'Time to get paid', category: 'payments_received', params: 'range', shape: 'list', filters: [CUSTOMER],
  description: 'For invoices paid off in the period: the share each customer paid within 15, 30, 45 days or later.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const c = oid(ctx.p.customerId);
    const invoices = await ctx.data.invoices.find({ orgId: ctx.orgId, status: { $in: DONE_INVOICE }, isOpeningBalance: { $ne: true }, ...(c ? { customerId: c } : {}), $or: [{ 'payments.paidOn': { $gte: r.fromDate, $lte: r.toDate } }, { 'adjustments.noteDate': { $gte: r.fromDate, $lte: r.toDate } }] }).lean().exec();
    const names = await ctx.data.names('customers', ctx.orgId, invoices.map((i) => i.customerId));
    const facts = invoices
      .filter((i) => i.status === 'paid')
      .map((i) => {
        const last = [...(i.payments ?? []).map((p) => p.paidOn), ...(i.adjustments ?? []).map((a) => a.noteDate)].sort().pop()!;
        return { customer: issuedTo(i, names, i.customerId, 'Unknown customer'), days: Math.max(0, daysBetween(i.invoiceDate, last)), last, amountPaise: i.amountsPaise.total };
      })
      .filter((f) => f.last >= r.fromDate && f.last <= r.toDate);
    const t = timeToGetPaid(facts);
    return {
      key: 'time_to_get_paid', title: 'Time to get paid', subtitle: r.label,
      columns: [text('customer', 'Customer'), num('count', 'Invoices paid'), num('d15', '0–15 days %'), num('d30', '16–30 days %'), num('d45', '31–45 days %'), num('later', 'Over 45 days %'), num('days', 'Average days')],
      rows: [...t.rows.map((cells) => ({ cells })), ...(t.rows.length ? [{ cells: t.total, style: 'grand' as const }] : [])],
      notes: ['Days from the invoice date to the day it was paid off, whether by payment or credit note. The average is weighted by invoice total.'],
    };
  },
};

export const PAYMENT_REPORTS: ReportDef[] = [paymentsReceived, creditNoteDetails, refunds('receipt'), timeToPay];
export const PAYMENTS_MADE_REPORTS: ReportDef[] = [paymentsMade, refunds('payment')];
