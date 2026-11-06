/**
 * Tests — time into invoice lines, and how a project is doing (pure).
 *
 *  ✓ Dates as a span; time grouped by task and rate, hours summed, unpriced time left out
 *  ✓ The model's line descriptions kept only as plain words with no figure of their own
 *  ✓ Billing methods: the old 'time' reads as project hours; each method prices an hour its own way and
 *    names what has no rate; by staff hours a line is per task and person
 *  ✓ Budget burn: time against the cap, cost against a fixed fee, hours against budgeted hours; with
 *    cost and revenue budgets, costs against the one and income against the other
 *  ✓ Time spent as hours and minutes, a start and end time, or a timer's minutes
 *  ✓ Missing timesheets: logged lately, nothing in the last week
 */
import {
  RateBook,
  billingMethod,
  budgetAlerts,
  dateSpan,
  durationHours,
  groupTime,
  lineDescription,
  missingRateMessage,
  missingTimesheets,
  rateFor,
  readTimeLines,
  spanHours,
  timerHours,
} from './time-billing';

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
    expect(groupTime([entry('x', '2026-10-01', 1, 'Design')], null)).toEqual({ groups: [], unpriced: ['x'], missing: ['the project'] });
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

describe('billing methods', () => {
  const book = (method: RateBook['method'], over: Partial<RateBook> = {}): RateBook => ({
    method,
    projectRatePaise: 2000_00,
    tasks: [{ id: 't1', name: 'Design', ratePaise: 2500_00 }, { id: 't2', name: 'Meetings', ratePaise: null }],
    members: [{ userId: 'asha', ratePaise: 3000_00 }, { userId: 'ravi', ratePaise: null }],
    ...over,
  });
  const fact = (over: Partial<Parameters<typeof rateFor>[1]> = {}) => ({ ratePaise: null, task: 'Design', taskId: 't1', userId: 'asha', userName: 'Asha', ...over });

  it("reads the old 'time' as project hours", () => {
    expect(billingMethod('time')).toBe('project_hours');
    expect(billingMethod(undefined)).toBe('project_hours');
    expect(['fixed', 'project_hours', 'task_hours', 'staff_hours'].map(billingMethod)).toEqual(['fixed', 'project_hours', 'task_hours', 'staff_hours']);
  });

  it('prices an hour by the method, an entry’s own rate first, and names what has no rate', () => {
    expect(rateFor(book('project_hours'), fact())).toEqual({ ratePaise: 2000_00, missing: null });
    expect(rateFor(book('project_hours', { projectRatePaise: null }), fact())).toEqual({ ratePaise: null, missing: 'the project' });
    expect(rateFor(book('task_hours'), fact())).toEqual({ ratePaise: 2500_00, missing: null });
    // Free text that names a task is that task.
    expect(rateFor(book('task_hours'), fact({ taskId: null, task: 'design ' }))).toEqual({ ratePaise: 2500_00, missing: null });
    expect(rateFor(book('task_hours'), fact({ taskId: 't2', task: 'Meetings' }))).toEqual({ ratePaise: null, missing: 'the task "Meetings"' });
    expect(rateFor(book('staff_hours'), fact())).toEqual({ ratePaise: 3000_00, missing: null });
    expect(rateFor(book('staff_hours'), fact({ userId: 'ravi', userName: 'Ravi' }))).toEqual({ ratePaise: null, missing: 'Ravi' });
    expect(rateFor(book('staff_hours'), fact({ userId: 'ravi', userName: 'Ravi', ratePaise: 900_00 }))).toEqual({ ratePaise: 900_00, missing: null });
    // A fixed fee leaves unpriced time off, as it always did.
    expect(rateFor(book('fixed', { projectRatePaise: null }), fact())).toEqual({ ratePaise: null, missing: null });

    expect(missingRateMessage('task_hours', ['the task "Meetings"'])).toBe('No rate per hour for the task "Meetings": give it a rate on the project, or the time its own.');
    expect(missingRateMessage('task_hours', ['the task "A"', 'the task "B"'])).toMatch(/tasks "A" and "B": give each/);
    expect(missingRateMessage('staff_hours', ['Ravi'])).toBe("No rate per hour for Ravi: add them to the project's users with a rate.");
    expect(missingRateMessage('project_hours', ['the project'])).toBe('No rate per hour for this project: give the project a rate, or the time its own.');
  });

  it('makes a line per task and person by staff hours', () => {
    const { groups, missing } = groupTime([
      { ...entry('a', '2026-10-01', 2, 'Design'), taskId: 't1', userId: 'asha' },
      { ...entry('b', '2026-10-02', 1.5, 'Design'), taskId: 't1', userId: 'asha' },
      { ...entry('c', '2026-10-02', 3, 'Design'), taskId: 't1', userId: 'ravi', userName: 'Ravi' },
    ], book('staff_hours', { members: [{ userId: 'asha', ratePaise: 3000_00 }, { userId: 'ravi', ratePaise: 1500_00 }] }));
    expect(missing).toEqual([]);
    expect(groups.map((g) => [lineDescription(g), g.hours, g.ratePaise])).toEqual([['Design (Asha), 1–2 Oct 2026', 3.5, 3000_00], ['Design (Ravi), 2 Oct 2026', 3, 1500_00]]);
    // The model's wording keeps whose time it is.
    expect([...readTimeLines({ lines: [{ line: 1, description: 'Logo concepts' }] }, groups)]).toEqual([[1, 'Logo concepts (Ravi), 2 Oct 2026']]);
  });
});

