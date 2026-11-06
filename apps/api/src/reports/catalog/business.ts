/**
 * Business Overview: the P&L in the operating format, Schedule III and
 * side-by-side; the balance sheet in Schedule III and side-by-side; the
 * cash flow statement; ratios; movement of equity; the cash forecast.
 * All from posted journals, read-only.
 */
import { AccountType } from '@ai-accounting/shared';
import { ReportRow, ReportTable } from '../report-table';
import { monthEnd, rangeLabel, shiftMonth, fyMonths } from '../management';
import { msmeProtected } from '../../purchase/msme';
import {
  BORROWINGS, CURRENT_ASSETS, CURRENT_LIABILITIES, EQUITY, FIXED_ASSETS, HeadFigures, ASSET_HEADS, LIABILITY_HEADS,
  bsFigures, bsHead, isCostOfSales, plFigures, plHead, plTotals, scheduleBs, schedulePl, totalOf,
} from './schedule-iii';
import { DETAIL_FILTER, ReportDef, RunCtx, addDays, asOfDate, daysBetween, money, num, rangeDates, text } from './types';
import { DONE_BILL, owedAsOf } from './documents';
import type { ChartAccount } from './report-data.service';

const MONEY_HEADS = new Set(['cash']);
const isPlType = (a: ChartAccount | undefined) => !!a && (a.type === AccountType.INCOME || a.type === AccountType.EXPENSE);

/** The previous financial year's last day for a date: 2026-11-04 → 2026-03-31. */
const previousYearEnd = (date: string) => `${fyMonths(date.slice(0, 7)).from.slice(0, 4)}-03-31`;

/** MSME dues within trade payables at a date: open bills of micro and small enterprises. */
async function msmeDues(ctx: RunCtx, asOf: string): Promise<number> {
  const vendors = await ctx.data.vendors.find({ orgId: ctx.orgId, msme: { $ne: null } }, { msme: 1 }).lean().exec();
  const protectedIds = vendors.filter((v) => msmeProtected(v.msme)).map((v) => v._id);
  if (!protectedIds.length) return 0;
  const bills = await ctx.data.bills.find({ orgId: ctx.orgId, vendorId: { $in: protectedIds }, status: { $in: DONE_BILL }, billDate: { $lte: asOf } }).lean().exec();
  return bills.reduce((s, b) => s + owedAsOf(b, asOf), 0);
}

async function balanceFigures(ctx: RunCtx, asOf: string): Promise<{ figures: HeadFigures; chart: Map<string, ChartAccount> }> {
  const [nets, chart] = await Promise.all([ctx.data.nets(ctx.orgId, { to: asOf, includeClosing: true }), ctx.data.chart(ctx.orgId)]);
  return { figures: bsFigures(nets, chart), chart };
}

// ── Profit and loss ─────────────────────────────────────────────────────

/** Income and expense by the operating format: gross profit, operating profit, net profit. */
export function operatingPl(nets: Map<string, number>, chart: Map<string, ChartAccount>, label: string): ReportTable {
  const sections: Record<'opIncome' | 'cogs' | 'opex' | 'otherIncome' | 'otherExpense', Array<{ name: string; amount: number; code: string }>> = { opIncome: [], cogs: [], opex: [], otherIncome: [], otherExpense: [] };
  for (const [id, net] of nets) {
    const a = chart.get(id);
    if (!isPlType(a) || net === 0) continue;
    const h = plHead(a!);
    const amount = a!.type === AccountType.INCOME ? -net : net;
    const row = { name: a!.name, amount, code: a!.code };
    if (a!.type === AccountType.INCOME) (h === 'other_income' ? sections.otherIncome : sections.opIncome).push(row);
    else if (isCostOfSales(a!)) sections.cogs.push(row);
    else if (h === 'finance' || h === 'tax' || a!.systemKey === 'FX_LOSS' || a!.systemKey === 'ASSET_DISPOSAL_LOSS') sections.otherExpense.push(row);
    else sections.opex.push(row);
  }
  const rows: ReportRow[] = [];
  const total = (list: Array<{ amount: number }>) => list.reduce((s, r) => s + r.amount, 0);
  const section = (title: string, list: Array<{ name: string; amount: number; code: string }>) => {
    rows.push({ cells: [title, null], style: 'group' });
    for (const r of list.sort((x, y) => x.code.localeCompare(y.code))) rows.push({ cells: [r.name, r.amount], indent: 1 });
    rows.push({ cells: [`Total ${title.toLowerCase()}`, total(list)], style: 'total' });
    return total(list);
  };
  const inc = section('Operating income', sections.opIncome);
  const cogs = section('Cost of goods sold', sections.cogs);
  rows.push({ cells: ['Gross profit', inc - cogs], style: 'total' });
  const opex = section('Operating expenses', sections.opex);
  const operating = inc - cogs - opex;
  rows.push({ cells: ['Operating profit', operating], style: 'total' });
  const oi = section('Non-operating income', sections.otherIncome);
  const oe = section('Non-operating expenses', sections.otherExpense);
  rows.push({ cells: ['Net profit', operating + oi - oe], style: 'grand' });
  return {
    key: 'profit_and_loss', title: 'Profit and loss', subtitle: label,
    columns: [text('account', 'Account'), money('amount', 'Amount')], rows,
    notes: ['From posted journals; the year-end closing entry is left out. Cost of goods sold is purchases, materials, the change in stock and the Direct Expenses group. Interest, tax, exchange loss and loss on assets sold are non-operating.'],
  };
}

