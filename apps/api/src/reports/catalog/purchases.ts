/**
 * Purchases and Expenses: expenses in detail and by customer, project and
 * employee, what can be billed on, and mileage. From posted expenses,
 * posted bills and employee claims once approved and posted.
 */
import { Types } from 'mongoose';
import { Cell, FilterDef, ReportDef, RunCtx, listTable, money, num, rangeDates, statusLabel, text } from './types';
import { DONE_BILL } from './documents';

const CUSTOMER: FilterDef = { key: 'customerId', label: 'Customer', kind: 'customer' };
const PROJECT: FilterDef = { key: 'projectId', label: 'Project', kind: 'project' };
const VENDOR: FilterDef = { key: 'vendorId', label: 'Vendor', kind: 'vendor' };
const oid = (id?: string | null) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const CLAIM_DONE = ['posted', 'paid'];

async function postedExpenses(ctx: RunCtx, fromDate: string, toDate: string, extra: Record<string, unknown> = {}) {
  const f: Record<string, unknown> = { orgId: ctx.orgId, status: 'posted', date: { $gte: fromDate, $lte: toDate }, ...extra };
  if (oid(ctx.p.vendorId)) f.vendorId = oid(ctx.p.vendorId);
  if (oid(ctx.p.customerId)) f.customerId = oid(ctx.p.customerId);
  if (oid(ctx.p.projectId)) f.projectId = oid(ctx.p.projectId);
  return ctx.data.expenses.find(f).sort({ date: 1, number: 1 }).lean().exec();
}

async function accountNames(ctx: RunCtx) {
  const chart = await ctx.data.chart(ctx.orgId);
  return (id: unknown) => chart.get(String(id))?.name ?? '';
}

const expenseDetails: ReportDef = {
  key: 'expense_details', title: 'Expense details', category: 'purchases', params: 'range', shape: 'list', filters: [VENDOR, CUSTOMER, PROJECT],
  description: 'Every posted expense in the period: account, paid through, project, customer, tax and total.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const list = await postedExpenses(ctx, r.fromDate, r.toDate);
    const [account, vendors, customers, projects] = await Promise.all([
      accountNames(ctx),
      ctx.data.names('vendors', ctx.orgId, list.map((e) => e.vendorId)),
      ctx.data.names('customers', ctx.orgId, list.map((e) => e.customerId)),
      ctx.data.has('projects') ? ctx.data.names('projects', ctx.orgId, list.map((e) => e.projectId)) : Promise.resolve(new Map<string, string>()),
    ]);
    const rows: Cell[][] = list.map((e) => {
      const accounts = [...new Set((e.lines?.length ? e.lines.map((l) => l.expenseAccountId) : [e.expenseAccountId]).map(String))];
      return [
        e.date, e.number, e.kind === 'mileage' ? 'Mileage' : 'Expense', vendors.get(String(e.vendorId)) ?? '', accounts.map(account).join(', '), account(e.paidThroughAccountId),
        projects.get(String(e.projectId)) ?? '', customers.get(String(e.customerId)) ?? '', e.billable ? 'Yes' : '', e.taxablePaise, e.cgstPaise + e.sgstPaise + e.igstPaise, e.totalPaise,
      ];
    });
    const columns = [text('date', 'Date'), text('number', 'Expense'), text('kind', 'Kind'), text('vendor', 'Vendor'), text('account', 'Account'), text('paidThrough', 'Paid through'), text('project', 'Project'), text('customer', 'Customer'), text('billable', 'Billable'), money('taxable', 'Amount before GST'), money('gst', 'GST'), money('total', 'Total')];
    return listTable({ key: 'expense_details', title: 'Expense details', subtitle: r.label, columns, rows, sum: ['taxable', 'gst', 'total'], notes: ['Posted expenses by their date. Bills and employee claims have their own reports.'] });
  },
};

/** Expense documents and bill lines charged to a customer or a project, in the period. */
async function chargedTo(ctx: RunCtx, by: 'customerId' | 'projectId', fromDate: string, toDate: string) {
  const expenses = await postedExpenses(ctx, fromDate, toDate, { [by]: { $ne: null } });
  const lineMatch: Record<string, unknown> = { [`lineItems.${by}`]: { $ne: null } };
  const bills = await ctx.data.bills.find({ orgId: ctx.orgId, status: { $in: DONE_BILL }, billDate: { $gte: fromDate, $lte: toDate }, ...lineMatch, ...(oid(ctx.p.vendorId) ? { vendorId: oid(ctx.p.vendorId) } : {}) }).lean().exec();
  const facts: Array<{ key: string; customer: string | null; amount: number; billable: number; source: string; date: string; label: string; billableFlag: boolean }> = [];
  for (const e of expenses) facts.push({ key: String(e[by]), customer: e.customerId ? String(e.customerId) : null, amount: e.taxablePaise, billable: e.billable ? e.taxablePaise : 0, source: e.number, date: e.date, label: '', billableFlag: !!e.billable });
  for (const b of bills) {
    for (const l of b.lineItems ?? []) {
      const k = l[by];
      if (!k) continue;
      if (by === 'customerId' && oid(ctx.p.customerId) && String(k) !== ctx.p.customerId) continue;
      if (by === 'projectId' && oid(ctx.p.projectId) && String(k) !== ctx.p.projectId) continue;
      const amount = l.amountPaise - (l.discountPaise ?? 0);
      facts.push({ key: String(k), customer: l.customerId ? String(l.customerId) : null, amount, billable: l.billable ? amount : 0, source: b.billNumber ? `Bill ${b.billNumber}` : `Bill of ${b.billDate}`, date: b.billDate, label: l.description, billableFlag: !!l.billable });
    }
  }
  return facts;
}

