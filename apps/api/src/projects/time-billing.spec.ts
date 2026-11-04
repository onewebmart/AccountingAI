/**
 * Tests — time into invoice lines, and how a project is doing (pure).
 *
 *  ✓ Dates as a span; time grouped by task and rate, hours summed, unpriced time left out
 *  ✓ The model's line descriptions kept only as plain words with no figure of their own
 *  ✓ Budget burn: time against the cap, cost against a fixed fee, hours against budgeted hours
 *  ✓ Missing timesheets: logged lately, nothing in the last week
 */
import { budgetAlerts, dateSpan, groupTime, lineDescription, missingTimesheets, readTimeLines } from './time-billing';

const entry = (id: string, date: string, hours: number, task: string, notes: string | null = null, ratePaise: number | null = null) => ({ id, date, hours, task, notes, ratePaise, userName: 'Asha' });

describe('time into lines', () => {
  it('writes dates as a span', () => {
    expect(dateSpan('2026-10-01', '2026-10-15')).toBe('1–15 Oct 2026');
    expect(dateSpan('2026-10-07', '2026-10-07')).toBe('7 Oct 2026');
    expect(dateSpan('2026-09-28', '2026-10-04')).toBe('28 Sep – 4 Oct 2026');
    expect(dateSpan('2026-12-29', '2027-01-03')).toBe('29 Dec 2026 – 3 Jan 2027');
  });

  it('groups by task and rate, and leaves out time with no rate', () => {
    const { groups, unpriced } = groupTime([
      entry('a', '2026-10-03', 2.5, 'Design', 'Homepage wireframes'),
      entry('b', '2026-10-01', 1.75, 'design ', 'Kick-off sketches'),
      entry('c', '2026-10-02', 3, 'Design', null, 3000_00),
      entry('d', '2026-10-05', 1.1, 'Meetings', 'Weekly review'),
    ], 2000_00);
    expect(groups).toEqual([
      { task: 'design', ratePaise: 2000_00, hours: 4.25, from: '2026-10-01', to: '2026-10-03', notes: ['Kick-off sketches', 'Homepage wireframes'], entryIds: ['b', 'a'] },
      { task: 'Design', ratePaise: 3000_00, hours: 3, from: '2026-10-02', to: '2026-10-02', notes: [], entryIds: ['c'] },
      { task: 'Meetings', ratePaise: 2000_00, hours: 1.1, from: '2026-10-05', to: '2026-10-05', notes: ['Weekly review'], entryIds: ['d'] },
    ]);
    expect(lineDescription(groups[0])).toBe('design, 1–3 Oct 2026');
    expect(groupTime([entry('x', '2026-10-01', 1, 'Design')], null)).toEqual({ groups: [], unpriced: ['x'] });
  });

  it("keeps the model's descriptions only as plain words with no figure of their own", () => {
    const { groups } = groupTime([entry('a', '2026-10-01', 4, 'Design', 'Wireframes for 3 landing pages'), entry('b', '2026-10-02', 2, 'Meetings', 'Weekly review')], 2000_00);
    const read = readTimeLines({
      lines: [
        { line: 0, description: 'Wireframes for 3 landing pages.' },
        { line: 1, description: 'Weekly reviews, 2 hours' },
        { line: 5, description: 'Nothing' },
      ],
    }, groups);
    expect([...read]).toEqual([[0, 'Wireframes for 3 landing pages, 1 Oct 2026']]);
    expect(readTimeLines({ lines: [{ line: 1, description: 'Review of ₹5,000 of work' }] }, groups).size).toBe(0);
    expect(readTimeLines({ lines: [{ line: 1, description: '4 weekly reviews' }] }, groups).size).toBe(0);
    expect(readTimeLines(null, groups).size).toBe(0);
  });
});

describe('how a project is doing', () => {
  it('warns at 80% of the budget and says when it is over', () => {
    expect(budgetAlerts({ billing: 'time', budgetPaise: 1_00_000_00, budgetHours: null, hours: 40, billedPaise: 60_000_00, unbilledPaise: 25_000_00, costPaise: 0 })).toEqual([{ level: 'warn', text: 'Time billed and unbilled is at 85% of the budget.' }]);
    expect(budgetAlerts({ billing: 'fixed', budgetPaise: 50_000_00, budgetHours: 100, hours: 120, billedPaise: 50_000_00, unbilledPaise: 0, costPaise: 20_000_00 })).toEqual([{ level: 'over', text: 'Time logged is at 120% of the budget.' }]);
    expect(budgetAlerts({ billing: 'time', budgetPaise: null, budgetHours: null, hours: 500, billedPaise: 1, unbilledPaise: 1, costPaise: 1 })).toEqual([]);
  });

  it('finds people who logged time lately but not this week', () => {
    const today = '2026-11-04';
    expect(missingTimesheets([
      { userId: 'u1', userName: 'Asha', date: '2026-10-20' },
      { userId: 'u1', userName: 'Asha', date: '2026-10-27' },
      { userId: 'u2', userName: 'Ravi', date: '2026-10-25' },
      { userId: 'u2', userName: 'Ravi', date: '2026-11-03' },
      { userId: 'u3', userName: 'Old hand', date: '2026-08-01' },
    ], today)).toEqual([{ userId: 'u1', userName: 'Asha', lastDate: '2026-10-27' }]);
  });
});
