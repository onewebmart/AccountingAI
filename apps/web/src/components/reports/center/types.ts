/** Shapes the Reports Center API returns (apps/api/src/reports/catalog). Money is integer paise throughout. */

export type ParamKind = 'range' | 'today' | 'year' | 'asof' | 'month' | 'quarter';
export type FilterKind = 'customer' | 'vendor' | 'account' | 'money_account' | 'project' | 'item' | 'user' | 'select';
export type ReportShape = 'list' | 'statement';

export interface FilterDef {
  key: string;
  label: string;
  kind: FilterKind;
  options?: Array<[string, string]>;
  required?: boolean;
  /** What leaving it unchosen means, when not "All". */
  empty?: string;
}

export interface CenterReport {
  key: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  params: ParamKind;
  filters: FilterDef[];
  shape: ReportShape;
  createdBy: string;
  custom: boolean;
  shared: boolean;
  mine: boolean;
  kind: 'built_in' | 'derived' | 'module';
  baseKey: string | null;
  favourite: boolean;
  lastVisitedAt: string | null;
}

export interface CenterData {
  categories: Array<{ key: string; label: string; count: number }>;
  reports: CenterReport[];
  counts: { all: number; favourites: number; shared: number; mine: number; scheduled: number };
}

export interface Condition {
  field: string;
  op: 'contains' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_true' | 'is_false';
  value: string | number | null;
}

export interface CustomSpec {
  id?: string;
  key?: string;
  name: string;
  description: string | null;
  kind: 'derived' | 'module';
  baseKey: string | null;
  module: string | null;
  params: Record<string, string>;
  period: string | null;
  columns: string[];
  conditions: Condition[];
  groupBy: string | null;
  groupTotalsOnly: boolean;
  sortBy: string | null;
  sortDir: 'asc' | 'desc';
  shared: boolean;
  mine?: boolean;
  createdByName?: string | null;
}

export interface Definition {
  key: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  params: ParamKind;
  filters: FilterDef[];
  shape: ReportShape;
  createdBy: string;
  custom: CustomSpec | null;
  favourite: boolean;
}

export interface ModuleField {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'number' | 'date' | 'bool';
  options: Array<[string, string]> | null;
  ops: string[];
  groupable: boolean;
  summable: boolean;
}

export interface ModuleInfo {
  key: string;
  label: string;
  hasPeriod: boolean;
  fields: ModuleField[];
}

export interface Schedule {
  id: string;
  report: string;
  title: string;
  period: string;
  periodLabel: string;
  frequency: 'monthly' | 'weekly';
  day: number;
  recipients: string[];
  nextRunOn: string;
  lastSentOn: string | null;
  lastError: string | null;
  active: boolean;
}

export const PERIODS: Array<[string, string]> = [
  ['last_month', 'Last month'],
  ['this_month', 'This month so far'],
  ['last_quarter', 'Last quarter'],
  ['this_fy', 'This financial year so far'],
  ['last_fy', 'Last financial year'],
];

export const OP_LABEL: Record<string, string> = {
  contains: 'contains', equals: 'is', not_equals: 'is not', gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most', is_true: 'is yes', is_false: 'is no',
};

// ── Dates, months and financial years (April to March) ────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const todayDate = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const thisMonth = () => todayDate().slice(0, 7);
export const shiftMonth = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
export const fyOf = (m: string) => { const y = Number(m.slice(0, 4)); const s = Number(m.slice(5, 7)) >= 4 ? y : y - 1; return `${s}-${pad((s + 1) % 100)}`; };
export const fyStartMonth = (m: string) => `${fyOf(m).slice(0, 4)}-04`;
export const recentYears = (n = 4) => { const s = Number(fyOf(thisMonth()).slice(0, 4)); return Array.from({ length: n }, (_, i) => `${s - i}-${pad((s - i + 1) % 100)}`); };
export const quarterOf = (m: string) => { const x = Number(m.slice(5, 7)); return x >= 4 && x <= 6 ? 'Q1' : x >= 7 && x <= 9 ? 'Q2' : x >= 10 ? 'Q3' : 'Q4'; };

/** The period fields a report starts with, by the kind of period it takes. */
export function defaultParams(kind: ParamKind): Record<string, string> {
  const now = thisMonth();
  const last = shiftMonth(now, -1);
  switch (kind) {
    case 'range': return { from: fyStartMonth(now), to: now };
    case 'year': return { financialYear: fyOf(now) };
    case 'asof': return { asOf: todayDate() };
    case 'month': return { from: last, to: last };
    case 'quarter': return { financialYear: fyOf(last), quarter: quarterOf(last) };
    default: return {};
  }
}

export const PERIOD_KEYS = ['from', 'to', 'financialYear', 'through', 'asOf', 'quarter'];

export function toQuery(p: Record<string, string | null | undefined>): string {
  const q = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return q ? `?${q}` : '';
}

export function lastVisited(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
