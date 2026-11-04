/**
 * Management reports, pure: the service hands over figures already summed
 * from the books, and these lay them out as report tables. No query here,
 * so every layout is tested without a database.
 */
import { AccountType } from '@ai-accounting/shared';
import { ReportRow, ReportTable, pctChange } from './report-table';

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Every month from one to another, both included. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 120; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export const monthLabel = (m: string) => `${NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const rangeLabel = (from: string, to: string) => (from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`);
export const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** April to March: 2026-11 is in 2026-27, which runs 2026-04 to 2027-03. */
export function fyMonths(month: string): { fy: string; from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, from: `${start}-04`, to: `${start + 1}-03` };
}

export interface AccountMeta {
  id: string;
  name: string;
  code: string;
  type: AccountType;
  /** The group it sits under: Direct Expenses, Indirect Expenses. */
  group: string | null;
}

/** Net debit less credit, per account per month, from posted journals. */
export interface MonthNet {
  accountId: string;
  month: string;
  net: number;
}

/** Income reads credit-positive, expenses debit-positive: both as a person says them. */
export const plAmount = (type: AccountType, net: number) => (type === AccountType.INCOME ? -net : net);
const isPl = (a: AccountMeta | undefined): a is AccountMeta => !!a && (a.type === AccountType.INCOME || a.type === AccountType.EXPENSE);
const byGroupThenCode = (a: AccountMeta, b: AccountMeta) => (a.group ?? '').localeCompare(b.group ?? '') || a.code.localeCompare(b.code);

/** Income and expense accounts in report order, with what each did. */
function plAccounts(accounts: Map<string, AccountMeta>, used: Set<string>) {
  const list = [...used].map((id) => accounts.get(id)).filter(isPl);
  return {
    income: list.filter((a) => a.type === AccountType.INCOME).sort(byGroupThenCode),
    expense: list.filter((a) => a.type === AccountType.EXPENSE).sort(byGroupThenCode),
  };
}

/** P&L across months: each income and expense account by month, the totals, and the profit. */
export function plMonthly(nets: MonthNet[], accounts: Map<string, AccountMeta>, months: string[], opts: { expensesOnly?: boolean } = {}): ReportTable {
  const cell = new Map<string, number>();
  for (const n of nets) {
    const a = accounts.get(n.accountId);
    if (!isPl(a)) continue;
    cell.set(`${n.accountId}|${n.month}`, (cell.get(`${n.accountId}|${n.month}`) ?? 0) + plAmount(a.type, n.net));
  }
  const used = new Set(nets.map((n) => n.accountId));
  const { income, expense } = plAccounts(accounts, used);
  const blank = months.map(() => null);
  const rows: ReportRow[] = [];
  const section = (title: string, list: AccountMeta[]) => {
    const totals = months.map(() => 0);
    rows.push({ cells: [title, ...blank, null], style: 'group' });
    let group: string | null | undefined;
    let groupTotals = months.map(() => 0);
    const closeGroup = () => {
      if (group !== undefined && new Set(list.map((a) => a.group)).size > 1) rows.push({ cells: [`Total ${group ?? 'other'}`, ...groupTotals, groupTotals.reduce((s, v) => s + v, 0)], style: 'total', indent: 1 });
    };
    for (const a of list) {
      if (a.group !== group) {
        closeGroup();
        group = a.group;
        groupTotals = months.map(() => 0);
      }
      const values = months.map((m) => cell.get(`${a.id}|${m}`) ?? 0);
      if (values.every((v) => v === 0)) continue;
      values.forEach((v, i) => { totals[i] += v; groupTotals[i] += v; });
      rows.push({ cells: [a.name, ...values, values.reduce((s, v) => s + v, 0)], indent: 1 });
    }
    closeGroup();
    rows.push({ cells: [`Total ${title.toLowerCase()}`, ...totals, totals.reduce((s, v) => s + v, 0)], style: 'total' });
    return totals;
  };
  const inc = opts.expensesOnly ? null : section('Income', income);
  const exp = section('Expenses', expense);
  if (inc) {
    const profit = months.map((_, i) => inc[i] - exp[i]);
    rows.push({ cells: ['Net profit', ...profit, profit.reduce((s, v) => s + v, 0)], style: 'grand' });
  }
  return {
    key: opts.expensesOnly ? 'expenses' : 'pl_monthly',
    title: opts.expensesOnly ? 'Expenses by category' : 'Profit and loss by month',
    subtitle: rangeLabel(months[0], months[months.length - 1]),
    columns: [{ key: 'account', label: 'Account', kind: 'text' }, ...months.map((m) => ({ key: m, label: monthLabel(m), kind: 'money' as const })), { key: 'total', label: 'Total', kind: 'money' }],
    rows,
    notes: ['From posted journals. The year-end closing entry is left out.'],
  };
}