const profitAndLoss: ReportDef = {
  key: 'profit_and_loss', title: 'Profit and loss', category: 'business', params: 'range', shape: 'statement',
  description: 'Income and expenses for a period, with gross, operating and net profit.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [nets, chart] = await Promise.all([ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate }), ctx.data.chart(ctx.orgId)]);
    return operatingPl(nets, chart, r.label);
  },
};

const plScheduleIii: ReportDef = {
  key: 'pl_schedule_iii', title: 'Profit and loss (Schedule III)', category: 'business', params: 'range', shape: 'statement', filters: [DETAIL_FILTER],
  description: 'The statement of profit and loss in the Companies Act Schedule III (Division I) format, against the same months a year earlier.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const prev = { from: shiftMonth(r.from, -12), to: shiftMonth(r.to, -12) };
    const [cur, before, chart] = await Promise.all([
      ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate }),
      ctx.data.nets(ctx.orgId, { from: `${prev.from}-01`, to: monthEnd(prev.to) }),
      ctx.data.chart(ctx.orgId),
    ]);
    const details = ctx.p.detail === 'accounts';
    return {
      key: 'pl_schedule_iii', title: 'Statement of profit and loss (Schedule III)', subtitle: `${r.label}, against ${rangeLabel(prev.from, prev.to)}`,
      columns: [text('particulars', 'Particulars'), money('current', r.label), money('previous', rangeLabel(prev.from, prev.to))],
      rows: schedulePl(plFigures(cur, chart), plFigures(before, chart), { details }),
      notes: [
        'Companies Act, 2013, Schedule III, Division I. Each account is placed under a head by its role, its group and its name; choose "Heads and their accounts" to see where each went.',
        'AiBooks does not record exceptional or extraordinary items, or deferred tax, separately: they show within the heads they were posted to.',
      ],
    };
  },
};

