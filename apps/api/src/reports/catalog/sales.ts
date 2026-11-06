/**
 * Sales and Receivables: what was sold, by whom and to whom, and what is
 * still owed. From posted invoices and credit notes; quotes, sales orders
 * and delivery challans as they stand.
 */
import { Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { bucketOf, monthLabel } from '../management';
import { outstandingPaise } from '../../gl/schemas/settlement.schema';
import { Cell, FilterDef, ReportDef, RunCtx, asOfDate, daysBetween, listTable, money, num, rangeDates, statusLabel, text } from './types';
import { DONE_INVOICE, gstOf, issuedTo, owedAsOf } from './documents';

const CUSTOMER: FilterDef = { key: 'customerId', label: 'Customer', kind: 'customer' };
const BUCKETS = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'];

const oid = (id?: string | null) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const party = (ctx: RunCtx) => (ctx.p.customerId ? { customerId: oid(ctx.p.customerId) } : {});

async function invoicesIn(ctx: RunCtx, fromDate: string, toDate: string) {
  return ctx.data.invoices
    .find({ orgId: ctx.orgId, status: { $in: DONE_INVOICE }, isOpeningBalance: { $ne: true }, invoiceDate: { $gte: fromDate, $lte: toDate }, ...party(ctx) })
    .sort({ invoiceDate: 1, invoiceNumber: 1 })
    .lean()
    .exec();
}

/** Every invoice that could be open at a date: posted or paid, dated by then, opening balances included. */
async function invoicesBy(ctx: RunCtx, asOf: string) {
  return ctx.data.invoices
    .find({ orgId: ctx.orgId, status: { $in: [...DONE_INVOICE, InvoiceStatus.SENT] }, invoiceDate: { $lte: asOf }, ...party(ctx) })
    .sort({ invoiceDate: 1 })
    .lean()
    .exec();
}

type Inv = Awaited<ReturnType<typeof invoicesIn>>[number];

/** Paid, part paid, overdue or open, as it stands at a date. */
export function invoiceState(inv: Pick<Inv, 'status' | 'dueDate' | 'invoiceDate'> & { amountPaidPaise?: number | null }, owed: number, asOf: string): string {
  if (owed <= 0) return 'Paid';
  if ((inv.dueDate ?? inv.invoiceDate) < asOf) return 'Overdue';
  return (inv.amountPaidPaise ?? 0) > 0 ? 'Partly paid' : 'Open';
}

// ── Sales ───────────────────────────────────────────────────────────────

const bySalesperson: ReportDef = {
  key: 'sales_by_salesperson', title: 'Sales by salesperson', category: 'sales', params: 'range', shape: 'list',
  description: 'Each salesperson’s invoices less their credit notes, before GST.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [invoices, notes] = await Promise.all([
      invoicesIn(ctx, r.fromDate, r.toDate),
      ctx.data.creditNotes.find({ orgId: ctx.orgId, status: 'posted', noteDate: { $gte: r.fromDate, $lte: r.toDate } }, { invoiceId: 1, salespersonName: 1, amountsPaise: 1 }).lean().exec(),
    ]);
    // A note without its own salesperson counts against its invoice's.
    const noteInvoices = await ctx.data.invoices.find({ orgId: ctx.orgId, _id: { $in: notes.map((n) => n.invoiceId) } }, { salespersonName: 1 }).lean().exec();
    const invoiceSp = new Map(noteInvoices.map((i) => [String(i._id), i.salespersonName]));
    const by = new Map<string, { count: number; taxable: number; notes: number; total: number }>();
    const row = (name: string | null | undefined) => {
      const k = name?.trim() || 'No salesperson';
      return by.get(k) ?? by.set(k, { count: 0, taxable: 0, notes: 0, total: 0 }).get(k)!;
    };
    for (const i of invoices) { const x = row(i.salespersonName); x.count++; x.taxable += i.amountsPaise.taxableValue; x.total += i.amountsPaise.total; }
    for (const n of notes) { const x = row(n.salespersonName || invoiceSp.get(String(n.invoiceId))); x.notes += n.amountsPaise.taxableValue; x.total -= n.amountsPaise.total; }
    const rows: Cell[][] = [...by].sort((a, b) => (b[1].taxable - b[1].notes) - (a[1].taxable - a[1].notes) || a[0].localeCompare(b[0])).map(([name, x]) => [name, x.count, x.taxable, x.notes, x.taxable - x.notes, x.total]);
    const columns = [text('salesperson', 'Salesperson'), num('count', 'Invoices'), money('taxable', 'Taxable value'), money('notes', 'Credit notes'), money('net', 'Net sales'), money('total', 'Net with GST')];
    return listTable({ key: 'sales_by_salesperson', title: 'Sales by salesperson', subtitle: r.label, columns, rows, sum: ['count', 'taxable', 'notes', 'net', 'total'], notes: ['The salesperson named on each posted invoice and credit note. Values before GST unless said.'] });
  },
};

