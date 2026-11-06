/**
 * Accountant, Currency, Activity, Automation and Recurring Invoices: the
 * ledgers and journals, exchange gains and losses, who changed what, and
 * what ran on its own. Read-only.
 */
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccountType, JournalStatus, VoucherType } from '@ai-accounting/shared';
import { ReportRow } from '../report-table';
import { fyMonths, monthLabel } from '../management';
import { Cell, FilterDef, ReportDef, addDays, listTable, money, num, rangeDates, statusLabel, text } from './types';
import { monthOf } from './taxes';

const ACCOUNT: FilterDef = { key: 'accountId', label: 'Account', kind: 'account' };
const MAX_LINES = 5000;
const voucher = (j: { voucherType: string; financialYear: string; voucherNumber: number }) => `${j.voucherType}/${j.financialYear}/${j.voucherNumber}`;
const isPl = (t: AccountType) => t === AccountType.INCOME || t === AccountType.EXPENSE;

// ── Accountant ──────────────────────────────────────────────────────────

const generalLedger: ReportDef = {
  key: 'general_ledger', title: 'General ledger', category: 'accountant', params: 'range', shape: 'list', filters: [ACCOUNT],
  description: 'Every account’s opening balance, debits, credits and closing balance for the period.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const fyStart = `${fyMonths(r.from).from}-01`;
    const [chart, before, beforeInYear, moves] = await Promise.all([
      ctx.data.chart(ctx.orgId),
      ctx.data.nets(ctx.orgId, { to: addDays(r.fromDate, -1), includeClosing: true }),
      r.fromDate > fyStart ? ctx.data.nets(ctx.orgId, { from: fyStart, to: addDays(r.fromDate, -1), includeClosing: true }) : Promise.resolve(new Map<string, number>()),
      ctx.data.movements(ctx.orgId, { from: r.fromDate, to: r.toDate }),
    ]);
    const rows: Cell[][] = [...chart.values()]
      .filter((a) => !a.isGroup && (!ctx.p.accountId || a.id === ctx.p.accountId))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => {
        // Income and expense start every year at nil; balance-sheet accounts carry forward.
        const open = isPl(a.type) ? beforeInYear.get(a.id) ?? 0 : before.get(a.id) ?? 0;
        const m = moves.get(a.id) ?? { dr: 0, cr: 0 };
        return { a, open, m, close: open + m.dr - m.cr };
      })
      .filter((x) => x.open || x.m.dr || x.m.cr)
      .map(({ a, open, m, close }) => [a.code, a.name, statusLabel(a.type.toLowerCase()), open, m.dr, m.cr, close]);
    const columns = [text('code', 'Code'), text('account', 'Account'), text('type', 'Type'), money('opening', 'Opening (Dr +)'), money('debit', 'Debit'), money('credit', 'Credit'), money('closing', 'Closing (Dr +)')];
    return listTable({ key: 'general_ledger', title: 'General ledger', subtitle: r.label, columns, rows, sum: ['opening', 'debit', 'credit', 'closing'], notes: ['Balances are debit positive, credit negative. Income and expense accounts open each financial year at nil.'] });
  },
};