/** The traditional side-by-side P&L: trading account, then profit and loss account. */
export function horizontalPl(nets: Map<string, number>, chart: Map<string, ChartAccount>): ReportRow[] {
  const direct = { dr: [] as Array<[string, number]>, cr: [] as Array<[string, number]> };
  const indirect = { dr: [] as Array<[string, number]>, cr: [] as Array<[string, number]> };
  for (const [id, net] of [...nets].sort((a, b) => (chart.get(a[0])?.code ?? '').localeCompare(chart.get(b[0])?.code ?? ''))) {
    const a = chart.get(id);
    if (!isPlType(a) || net === 0) continue;
    if (a!.type === AccountType.INCOME) (plHead(a!) === 'other_income' ? indirect.cr : direct.cr).push([a!.name, -net]);
    else (isCostOfSales(a!) ? direct.dr : indirect.dr).push([a!.name, net]);
  }
  const sum = (l: Array<[string, number]>) => l.reduce((s, [, v]) => s + v, 0);
  const gross = sum(direct.cr) - sum(direct.dr);
  if (gross >= 0) direct.dr.push(['Gross profit c/d', gross]);
  else direct.cr.push(['Gross loss c/d', -gross]);
  if (gross >= 0) indirect.cr.unshift(['Gross profit b/d', gross]);
  else indirect.dr.unshift(['Gross loss b/d', -gross]);
  const net = sum(indirect.cr) - sum(indirect.dr);
  if (net >= 0) indirect.dr.push(['Net profit', net]);
  else indirect.cr.push(['Net loss', -net]);
  const rows: ReportRow[] = [];
  const side = (title: string, s: { dr: Array<[string, number]>; cr: Array<[string, number]> }) => {
    rows.push({ cells: [`${title}: Dr`, null, `${title}: Cr`, null], style: 'group' });
    for (let i = 0; i < Math.max(s.dr.length, s.cr.length); i++) rows.push({ cells: [s.dr[i]?.[0] ?? null, s.dr[i]?.[1] ?? null, s.cr[i]?.[0] ?? null, s.cr[i]?.[1] ?? null] });
    rows.push({ cells: ['Total', sum(s.dr), 'Total', sum(s.cr)], style: 'total' });
  };
  side('Trading account', direct);
  side('Profit and loss account', indirect);
  return rows;
}

const plHorizontal: ReportDef = {
  key: 'pl_horizontal', title: 'Horizontal profit and loss', category: 'business', params: 'range', shape: 'statement',
  description: 'The trading and profit and loss account side by side: expenses on the left, income on the right.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [nets, chart] = await Promise.all([ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate }), ctx.data.chart(ctx.orgId)]);
    return {
      key: 'pl_horizontal', title: 'Trading and profit and loss account', subtitle: r.label,
      columns: [text('dr', 'Particulars (Dr)'), money('drAmount', 'Amount'), text('cr', 'Particulars (Cr)'), money('crAmount', 'Amount')],
      rows: horizontalPl(nets, chart),
      notes: ['Direct expenses and purchases go to the trading account; other income and expenses to the profit and loss account. Both sides of each total agree.'],
    };
  },
};

// ── Balance sheet ───────────────────────────────────────────────────────

const bsScheduleIii: ReportDef = {
  key: 'bs_schedule_iii', title: 'Balance sheet (Schedule III)', category: 'business', params: 'asof', shape: 'statement', filters: [DETAIL_FILTER],
  description: 'The balance sheet in the Companies Act Schedule III (Division I) format, with MSME dues shown apart, against the last year end.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const prevEnd = previousYearEnd(asOf);
    const [cur, prev, msmeNow, msmePrev] = await Promise.all([balanceFigures(ctx, asOf), balanceFigures(ctx, prevEnd), msmeDues(ctx, asOf), msmeDues(ctx, prevEnd)]);
    const tiesNow = totalOf(cur.figures, ASSET_HEADS) === totalOf(cur.figures, LIABILITY_HEADS);
    return {
      key: 'bs_schedule_iii', title: 'Balance sheet (Schedule III)', subtitle: `As at ${asOf}, against ${prevEnd}`,
      columns: [text('particulars', 'Particulars'), money('current', `As at ${asOf}`), money('previous', `As at ${prevEnd}`)],
      rows: scheduleBs(cur.figures, prev.figures, { cur: Math.min(msmeNow, cur.figures.heads.get('trade_payables') ?? 0), prev: Math.min(msmePrev, prev.figures.heads.get('trade_payables') ?? 0) }, { details: ctx.p.detail === 'accounts' }),
      notes: [
        'Companies Act, 2013, Schedule III, Division I. Profit not yet closed into reserves is shown as surplus in reserves.',
        'Trade payables (A) are open bills of vendors registered as micro or small enterprises (manufacturing or services) under the MSMED Act.',
        'A bank account in credit is shown as a short-term borrowing.',
        tiesNow ? 'Total assets equal total equity and liabilities.' : 'Assets and liabilities differ: check the opening balances.',
      ],
    };
  },
};

