/**
 * Banking, Projects and Timesheet, and Inventory: reconciliation, the bank
 * and cash books, projects and time, and stock. Read-only.
 */
import { Types } from 'mongoose';
import { JournalStatus } from '@ai-accounting/shared';
import { isMoneyAccount } from '../../gl/money-accounts';
import { ReportRow } from '../report-table';
import { Cell, FilterDef, ReportDef, RunCtx, addDays, asOfDate, listTable, money, num, rangeDates, statusLabel, text } from './types';
import type { ChartAccount } from './report-data.service';

const PROJECT: FilterDef = { key: 'projectId', label: 'Project', kind: 'project' };
const oid = (id?: string | null) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

// ── Banking ─────────────────────────────────────────────────────────────

const reconciliation: ReportDef = {
  key: 'reconciliation_status', title: 'Reconciliation status', category: 'banking', params: 'today', shape: 'list',
  description: 'For each bank account: statements imported, lines reconciled, waiting to confirm, and still unmatched.',
  async run(ctx) {
    const [accounts, statements, lines] = await Promise.all([
      ctx.data.bankAccounts.find({ orgId: ctx.orgId }).lean().exec(),
      ctx.data.statements.find({ orgId: ctx.orgId }).sort({ periodEnd: -1 }).lean().exec(),
      ctx.data.statementLines.aggregate<{ _id: { a: Types.ObjectId; s: string; x: boolean }; n: number }>([
        { $match: { orgId: ctx.orgId } },
        { $group: { _id: { a: '$bankAccountId', s: '$matchStatus', x: '$excluded' }, n: { $sum: 1 } } },
      ]).exec(),
    ]);
    const rows: Cell[][] = accounts.map((a) => {
      const id = String(a._id);
      const own = statements.filter((s) => String(s.bankAccountId) === id);
      const count = (pred: (k: { s: string; x: boolean }) => boolean) => lines.filter((l) => String(l._id.a) === id && pred(l._id)).reduce((s, l) => s + l.n, 0);
      const latest = own[0];
      return [
        a.name, a.bankName ?? '', own.length, latest ? `${latest.periodStart} to ${latest.periodEnd}` : 'None yet',
        count(() => true), count((k) => !k.x && k.s === 'confirmed'), count((k) => !k.x && (k.s === 'auto_matched' || k.s === 'manually_matched')), count((k) => !k.x && k.s === 'unmatched'), count((k) => k.x),
        latest ? latest.closingBalancePaise : null,
      ];
    });
    const columns = [text('account', 'Bank account'), text('bank', 'Bank'), num('statements', 'Statements'), text('latest', 'Latest statement'), num('lines', 'Lines'), num('reconciled', 'Reconciled'), num('toConfirm', 'Matched, to confirm'), num('unmatched', 'Unmatched'), num('excluded', 'Excluded'), money('closing', 'Latest statement closing balance')];
    return listTable({ key: 'reconciliation_status', title: 'Reconciliation status', subtitle: `As at ${ctx.today}`, columns, rows, sum: ['statements', 'lines', 'reconciled', 'toConfirm', 'unmatched', 'excluded'], notes: ['Matched lines are reconciled once confirmed on the Banking page.'] });
  },
};

const isCashAccount = (a: ChartAccount) => a.systemKey === 'CASH' || /\b(cash|petty|imprest)\b/i.test(a.name);