/** Sum a set of month nets into one figure per account, sign as a person reads it. */
export function plTotals(nets: MonthNet[], accounts: Map<string, AccountMeta>): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nets) {
    const a = accounts.get(n.accountId);
    if (isPl(a)) out.set(n.accountId, (out.get(n.accountId) ?? 0) + plAmount(a.type, n.net));
  }
  return out;
}

/** This period against the one before it and the same months a year earlier. */
export function comparison(
  periods: { current: Map<string, number>; previous: Map<string, number>; lastYear: Map<string, number> },
  accounts: Map<string, AccountMeta>,
  labels: { current: string; previous: string; lastYear: string },
): ReportTable {
  const used = new Set([...periods.current.keys(), ...periods.previous.keys(), ...periods.lastYear.keys()]);
  const { income, expense } = plAccounts(accounts, used);
  const rows: ReportRow[] = [];
  const line = (name: string, c: number, p: number, l: number, style?: ReportRow['style'], indent?: number) =>
    rows.push({ cells: [name, c, p, c - p, pctChange(c, p), l, c - l, pctChange(c, l)], style, indent });
  const section = (title: string, list: AccountMeta[]) => {
    rows.push({ cells: [title, null, null, null, null, null, null, null], style: 'group' });
    const t = { c: 0, p: 0, l: 0 };
    for (const a of list) {
      const c = periods.current.get(a.id) ?? 0;
      const p = periods.previous.get(a.id) ?? 0;
      const l = periods.lastYear.get(a.id) ?? 0;
      if (!c && !p && !l) continue;
      t.c += c; t.p += p; t.l += l;
      line(a.name, c, p, l, undefined, 1);
    }
    line(`Total ${title.toLowerCase()}`, t.c, t.p, t.l, 'total');
    return t;
  };
  const i = section('Income', income);
  const e = section('Expenses', expense);
  line('Net profit', i.c - e.c, i.p - e.p, i.l - e.l, 'grand');
  return {
    key: 'comparison',
    title: 'Profit and loss compared',
    subtitle: `${labels.current} against ${labels.previous} and ${labels.lastYear}`,
    columns: [
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'current', label: labels.current, kind: 'money' },
      { key: 'previous', label: labels.previous, kind: 'money' },
      { key: 'changePrev', label: 'Change', kind: 'money' },
      { key: 'pctPrev', label: '%', kind: 'pct' },
      { key: 'lastYear', label: labels.lastYear, kind: 'money' },
      { key: 'changeYear', label: 'Change', kind: 'money' },
      { key: 'pctYear', label: '%', kind: 'pct' },
    ],
    rows,
    notes: ['A rise in an expense shows as a positive change: read it against income.'],
  };
}

/** Budget against what the books show, per account, over the months chosen. */
export function budgetVsActual(budget: Map<string, number>, actual: Map<string, number>, accounts: Map<string, AccountMeta>, label: string): ReportTable {
  const used = new Set([...budget.keys(), ...actual.keys()]);
  const { income, expense } = plAccounts(accounts, used);
  const rows: ReportRow[] = [];
  const line = (name: string, b: number, a: number, style?: ReportRow['style'], indent?: number) =>
    rows.push({ cells: [name, b, a, a - b, b ? Math.round((a / b) * 1000) / 10 : null], style, indent });
  const section = (title: string, list: AccountMeta[]) => {
    rows.push({ cells: [title, null, null, null, null], style: 'group' });
    const t = { b: 0, a: 0 };
    for (const acc of list) {
      const b = budget.get(acc.id) ?? 0;
      const a = actual.get(acc.id) ?? 0;
      if (!b && !a) continue;
      t.b += b; t.a += a;
      line(acc.name, b, a, undefined, 1);
    }
    line(`Total ${title.toLowerCase()}`, t.b, t.a, 'total');
    return t;
  };
  const i = section('Income', income);
  const e = section('Expenses', expense);
  line('Net profit', i.b - e.b, i.a - e.a, 'grand');
  return {
    key: 'budget_vs_actual',
    title: 'Budget against actual',
    subtitle: label,
    columns: [
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'budget', label: 'Budget', kind: 'money' },
      { key: 'actual', label: 'Actual', kind: 'money' },
      { key: 'variance', label: 'Over (under) budget', kind: 'money' },
      // As a plain percentage of the budget, not a change: 92.5 means 92.5% used.
      { key: 'used', label: '% of budget', kind: 'number' },
    ],
    rows,
    notes: ['Accounts with no budget show their actual against nil.'],
  };
}