/** The traditional side-by-side balance sheet: liabilities on the left, assets on the right, by group. */
export function horizontalBs(nets: Map<string, number>, chart: Map<string, ChartAccount>): ReportRow[] {
  const left = new Map<string, Array<[string, number]>>();
  const right = new Map<string, Array<[string, number]>>();
  let profit = 0;
  for (const [id, net] of [...nets].sort((a, b) => (chart.get(a[0])?.code ?? '').localeCompare(chart.get(b[0])?.code ?? ''))) {
    const a = chart.get(id);
    if (!a || net === 0) continue;
    if (isPlType(a)) { profit -= net; continue; }
    const group = a.group ?? (a.type === AccountType.ASSETS ? 'Assets' : a.type === AccountType.CAPITAL ? 'Capital Account' : 'Liabilities');
    const target = a.type === AccountType.ASSETS ? right : left;
    (target.get(group) ?? target.set(group, []).get(group)!).push([a.name, a.type === AccountType.ASSETS ? net : -net]);
  }
  if (profit) (left.get('Profit and loss account') ?? left.set('Profit and loss account', []).get('Profit and loss account')!).push([profit >= 0 ? 'Profit to date' : 'Loss to date', profit]);
  const flatten = (m: Map<string, Array<[string, number]>>, order: string[]) => {
    const out: Array<{ name: string; amount: number | null; head: boolean }> = [];
    const keys = [...m.keys()].sort((x, y) => (order.indexOf(x) === -1 ? 99 : order.indexOf(x)) - (order.indexOf(y) === -1 ? 99 : order.indexOf(y)) || x.localeCompare(y));
    for (const g of keys) {
      const list = m.get(g)!;
      out.push({ name: g, amount: list.reduce((s, [, v]) => s + v, 0), head: true });
      for (const [n, v] of list) out.push({ name: `  ${n}`, amount: v, head: false });
    }
    return out;
  };
  const l = flatten(left, ['Capital Account', 'Profit and loss account', 'Loans', 'Current Liabilities']);
  const r = flatten(right, ['Fixed Assets', 'Investments', 'Current Assets']);
  const rows: ReportRow[] = [{ cells: ['Liabilities', null, 'Assets', null], style: 'group' }];
  for (let i = 0; i < Math.max(l.length, r.length); i++) rows.push({ cells: [l[i]?.name ?? null, l[i]?.amount ?? null, r[i]?.name ?? null, r[i]?.amount ?? null] });
  const tl = l.filter((x) => x.head).reduce((s, x) => s + (x.amount ?? 0), 0);
  const tr = r.filter((x) => x.head).reduce((s, x) => s + (x.amount ?? 0), 0);
  rows.push({ cells: ['Total', tl, 'Total', tr], style: 'grand' });
  return rows;
}

const bsHorizontal: ReportDef = {
  key: 'bs_horizontal', title: 'Horizontal balance sheet', category: 'business', params: 'asof', shape: 'statement',
  description: 'Liabilities and capital beside assets, group by group, as at a date.',
  async run(ctx) {
    const asOf = asOfDate(ctx);
    const [nets, chart] = await Promise.all([ctx.data.nets(ctx.orgId, { to: asOf, includeClosing: true }), ctx.data.chart(ctx.orgId)]);
    return {
      key: 'bs_horizontal', title: 'Horizontal balance sheet', subtitle: `As at ${asOf}`,
      columns: [text('liability', 'Liabilities'), money('liabilityAmount', 'Amount'), text('asset', 'Assets'), money('assetAmount', 'Amount')],
      rows: horizontalBs(nets, chart),
      notes: ['Group totals are in the group rows; the accounts under them are indented. Profit not yet closed into reserves shows on the liabilities side.'],
    };
  },
};

// ── Cash flow ───────────────────────────────────────────────────────────

/**
 * The cash flow statement by the indirect method (AS 3): profit, adjusted
 * for what moved no cash, and the change in each balance-sheet head. Every
 * non-cash balance's movement lands in exactly one line, so the net change
 * always equals the change in bank and cash.
 */