const salesSummary: ReportDef = {
  key: 'sales_summary', title: 'Sales summary', category: 'sales', params: 'range', shape: 'list',
  description: 'Month by month: invoices, taxable value, each GST head, the total and credit notes.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [invoices, notes] = await Promise.all([
      invoicesIn(ctx, r.fromDate, r.toDate),
      ctx.data.creditNotes.find({ orgId: ctx.orgId, status: 'posted', noteDate: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx) }, { noteDate: 1, amountsPaise: 1 }).lean().exec(),
    ]);
    const by = new Map(r.months.map((m) => [m, [0, 0, 0, 0, 0, 0, 0, 0]]));
    for (const i of invoices) {
      const x = by.get(i.invoiceDate.slice(0, 7));
      if (!x) continue;
      const a = i.amountsPaise;
      x[0]++; x[1] += a.taxableValue; x[2] += a.cgst; x[3] += a.sgst; x[4] += a.igst; x[5] += a.cess; x[6] += a.total;
    }
    for (const n of notes) { const x = by.get(n.noteDate.slice(0, 7)); if (x) x[7] += n.amountsPaise.total; }
    const rows: Cell[][] = r.months.map((m) => { const x = by.get(m)!; return [monthLabel(m), ...x, x[6] - x[7]]; });
    const columns = [text('month', 'Month'), num('count', 'Invoices'), money('taxable', 'Taxable value'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('cess', 'Cess'), money('total', 'Total with GST'), money('notes', 'Credit notes'), money('net', 'Net')];
    return listTable({ key: 'sales_summary', title: 'Sales summary', subtitle: r.label, columns, rows, sum: ['count', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'total', 'notes', 'net'], notes: ['Posted invoices by their date, credit notes by theirs, with GST.'] });
  },
};

// ── Receivables ─────────────────────────────────────────────────────────

const arAgeingDetails: ReportDef = {
  key: 'ar_ageing_details', title: 'AR ageing details', category: 'receivables', params: 'asof', shape: 'list', filters: [CUSTOMER],
  description: 'Every invoice still owed at a date, how many days overdue, and its ageing bucket.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const invoices = await invoicesBy(ctx, asOf);
    const names = await ctx.data.names('customers', ctx.orgId, invoices.map((i) => i.customerId));
    const rows: Cell[][] = invoices
      .map((i) => ({ i, owed: owedAsOf(i, asOf) }))
      .filter((x) => x.owed > 0)
      .sort((a, b) => (a.i.dueDate ?? a.i.invoiceDate).localeCompare(b.i.dueDate ?? b.i.invoiceDate))
      .map(({ i, owed }) => [i.invoiceDate, i.invoiceNumber ?? '', issuedTo(i, names, i.customerId, 'Unknown customer'), i.dueDate ?? '', Math.max(0, daysBetween(i.dueDate ?? i.invoiceDate, asOf)), BUCKETS[bucketOf(i.dueDate, i.invoiceDate, asOf)], i.amountsPaise.total, owed]);
    const columns = [text('date', 'Date'), text('number', 'Invoice'), text('customer', 'Customer'), text('due', 'Due date'), num('days', 'Days overdue'), text('bucket', 'Bucket'), money('total', 'Invoice total'), money('balance', 'Balance due')];
    return listTable({ key: 'ar_ageing_details', title: 'AR ageing details', subtitle: `As at ${asOf}`, columns, rows, sum: ['total', 'balance'], notes: ['Overdue counts from the due date, or the invoice date when there is none. Payments and credit notes dated after the day are not taken off.'] });
  },
};