describe('time spent', () => {
  it('reads hours and minutes, start and end times, and a timer', () => {
    expect(durationHours('1:30')).toBe(1.5);
    expect(durationHours('0:20')).toBe(0.33);
    expect(durationHours('1.5')).toBeNull();
    expect(spanHours('09:15', '11:45')).toBe(2.5);
    expect(spanHours('9:00', '9:40')).toBe(0.67);
    expect(spanHours('13:00', '12:00')).toBeNull();
    expect(spanHours('25:00', '26:00')).toBeNull();
    const at = new Date('2026-11-02T04:30:00Z');
    expect(timerHours(at, new Date(at.getTime() + (25 * 60 + 20) * 1000))).toEqual({ minutes: 25, hours: 0.42 });
    expect(timerHours(at, new Date(at.getTime() + 10_000))).toEqual({ minutes: 1, hours: 0.02 });
  });
});

describe('how a project is doing', () => {
  it('checks costs against the cost budget and income against the revenue budget', () => {
    const base = { budgetPaise: null, budgetHours: null, hours: 0, billedPaise: 0, unbilledPaise: 0, costPaise: 0 };
    expect(budgetAlerts({ ...base, billing: 'task_hours', costBudgetPaise: 50_000_00, revenueBudgetPaise: 1_00_000_00, costPaise: 45_000_00, billedPaise: 70_000_00, unbilledPaise: 40_000_00 })).toEqual([
      { level: 'warn', text: 'Cost is at 90% of the cost budget.' },
      { level: 'over', text: 'Time billed and unbilled is at 110% of the revenue budget.' },
    ]);
    expect(budgetAlerts({ ...base, billing: 'fixed', revenueBudgetPaise: 2_00_000_00, billedPaise: 1_60_000_00, costPaise: 5_00_000_00 })).toEqual([{ level: 'warn', text: 'Income is at 80% of the revenue budget.' }]);
    // The old single budget is the revenue budget when only a cost budget is new.
    expect(budgetAlerts({ ...base, billing: 'time', budgetPaise: 1_00_000_00, costBudgetPaise: 10_00_000_00, billedPaise: 90_000_00 })).toEqual([{ level: 'warn', text: 'Time billed and unbilled is at 90% of the revenue budget.' }]);
  });

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
