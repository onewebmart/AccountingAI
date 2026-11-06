/**
 * The Reports Center's catalog: every report has a key, a title, a category
 * (Zoho's, as an Indian business reads them), the period it takes, the
 * filters it accepts and a function that reads the books into a report
 * table. A report only ever reads: nothing here writes to the ledger.
 */
import { ReportColumn, ReportRow, ReportTable } from '../report-table';
import { monthEnd, monthsBetween, rangeLabel } from '../management';
import type { ReportDataService } from './report-data.service';

export const CATEGORIES = [
  { key: 'business', label: 'Business Overview' },
  { key: 'sales', label: 'Sales' },
  { key: 'receivables', label: 'Receivables' },
  { key: 'payments_received', label: 'Payments Received' },
  { key: 'recurring', label: 'Recurring Invoices' },
  { key: 'payables', label: 'Payables' },
  { key: 'purchases', label: 'Purchases and Expenses' },
  { key: 'taxes', label: 'Taxes' },
  { key: 'banking', label: 'Banking' },
  { key: 'projects', label: 'Projects and Timesheet' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'accountant', label: 'Accountant' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'currency', label: 'Currency' },
  { key: 'activity', label: 'Activity' },
  { key: 'automation', label: 'Automation' },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]['key'];
export const categoryLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

/**
 * The period a report takes.
 * range: from and to months. today: as the books stand now. year: a
 * financial year. asof: a date. month: one month (sent as from and to).
 * quarter: a financial year and a quarter.
 */
export type ParamKind = 'range' | 'today' | 'year' | 'asof' | 'month' | 'quarter';

/** What a filter picks from: the page fills the list from /reports/options/<kind>. */
export type FilterKind = 'customer' | 'vendor' | 'account' | 'money_account' | 'project' | 'item' | 'user' | 'select';
export const FILTER_KEYS = ['customerId', 'vendorId', 'accountId', 'projectId', 'itemId', 'userId', 'status', 'detail'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface FilterDef {
  key: FilterKey;
  label: string;
  kind: FilterKind;
  /** What leaving it unchosen means, when not "All". */
  empty?: string;
  /** For kind select: the values allowed, as [value, label]. */
  options?: Array<[string, string]>;
  required?: boolean;
}

/** Everything a report may be run with. Filters are checked against the report's own list before use. */
export interface RunParams {
  from?: string | null;
  to?: string | null;
  financialYear?: string | null;
  through?: string | null;
  asOf?: string | null;
  quarter?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  accountId?: string | null;
  projectId?: string | null;
  itemId?: string | null;
  userId?: string | null;
  status?: string | null;
  /** A statement's level of detail: heads only, or the accounts under them. */
  detail?: string | null;
}

/** Shown under a statement's heads, or not. */
export const DETAIL_FILTER: FilterDef = { key: 'detail', label: 'Show', kind: 'select', empty: 'Heads only', options: [['accounts', 'Heads and their accounts']] };

export interface RunCtx {
  orgId: string;
  p: RunParams;
  data: ReportDataService;
  today: string;
}

/**
 * list: one row per thing, so its columns can be chosen and reordered, its
 * rows filtered, grouped and sorted. statement: a laid-out statement (a P&L,
 * a balance sheet) whose rows keep their order; only columns can be hidden.
 */
export type ReportShape = 'list' | 'statement';

export interface ReportDef {
  key: string;
  title: string;
  category: CategoryKey;
  description: string;
  params: ParamKind;
  filters?: FilterDef[];
  shape: ReportShape;
  run(ctx: RunCtx): Promise<ReportTable>;
}

// ── Building tables ───────────────────────────────────────────────────────

export const text = (key: string, label: string): ReportColumn => ({ key, label, kind: 'text' });
export const money = (key: string, label: string): ReportColumn => ({ key, label, kind: 'money' });
export const num = (key: string, label: string): ReportColumn => ({ key, label, kind: 'number' });
export const pct = (key: string, label: string): ReportColumn => ({ key, label, kind: 'pct' });

export type Cell = string | number | null;

/** A list's bottom line: the sum of the named columns, "Total" in the first. */
export function totalRow(columns: ReportColumn[], rows: Cell[][], sum: string[], label = 'Total'): ReportRow {
  return {
    style: 'grand',
    cells: columns.map((c, i) => {
      if (i === 0) return label;
      if (!sum.includes(c.key)) return null;
      const s = rows.reduce((acc, r) => acc + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0);
      return c.kind === 'money' ? Math.round(s) : Math.round(s * 100) / 100;
    }),
  };
}

/** A flat list with an optional total line. */
export function listTable(input: { key: string; title: string; subtitle: string; columns: ReportColumn[]; rows: Cell[][]; sum?: string[]; notes?: string[] }): ReportTable {
  const rows: ReportRow[] = input.rows.map((cells) => ({ cells }));
  if (input.sum?.length && input.rows.length) rows.push(totalRow(input.columns, input.rows, input.sum));
  return { key: input.key, title: input.title, subtitle: input.subtitle, columns: input.columns, rows, notes: input.notes ?? [] };
}

/** Days from one date to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A month range as dates, and in words. */
export function rangeDates(ctx: RunCtx) {
  const r = ctx.data.management.range(ctx.p.from, ctx.p.to);
  return { ...r, fromDate: `${r.from}-01`, toDate: monthEnd(r.to), label: rangeLabel(r.from, r.to), months: monthsBetween(r.from, r.to) };
}

/** The date a report stands at: the asOf given, or today. */
export function asOfDate(ctx: RunCtx): string {
  const d = ctx.p.asOf || ctx.today;
  return d > ctx.today ? ctx.today : d;
}

export const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const dateIn = (fromDate: string, toDate: string) => ({ $gte: fromDate, $lte: toDate });
export const idStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));