const invoiceDetails: ReportDef = {
  key: 'invoice_details', title: 'Invoice details', category: 'receivables', params: 'range', shape: 'list',
  filters: [CUSTOMER, { key: 'status', label: 'Status', kind: 'select', options: [['open', 'Open'], ['overdue', 'Overdue'], ['partly_paid', 'Partly paid'], ['paid', 'Paid']] }],
  description: 'Every posted invoice in the period with its status, tax, total and what is still due.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const invoices = await invoicesIn(ctx, r.fromDate, r.toDate);
    const names = await ctx.data.names('customers', ctx.orgId, invoices.map((i) => i.customerId));
    const want = ctx.p.status ? statusLabel(ctx.p.status) : null;
    const rows: Cell[][] = invoices
      .map((i) => { const owed = outstandingPaise(i); return { i, owed, state: invoiceState(i, owed, ctx.today) }; })
      .filter((x) => !want || x.state === want)
      .map(({ i, owed, state }) => [i.invoiceDate, i.invoiceNumber ?? '', issuedTo(i, names, i.customerId, 'Unknown customer'), state, i.dueDate ?? '', i.salespersonName ?? '', i.amountsPaise.taxableValue, gstOf(i.amountsPaise), i.amountsPaise.total, owed]);
    const columns = [text('date', 'Date'), text('number', 'Invoice'), text('customer', 'Customer'), text('status', 'Status'), text('due', 'Due date'), text('salesperson', 'Salesperson'), money('taxable', 'Taxable value'), money('gst', 'GST'), money('total', 'Total'), money('balance', 'Balance due')];
    return listTable({ key: 'invoice_details', title: 'Invoice details', subtitle: r.label, columns, rows, sum: ['taxable', 'gst', 'total', 'balance'], notes: ['Posted invoices by their date. Balance due is as it stands today.'] });
  },
};

const ORDER_STATES: Array<[string, string]> = [['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];

const salesOrderDetails: ReportDef = {
  key: 'sales_order_details', title: 'Sales order details', category: 'receivables', params: 'range', shape: 'list',
  filters: [CUSTOMER, { key: 'status', label: 'Status', kind: 'select', options: ORDER_STATES }],
  description: 'Sales orders in the period: customer, status, expected date and value.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const orders = await ctx.data.salesOrders.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx), ...(ctx.p.status ? { status: ctx.p.status } : {}) }).sort({ date: 1, number: 1 }).lean().exec();
    const names = await ctx.data.names('customers', ctx.orgId, orders.map((o) => o.customerId));
    const rows: Cell[][] = orders.map((o) => [o.date, o.number, names.get(String(o.customerId)) ?? 'Unknown customer', statusLabel(o.status), o.expectedBy ?? '', o.customerPoNumber ?? '', o.salespersonName ?? '', o.amountsPaise.taxableValue, o.amountsPaise.total]);
    const columns = [text('date', 'Date'), text('number', 'Sales order'), text('customer', 'Customer'), text('status', 'Status'), text('expected', 'Expected by'), text('po', 'Customer PO'), text('salesperson', 'Salesperson'), money('taxable', 'Taxable value'), money('total', 'Total')];
    return listTable({ key: 'sales_order_details', title: 'Sales order details', subtitle: r.label, columns, rows, sum: ['taxable', 'total'], notes: ['Sales orders are commitments, not sales: they are not in the books until invoiced.'] });
  },
};

const challanDetails: ReportDef = {
  key: 'delivery_challan_details', title: 'Delivery challan details', category: 'receivables', params: 'range', shape: 'list',
  filters: [CUSTOMER, { key: 'status', label: 'Status', kind: 'select', options: [['issued', 'Issued'], ['returned', 'Returned'], ['cancelled', 'Cancelled']] }],
  description: 'Goods sent out on challan: customer, reason, vehicle, quantity and value.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const challans = await ctx.data.challans.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx), ...(ctx.p.status ? { status: ctx.p.status } : {}) }).sort({ date: 1, number: 1 }).lean().exec();
    const names = await ctx.data.names('customers', ctx.orgId, challans.map((c) => c.customerId));
    const rows: Cell[][] = challans.map((c) => {
      const lines = (c.lines ?? []).map((l) => l.line);
      const qty = Math.round(lines.reduce((s, l) => s + (l?.qty ?? 0), 0) * 1000) / 1000;
      const value = lines.reduce((s, l) => s + (l?.amountPaise ?? 0) - (l?.discountPaise ?? 0), 0);
      return [c.date, c.number, names.get(String(c.customerId)) ?? 'Unknown customer', statusLabel(c.reason), statusLabel(c.status), c.vehicleNo ?? '', lines.length, qty, value];
    });
    const columns = [text('date', 'Date'), text('number', 'Challan'), text('customer', 'Customer'), text('reason', 'Reason'), text('status', 'Status'), text('vehicle', 'Vehicle'), num('lines', 'Lines'), num('qty', 'Quantity'), money('value', 'Value before GST')];
    return listTable({ key: 'delivery_challan_details', title: 'Delivery challan details', subtitle: r.label, columns, rows, sum: ['lines', 'qty', 'value'], notes: ['A challan moves goods without a sale; its value is the lines’ amounts less discounts.'] });
  },
};

