/**
 * Budget periods in the browser, the same rules as the API's
 * budget-periods.ts: a budget is kept as twelve months, April to March; an
 * amount typed for a quarter, a half-year or the year is split across its
 * months to the paisa, the remainder on the last month. Used to show a
 * budget by another period and to fill from last year's months.
 */

export type BudgetPeriod = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export const PERIOD_NAMES: Record<BudgetPeriod, string> = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };
const MONTHS_IN: Record<BudgetPeriod, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
export const periodCount = (p: BudgetPeriod) => 12 / MONTHS_IN[p];

const MONTH_NAMES = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

export function periodLabels(period: BudgetPeriod, financialYear: string): string[] {
  const start = Number(financialYear.slice(0, 4));
  if (period === 'monthly') return MONTH_NAMES.map((m, i) => `${m} ${String(i < 9 ? start : start + 1).slice(2)}`);
  if (period === 'yearly') return [`FY ${financialYear}`];
  const k = MONTHS_IN[period];
  const tag = period === 'quarterly' ? 'Q' : 'H';
  return Array.from({ length: 12 / k }, (_, n) => `${tag}${n + 1} ${MONTH_NAMES[n * k]}–${MONTH_NAMES[n * k + k - 1]}`);
}

export function splitToMonths(period: BudgetPeriod, amounts: number[]): number[] {
  const k = MONTHS_IN[period];
  const months: number[] = [];
  for (const a of amounts) {
    const share = Math.trunc(a / k) || 0;
    for (let i = 0; i < k - 1; i++) months.push(share);
    months.push(a - share * (k - 1));
  }
  return months;
}

export function sumToPeriods(period: BudgetPeriod, months: number[]): number[] {
  const k = MONTHS_IN[period];
  return Array.from({ length: 12 / k }, (_, n) => months.slice(n * k, n * k + k).reduce((s, v) => s + v, 0));
}

/** "2026-27" for the year a date falls in, April to March. */
export function fyOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const fyName = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
/** Next year (to budget ahead), this year and the two before. */
export function fyChoices(today: string): string[] {
  const start = Number(fyOf(today).slice(0, 4));
  return [start + 1, start, start - 1, start - 2].map(fyName);
}