// ── Sales and purchases ─────────────────────────────────────────────────

export interface DocFact {
  partyId: string;
  partyName: string;
  date: string;
  taxablePaise: number;
  gstPaise: number;
}

export interface LineFact {
  itemId: string | null;
  name: string;
  uqc: string | null;
  qty: number;
  amountPaise: number;
}

type Side = 'sales' | 'purchases';
const SIDE = {
  sales: { party: 'Customer', doc: 'Invoices', note: 'Credit notes', title: 'Sales' },
  purchases: { party: 'Vendor', doc: 'Bills', note: 'Debit notes', title: 'Purchases' },
};

/** Each party's documents less its notes, largest first, with its share of the whole. */
export function byParty(side: Side, docs: DocFact[], notes: DocFact[], label: string): ReportTable {
  const s = SIDE[side];
  const by = new Map<string, { name: string; count: number; taxable: number; notes: number; gst: number }>();
  const row = (f: DocFact) => by.get(f.partyId) ?? by.set(f.partyId, { name: f.partyName, count: 0, taxable: 0, notes: 0, gst: 0 }).get(f.partyId)!;
  for (const d of docs) { const r = row(d); r.count++; r.taxable += d.taxablePaise; r.gst += d.gstPaise; }
  for (const n of notes) { const r = row(n); r.notes += n.taxablePaise; r.gst -= n.gstPaise; }
  const list = [...by.values()].map((r) => ({ ...r, net: r.taxable - r.notes })).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  const total = list.reduce((t, r) => ({ count: t.count + r.count, taxable: t.taxable + r.taxable, notes: t.notes + r.notes, net: t.net + r.net, gst: t.gst + r.gst }), { count: 0, taxable: 0, notes: 0, net: 0, gst: 0 });
  const share = (v: number) => (total.net ? Math.round((v / total.net) * 1000) / 10 : null);
  return {
    key: `${side}_by_${side === 'sales' ? 'customer' : 'vendor'}`,
    title: `${s.title} by ${s.party.toLowerCase()}`,
    subtitle: label,
    columns: [
      { key: 'party', label: s.party, kind: 'text' },
      { key: 'count', label: s.doc, kind: 'number' },
      { key: 'taxable', label: 'Taxable value', kind: 'money' },
      { key: 'notes', label: s.note, kind: 'money' },
      { key: 'net', label: `Net ${s.title.toLowerCase()}`, kind: 'money' },
      { key: 'gst', label: 'GST', kind: 'money' },
      { key: 'share', label: 'Share %', kind: 'number' },
    ],
    rows: [
      ...list.map((r) => ({ cells: [r.name, r.count, r.taxable, r.notes, r.net, r.gst, share(r.net)] })),
      { cells: ['Total', total.count, total.taxable, total.notes, total.net, total.gst, total.net ? 100 : null], style: 'grand' as const },
    ],
    notes: [`Posted ${s.doc.toLowerCase()} by their date; ${s.note.toLowerCase()} by theirs. Values before GST.`],
  };
}