const byCustomer: ReportDef = {
  key: 'expenses_by_customer', title: 'Expenses by customer', category: 'purchases', params: 'range', shape: 'list', filters: [CUSTOMER, VENDOR],
  description: 'Expenses and bill lines charged to each customer, and how much of it can be billed on.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const facts = await chargedTo(ctx, 'customerId', r.fromDate, r.toDate);
    const names = await ctx.data.names('customers', ctx.orgId, facts.map((f) => f.key));
    const by = new Map<string, number[]>();
    for (const f of facts) { const x = by.get(f.key) ?? by.set(f.key, [0, 0, 0]).get(f.key)!; x[0]++; x[1] += f.amount; x[2] += f.billable; }
    const rows: Cell[][] = [...by].map(([id, x]) => [names.get(id) ?? 'Unknown customer', ...x] as Cell[]).sort((a, b) => (b[2] as number) - (a[2] as number));
    const columns = [text('customer', 'Customer'), num('count', 'Expenses'), money('amount', 'Amount before GST'), money('billable', 'Billable')];
    return listTable({ key: 'expenses_by_customer', title: 'Expenses by customer', subtitle: r.label, columns, rows, sum: ['count', 'amount', 'billable'], notes: ['Posted expenses with a customer, and posted bill lines charged to one.'] });
  },
};

const byProject: ReportDef = {
  key: 'expenses_by_project', title: 'Expenses by project', category: 'purchases', params: 'range', shape: 'list', filters: [PROJECT, VENDOR],
  description: 'Expenses and bill lines charged to each project, and how much of it can be billed on.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const facts = await chargedTo(ctx, 'projectId', r.fromDate, r.toDate);
    const projects = await ctx.data.projects.find({ orgId: ctx.orgId, _id: { $in: [...new Set(facts.map((f) => f.key))].filter((id) => Types.ObjectId.isValid(id)) } }, { name: 1, customerId: 1 }).lean().exec();
    const customers = await ctx.data.names('customers', ctx.orgId, projects.map((p) => p.customerId));
    const info = new Map(projects.map((p) => [String(p._id), { name: p.name, customer: p.customerId ? customers.get(String(p.customerId)) ?? '' : 'Internal' }]));
    const by = new Map<string, number[]>();
    for (const f of facts) { const x = by.get(f.key) ?? by.set(f.key, [0, 0, 0]).get(f.key)!; x[0]++; x[1] += f.amount; x[2] += f.billable; }
    const rows: Cell[][] = [...by].map(([id, x]) => [info.get(id)?.name ?? 'Unknown project', info.get(id)?.customer ?? '', ...x] as Cell[]).sort((a, b) => (b[3] as number) - (a[3] as number));
    const columns = [text('project', 'Project'), text('customer', 'Customer'), num('count', 'Expenses'), money('amount', 'Amount before GST'), money('billable', 'Billable')];
    return listTable({ key: 'expenses_by_project', title: 'Expenses by project', subtitle: r.label, columns, rows, sum: ['count', 'amount', 'billable'], notes: ['Posted expenses with a project, and posted bill lines charged to one. Profit by project has income and every cost tagged to it.'] });
  },
};

const billable: ReportDef = {
  key: 'billable_expense_details', title: 'Billable expense details', category: 'purchases', params: 'range', shape: 'list', filters: [CUSTOMER],
  description: 'Every expense and bill line marked billable to a customer, not yet invoiced.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const facts = (await chargedTo(ctx, 'customerId', r.fromDate, r.toDate)).filter((f) => f.billableFlag);
    const names = await ctx.data.names('customers', ctx.orgId, facts.map((f) => f.key));
    const rows: Cell[][] = facts.sort((a, b) => a.date.localeCompare(b.date)).map((f) => [f.date, f.source, names.get(f.key) ?? 'Unknown customer', f.label, f.amount]);
    const columns = [text('date', 'Date'), text('source', 'From'), text('customer', 'Customer'), text('description', 'Description'), money('amount', 'Amount before GST')];
    return listTable({ key: 'billable_expense_details', title: 'Billable expense details', subtitle: r.label, columns, rows, sum: ['amount'], notes: ['Billable costs to put on the customer’s next invoice.'] });
  },
};

