/**
 * The server's schedule rule (apps/api/src/automation/schedule.ts), so a form
 * can say when the first and next documents will be drafted. Same steps, same
 * clamping to the month's length, on YYYY-MM-DD strings in UTC.
 */

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'bimonthly' | 'quarterly' | 'half_yearly' | 'yearly';

/** Zoho's words, as the recurring invoice form uses them. */
export const REPEAT_EVERY: Record<Frequency, string> = {
  weekly: 'Week',
  fortnightly: '2 weeks',
  monthly: 'Month',
  bimonthly: '2 months',
  quarterly: 'Quarter (3 months)',
  half_yearly: '6 months',
  yearly: 'Year',
};

const MONTHS_IN: Partial<Record<Frequency, number>> = { monthly: 1, bimonthly: 2, quarterly: 3, half_yearly: 6, yearly: 12 };
const DAYS_IN: Partial<Record<Frequency, number>> = { weekly: 7, fortnightly: 14 };

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayInMonthAfter(date: string, months: number, dayOfMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m0 = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m0 / 12);
  const month0 = ((m0 % 12) + 12) % 12;
  const day = Math.min(dayOfMonth, new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate());
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first date on or after the start that falls on the day of the month; weekly ones start on the start date. */
export function firstOccurrence(startDate: string, dayOfMonth: number, frequency: Frequency): string {
  if (DAYS_IN[frequency]) return startDate;
  const inStartMonth = dayInMonthAfter(startDate, 0, dayOfMonth);
  return inStartMonth >= startDate ? inStartMonth : dayInMonthAfter(startDate, MONTHS_IN[frequency] ?? 1, dayOfMonth);
}

/** The occurrence after `current`. */
export function nextOccurrence(current: string, dayOfMonth: number, frequency: Frequency): string {
  const days = DAYS_IN[frequency];
  if (days) return addDays(current, days);
  return dayInMonthAfter(current, MONTHS_IN[frequency] ?? 1, dayOfMonth);
}