const QUOTE_STATES: Array<[string, string]> = [['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['converted', 'Converted'], ['expired', 'Expired']];
const quoteState = (q: { status: string; validUntil: string }, today: string) => (['draft', 'sent'].includes(q.status) && q.validUntil < today ? 'expired' : q.status);

const quoteDetails: ReportDef = {
  key: 'quote_details', title: 'Quote details', category: 'receivables', params: 'range', shape: 'list',
  filters: [CUSTOMER, { key: 'status', label: 'Status', kind: 'select', options: QUOTE_STATES }],
  description: 'Quotes in the period: customer, status (expired when past its date), and value.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const quotes = await ctx.data.quotes.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx) }).sort({ date: 1, number: 1 }).lean().exec();
    const names = await ctx.data.names('customers', ctx.orgId, quotes.map((q) => q.customerId));
    const rows: Cell[][] = quotes
      .map((q) => ({ q, state: quoteState(q, ctx.today) }))
      .filter((x) => !ctx.p.status || x.state === ctx.p.status)
      .map(({ q, state }) => [q.date, q.number, names.get(String(q.customerId)) ?? 'Unknown customer', statusLabel(state), q.validUntil, q.salespersonName ?? '', q.amountsPaise.taxableValue, q.amountsPaise.total]);
    const columns = [text('date', 'Date'), text('number', 'Quote'), text('customer', 'Customer'), text('status', 'Status'), text('valid', 'Valid until'), text('salesperson', 'Salesperson'), money('taxable', 'Taxable value'), money('total', 'Total')];
    return listTable({ key: 'quote_details', title: 'Quote details', subtitle: r.label, columns, rows, sum: ['taxable', 'total'], notes: ['Quotes are offers, not sales. A draft or sent quote past its valid-until date shows as expired.'] });
  },
};

const quoteItemDetails: ReportDef = {
  key: 'quote_item_details', title: 'Quote item details', category: 'receivables', params: 'range', shape: 'list',
  filters: [CUSTOMER, { key: 'itemId', label: 'Item', kind: 'item' }],
  description: 'Each line of each quote: item, quantity, rate and amount.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const quotes = await ctx.data.quotes.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...party(ctx) }).sort({ date: 1, number: 1 }).lean().exec();
    const [names, items] = await Promise.all([
      ctx.data.names('customers', ctx.orgId, quotes.map((q) => q.customerId)),
      ctx.data.names('items', ctx.orgId, quotes.flatMap((q) => (q.lines ?? []).map((l) => l.itemId))),
    ]);
    const rows: Cell[][] = quotes.flatMap((q) =>
      (q.lines ?? [])
        .filter((l) => !ctx.p.itemId || String(l.itemId) === ctx.p.itemId)
        .map((l) => [q.date, q.number, names.get(String(q.customerId)) ?? 'Unknown customer', statusLabel(quoteState(q, ctx.today)), (l.itemId && items.get(String(l.itemId))) || l.description, l.qty, l.uqc ?? '', l.ratePaise, l.amountPaise - (l.discountPaise ?? 0)]),
    );
    const columns = [text('date', 'Date'), text('number', 'Quote'), text('customer', 'Customer'), text('status', 'Status'), text('item', 'Item'), num('qty', 'Quantity'), text('uqc', 'Unit'), money('rate', 'Rate'), money('amount', 'Amount')];
    return listTable({ key: 'quote_item_details', title: 'Quote item details', subtitle: r.label, columns, rows, sum: ['qty', 'amount'], notes: ['Line amounts less line discounts, before GST.'] });
  },
};

