/**
 * Unit tests — forecast arithmetic.
 *
 *  ✓ A customer's usual lateness is the median, never negative, capped at 90 days
 *  ✓ Items fall in their week; overdue ones in the first; the balance runs forward
 *  ✓ The trend projects forward and never below zero
 *  ✓ TDS and GST land on the coming 7th and 20th
 */
import { buildWeeks, nextGstDueDate, nextTdsDueDate, projectTrend, typicalDelayDays } from './forecast';

describe('typicalDelayDays', () => {
  it('takes the median lateness', () => {
    expect(typicalDelayDays([])).toBeNull();
    expect(typicalDelayDays([{ dueDate: '2026-07-31', paidOn: '2026-08-14' }])).toBe(14);
    expect(
      typicalDelayDays([
        { dueDate: '2026-07-31', paidOn: '2026-07-20' }, // early: on time
        { dueDate: '2026-07-31', paidOn: '2026-08-10' },
        { dueDate: '2026-07-31', paidOn: '2026-08-30' },
      ]),
    ).toBe(10);
    expect(typicalDelayDays([{ dueDate: '2026-01-01', paidOn: '2026-12-01' }])).toBe(90);
  });
});

describe('buildWeeks', () => {
  it('places items by week and runs the balance forward', () => {
    const weeks = buildWeeks({
      today: '2026-10-14',
      openingCashPaise: 100000,
      weeks: 3,
      runRate: { weeklyInPaise: 0, weeklyOutPaise: 1000 },
      items: [
        { kind: 'payable', direction: 'out', label: 'Overdue bill', date: '2026-09-30', amountPaise: 20000 },
        { kind: 'receivable', direction: 'in', label: 'Invoice', date: '2026-10-22', amountPaise: 50000 },
        { kind: 'gst', direction: 'out', label: 'GST', date: '2026-11-03', amountPaise: 5000 },
        { kind: 'payable', direction: 'out', label: 'Beyond', date: '2026-11-04', amountPaise: 99999 },
      ],
    });
    expect(weeks.map((w) => [w.weekStart, w.weekEnd, w.inflowPaise, w.outflowPaise, w.closingPaise])).toEqual([
      ['2026-10-14', '2026-10-20', 0, 21000, 79000],
      ['2026-10-21', '2026-10-27', 50000, 1000, 128000],
      ['2026-10-28', '2026-11-03', 0, 6000, 122000],
    ]);
    expect(weeks[0].items.map((i) => i.label)).toEqual(['Overdue bill', 'Usual spending without a bill']);
  });
});

describe('projectTrend', () => {
  it('follows the line, floored at zero', () => {
    expect(projectTrend([100, 200, 300], 2)).toEqual([400, 500]);
    expect(projectTrend([300, 200, 100], 3)).toEqual([0, 0, 0]);
    expect(projectTrend([500, 700], 2)).toEqual([600, 600]);
    expect(projectTrend([], 1)).toEqual([0]);
  });
});

describe('tax due dates', () => {
  it('finds the coming 7th and 20th', () => {
    expect(nextTdsDueDate('2026-10-05')).toBe('2026-10-07');
    expect(nextTdsDueDate('2026-10-14')).toBe('2026-11-07');
    expect(nextTdsDueDate('2026-12-20')).toBe('2027-01-07');
    expect(nextGstDueDate('2026-10-14')).toBe('2026-10-20');
    expect(nextGstDueDate('2026-10-21')).toBe('2026-11-20');
  });
});