export function cashFlowStatement(input: { moves: Map<string, number>; chart: Map<string, ChartAccount>; openingCash: number; closingCash: number }): ReportRow[] {
  const { moves, chart } = input;
  const by = new Map<string, number>();
  const add = (k: string, v: number) => by.set(k, (by.get(k) ?? 0) + v);
  let profit = 0;
  let depreciation = 0;
  let disposal = 0; // loss positive, gain negative
  for (const [id, net] of moves) {
    const a = chart.get(id);
    if (!a || net === 0) continue;
    if (isPlType(a)) {
      profit -= net;
      if (plHead(a) === 'depreciation') depreciation += net;
      if (a.systemKey === 'ASSET_DISPOSAL_GAIN' || a.systemKey === 'ASSET_DISPOSAL_LOSS') disposal += net;
      continue;
    }
    // Money accounts are the cash itself, overdrawn or not.
    const h = bsHead(a, 1);
    if (!h || MONEY_HEADS.has(h)) continue;
    add(h, -net);
  }
  const v = (k: string) => by.get(k) ?? 0;
  const rows: ReportRow[] = [];
  const line = (label: string, amount: number | null, style?: ReportRow['style'], indent?: number) => rows.push({ cells: [label, amount], style, indent });

  rows.push({ cells: ['A. Cash flow from operating activities', null], style: 'group' });
  line('Net profit', profit, undefined, 1);
  line('Add: depreciation and amortisation', depreciation, undefined, 1);
  line('Add: loss (less: gain) on assets sold', disposal, undefined, 1);
  const beforeWc = profit + depreciation + disposal;
  line('Operating profit before working capital changes', beforeWc, 'total');
  const wc: Array<[string, string]> = [
    ['trade_receivables', '(Increase) / decrease in trade receivables'],
    ['inventories', '(Increase) / decrease in inventories'],
    ['st_loans_advances', '(Increase) / decrease in loans, advances and tax credits'],
    ['other_current_assets', '(Increase) / decrease in other current assets'],
    ['trade_payables', 'Increase / (decrease) in trade payables'],
    ['other_current_liabilities', 'Increase / (decrease) in other current liabilities'],
    ['st_provisions', 'Increase / (decrease) in provisions'],
    ['lt_provisions', 'Increase / (decrease) in long-term provisions'],
    ['other_lt_liabilities', 'Increase / (decrease) in other long-term liabilities'],
    ['deferred_tax_liability', 'Increase / (decrease) in deferred tax'],
    ['deferred_tax_asset', '(Increase) / decrease in deferred tax assets'],
  ];
  let operating = beforeWc;
  for (const [k, label] of wc) {
    if (!v(k)) continue;
    line(label, v(k), undefined, 1);
    operating += v(k);
  }
  line('Net cash from operating activities (A)', operating, 'total');

  rows.push({ cells: ['B. Cash flow from investing activities', null], style: 'group' });
  const fixed = FIXED_ASSETS.reduce((s, k) => s + v(k), 0) + v('lt_loans_advances') + v('other_nc_assets') + v('current_investments');
  const investing = fixed - depreciation - disposal;
  line('Purchase less sale of fixed assets and investments', investing, undefined, 1);
  line('Net cash from investing activities (B)', investing, 'total');

  rows.push({ cells: ['C. Cash flow from financing activities', null], style: 'group' });
  const capital = v('share_capital') + v('reserves');
  const borrowings = BORROWINGS.reduce((s, k) => s + v(k), 0);
  line('Capital introduced less drawings', capital, undefined, 1);
  line('Borrowings taken less repaid', borrowings, undefined, 1);
  const financing = capital + borrowings;
  line('Net cash from financing activities (C)', financing, 'total');

  const net = operating + investing + financing;
  line('Net increase / (decrease) in cash and cash equivalents (A + B + C)', net, 'total');
  line('Cash and cash equivalents at the beginning', input.openingCash);
  line('Cash and cash equivalents at the end', input.openingCash + net, 'grand');
  return rows;
}