const detailedLedger: ReportDef = {
  key: 'detailed_general_ledger', title: 'Detailed general ledger', category: 'accountant', params: 'range', shape: 'statement', filters: [ACCOUNT],
  description: 'Each account’s postings in the period with a running balance, opening to closing.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const fyStart = `${fyMonths(r.from).from}-01`;
    const accountFilter = ctx.p.accountId && Types.ObjectId.isValid(ctx.p.accountId) ? { 'lines.accountId': new Types.ObjectId(ctx.p.accountId) } : {};
    const [chart, before, beforeInYear, journals] = await Promise.all([
      ctx.data.chart(ctx.orgId),
      ctx.data.nets(ctx.orgId, { to: addDays(r.fromDate, -1), includeClosing: true }),
      r.fromDate > fyStart ? ctx.data.nets(ctx.orgId, { from: fyStart, to: addDays(r.fromDate, -1), includeClosing: true }) : Promise.resolve(new Map<string, number>()),
      ctx.data.journals.find({ orgId: ctx.orgId, status: JournalStatus.POSTED, date: { $gte: r.fromDate, $lte: r.toDate }, ...accountFilter }).sort({ date: 1, voucherNumber: 1 }).limit(MAX_LINES).lean().exec(),
    ]);
    const byAccount = new Map<string, Array<{ j: (typeof journals)[number]; dr: number; cr: number }>>();
    for (const j of journals) for (const l of j.lines) {
      const id = String(l.accountId);
      if (ctx.p.accountId && id !== ctx.p.accountId) continue;
      (byAccount.get(id) ?? byAccount.set(id, []).get(id)!).push({ j, dr: l.debitPaise, cr: l.creditPaise });
    }
    const rows: ReportRow[] = [];
    for (const a of [...chart.values()].filter((x) => !x.isGroup).sort((x, y) => x.code.localeCompare(y.code))) {
      const lines = byAccount.get(a.id) ?? [];
      if (ctx.p.accountId && a.id !== ctx.p.accountId) continue;
      let balance = isPl(a.type) ? beforeInYear.get(a.id) ?? 0 : before.get(a.id) ?? 0;
      if (!lines.length && !balance) continue;
      rows.push({ cells: [`${a.code} ${a.name}`, null, null, null, null, null], style: 'group' });
      rows.push({ cells: ['', '', 'Opening balance', null, null, balance], indent: 1 });
      let dr = 0;
      let cr = 0;
      for (const x of lines) {
        balance += x.dr - x.cr;
        dr += x.dr;
        cr += x.cr;
        rows.push({ cells: [x.j.date, voucher(x.j), x.j.narration ?? '', x.dr || null, x.cr || null, balance], indent: 1 });
      }
      rows.push({ cells: [`Closing ${a.name}`, null, null, dr, cr, balance], style: 'total' });
    }
    return {
      key: 'detailed_general_ledger', title: 'Detailed general ledger', subtitle: r.label,
      columns: [text('date', 'Date'), text('voucher', 'Voucher'), text('narration', 'Narration'), money('debit', 'Debit'), money('credit', 'Credit'), money('balance', 'Balance (Dr +)')],
      rows, notes: [journals.length >= MAX_LINES ? `Only the first ${MAX_LINES} vouchers are shown: pick an account or a shorter period.` : 'Posted vouchers by date, the year-end closing entry included.'],
    };
  },
};

const VOUCHER_FILTER: FilterDef = { key: 'status', label: 'Voucher type', kind: 'select', options: Object.values(VoucherType).map((v) => [v, statusLabel(v.toLowerCase())] as [string, string]) };

const accountTransactions: ReportDef = {
  key: 'account_transactions', title: 'Account transactions', category: 'accountant', params: 'range', shape: 'list', filters: [ACCOUNT, VOUCHER_FILTER],
  description: 'Every posted line in the period: date, voucher, account, narration, debit and credit.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const f: Record<string, unknown> = { orgId: ctx.orgId, status: JournalStatus.POSTED, date: { $gte: r.fromDate, $lte: r.toDate } };
    if (ctx.p.accountId && Types.ObjectId.isValid(ctx.p.accountId)) f['lines.accountId'] = new Types.ObjectId(ctx.p.accountId);
    if (ctx.p.status && (Object.values(VoucherType) as string[]).includes(ctx.p.status)) f.voucherType = ctx.p.status;
    const [chart, journals] = await Promise.all([ctx.data.chart(ctx.orgId), ctx.data.journals.find(f).sort({ date: 1, voucherNumber: 1 }).limit(MAX_LINES).lean().exec()]);
    const rows: Cell[][] = journals.flatMap((j) => j.lines.filter((l) => !ctx.p.accountId || String(l.accountId) === ctx.p.accountId).map((l) => [j.date, voucher(j), chart.get(String(l.accountId))?.name ?? l.description ?? '', j.narration ?? '', l.debitPaise || null, l.creditPaise || null] as Cell[]));
    const columns = [text('date', 'Date'), text('voucher', 'Voucher'), text('account', 'Account'), text('narration', 'Narration'), money('debit', 'Debit'), money('credit', 'Credit')];
    return listTable({ key: 'account_transactions', title: 'Account transactions', subtitle: r.label, columns, rows, sum: ['debit', 'credit'], notes: [journals.length >= MAX_LINES ? `Only the first ${MAX_LINES} vouchers are shown.` : 'Posted lines by date.'] });
  },
};

