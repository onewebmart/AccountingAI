/**
 * Cash-flow forecasting arithmetic, in integer paise (Invariant 1). Pure
 * functions: ForecastService gathers what is owed, due and usual, and these
 * place it in weeks and project the trend.
 */

export type ForecastKind =
  | 'receivable'
  | 'payable'
  | 'recurring_in'
  | 'recurring_out'
  | 'gst'
  | 'tds'
  | 'run_rate_in'
  | 'run_rate_out';

export interface ForecastItem {
  kind: ForecastKind;
  direction: 'in' | 'out';
  label: string;
  /** When the money is expected to move. */
  date: string;
  amountPaise: number;
  /** Why this date, when it is not simply the due date. */
  note?: string;
}

export interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  inflowPaise: number;
  outflowPaise: number;
  closingPaise: number;
  items: ForecastItem[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * How late a customer usually pays: the median of days past the due date
 * across their payments, never negative (early payers are treated as on
 * time) and capped at 90. Null when there is nothing to go on.
 */
export function typicalDelayDays(payments: Array<{ dueDate: string; paidOn: string }>): number | null {
  if (payments.length === 0) return null;
  const days = payments.map((p) => Math.max(0, daysBetween(p.dueDate, p.paidOn))).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
  return Math.min(90, median);
}

/**
 * Places every item in its week, starting today, and runs the balance
 * forward. An item dated before today (an overdue bill, say) lands in the
 * first week: it is due now. The run rate is spread evenly, a week at a time.
 */
export function buildWeeks(input: {
  today: string;
  openingCashPaise: number;
  weeks: number;
  items: ForecastItem[];
  runRate: { weeklyInPaise: number; weeklyOutPaise: number };
}): ForecastWeek[] {
  const out: ForecastWeek[] = [];
  let balance = input.openingCashPaise;
  for (let w = 0; w < input.weeks; w++) {
    const weekStart = addDays(input.today, w * 7);
    const weekEnd = addDays(weekStart, 6);
    const items = input.items
      .filter((i) => (w === 0 ? i.date <= weekEnd : i.date >= weekStart && i.date <= weekEnd))
      .sort((a, b) => a.date.localeCompare(b.date) || b.amountPaise - a.amountPaise);
    if (input.runRate.weeklyInPaise > 0) {
      items.push({ kind: 'run_rate_in', direction: 'in', label: 'Usual receipts not invoiced', date: weekEnd, amountPaise: input.runRate.weeklyInPaise });
    }
    if (input.runRate.weeklyOutPaise > 0) {
      items.push({ kind: 'run_rate_out', direction: 'out', label: 'Usual spending without a bill', date: weekEnd, amountPaise: input.runRate.weeklyOutPaise });
    }
    const inflowPaise = items.filter((i) => i.direction === 'in').reduce((s, i) => s + i.amountPaise, 0);
    const outflowPaise = items.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amountPaise, 0);
    balance += inflowPaise - outflowPaise;
    out.push({ weekStart, weekEnd, inflowPaise, outflowPaise, closingPaise: balance, items });
  }
  return out;
}

/**
 * The next `ahead` values of a monthly series by least-squares trend, never
 * below zero. With fewer than three points there is no trend to speak of, so
 * the average carries forward.
 */
export function projectTrend(values: number[], ahead: number): number[] {
  const n = values.length;
  if (n === 0) return Array(ahead).fill(0);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 3) return Array(ahead).fill(Math.max(0, Math.round(mean)));
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  values.forEach((v, x) => {
    num += (x - xMean) * (v - mean);
    den += (x - xMean) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  return Array.from({ length: ahead }, (_, k) => Math.max(0, Math.round(mean + slope * (n + k - xMean))));
}

/**
 * The coming 7th: TDS deducted in a month is deposited by the 7th of the
 * next. The whole unpaid balance is placed there, which is early for this
 * month's deductions, never late. (March's are due 30 April; the 7th is
 * earlier still.)
 */
export function nextTdsDueDate(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  if (d <= 7) return `${y}-${String(m).padStart(2, '0')}-07`;
  const next = new Date(Date.UTC(y, m, 7));
  return next.toISOString().slice(0, 10);
}

/** The coming 20th: when GSTR-3B tax is paid for the month before. */
export function nextGstDueDate(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  if (d <= 20) return `${y}-${String(m).padStart(2, '0')}-20`;
  return new Date(Date.UTC(y, m, 20)).toISOString().slice(0, 10);
}
