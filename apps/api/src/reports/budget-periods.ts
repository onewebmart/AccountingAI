/**
 * Budget periods, pure. A budget is always kept as twelve monthly amounts,
 * April to March, so budget against actual reads any budget the same way.
 * One typed for a quarter, a half-year or the year is split across its
 * months here, to the paisa: the same share each month and the remainder
 * on the last, so the months add back to exactly what was typed.
 */

export const BUDGET_PERIODS = ['monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

/** How many months each period covers. */
export const MONTHS_IN: Record<BudgetPeriod, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

/** How many amounts a row of this period has: 12, 4, 2 or 1. */
export const periodCount = (p: BudgetPeriod) => 12 / MONTHS_IN[p];

const MONTH_NAMES = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** The column headings for a financial year: Apr 2026 …, Q1 (Apr–Jun) …, H1 (Apr–Sep) …, FY 2026-27. */
export function periodLabels(period: BudgetPeriod, financialYear: string): string[] {
  const start = Number(financialYear.slice(0, 4));
  const year = (i: number) => (i < 9 ? start : start + 1);
  if (period === 'monthly') return MONTH_NAMES.map((m, i) => `${m} ${year(i)}`);
  if (period === 'yearly') return [`FY ${financialYear}`];
  const k = MONTHS_IN[period];
  const tag = period === 'quarterly' ? 'Q' : 'H';
  return Array.from({ length: 12 / k }, (_, n) => `${tag}${n + 1} (${MONTH_NAMES[n * k]}–${MONTH_NAMES[n * k + k - 1]})`);
}

/**
 * One amount per period to twelve months. ₹100.00 for a quarter is
 * 3333 + 3333 + 3334 paise. A negative amount (a balance-sheet account
 * planned to go down) splits the same way, toward zero.
 */
export function splitToMonths(period: BudgetPeriod, amounts: number[]): number[] {
  const k = MONTHS_IN[period];
  if (amounts.length !== 12 / k) throw new Error(`A ${period.replace('_', '-')} budget has ${12 / k} amount${k === 12 ? '' : 's'} a row.`);
  const months: number[] = [];
  for (const a of amounts) {
    if (!Number.isInteger(a)) throw new Error('Amounts are whole paise.');
    const share = Math.trunc(a / k) || 0; // never −0
    for (let i = 0; i < k - 1; i++) months.push(share);
    months.push(a - share * (k - 1));
  }
  return months;
}

/** Twelve months back to one amount per period: the sum of each period's months. */
export function sumToPeriods(period: BudgetPeriod, months: number[]): number[] {
  const k = MONTHS_IN[period];
  return Array.from({ length: 12 / k }, (_, n) => months.slice(n * k, n * k + k).reduce((s, v) => s + v, 0));
}