const cashFlow: ReportDef = {
  key: 'cash_flow_statement', title: 'Cash flow statement', category: 'business', params: 'range', shape: 'statement',
  description: 'Operating, investing and financing cash flows by the indirect method, tied to bank and cash.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const opening = await ctx.data.openingJournalIds(ctx.orgId);
    const [moves, chart, before, openingIn, after] = await Promise.all([
      ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate, except: opening }),
      ctx.data.chart(ctx.orgId),
      ctx.data.nets(ctx.orgId, { to: addDays(r.fromDate, -1), includeClosing: true }),
      opening.length ? ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate, only: opening, includeClosing: true }) : Promise.resolve(new Map<string, number>()),
      ctx.data.nets(ctx.orgId, { to: r.toDate, includeClosing: true }),
    ]);
    const isCash = (a: ChartAccount | undefined) => !!a && a.type === AccountType.ASSETS && bsHead(a, 1) === 'cash';
    const cashOf = (m: Map<string, number>) => [...m].reduce((s, [id, n]) => (isCash(chart.get(id)) ? s + n : s), 0);
    const openingCash = cashOf(before) + cashOf(openingIn);
    const closingCash = cashOf(after);
    const rows = cashFlowStatement({ moves, chart, openingCash, closingCash });
    const shown = rows[rows.length - 1].cells[1] as number;
    return {
      key: 'cash_flow_statement', title: 'Cash flow statement', subtitle: r.label,
      columns: [text('particulars', 'Particulars'), money('amount', 'Amount')], rows,
      notes: [
        'Indirect method, as in Accounting Standard 3. Opening balances brought in by an import count as where the books start, not as money that moved.',
        shown === closingCash ? 'The closing figure equals the bank and cash balances in the ledger.' : `The ledger shows ${closingCash / 100} in bank and cash: tell support, this should never differ.`,
      ],
    };
  },
};

const cashInOut: ReportDef = {
  key: 'cash_in_out', title: 'Cash in and out', category: 'business', params: 'year', shape: 'statement',
  description: 'Money into and out of bank and cash for a financial year, with the opening and closing balance.',
  async run(ctx) {
    const fy = ctx.p.financialYear || fyMonths(ctx.today.slice(0, 7)).fy;
    const cf = await ctx.data.reports.getCashFlow(ctx.orgId, fy);
    return {
      key: 'cash_in_out', title: 'Cash in and out', subtitle: `Financial year ${fy}`,
      columns: [text('particulars', 'Particulars'), money('amount', 'Amount')],
      rows: [
        { cells: ['Bank and cash at the start', cf.openingCashPaise] },
        { cells: ['Money in (receipts)', cf.cashInflowsPaise], indent: 1 },
        { cells: ['Money out (payments)', cf.cashOutflowsPaise], indent: 1 },
        { cells: ['Net cash flow', cf.netCashFlowPaise], style: 'total' },
        { cells: ['Bank and cash at the end', cf.closingCashPaise], style: 'grand' },
      ],
      notes: ['Every posted line on a bank or cash account. Moving money between your own bank and cash accounts is neither in nor out.'],
    };
  },
};

const cashForecast: ReportDef = {
  key: 'cash_flow_forecast', title: 'Cash flow forecasting', category: 'business', params: 'today', shape: 'list',
  description: 'Where bank and cash are heading week by week over the next thirteen weeks, from what is owed and what recurs.',
  async run(ctx) {
    const forecast = await ctx.data.service(async () => (await import('../../insights/forecast.service')).ForecastService, 'The cash forecast');
    const f = await forecast.cashForecast(ctx.orgId, 13, ctx.today);
    return {
      key: 'cash_flow_forecast', title: 'Cash flow forecast', subtitle: `Thirteen weeks from ${f.asOf}`,
      columns: [text('week', 'Week'), money('in', 'Money in'), money('out', 'Money out'), money('net', 'Net'), money('closing', 'Bank and cash at the end')],
      rows: [
        { cells: ['Bank and cash today', null, null, null, f.openingCashPaise], style: 'total' },
        ...f.weeks.map((w) => ({ cells: [`${w.weekStart} to ${w.weekEnd}`, w.inflowPaise, w.outflowPaise, w.inflowPaise - w.outflowPaise, w.closingPaise] as Array<string | number | null> })),
        { cells: ['Total', f.weeks.reduce((s, w) => s + w.inflowPaise, 0), f.weeks.reduce((s, w) => s + w.outflowPaise, 0), f.weeks.reduce((s, w) => s + w.inflowPaise - w.outflowPaise, 0), null], style: 'grand' },
      ],
      notes: [
        'An estimate from the books, not a promise: it posts nothing.',
        `Lowest point: week of ${f.lowestWeekStart}.`,
        ...(f.doubtful.count ? [`${f.doubtful.count} receivables more than 90 days late are left out.`] : []),
        ...f.assumptions,
      ],
    };
  },
};