function moneyBook(kind: 'bank' | 'cash'): ReportDef {
  const bank = kind === 'bank';
  return {
    key: bank ? 'bank_book' : 'cash_book', title: bank ? 'Bank book' : 'Cash book', category: 'banking', params: 'range', shape: 'statement',
    filters: [{ key: 'accountId', label: bank ? 'Bank account' : 'Cash account', kind: 'money_account' }],
    description: bank ? 'Every receipt and payment through each bank account, with the running balance.' : 'Every receipt and payment in cash, with the running balance.',
    async run(ctx) {
      const r = rangeDates(ctx);
      const chart = await ctx.data.chart(ctx.orgId);
      const accounts = [...chart.values()].filter((a) => !a.isGroup && isMoneyAccount(a) && (bank ? !isCashAccount(a) : isCashAccount(a)) && (!ctx.p.accountId || a.id === ctx.p.accountId)).sort((a, b) => a.code.localeCompare(b.code));
      const ids = accounts.map((a) => new Types.ObjectId(a.id));
      const [before, journals] = await Promise.all([
        ctx.data.nets(ctx.orgId, { to: addDays(r.fromDate, -1), includeClosing: true }),
        ctx.data.journals.find({ orgId: ctx.orgId, status: JournalStatus.POSTED, date: { $gte: r.fromDate, $lte: r.toDate }, 'lines.accountId': { $in: ids } }).sort({ date: 1, voucherNumber: 1 }).lean().exec(),
      ]);
      const rows: ReportRow[] = [];
      let tIn = 0;
      let tOut = 0;
      for (const a of accounts) {
        let balance = before.get(a.id) ?? 0;
        const own = journals.flatMap((j) => j.lines.filter((l) => String(l.accountId) === a.id).map((l) => ({ j, l })));
        if (!own.length && !balance) continue;
        rows.push({ cells: [a.name, null, null, null, null, null], style: 'group' });
        rows.push({ cells: ['', '', 'Opening balance', null, null, balance], indent: 1 });
        let inn = 0;
        let out = 0;
        for (const { j, l } of own) {
          balance += l.debitPaise - l.creditPaise;
          inn += l.debitPaise;
          out += l.creditPaise;
          rows.push({ cells: [j.date, `${j.voucherType}/${j.financialYear}/${j.voucherNumber}`, j.narration ?? '', l.debitPaise || null, l.creditPaise || null, balance], indent: 1 });
        }
        rows.push({ cells: [`Closing ${a.name}`, null, null, inn, out, balance], style: 'total' });
        tIn += inn;
        tOut += out;
      }
      rows.push({ cells: ['Total', null, null, tIn, tOut, null], style: 'grand' });
      return {
        key: bank ? 'bank_book' : 'cash_book', title: bank ? 'Bank book' : 'Cash book', subtitle: r.label,
        columns: [text('date', 'Date'), text('voucher', 'Voucher'), text('narration', 'Narration'), money('in', 'Receipts'), money('out', 'Payments'), money('balance', 'Balance')],
        rows,
        notes: ['Posted lines on each account by date. A negative balance on a bank account is an overdraft.'],
      };
    },
  };
}

// ── Projects and time ───────────────────────────────────────────────────

const projectSummary: ReportDef = {
  key: 'project_summary', title: 'Project summary', category: 'projects', params: 'range', shape: 'list', filters: [{ key: 'status', label: 'Status', kind: 'select', options: [['active', 'Active'], ['on_hold', 'On hold'], ['completed', 'Completed']] }],
  description: 'Each project’s budget against hours logged, billed and unbilled, and its income and costs.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [projects, figures, time] = await Promise.all([
      ctx.data.projects.find({ orgId: ctx.orgId, ...(ctx.p.status ? { status: ctx.p.status } : {}) }).sort({ name: 1 }).lean().exec(),
      ctx.data.management.projectFigures(ctx.orgId, r),
      ctx.data.time.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate } }, { projectId: 1, hours: 1, billable: 1, status: 1 }).lean().exec(),
    ]);
    const customers = await ctx.data.names('customers', ctx.orgId, projects.map((p) => p.customerId));
    const rows: Cell[][] = projects.map((p) => {
      const id = String(p._id);
      const own = time.filter((t) => String(t.projectId) === id);
      const h = (f: (t: (typeof own)[number]) => boolean) => Math.round(own.filter(f).reduce((s, t) => s + t.hours, 0) * 100) / 100;
      const f = figures.get(id);
      return [p.name, p.customerId ? customers.get(String(p.customerId)) ?? '' : 'Internal', statusLabel(p.status), statusLabel(p.billing === 'time' ? 'project_hours' : p.billing), p.budgetHours ?? null, h(() => true), h((t) => t.billable), h((t) => t.billable && t.status === 'billed'), f?.unbilledHours ?? 0, p.revenueBudgetPaise ?? p.budgetPaise ?? null, f?.incomePaise ?? 0, f?.costPaise ?? 0, (f?.incomePaise ?? 0) - (f?.costPaise ?? 0)];
    });
    const columns = [text('project', 'Project'), text('customer', 'Customer'), text('status', 'Status'), text('billing', 'Billing'), num('budgetHours', 'Budget hours'), num('hours', 'Hours logged'), num('billable', 'Billable hours'), num('billed', 'Billed hours'), num('unbilled', 'Unbilled hours (all time)'), money('budget', 'Revenue budget'), money('income', 'Income'), money('cost', 'Costs'), money('profit', 'Profit')];
    return listTable({ key: 'project_summary', title: 'Project summary', subtitle: r.label, columns, rows, sum: ['hours', 'billable', 'billed', 'unbilled', 'income', 'cost', 'profit'], notes: ['Hours logged in the period; income and costs from posted lines tagged with the project.'] });
  },
};