export function byMonth(side: Side, docs: DocFact[], notes: DocFact[], months: string[]): ReportTable {
  const s = SIDE[side];
  const by = new Map(months.map((m) => [m, { count: 0, taxable: 0, notes: 0, gst: 0 }]));
  for (const d of docs) { const r = by.get(d.date.slice(0, 7)); if (r) { r.count++; r.taxable += d.taxablePaise; r.gst += d.gstPaise; } }
  for (const n of notes) { const r = by.get(n.date.slice(0, 7)); if (r) { r.notes += n.taxablePaise; r.gst -= n.gstPaise; } }
  const rows = months.map((m) => { const r = by.get(m)!; return { cells: [monthLabel(m), r.count, r.taxable, r.notes, r.taxable - r.notes, r.gst] as Array<string | number | null> }; });
  const t = [...by.values()].reduce((a, r) => ({ count: a.count + r.count, taxable: a.taxable + r.taxable, notes: a.notes + r.notes, gst: a.gst + r.gst }), { count: 0, taxable: 0, notes: 0, gst: 0 });
  return {
    key: `${side}_by_month`,
    title: `${s.title} by month`,
    subtitle: rangeLabel(months[0], months[months.length - 1]),
    columns: [
      { key: 'month', label: 'Month', kind: 'text' },
      { key: 'count', label: s.doc, kind: 'number' },
      { key: 'taxable', label: 'Taxable value', kind: 'money' },
      { key: 'notes', label: s.note, kind: 'money' },
      { key: 'net', label: `Net ${s.title.toLowerCase()}`, kind: 'money' },
      { key: 'gst', label: 'GST', kind: 'money' },
    ],
    rows: [...rows, { cells: ['Total', t.count, t.taxable, t.notes, t.taxable - t.notes, t.gst], style: 'grand' }],
    notes: [`Values before GST, less ${s.note.toLowerCase()}.`],
  };
}

export function byItem(side: Side, lines: LineFact[], label: string): ReportTable {
  const s = SIDE[side];
  const by = new Map<string, { name: string; uqc: string | null; qty: number; value: number; linked: boolean }>();
  for (const l of lines) {
    const key = l.itemId ?? '__none';
    const r = by.get(key) ?? by.set(key, { name: l.itemId ? l.name : 'Lines not linked to an item', uqc: l.itemId ? l.uqc : null, qty: 0, value: 0, linked: !!l.itemId }).get(key)!;
    r.qty = Math.round((r.qty + l.qty) * 1000) / 1000;
    r.value += l.amountPaise;
  }
  const list = [...by.values()].sort((a, b) => Number(b.linked) - Number(a.linked) || b.value - a.value);
  const total = list.reduce((t, r) => t + r.value, 0);
  return {
    key: `${side}_by_item`,
    title: `${s.title} by item`,
    subtitle: label,
    columns: [
      { key: 'item', label: 'Item', kind: 'text' },
      { key: 'qty', label: 'Quantity', kind: 'number' },
      { key: 'uqc', label: 'Unit', kind: 'text' },
      { key: 'value', label: 'Value', kind: 'money' },
      { key: 'rate', label: 'Average rate', kind: 'money' },
      { key: 'share', label: 'Share %', kind: 'number' },
    ],
    rows: [
      ...list.map((r) => ({ cells: [r.name, r.linked ? r.qty : null, r.uqc, r.value, r.linked && r.qty > 0 ? Math.round(r.value / r.qty) : null, total ? Math.round((r.value / total) * 1000) / 10 : null] })),
      { cells: ['Total', null, null, total, null, total ? 100 : null], style: 'grand' as const },
    ],
    notes: [`Line values before GST, from posted ${s.doc.toLowerCase()}. ${s.note} carry amounts, not items, so they are not taken off here.`],
  };
}

// ── Receivables and payables ────────────────────────────────────────────

export interface OpenDoc {
  partyId: string;
  partyName: string;
  date: string;
  dueDate: string | null;
  owedPaise: number;
}