const accountTypeSummary: ReportDef = {
  key: 'account_type_summary', title: 'Account type summary', category: 'accountant', params: 'range', shape: 'list',
  description: 'Debits and credits for the period by account type: assets, liabilities, capital, income and expenses.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [chart, moves] = await Promise.all([ctx.data.chart(ctx.orgId), ctx.data.movements(ctx.orgId, { from: r.fromDate, to: r.toDate })]);
    const by = new Map<string, number[]>();
    for (const [id, m] of moves) {
      const t = chart.get(id)?.type ?? 'UNKNOWN';
      const x = by.get(t) ?? by.set(t, [0, 0]).get(t)!;
      x[0] += m.dr; x[1] += m.cr;
    }
    const order = [AccountType.ASSETS, AccountType.LIABILITIES, AccountType.CAPITAL, AccountType.INCOME, AccountType.EXPENSE, 'UNKNOWN'];
    const rows: Cell[][] = order.filter((t) => by.has(t)).map((t) => [statusLabel(t.toLowerCase()), by.get(t)![0], by.get(t)![1], by.get(t)![0] - by.get(t)![1]]);
    const columns = [text('type', 'Account type'), money('debit', 'Debit'), money('credit', 'Credit'), money('net', 'Net (Dr +)')];
    return listTable({ key: 'account_type_summary', title: 'Account type summary', subtitle: r.label, columns, rows, sum: ['debit', 'credit', 'net'], notes: ['Debits equal credits overall, so the net total is nil.'] });
  },
};

const journalReport: ReportDef = {
  key: 'journal_report', title: 'Journal report', category: 'accountant', params: 'range', shape: 'statement', filters: [VOUCHER_FILTER],
  description: 'Every posted voucher in the period with its debit and credit lines.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const f: Record<string, unknown> = { orgId: ctx.orgId, status: JournalStatus.POSTED, date: { $gte: r.fromDate, $lte: r.toDate } };
    if (ctx.p.status && (Object.values(VoucherType) as string[]).includes(ctx.p.status)) f.voucherType = ctx.p.status;
    const [chart, journals] = await Promise.all([ctx.data.chart(ctx.orgId), ctx.data.journals.find(f).sort({ date: 1, voucherType: 1, voucherNumber: 1 }).limit(MAX_LINES).lean().exec()]);
    const rows: ReportRow[] = [];
    let dr = 0;
    let cr = 0;
    for (const j of journals) {
      const d = j.lines.reduce((s, l) => s + l.debitPaise, 0);
      rows.push({ cells: [j.date, voucher(j), j.narration ?? '', d, d], style: 'total' });
      for (const l of j.lines) rows.push({ cells: ['', '', chart.get(String(l.accountId))?.name ?? l.description ?? '', l.debitPaise || null, l.creditPaise || null], indent: 1 });
      dr += d; cr += j.lines.reduce((s, l) => s + l.creditPaise, 0);
    }
    rows.push({ cells: ['Total', null, `${journals.length} vouchers`, dr, cr], style: 'grand' });
    return {
      key: 'journal_report', title: 'Journal report', subtitle: r.label,
      columns: [text('date', 'Date'), text('voucher', 'Voucher'), text('particulars', 'Particulars'), money('debit', 'Debit'), money('credit', 'Credit')],
      rows, notes: [journals.length >= MAX_LINES ? `Only the first ${MAX_LINES} vouchers are shown.` : 'Every voucher balances: its debits equal its credits.'],
    };
  },
};