const projectDetails: ReportDef = {
  key: 'project_details', title: 'Project details', category: 'projects', params: 'range', shape: 'statement', filters: [PROJECT],
  description: 'For each project, the hours by task and person, and what they are worth at the project’s rates.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const pid = oid(ctx.p.projectId);
    const [projects, time] = await Promise.all([
      ctx.data.projects.find({ orgId: ctx.orgId, ...(pid ? { _id: pid } : {}) }).sort({ name: 1 }).lean().exec(),
      ctx.data.time.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...(pid ? { projectId: pid } : {}) }).lean().exec(),
    ]);
    const rows: ReportRow[] = [];
    const total = [0, 0, 0];
    for (const p of projects) {
      const own = time.filter((t) => String(t.projectId) === String(p._id));
      if (!own.length) continue;
      rows.push({ cells: [p.name, null, null, null, null], style: 'group' });
      const by = new Map<string, number[]>();
      for (const t of own) {
        const k = `${t.task || 'General'} · ${t.userName}`;
        const x = by.get(k) ?? by.set(k, [0, 0, 0]).get(k)!;
        x[0] += t.hours;
        if (t.billable) { x[1] += t.hours; x[2] += Math.round(t.hours * (t.ratePaise ?? p.ratePaise ?? 0)); }
      }
      const sub = [0, 0, 0];
      for (const [k, x] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
        const [task, who] = k.split(' · ');
        rows.push({ cells: [task, who, Math.round(x[0] * 100) / 100, Math.round(x[1] * 100) / 100, x[2]], indent: 1 });
        x.forEach((v, i) => (sub[i] += v));
      }
      rows.push({ cells: [`Total ${p.name}`, null, Math.round(sub[0] * 100) / 100, Math.round(sub[1] * 100) / 100, sub[2]], style: 'total' });
      sub.forEach((v, i) => (total[i] += v));
    }
    rows.push({ cells: ['Total', null, Math.round(total[0] * 100) / 100, Math.round(total[1] * 100) / 100, total[2]], style: 'grand' });
    return {
      key: 'project_details', title: 'Project details', subtitle: r.label,
      columns: [text('task', 'Task'), text('person', 'Person'), num('hours', 'Hours'), num('billable', 'Billable hours'), money('value', 'Billable value')],
      rows, notes: ['Billable value at the entry’s rate, or the project’s.'],
    };
  },
};

const timesheet: ReportDef = {
  key: 'timesheet_details', title: 'Timesheet details', category: 'projects', params: 'range', shape: 'list', filters: [PROJECT, { key: 'userId', label: 'Person', kind: 'user' }],
  description: 'Every time entry in the period: who, on what, how long, and whether it is billed.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const pid = oid(ctx.p.projectId);
    const time = await ctx.data.time.find({ orgId: ctx.orgId, date: { $gte: r.fromDate, $lte: r.toDate }, ...(pid ? { projectId: pid } : {}), ...(ctx.p.userId ? { userId: ctx.p.userId } : {}) }).sort({ date: 1 }).lean().exec();
    const projects = await ctx.data.projects.find({ orgId: ctx.orgId, _id: { $in: time.map((t) => t.projectId) } }, { name: 1, ratePaise: 1 }).lean().exec();
    const p = new Map(projects.map((x) => [String(x._id), x]));
    const rows: Cell[][] = time.map((t) => {
      const rate = t.ratePaise ?? p.get(String(t.projectId))?.ratePaise ?? null;
      return [t.date, p.get(String(t.projectId))?.name ?? 'Unknown project', t.userName, t.task || 'General', t.notes ?? '', t.hours, t.billable ? 'Yes' : 'No', statusLabel(t.status), rate, t.billable && rate ? Math.round(t.hours * rate) : null];
    });
    const columns = [text('date', 'Date'), text('project', 'Project'), text('person', 'Person'), text('task', 'Task'), text('notes', 'Notes'), num('hours', 'Hours'), text('billable', 'Billable'), text('status', 'Status'), money('rate', 'Rate an hour'), money('value', 'Billable value')];
    return listTable({ key: 'timesheet_details', title: 'Timesheet details', subtitle: r.label, columns, rows, sum: ['hours', 'value'], notes: ['Time logged by its date.'] });
  },
};