const mileage: ReportDef = {
  key: 'mileage_expenses', title: 'Mileage expenses', category: 'purchases', params: 'range', shape: 'list',
  description: 'Mileage claimed in the period: who travelled, how far, at what rate.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [expenses, claims] = await Promise.all([
      postedExpenses(ctx, r.fromDate, r.toDate, { kind: 'mileage' }),
      ctx.data.has('claims') ? ctx.data.claims.find({ orgId: ctx.orgId, status: { $in: CLAIM_DONE }, 'lines.kind': 'mileage', 'lines.date': { $gte: r.fromDate, $lte: r.toDate } }).lean().exec() : Promise.resolve([]),
    ]);
    const rows: Cell[][] = [
      ...expenses.map((e) => [e.date, e.mileage?.employeeName ?? '', e.number, e.mileage?.distance ?? null, e.mileage?.unit ?? 'km', e.mileage?.ratePaise ?? null, e.totalPaise] as Cell[]),
      ...claims.flatMap((c) => (c.lines ?? []).filter((l) => l.kind === 'mileage' && l.date >= r.fromDate && l.date <= r.toDate).map((l) => [l.date, c.employeeName, c.number, l.km ?? null, 'km', l.km ? Math.round(l.amountPaise / l.km) : null, l.amountPaise] as Cell[])),
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const columns = [text('date', 'Date'), text('employee', 'Employee'), text('source', 'Expense or claim'), num('distance', 'Distance'), text('unit', 'Unit'), money('rate', 'Rate'), money('amount', 'Amount')];
    return listTable({ key: 'mileage_expenses', title: 'Mileage expenses', subtitle: r.label, columns, rows, sum: ['distance', 'amount'], notes: ['Posted mileage expenses and mileage lines of posted or paid employee claims.'] });
  },
};

const byEmployee: ReportDef = {
  key: 'expenses_by_employee', title: 'Expenses by employee', category: 'purchases', params: 'range', shape: 'list',
  description: 'Employee claims posted in the period: how much each person claimed and what is still to be paid.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const claims = await ctx.data.claims.find({ orgId: ctx.orgId, status: { $in: CLAIM_DONE }, 'lines.date': { $gte: r.fromDate, $lte: r.toDate } }).lean().exec();
    const by = new Map<string, number[]>();
    for (const c of claims) {
      const lines = (c.lines ?? []).filter((l) => l.date >= r.fromDate && l.date <= r.toDate);
      const amount = lines.reduce((s, l) => s + l.amountPaise, 0);
      const x = by.get(c.employeeName) ?? by.set(c.employeeName, [0, 0, 0, 0, 0]).get(c.employeeName)!;
      x[0]++; x[1] += lines.length; x[2] += amount; x[3] += lines.reduce((s, l) => s + (l.gstPaise ?? 0), 0);
      if (c.status !== 'paid') x[4] += amount;
    }
    const rows: Cell[][] = [...by].sort((a, b) => b[1][2] - a[1][2]).map(([name, x]) => [name, ...x]);
    const columns = [text('employee', 'Employee'), num('claims', 'Claims'), num('lines', 'Lines'), money('amount', 'Amount'), money('gst', 'GST in it'), money('unpaid', 'Not yet paid')];
    return listTable({ key: 'expenses_by_employee', title: 'Expenses by employee', subtitle: r.label, columns, rows, sum: ['claims', 'lines', 'amount', 'gst', 'unpaid'], notes: ['Posted and paid employee claims, by the dates of their lines.'] });
  },
};

const claimDetails: ReportDef = {
  key: 'expense_claim_details', title: 'Expense claim details', category: 'purchases', params: 'range', shape: 'list',
  filters: [{ key: 'status', label: 'Status', kind: 'select', options: [['posted', 'Posted'], ['paid', 'Paid']] }],
  description: 'Each line of each posted employee claim: date, merchant, account and amount.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const claims = await ctx.data.claims.find({ orgId: ctx.orgId, status: { $in: ctx.p.status && CLAIM_DONE.includes(ctx.p.status) ? [ctx.p.status] : CLAIM_DONE }, 'lines.date': { $gte: r.fromDate, $lte: r.toDate } }).sort({ number: 1 }).lean().exec();
    const account = await accountNames(ctx);
    const rows: Cell[][] = claims.flatMap((c) => (c.lines ?? []).filter((l) => l.date >= r.fromDate && l.date <= r.toDate).map((l) => [l.date, c.number, c.employeeName, statusLabel(c.status), l.merchant ?? '', l.description, account(l.expenseAccountId), l.gstPaise ?? 0, l.amountPaise] as Cell[]));
    const columns = [text('date', 'Date'), text('claim', 'Claim'), text('employee', 'Employee'), text('status', 'Status'), text('merchant', 'Merchant'), text('description', 'Description'), text('account', 'Account'), money('gst', 'GST in it'), money('amount', 'Amount')];
    return listTable({ key: 'expense_claim_details', title: 'Expense claim details', subtitle: r.label, columns, rows, sum: ['gst', 'amount'], notes: ['Lines of posted and paid claims; drafts and claims awaiting approval are left out.'] });
  },
};

export const PURCHASE_REPORTS: ReportDef[] = [expenseDetails, byCustomer, byProject, byEmployee, billable, mileage, claimDetails];