const accountLedger: ReportDef = {
  key: 'account_ledger', title: 'Account ledger', category: 'accountant', params: 'year', shape: 'list', filters: [{ ...ACCOUNT, required: true }],
  description: 'One account’s postings for a financial year with the running balance, brought forward and carried down.',
  async run(ctx) {
    if (!ctx.p.accountId) throw new BadRequestException('Pick an account.');
    const fy = ctx.p.financialYear || fyMonths(ctx.today.slice(0, 7)).fy;
    const l = await ctx.data.reports.getLedger(ctx.orgId, fy, ctx.p.accountId);
    return {
      key: 'account_ledger', title: `Ledger: ${l.accountDescription}`, subtitle: `Financial year ${fy}`,
      columns: [text('date', 'Date'), text('voucher', 'Voucher'), text('narration', 'Narration'), money('debit', 'Debit'), money('credit', 'Credit'), money('balance', 'Balance (Dr +)')],
      rows: [
        { cells: ['', 'Opening', 'Brought forward', null, null, l.openingBalancePaise] },
        ...l.entries.map((e) => ({ cells: [e.date, `${e.voucherType}/${e.voucherNumber}`, [e.narration, e.contact].filter(Boolean).join(" · "), e.debitPaise || null, e.creditPaise || null, e.runningBalancePaise] as Cell[] })),
        { cells: ['Closing balance', null, null, l.entries.reduce((s, e) => s + e.debitPaise, 0), l.entries.reduce((s, e) => s + e.creditPaise, 0), l.closingBalancePaise], style: 'grand' },
      ],
      notes: ['Balance-sheet accounts open with everything posted before the year; income and expense accounts open at nil.'],
    };
  },
};

const dayBook: ReportDef = {
  key: 'day_book', title: 'Day book', category: 'accountant', params: 'year', shape: 'statement',
  description: 'Every voucher posted in a financial year, day by day, with its lines.',
  async run(ctx) {
    const fy = ctx.p.financialYear || fyMonths(ctx.today.slice(0, 7)).fy;
    const list = await ctx.data.reports.getDayBook(ctx.orgId, undefined, undefined, fy);
    const rows: ReportRow[] = [];
    for (const e of list.slice(0, MAX_LINES)) {
      rows.push({ cells: [e.date, `${e.voucherType}/${e.voucherNumber}`, e.narration || '', e.totalAmountPaise, e.totalAmountPaise], style: 'total' });
      for (const l of e.lines) rows.push({ cells: ['', '', l.description, l.debitPaise || null, l.creditPaise || null], indent: 1 });
    }
    rows.push({ cells: ['Total', null, `${list.length} vouchers`, list.reduce((s, e) => s + e.totalAmountPaise, 0), list.reduce((s, e) => s + e.totalAmountPaise, 0)], style: 'grand' });
    return {
      key: 'day_book', title: 'Day book', subtitle: `Financial year ${fy}`,
      columns: [text('date', 'Date'), text('voucher', 'Voucher'), text('particulars', 'Particulars'), money('debit', 'Debit'), money('credit', 'Credit')],
      rows, notes: [list.length > MAX_LINES ? `Only the first ${MAX_LINES} vouchers are shown; download the CSV for the rest from the account transactions report.` : 'Posted vouchers in date order.'],
    };
  },
};

// ── Currency ────────────────────────────────────────────────────────────

const UNREALISED = /revaluation|base currency adjustment/i;

const realisedFx: ReportDef = {
  key: 'realised_fx', title: 'Realised exchange gain or loss', category: 'currency', params: 'range', shape: 'list',
  description: 'Exchange gains and losses booked when foreign-currency invoices and bills were settled.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const chart = await ctx.data.chart(ctx.orgId);
    const fx = [...chart.values()].filter((a) => a.systemKey === 'FX_GAIN' || a.systemKey === 'FX_LOSS');
    const ids = fx.map((a) => new Types.ObjectId(a.id));
    const journals = ids.length ? await ctx.data.journals.find({ orgId: ctx.orgId, status: JournalStatus.POSTED, date: { $gte: r.fromDate, $lte: r.toDate }, 'lines.accountId': { $in: ids } }).sort({ date: 1 }).lean().exec() : [];
    const fxIds = new Set(fx.map((a) => a.id));
    const rows: Cell[][] = journals
      .filter((j) => !UNREALISED.test(j.narration ?? ''))
      .map((j) => {
        const net = j.lines.filter((l) => fxIds.has(String(l.accountId))).reduce((s, l) => s + l.creditPaise - l.debitPaise, 0);
        return [j.date, voucher(j), j.narration ?? '', net > 0 ? net : null, net < 0 ? -net : null, net];
      });
    const columns = [text('date', 'Date'), text('voucher', 'Voucher'), text('narration', 'Settlement'), money('gain', 'Gain'), money('loss', 'Loss'), money('net', 'Net gain (loss)')];
    return listTable({ key: 'realised_fx', title: 'Realised exchange gain or loss', subtitle: r.label, columns, rows, sum: ['gain', 'loss', 'net'], notes: ['From the Foreign Exchange Gain and Loss accounts, month-end revaluations left out.'] });
  },
};