// ── Ratios and equity ───────────────────────────────────────────────────

export interface RatioInput {
  bs: HeadFigures;
  pl: ReturnType<typeof plFigures>;
  cogs: number;
  days: number;
}

/** The business performance ratios, each with the figures behind it. */
export function ratios(input: RatioInput): Array<{ name: string; value: number | null; unit: string; top: number; bottom: number; basis: string }> {
  const { bs, pl, cogs, days } = input;
  const h = (k: Parameters<typeof bs.heads.get>[0]) => bs.heads.get(k) ?? 0;
  const ca = totalOf(bs, CURRENT_ASSETS);
  const cl = totalOf(bs, CURRENT_LIABILITIES);
  const equity = totalOf(bs, EQUITY);
  const debt = totalOf(bs, BORROWINGS);
  const t = plTotals(pl);
  const revenue = pl.heads.get('revenue') ?? 0;
  const finance = pl.heads.get('finance') ?? 0;
  const purchases = (pl.heads.get('purchases') ?? 0) + (pl.heads.get('materials') ?? 0);
  const ratio = (a: number, b: number, scale = 1) => (b ? Math.round((a / b) * scale * 100) / 100 : null);
  return [
    { name: 'Current ratio', value: ratio(ca, cl), unit: 'times', top: ca, bottom: cl, basis: 'Current assets ÷ current liabilities' },
    { name: 'Quick ratio', value: ratio(ca - h('inventories'), cl), unit: 'times', top: ca - h('inventories'), bottom: cl, basis: '(Current assets − inventories) ÷ current liabilities' },
    { name: 'Cash ratio', value: ratio(h('cash'), cl), unit: 'times', top: h('cash'), bottom: cl, basis: 'Cash and bank ÷ current liabilities' },
    { name: 'Debt-equity ratio', value: ratio(debt, equity), unit: 'times', top: debt, bottom: equity, basis: 'Borrowings ÷ shareholders’ funds' },
    { name: 'Gross profit margin', value: ratio(revenue - cogs, revenue, 100), unit: '%', top: revenue - cogs, bottom: revenue, basis: '(Revenue − cost of goods sold) ÷ revenue' },
    { name: 'Net profit margin', value: ratio(t.profit, revenue, 100), unit: '%', top: t.profit, bottom: revenue, basis: 'Profit for the period ÷ revenue from operations' },
    { name: 'Return on equity', value: ratio(t.profit, equity, 100), unit: '%', top: t.profit, bottom: equity, basis: 'Profit for the period ÷ shareholders’ funds at the end' },
    { name: 'Interest coverage', value: ratio(t.beforeTax + finance, finance), unit: 'times', top: t.beforeTax + finance, bottom: finance, basis: '(Profit before tax + finance costs) ÷ finance costs' },
    { name: 'Debtor days', value: ratio(h('trade_receivables') * days, revenue), unit: 'days', top: h('trade_receivables'), bottom: revenue, basis: `Trade receivables ÷ revenue × ${days} days` },
    { name: 'Creditor days', value: ratio(h('trade_payables') * days, purchases), unit: 'days', top: h('trade_payables'), bottom: purchases, basis: `Trade payables ÷ purchases × ${days} days` },
    { name: 'Inventory days', value: ratio(h('inventories') * days, cogs), unit: 'days', top: h('inventories'), bottom: cogs, basis: `Inventories ÷ cost of goods sold × ${days} days` },
  ];
}

