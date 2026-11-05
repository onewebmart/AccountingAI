/**
 * Unit tests — recurring-date arithmetic.
 *
 *  ✓ Day 31 lands on each month's last day, February included
 *  ✓ The first occurrence is on or after the start date
 *  ✓ Quarterly and yearly step by three and twelve months
 *  ✓ Today is India's date, not the server's
 *  ✓ Weekly and fortnightly step from the start date; every two and every six months on the day
 */
import { addDays, dayInMonthAfter, daysBetween, firstOccurrence, nextOccurrence, todayIst } from './schedule';

describe('schedule', () => {
  it('clamps day 31 to the end of each month', () => {
    expect(dayInMonthAfter('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(dayInMonthAfter('2028-01-31', 1, 31)).toBe('2028-02-29');
    expect(dayInMonthAfter('2026-03-31', 1, 31)).toBe('2026-04-30');
    expect(nextOccurrence('2026-02-28', 31, 'monthly')).toBe('2026-03-31');
    expect(dayInMonthAfter('2026-11-15', 2, 15)).toBe('2027-01-15');
  });

  it('starts on or after the start date', () => {
    expect(firstOccurrence('2026-10-01', 5, 'monthly')).toBe('2026-10-05');
    expect(firstOccurrence('2026-10-10', 5, 'monthly')).toBe('2026-11-05');
    expect(firstOccurrence('2026-10-10', 5, 'quarterly')).toBe('2027-01-05');
    expect(firstOccurrence('2026-10-05', 5, 'yearly')).toBe('2026-10-05');
  });

  it('steps by the frequency', () => {
    expect(nextOccurrence('2026-10-05', 5, 'quarterly')).toBe('2027-01-05');
    expect(nextOccurrence('2026-10-05', 5, 'yearly')).toBe('2027-10-05');
  });

  it('counts days and reads the date in India', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15', '2026-10-12')).toBe(-3);
    // 20:00 UTC on 14 Oct is 01:30 on 15 Oct in India.
    expect(todayIst(new Date('2026-10-14T20:00:00Z'))).toBe('2026-10-15');
  });
});

describe('schedule: every week to every six months', () => {
  it('starts a weekly or fortnightly one on its start date and steps by 7 or 14 days, the day of the month aside', () => {
    expect(firstOccurrence('2026-11-04', 31, 'weekly')).toBe('2026-11-04');
    expect(nextOccurrence('2026-11-04', 31, 'weekly')).toBe('2026-11-11');
    expect(nextOccurrence('2026-12-28', 1, 'weekly')).toBe('2027-01-04');
    expect(firstOccurrence('2026-11-04', 1, 'fortnightly')).toBe('2026-11-04');
    expect(nextOccurrence('2026-11-25', 1, 'fortnightly')).toBe('2026-12-09');
  });

  it('steps every two months and every six, on the day of the month', () => {
    expect(firstOccurrence('2026-11-10', 5, 'bimonthly')).toBe('2027-01-05');
    expect(nextOccurrence('2026-12-31', 31, 'bimonthly')).toBe('2027-02-28');
    expect(nextOccurrence('2026-10-05', 5, 'half_yearly')).toBe('2027-04-05');
    expect(firstOccurrence('2026-10-10', 5, 'half_yearly')).toBe('2027-04-05');
  });
});