const unrealisedFx: ReportDef = {
  key: 'unrealised_fx', title: 'Unrealised exchange gain or loss', category: 'currency', params: 'month', shape: 'list',
  description: 'Open foreign-currency invoices and bills at a month’s end, at their booked rate and at the month-end rate.',
  async run(ctx) {
    const period = monthOf(ctx);
    const foreign = await ctx.data.service(async () => (await import('../../currency/foreign.service')).ForeignService, 'Foreign currency');
    const r = await foreign.revaluation(ctx.orgId, period);
    const rows: Cell[][] = r.rows.map((x) => [x.kind === 'invoice' ? 'Invoice' : 'Bill', x.number ?? '', x.currency, Math.round(x.openMinor) / 10 ** x.digits, x.bookedRate, x.rate, x.bookedPaise, x.revaluedPaise, x.differencePaise === null ? null : x.kind === 'invoice' ? x.differencePaise : -x.differencePaise]);
    const columns = [text('kind', 'Document'), text('number', 'Number'), text('currency', 'Currency'), num('open', 'Open, in the currency'), num('booked', 'Booked rate'), num('rate', 'Month-end rate'), money('bookedInr', 'At booked rate'), money('revalued', 'At month-end rate'), money('gain', 'Gain (loss)')];
    return listTable({
      key: 'unrealised_fx', title: 'Unrealised exchange gain or loss', subtitle: `${monthLabel(period)}, at ${r.date}`, columns, rows, sum: ['gain'],
      notes: ['A receivable worth more in rupees is a gain; a payable worth more is a loss. Nothing is posted here: the revaluation goes to the review queue from the Currency page.', ...(r.missingRates.length ? [`No month-end rate entered for ${r.missingRates.join(', ')}.`] : [])],
    });
  },
};

// ── Activity ────────────────────────────────────────────────────────────

const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const actorName = (id: string, names: Map<string, string>) => names.get(id) ?? (id.startsWith('system') ? `System (${id.replace(/^system:?/, '').replace(/-/g, ' ') || 'automatic'})` : 'Former user');

const activityLog: ReportDef = {
  key: 'activity_log', title: 'Activity log', category: 'activity', params: 'range', shape: 'list', filters: [{ key: 'userId', label: 'Person', kind: 'user' }],
  description: 'Every change made in the period: when, by whom, to which record, and what was done.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const f: Record<string, unknown> = { orgId: ctx.orgId, createdAt: { $gte: new Date(`${r.fromDate}T00:00:00+05:30`), $lt: new Date(new Date(`${r.toDate}T00:00:00+05:30`).getTime() + 86_400_000) } };
    if (ctx.p.userId) f.performedBy = ctx.p.userId;
    const logs = await ctx.data.audit.find(f).sort({ _id: -1 }).limit(MAX_LINES).lean().exec();
    const names = await ctx.data.userNames(logs.map((l) => l.performedBy));
    const rows: Cell[][] = logs.map((l) => {
      const at = (l as unknown as { createdAt?: Date }).createdAt ?? l._id.getTimestamp();
      const meta = (l.meta as Record<string, unknown> | undefined) ?? {};
      return [new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' '), actorName(l.performedBy, names), l.entityType, statusLabel(l.action.toLowerCase()), l.entityId, typeof meta.impersonatedBy === 'string' ? 'Yes' : ''];
    });
    const columns = [text('at', 'When (IST)'), text('person', 'Person'), text('record', 'Record type'), text('action', 'Action'), text('id', 'Record'), text('impersonated', 'By platform support')];
    return listTable({ key: 'activity_log', title: 'Activity log', subtitle: r.label, columns, rows, notes: [logs.length >= MAX_LINES ? `The latest ${MAX_LINES} changes are shown.` : 'From the audit trail, newest first. It is append-only: nothing in it can be changed.'] });
  },
};