const businessRatios: ReportDef = {
  key: 'business_ratios', title: 'Business performance ratios', category: 'business', params: 'range', shape: 'list',
  description: 'Liquidity, leverage, margins and how many days customers and vendors take, from the books.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const end = r.toDate > ctx.today ? ctx.today : r.toDate;
    const [plNets, bsNets, chart] = await Promise.all([
      ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate }),
      ctx.data.nets(ctx.orgId, { to: end, includeClosing: true }),
      ctx.data.chart(ctx.orgId),
    ]);
    const pl = plFigures(plNets, chart);
    const cogs = [...plNets].reduce((s, [id, n]) => { const a = chart.get(id); return a && a.type === AccountType.EXPENSE && isCostOfSales(a) ? s + n : s; }, 0);
    const days = Math.max(1, daysBetween(r.fromDate, end) + 1);
    const list = ratios({ bs: bsFigures(bsNets, chart), pl, cogs, days });
    return {
      key: 'business_ratios', title: 'Business performance ratios', subtitle: `${r.label}; balances as at ${end}`,
      columns: [text('ratio', 'Ratio'), num('value', 'Value'), text('unit', 'Unit'), money('top', 'Numerator'), money('bottom', 'Denominator'), text('basis', 'How it is worked out')],
      rows: list.map((x) => ({ cells: [x.name, x.value, x.unit, x.top, x.bottom, x.basis] })),
      notes: ['Balances are taken from the balance sheet in Schedule III heads at the end of the period; income and costs over the period. A ratio with nothing below the line is left blank.'],
    };
  },
};

const movementOfEquity: ReportDef = {
  key: 'movement_of_equity', title: 'Movement of equity', category: 'business', params: 'range', shape: 'statement',
  description: 'Each capital account and the profit and loss balance from the start of the period to its end.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const [before, moves, closing, chart] = await Promise.all([
      ctx.data.nets(ctx.orgId, { to: addDays(r.fromDate, -1), includeClosing: true }),
      ctx.data.nets(ctx.orgId, { from: r.fromDate, to: r.toDate }),
      ctx.data.nets(ctx.orgId, { to: r.toDate, includeClosing: true }),
      ctx.data.chart(ctx.orgId),
    ]);
    // Credits to a capital account are money put in, debits are drawings; the closing entry is a transfer.
    const gross = await ctx.data.movements(ctx.orgId, { from: r.fromDate, to: r.toDate, includeClosing: false });
    const rows: ReportRow[] = [];
    const totals = [0, 0, 0, 0, 0, 0];
    const push = (name: string, cells: number[]) => {
      cells.forEach((v, i) => (totals[i] += v));
      rows.push({ cells: [name, ...cells] });
    };
    const capitals = [...chart.values()].filter((a) => a.type === AccountType.CAPITAL && !a.isGroup).sort((a, b) => a.code.localeCompare(b.code));
    for (const a of capitals) {
      const open = 0 - (before.get(a.id) ?? 0);
      const close = 0 - (closing.get(a.id) ?? 0);
      const m = gross.get(a.id) ?? { dr: 0, cr: 0 };
      const transfers = close - open - (m.cr - m.dr);
      if (!open && !close && !m.cr && !m.dr) continue;
      push(a.name, [open, m.cr, m.dr, 0, transfers, close]);
    }
    const plOpen = [...before].reduce((s, [id, n]) => (isPlType(chart.get(id)) ? s - n : s), 0);
    const plClose = [...closing].reduce((s, [id, n]) => (isPlType(chart.get(id)) ? s - n : s), 0);
    const profit = [...moves].reduce((s, [id, n]) => (isPlType(chart.get(id)) ? s - n : s), 0);
    push('Surplus in profit and loss', [plOpen, 0, 0, profit, plClose - plOpen - profit, plClose]);
    rows.push({ cells: ['Total equity', ...totals], style: 'grand' });
    return {
      key: 'movement_of_equity', title: 'Movement of equity', subtitle: r.label,
      columns: [text('account', 'Account'), money('opening', 'Opening'), money('introduced', 'Introduced'), money('drawn', 'Drawn or reduced'), money('profit', 'Profit for the period'), money('transfers', 'Year-end transfers'), money('closing', 'Closing')],
      rows,
      notes: ['Capital accounts net of the period: a net credit is money introduced, a net debit is drawings. Year-end transfers are the closing entry moving profit into retained earnings. Closing total equity equals the balance sheet’s capital and profit.'],
    };
  },
};

export const BUSINESS_REPORTS: ReportDef[] = [profitAndLoss, plScheduleIii, plHorizontal, bsScheduleIii, bsHorizontal, cashFlow, cashInOut, cashForecast, businessRatios, movementOfEquity];