const customerBalances: ReportDef = {
  key: 'customer_balance_summary', title: 'Customer balance summary', category: 'receivables', params: 'asof', shape: 'list', filters: [CUSTOMER],
  description: 'For each customer at a date: invoiced, credited, received, and the balance still due.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const invoices = await invoicesBy(ctx, asOf);
    const names = await ctx.data.names('customers', ctx.orgId, invoices.map((i) => i.customerId));
    const by = new Map<string, number[]>();
    for (const i of invoices) {
      const k = String(i.customerId);
      const x = by.get(k) ?? by.set(k, [0, 0, 0, 0]).get(k)!;
      x[0] += i.amountsPaise.total;
      x[1] += (i.adjustments ?? []).filter((a) => a.noteDate <= asOf).reduce((s, a) => s + a.amountPaise, 0);
      x[2] += (i.payments ?? []).filter((p) => p.paidOn <= asOf).reduce((s, p) => s + p.amountPaise + (p.tdsPaise ?? 0), 0);
      x[3] += owedAsOf(i, asOf);
    }
    const rows: Cell[][] = [...by].map(([id, x]) => [names.get(id) ?? 'Unknown customer', ...x] as Cell[]).filter((r) => r.slice(1).some((v) => v !== 0)).sort((a, b) => (b[4] as number) - (a[4] as number) || String(a[0]).localeCompare(String(b[0])));
    const columns = [text('customer', 'Customer'), money('invoiced', 'Invoiced'), money('credited', 'Credit notes'), money('received', 'Received (with TDS)'), money('balance', 'Balance due')];
    return listTable({ key: 'customer_balance_summary', title: 'Customer balance summary', subtitle: `As at ${asOf}`, columns, rows, sum: ['invoiced', 'credited', 'received', 'balance'], notes: ['Invoices to the date, with credit notes and payments dated by then. Advances not yet applied to an invoice are not in these figures; see Payments received.'] });
  },
};

const receivableSummary: ReportDef = {
  key: 'receivable_summary', title: 'Receivable summary', category: 'receivables', params: 'asof', shape: 'list', filters: [CUSTOMER],
  description: 'Every invoice with something still due at a date: status, total and balance.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const invoices = await invoicesBy(ctx, asOf);
    const names = await ctx.data.names('customers', ctx.orgId, invoices.map((i) => i.customerId));
    const rows: Cell[][] = invoices
      .map((i) => ({ i, owed: owedAsOf(i, asOf) }))
      .filter((x) => x.owed > 0)
      .map(({ i, owed }) => [issuedTo(i, names, i.customerId, 'Unknown customer'), i.invoiceNumber ?? '', i.invoiceDate, i.dueDate ?? '', invoiceState(i, owed, asOf), i.amountsPaise.total, owed]);
    const columns = [text('customer', 'Customer'), text('number', 'Invoice'), text('date', 'Date'), text('due', 'Due date'), text('status', 'Status'), money('total', 'Total'), money('balance', 'Balance due')];
    return listTable({ key: 'receivable_summary', title: 'Receivable summary', subtitle: `As at ${asOf}`, columns, rows, sum: ['total', 'balance'], notes: ['Posted invoices with a balance at the date.'] });
  },
};

const receivableDetails: ReportDef = {
  key: 'receivable_details', title: 'Receivable details', category: 'receivables', params: 'asof', shape: 'list', filters: [CUSTOMER],
  description: 'The lines of every invoice still owed at a date, with the invoice’s balance.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const invoices = (await invoicesBy(ctx, asOf)).map((i) => ({ i, owed: owedAsOf(i, asOf) })).filter((x) => x.owed > 0);
    const [names, items] = await Promise.all([
      ctx.data.names('customers', ctx.orgId, invoices.map((x) => x.i.customerId)),
      ctx.data.names('items', ctx.orgId, invoices.flatMap((x) => (x.i.lineItems ?? []).map((l) => l.itemId))),
    ]);
    const rows: Cell[][] = invoices.flatMap(({ i, owed }) =>
      (i.lineItems ?? []).map((l, n) => [issuedTo(i, names, i.customerId, 'Unknown customer'), i.invoiceNumber ?? '', i.invoiceDate, (l.itemId && items.get(String(l.itemId))) || l.description, l.qty, l.ratePaise, l.amountPaise - (l.discountPaise ?? 0), n === 0 ? owed : null]),
    );
    const columns = [text('customer', 'Customer'), text('number', 'Invoice'), text('date', 'Date'), text('item', 'Item'), num('qty', 'Quantity'), money('rate', 'Rate'), money('amount', 'Line amount'), money('balance', 'Invoice balance')];
    return listTable({ key: 'receivable_details', title: 'Receivable details', subtitle: `As at ${asOf}`, columns, rows, sum: ['amount', 'balance'], notes: ['Line amounts before GST. The invoice balance, with GST, is on each invoice’s first line.'] });
  },
};

export const SALES_REPORTS: ReportDef[] = [bySalesperson, salesSummary];
export const RECEIVABLE_REPORTS: ReportDef[] = [arAgeingDetails, invoiceDetails, salesOrderDetails, challanDetails, quoteDetails, quoteItemDetails, customerBalances, receivableSummary, receivableDetails];