const unbilled: ReportDef = {
  key: 'unbilled_time', title: 'Unbilled time', category: 'projects', params: 'today', shape: 'list', filters: [PROJECT],
  description: 'Billable time not yet on an invoice, by project and person, at its rates.',
  async run(ctx) {
    const pid = oid(ctx.p.projectId);
    const time = await ctx.data.time.find({ orgId: ctx.orgId, billable: true, status: 'unbilled', ...(pid ? { projectId: pid } : {}) }).sort({ date: 1 }).lean().exec();
    const projects = await ctx.data.projects.find({ orgId: ctx.orgId, _id: { $in: time.map((t) => t.projectId) } }, { name: 1, ratePaise: 1, customerId: 1 }).lean().exec();
    const customers = await ctx.data.names('customers', ctx.orgId, projects.map((x) => x.customerId));
    const p = new Map(projects.map((x) => [String(x._id), x]));
    const rows: Cell[][] = time.map((t) => {
      const proj = p.get(String(t.projectId));
      const rate = t.ratePaise ?? proj?.ratePaise ?? 0;
      return [proj?.name ?? 'Unknown project', proj?.customerId ? customers.get(String(proj.customerId)) ?? '' : 'Internal', t.date, t.userName, t.task || 'General', t.hours, rate || null, Math.round(t.hours * rate)];
    });
    const columns = [text('project', 'Project'), text('customer', 'Customer'), text('date', 'Date'), text('person', 'Person'), text('task', 'Task'), num('hours', 'Hours'), money('rate', 'Rate an hour'), money('value', 'Value')];
    return listTable({ key: 'unbilled_time', title: 'Unbilled time', subtitle: `As at ${ctx.today}`, columns, rows, sum: ['hours', 'value'], notes: ['Bill it from the project: it becomes a draft invoice for you to check and post.'] });
  },
};

// ── Inventory ───────────────────────────────────────────────────────────

const stock = (ctx: RunCtx) => ctx.data.service(async () => (await import('../../stock/stock.service')).StockService, 'Stock');

const inventorySummary: ReportDef = {
  key: 'inventory_summary', title: 'Inventory summary', category: 'inventory', params: 'asof', shape: 'list',
  description: 'Each stock item on a date: quantity in hand, on order, average cost and value.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const s = await (await stock(ctx)).summary(ctx.orgId, asOf);
    const rows: Cell[][] = s.rows.map((x) => [x.name, x.code ?? '', x.uqc, x.qty, x.onOrder, x.avgPaise, x.valuePaise, x.reorder ? `Reorder ${x.reorder.suggestQty}` : x.negative ? 'Below zero' : '']);
    const columns = [text('item', 'Item'), text('code', 'Code'), text('uqc', 'Unit'), num('qty', 'In hand'), num('onOrder', 'On order'), money('avg', 'Average cost'), money('value', 'Stock value'), text('note', 'Note')];
    return listTable({ key: 'inventory_summary', title: 'Inventory summary', subtitle: `As at ${asOf}`, columns, rows, sum: ['value'], notes: ['From posted bills and invoices linked to counted items, and stock adjustments, at weighted average cost.'] });
  },
};

const inventoryValuation: ReportDef = {
  key: 'inventory_valuation', title: 'Inventory valuation summary', category: 'inventory', params: 'asof', shape: 'list',
  description: 'Stock value by item on a date, its share of the whole, against Stock in Hand in the books.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const [s, nets, chart] = await Promise.all([(await stock(ctx)).summary(ctx.orgId, asOf), ctx.data.nets(ctx.orgId, { to: asOf, includeClosing: true }), ctx.data.chart(ctx.orgId)]);
    const total = s.totals.valuePaise;
    const books = [...chart.values()].filter((a) => a.systemKey === 'INVENTORY').reduce((sum, a) => sum + (nets.get(a.id) ?? 0), 0);
    const rows: Cell[][] = s.rows.filter((x) => x.qty !== 0 || x.valuePaise !== 0).sort((a, b) => b.valuePaise - a.valuePaise).map((x) => [x.name, x.uqc, x.qty, x.avgPaise, x.valuePaise, total ? Math.round((x.valuePaise / total) * 1000) / 10 : null]);
    const columns = [text('item', 'Item'), text('uqc', 'Unit'), num('qty', 'Quantity'), money('avg', 'Average cost'), money('value', 'Value'), num('share', 'Share %')];
    return listTable({ key: 'inventory_valuation', title: 'Inventory valuation summary', subtitle: `As at ${asOf}`, columns, rows, sum: ['value'], notes: [`Stock in Hand in the books: ${(books / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} rupees. A difference is closed by the month-end closing stock entry.`] });
  },
};

export const BANKING_REPORTS: ReportDef[] = [reconciliation, moneyBook('bank'), moneyBook('cash')];
export const PROJECT_REPORTS: ReportDef[] = [projectSummary, projectDetails, timesheet, unbilled];
export const INVENTORY_REPORTS: ReportDef[] = [inventorySummary, inventoryValuation];