const activityByUser: ReportDef = {
  key: 'activity_by_user', title: 'Activity by user', category: 'activity', params: 'range', shape: 'list',
  description: 'How many changes each person made in the period, by kind of record.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const rowsRaw = await ctx.data.audit.aggregate<{ _id: { u: string; t: string }; n: number; first: Date; last: Date }>([
      { $match: { orgId: ctx.orgId, createdAt: { $gte: new Date(`${r.fromDate}T00:00:00+05:30`), $lt: new Date(new Date(`${r.toDate}T00:00:00+05:30`).getTime() + 86_400_000) } } },
      { $group: { _id: { u: '$performedBy', t: '$entityType' }, n: { $sum: 1 }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
    ]).exec();
    const names = await ctx.data.userNames(rowsRaw.map((x) => x._id.u));
    const rows: Cell[][] = rowsRaw
      .map((x) => [actorName(x._id.u, names), x._id.t, x.n, istDay(x.first), istDay(x.last)] as Cell[])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || (b[2] as number) - (a[2] as number));
    const columns = [text('person', 'Person'), text('record', 'Record type'), num('changes', 'Changes'), text('first', 'First'), text('last', 'Last')];
    return listTable({ key: 'activity_by_user', title: 'Activity by user', subtitle: r.label, columns, rows, sum: ['changes'], notes: ['Counted from the audit trail.'] });
  },
};

// ── Automation and recurring ────────────────────────────────────────────

const FREQ: Record<string, string> = { weekly: 'Weekly', fortnightly: 'Every two weeks', monthly: 'Monthly', bimonthly: 'Every two months', quarterly: 'Quarterly', half_yearly: 'Every six months', yearly: 'Yearly' };

const recurringInvoices: ReportDef = {
  key: 'recurring_invoice_details', title: 'Recurring invoice details', category: 'recurring', params: 'today', shape: 'list', filters: [{ key: 'customerId', label: 'Customer', kind: 'customer' }, { key: 'status', label: 'Status', kind: 'select', options: [['active', 'Active'], ['paused', 'Paused'], ['ended', 'Ended']] }],
  description: 'Each recurring invoice profile: customer, how often, the next date, its amount and the invoices it has made.',
  async run(ctx) {
    const list = await ctx.data.templates.find({ orgId: ctx.orgId, kind: 'invoice', ...(ctx.p.customerId ? { partyId: ctx.p.customerId } : {}), ...(ctx.p.status ? { status: ctx.p.status } : {}) }).sort({ name: 1 }).lean().exec();
    const names = await ctx.data.names('customers', ctx.orgId, list.map((t) => t.partyId));
    const rows: Cell[][] = list.map((t) => {
      const made = t.generated ?? [];
      return [t.name, names.get(String(t.partyId)) ?? '', FREQ[t.frequency] ?? t.frequency, t.startDate, t.endDate ?? 'Never', t.status === 'active' ? t.nextRunDate ?? '' : '', statusLabel(t.status), t.amountsPaise?.total ?? null, made.length, made.map((g) => g.documentDate).sort().pop() ?? '', t.lastError ?? ''];
    });
    const columns = [text('profile', 'Profile'), text('customer', 'Customer'), text('frequency', 'Repeats'), text('start', 'Starts'), text('end', 'Ends'), text('next', 'Next invoice'), text('status', 'Status'), money('amount', 'Amount'), num('made', 'Invoices made'), text('last', 'Last made'), text('error', 'Last problem')];
    return listTable({ key: 'recurring_invoice_details', title: 'Recurring invoice details', subtitle: `As at ${ctx.today}`, columns, rows, sum: ['made'], notes: ['Each run makes a draft invoice for you to check and post.'] });
  },
};