/** A payment against a document: how many days after the document's date it came. */
export interface PaidFact {
  partyId: string;
  paidOn: string;
  days: number;
  amountPaise: number;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function bucketOf(dueDate: string | null, date: string, asOf: string): 0 | 1 | 2 | 3 | 4 {
  const overdue = daysBetween(dueDate ?? date, asOf);
  return overdue <= 0 ? 0 : overdue <= 30 ? 1 : overdue <= 60 ? 2 : overdue <= 90 ? 3 : 4;
}

/** Days to pay, weighted by amount. */
export function averageDays(paid: PaidFact[]): number | null {
  const amount = paid.reduce((s, p) => s + p.amountPaise, 0);
  return amount > 0 ? Math.round(paid.reduce((s, p) => s + p.days * p.amountPaise, 0) / amount) : null;
}

export function ageingByParty(side: 'receivables' | 'payables', open: OpenDoc[], paid: PaidFact[], asOf: string): ReportTable {
  const by = new Map<string, { name: string; b: number[]; total: number }>();
  for (const d of open) {
    if (d.owedPaise <= 0) continue;
    const r = by.get(d.partyId) ?? by.set(d.partyId, { name: d.partyName, b: [0, 0, 0, 0, 0], total: 0 }).get(d.partyId)!;
    r.b[bucketOf(d.dueDate, d.date, asOf)] += d.owedPaise;
    r.total += d.owedPaise;
  }
  const yearAgo = new Date(Date.parse(`${asOf}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const recent = paid.filter((p) => p.paidOn > yearAgo && p.paidOn <= asOf);
  const list = [...by.entries()].sort((a, b) => b[1].total - a[1].total);
  const t = list.reduce((acc, [, r]) => acc.map((v, i) => v + r.b[i]), [0, 0, 0, 0, 0]);
  return {
    key: side,
    title: side === 'receivables' ? 'Receivables by customer' : 'Payables by vendor',
    subtitle: `As at ${asOf}`,
    columns: [
      { key: 'party', label: side === 'receivables' ? 'Customer' : 'Vendor', kind: 'text' },
      { key: 'current', label: 'Not yet due', kind: 'money' },
      { key: 'd30', label: '1–30 days', kind: 'money' },
      { key: 'd60', label: '31–60 days', kind: 'money' },
      { key: 'd90', label: '61–90 days', kind: 'money' },
      { key: 'over90', label: 'Over 90 days', kind: 'money' },
      { key: 'total', label: 'Total', kind: 'money' },
      { key: 'days', label: side === 'receivables' ? 'Days they take to pay' : 'Days we take to pay', kind: 'number' },
    ],
    rows: [
      ...list.map(([id, r]) => ({ cells: [r.name, ...r.b, r.total, averageDays(recent.filter((p) => p.partyId === id))] as Array<string | number | null> })),
      { cells: ['Total', ...t, t.reduce((s, v) => s + v, 0), averageDays(recent)], style: 'grand' as const },
    ],
    notes: ['Overdue counts from the due date, or the document date when there is none. Days to pay: payments over the last year, weighted by amount.'],
  };
}

// ── GST ─────────────────────────────────────────────────────────────────

export interface GstMonth {
  month: string;
  outputPaise: number;
  rcmPaise: number;
  inputPaise: number;
}

export function gstSummary(rows: GstMonth[], months: string[]): ReportTable {
  const by = new Map(rows.map((r) => [r.month, r]));
  const lines = months.map((m) => {
    const r = by.get(m) ?? { month: m, outputPaise: 0, rcmPaise: 0, inputPaise: 0 };
    return [monthLabel(m), r.outputPaise, r.rcmPaise, r.inputPaise, r.outputPaise + r.rcmPaise - r.inputPaise] as [string, number, number, number, number];
  });
  const t = lines.reduce((a, l) => [a[0] + l[1], a[1] + l[2], a[2] + l[3], a[3] + l[4]], [0, 0, 0, 0]);
  return {
    key: 'gst_summary',
    title: 'GST summary',
    subtitle: rangeLabel(months[0], months[months.length - 1]),
    columns: [
      { key: 'month', label: 'Month', kind: 'text' },
      { key: 'output', label: 'Output tax', kind: 'money' },
      { key: 'rcm', label: 'Reverse charge', kind: 'money' },
      { key: 'input', label: 'Input tax credit', kind: 'money' },
      { key: 'net', label: 'Net', kind: 'money' },
    ],
    rows: [...lines.map((l) => ({ cells: l as Array<string | number | null> })), { cells: ['Total', ...t], style: 'grand' }],
    notes: ['From the GST accounts in the books, before set-off rules. Reverse-charge tax is paid in cash; the filed GSTR-3B has the figures that count.'],
  };
}
