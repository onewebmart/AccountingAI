/**
 * Calendar arithmetic for recurring documents and reminders, on YYYY-MM-DD
 * strings — the shape every date in the books is stored in. All in UTC, so a
 * server's own timezone can never move a date by a day.
 */

/** How often a document repeats: by weeks from the start date, or by months on a day of the month. */
export const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** The month-based ones, and how many months each steps. */
export const MONTHS_IN: Partial<Record<Frequency, number>> = { monthly: 1, bimonthly: 2, quarterly: 3, half_yearly: 6, yearly: 12 };
/** The week-based ones, and how many days each steps. They repeat on the start date's weekday; the day of the month does not apply. */
export const DAYS_IN: Partial<Record<Frequency, number>> = { weekly: 7, fortnightly: 14 };

/** Today in India, where the books are kept, whatever the server's clock says. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * The given day in the month `months` after `date`'s, clamped to the month's
 * length: day 31 is the 30th in April and the 28th or 29th in February.
 */
export function dayInMonthAfter(date: string, months: number, dayOfMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m0 = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m0 / 12);
  const month0 = ((m0 % 12) + 12) % 12;
  const day = Math.min(dayOfMonth, daysInMonth(year, month0));
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The first date on or after `startDate` that falls on `dayOfMonth`, stepping
 * by the frequency. A weekly or fortnightly one starts on the start date.
 */
export function firstOccurrence(startDate: string, dayOfMonth: number, frequency: Frequency): string {
  if (DAYS_IN[frequency]) return startDate;
  const inStartMonth = dayInMonthAfter(startDate, 0, dayOfMonth);
  return inStartMonth >= startDate ? inStartMonth : dayInMonthAfter(startDate, MONTHS_IN[frequency] ?? 1, dayOfMonth);
}

/** The occurrence after `current`: a week or two later, or the day in the month one step on. */
export function nextOccurrence(current: string, dayOfMonth: number, frequency: Frequency): string {
  const days = DAYS_IN[frequency];
  if (days) return addDays(current, days);
  return dayInMonthAfter(current, MONTHS_IN[frequency] ?? 1, dayOfMonth);
}