const recurringRuns: ReportDef = {
  key: 'recurring_runs', title: 'Recurring runs', category: 'automation', params: 'range', shape: 'list',
  description: 'Every invoice, bill, expense and journal a recurring profile made in the period.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const list = await ctx.data.templates.find({ orgId: ctx.orgId, 'generated.documentDate': { $gte: r.fromDate, $lte: r.toDate } }).lean().exec();
    const rows: Cell[][] = list
      .flatMap((t) => (t.generated ?? []).filter((g) => g.documentDate >= r.fromDate && g.documentDate <= r.toDate).map((g) => [g.documentDate, t.name, statusLabel(t.kind), FREQ[t.frequency] ?? t.frequency, istDay(new Date(g.createdAt)), t.amountsPaise?.total ?? null] as Cell[]))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const columns = [text('date', 'Document date'), text('profile', 'Profile'), text('kind', 'Makes'), text('frequency', 'Repeats'), text('made', 'Made on'), money('amount', 'Amount')];
    return listTable({ key: 'recurring_runs', title: 'Recurring runs', subtitle: r.label, columns, rows, sum: ['amount'], notes: ['Recurring profiles make drafts (journals go to the review queue); nothing posts without a person.'] });
  },
};

const RUNG: Record<string, string> = { before_due: 'Before due', on_due: 'On the due date', late_7: '7 days late', late_15: '15 days late', late_30: '30 days late', manual: 'Sent by hand' };

const remindersSent: ReportDef = {
  key: 'reminders_sent', title: 'Payment reminders sent', category: 'automation', params: 'range', shape: 'list', filters: [{ key: 'customerId', label: 'Customer', kind: 'customer' }],
  description: 'Every payment reminder in the period: to whom, for which invoice, when, and whether it went.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const f: Record<string, unknown> = { orgId: ctx.orgId, createdAt: { $gte: new Date(`${r.fromDate}T00:00:00+05:30`), $lt: new Date(new Date(`${r.toDate}T00:00:00+05:30`).getTime() + 86_400_000) } };
    if (ctx.p.customerId && Types.ObjectId.isValid(ctx.p.customerId)) f.customerId = new Types.ObjectId(ctx.p.customerId);
    const list = await ctx.data.reminders.find(f).sort({ createdAt: 1 }).lean().exec();
    const [names, invoices] = await Promise.all([
      ctx.data.names('customers', ctx.orgId, list.map((x) => x.customerId)),
      ctx.data.invoices.find({ orgId: ctx.orgId, _id: { $in: list.map((x) => x.invoiceId) } }, { invoiceNumber: 1 }).lean().exec(),
    ]);
    const number = new Map(invoices.map((i) => [String(i._id), i.invoiceNumber]));
    const rows: Cell[][] = list.map((x) => {
      const at = x.sentAt ?? (x as unknown as { createdAt: Date }).createdAt;
      return [istDay(new Date(at)), names.get(String(x.customerId)) ?? 'Unknown customer', number.get(String(x.invoiceId)) ?? '', RUNG[x.rung] ?? x.rung, x.automatic ? 'Automatic' : 'By hand', x.channel === 'whatsapp' ? 'WhatsApp' : 'Email', x.to, statusLabel(x.status), x.outstandingPaise];
    });
    const columns = [text('date', 'Date'), text('customer', 'Customer'), text('invoice', 'Invoice'), text('rung', 'Reminder'), text('how', 'Sent'), text('channel', 'Channel'), text('to', 'To'), text('status', 'Status'), money('owed', 'Owed at the time')];
    return listTable({ key: 'reminders_sent', title: 'Payment reminders sent', subtitle: r.label, columns, rows, notes: ['The amount owed is as it was when the reminder was written.'] });
  },
};

export const ACCOUNTANT_REPORTS: ReportDef[] = [generalLedger, detailedLedger, accountTransactions, accountTypeSummary, journalReport, accountLedger, dayBook];
export const CURRENCY_REPORTS: ReportDef[] = [realisedFx, unrealisedFx];
export const ACTIVITY_REPORTS: ReportDef[] = [activityLog, activityByUser];
export const AUTOMATION_REPORTS: ReportDef[] = [recurringRuns, remindersSent];
export const RECURRING_REPORTS: ReportDef[] = [recurringInvoices];
