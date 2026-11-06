/**
 * Time into invoice lines, and how a project is doing. Pure: hours, rates
 * and amounts are worked out here; the model, when there is one, only words
 * a line's description from the notes people wrote.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── How a project is billed ──────────────────────────────────────────────

/**
 * fixed: an agreed fee, invoiced by hand; time defaults to not billable.
 * project_hours: one rate per hour for the whole project.
 * task_hours: each task has its own rate per hour.
 * staff_hours: each person on the project has their own rate per hour.
 */
export type BillingMethod = 'fixed' | 'project_hours' | 'task_hours' | 'staff_hours';
export const BILLING_METHODS: BillingMethod[] = ['fixed', 'project_hours', 'task_hours', 'staff_hours'];

/**
 * Projects saved before there were four methods say 'time' for "by the hour,
 * one rate for the project": read as project_hours. 'time' is still accepted
 * as an alias when a project is saved.
 */
export function billingMethod(raw: string | null | undefined): BillingMethod {
  return raw === 'fixed' || raw === 'task_hours' || raw === 'staff_hours' ? raw : 'project_hours';
}

/** What prices an hour on a project: its method and the rates it holds. */
export interface RateBook {
  method: BillingMethod;
  projectRatePaise: number | null;
  tasks: Array<{ id: string; name: string; ratePaise: number | null }>;
  members: Array<{ userId: string; ratePaise: number | null }>;
}

/** A project's rate book from the stored project, old or new. */
export function rateBook(p: { billing?: string | null; ratePaise?: number | null; tasks?: Array<{ _id?: unknown; name: string; ratePaise?: number | null }> | null; members?: Array<{ userId: string; ratePaise?: number | null }> | null }): RateBook {
  return {
    method: billingMethod(p.billing),
    projectRatePaise: p.ratePaise ?? null,
    tasks: (p.tasks ?? []).map((t) => ({ id: String(t._id), name: t.name, ratePaise: t.ratePaise ?? null })),
    members: (p.members ?? []).map((m) => ({ userId: String(m.userId), ratePaise: m.ratePaise ?? null })),
  };
}

/** The project's task an entry is on: by its id, or, for time logged as free text, by its name. */
export function findTask<T extends { id: string; name: string }>(tasks: T[], taskId: string | null | undefined, name: string | null | undefined): T | null {
  if (taskId) {
    const byId = tasks.find((t) => t.id === String(taskId));
    if (byId) return byId;
  }
  const key = (name ?? '').trim().toLowerCase();
  return key ? tasks.find((t) => t.name.trim().toLowerCase() === key) ?? null : null;
}

/**
 * The rate an hour of this time bills at. A rate on the entry itself comes
 * first; then the method's: the project's rate, the task's, or the person's.
 * With none, `missing` names what needs one (null for fixed fee, whose
 * unpriced time is simply left off, as it always was).
 */
export function rateFor(book: RateBook, e: { ratePaise: number | null; task: string; taskId?: string | null; userId?: string; userName: string }): { ratePaise: number | null; missing: string | null } {
  if (e.ratePaise != null) return { ratePaise: e.ratePaise, missing: null };
  if (book.method === 'task_hours') {
    const t = findTask(book.tasks, e.taskId, e.task);
    return t?.ratePaise != null ? { ratePaise: t.ratePaise, missing: null } : { ratePaise: null, missing: `the task "${t?.name ?? e.task.trim()}"` };
  }
  if (book.method === 'staff_hours') {
    const m = book.members.find((x) => x.userId === e.userId);
    return m?.ratePaise != null ? { ratePaise: m.ratePaise, missing: null } : { ratePaise: null, missing: e.userName };
  }
  if (book.projectRatePaise != null) return { ratePaise: book.projectRatePaise, missing: null };
  return { ratePaise: null, missing: book.method === 'fixed' ? null : 'the project' };
}

const listed = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Why time cannot be invoiced yet, naming the tasks or people without a rate. */
export function missingRateMessage(method: BillingMethod, missing: string[]): string {
  if (method === 'task_hours') {
    const names = missing.map((m) => m.replace(/^the task /, ''));
    return `No rate per hour for the task${names.length === 1 ? '' : 's'} ${listed(names)}: give ${names.length === 1 ? 'it' : 'each'} a rate on the project, or the time its own.`;
  }
  if (method === 'staff_hours') return `No rate per hour for ${listed(missing)}: add ${missing.length === 1 ? 'them' : 'each'} to the project's users with a rate.`;
  return 'No rate per hour for this project: give the project a rate, or the time its own.';
}

export interface TimeFact {
  id: string;
  date: string;
  hours: number;
  task: string;
  notes: string | null;
  ratePaise: number | null;
  userName: string;
  userId?: string;
  taskId?: string | null;
}

export interface TimeGroup {
  task: string;
  /** Billed by staff hours: whose time the line is, since each person has their own rate. */
  who?: string;
  ratePaise: number;
  hours: number;
  from: string;
  to: string;
  notes: string[];
  entryIds: string[];
}

/** 2026-10-01 to 2026-10-15 → "1–15 Oct 2026". */
export function dateSpan(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (from === to) return `${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}

/**
 * Billable time as invoice lines: one per task and rate, hours summed; by
 * staff hours, one per task and person. The rate is the method's (see
 * rateFor). A bare number is the old call: one rate for the project.
 * `unpriced` is the time with no rate; `missing` names what lacks one.
 */
export function groupTime(entries: TimeFact[], book: RateBook | number | null): { groups: TimeGroup[]; unpriced: string[]; missing: string[] } {
  const b: RateBook = book !== null && typeof book === 'object' ? book : { method: 'project_hours', projectRatePaise: book, tasks: [], members: [] };
  const by = new Map<string, TimeGroup>();
  const unpriced: string[] = [];
  const missing = new Set<string>();
  for (const e of [...entries].sort((a, c) => a.date.localeCompare(c.date))) {
    const { ratePaise: rate, missing: lacks } = rateFor(b, e);
    if (rate == null) {
      unpriced.push(e.id);
      if (lacks) missing.add(lacks);
      continue;
    }
    const task = findTask(b.tasks, e.taskId, e.task)?.name ?? e.task.trim();
    const who = b.method === 'staff_hours' ? e.userName : undefined;
    const key = `${task.toLowerCase()}|${rate}|${who ? e.userId ?? who : ''}`;
    const g = by.get(key) ?? { task: e.taskId ? task : e.task.trim(), ...(who ? { who } : {}), ratePaise: rate, hours: 0, from: e.date, to: e.date, notes: [], entryIds: [] };
    g.hours = round2(g.hours + e.hours);
    if (e.date < g.from) g.from = e.date;
    if (e.date > g.to) g.to = e.date;
    if (e.notes?.trim()) g.notes.push(e.notes.trim());
    g.entryIds.push(e.id);
    by.set(key, g);
  }
  return { groups: [...by.values()], unpriced, missing: [...missing] };
}

/** The rules' description: the task (and, by staff hours, whose time) and the dates it covers. */
export const lineDescription = (g: TimeGroup) => `${g.task}${g.who ? ` (${g.who})` : ''}, ${dateSpan(g.from, g.to)}`;

export function timeLinesPrompt(project: string, groups: TimeGroup[]): string {
  return [
    `Write the description for each line of an invoice for time spent on "${project}", for the customer to read.`,
    'Summarise what was done from the notes, in under 20 words, plain and specific. No hours, rates, amounts, dates or names: those are printed beside it.',
    'Reply with JSON only: {"lines": [{"line": <number>, "description": "<text>"}]}.',
    '',
    ...groups.map((g, i) => `Line ${i}: ${g.task}. Notes: ${g.notes.slice(0, 20).map((n) => n.slice(0, 200)).join(' | ') || 'none'}`),
  ].join('\n');
}

/**
 * The model's descriptions, kept only where they are short text with no
 * figure of their own: a number not in the notes or task (an hour count, an
 * amount) means the line keeps the rules' words.
 */
export function readTimeLines(raw: unknown, groups: TimeGroup[]): Map<number, string> {
  const out = new Map<number, string>();
  const lines = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return out;
  for (const l of lines) {
    const i = Number(l?.line);
    const text = typeof l?.description === 'string' ? l.description.replace(/\s+/g, ' ').trim() : '';
    const g = groups[i];
    if (!g || !Number.isInteger(i) || text.length < 3 || text.length > 200 || /₹|\brs\.?\s|\bhours?\b|\bhrs?\b/i.test(text)) continue;
    const known = new Set(`${g.task} ${g.notes.join(' ')}`.match(/\d+(?:\.\d+)?/g) ?? []);
    if ((text.match(/\d+(?:\.\d+)?/g) ?? []).some((n: string) => !known.has(n))) continue;
    out.set(i, `${text.replace(/[.\s]+$/, '')}${g.who ? ` (${g.who})` : ''}, ${dateSpan(g.from, g.to)}`);
  }
  return out;
}

// ── How a project is doing ───────────────────────────────────────────────

export interface ProjectFigures {
  /** The method, or the old 'time' (read as project_hours). */
  billing: string;
  /**
   * The one budget projects had before cost and revenue budgets: the fee for
   * fixed work, the cap on billed and unbilled time for hourly work. Read as
   * the revenue budget; alerts work as they always did while it is the only
   * budget set.
   */
  budgetPaise: number | null;
  costBudgetPaise?: number | null;
  revenueBudgetPaise?: number | null;
  budgetHours: number | null;
  hours: number;
  /** Invoiced so far, before GST. */
  billedPaise: number;
  /** Billable time not yet invoiced, at its rates. */
  unbilledPaise: number;
  /** Costs booked to the project. */
  costPaise: number;
}

export interface Alert {
  level: 'warn' | 'over';
  text: string;
}

/**
 * Budget burn, by rules. With a cost or revenue budget: costs against the
 * cost budget, and income against the revenue budget (for hourly work,
 * what is billed and unbilled; for a fixed fee, what is invoiced). With only
 * the old single budget, as before: hourly work's billed and unbilled time
 * against the cap, a fixed fee's costs against the fee. And hours against
 * budgeted hours, either way.
 */
export function budgetAlerts(p: ProjectFigures): Alert[] {
  const out: Alert[] = [];
  const check = (used: number, of: number, what: string, budget = 'budget') => {
    const pct = Math.round((used / of) * 100);
    if (pct >= 100) out.push({ level: 'over', text: `${what} is at ${pct}% of the ${budget}.` });
    else if (pct >= 80) out.push({ level: 'warn', text: `${what} is at ${pct}% of the ${budget}.` });
  };
  const hourly = billingMethod(p.billing) !== 'fixed';
  if (p.costBudgetPaise != null || p.revenueBudgetPaise != null) {
    if (p.costBudgetPaise) check(p.costPaise, p.costBudgetPaise, 'Cost', 'cost budget');
    const revenue = p.revenueBudgetPaise ?? p.budgetPaise;
    if (revenue) check(hourly ? p.billedPaise + p.unbilledPaise : p.billedPaise, revenue, hourly ? 'Time billed and unbilled' : 'Income', 'revenue budget');
  } else if (p.budgetPaise) {
    check(hourly ? p.billedPaise + p.unbilledPaise : p.costPaise, p.budgetPaise, hourly ? 'Time billed and unbilled' : 'Cost');
  }
  if (p.budgetHours) check(p.hours, p.budgetHours, 'Time logged');
  return out;
}

// ── Time spent ───────────────────────────────────────────────────────────

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "13:05" → minutes after midnight; null if it is not a time of day. */
export function clockMinutes(v: string): number | null {
  const m = CLOCK.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "1:30" (hours and minutes spent) → 1.5 hours; null if it is not one. */
export function durationHours(v: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(v.trim());
  return m ? round2(Number(m[1]) + Number(m[2]) / 60) : null;
}

/** Hours between a start and an end time the same day, to two decimals; null if the end is not after the start. */
export function spanHours(start: string, end: string): number | null {
  const a = clockMinutes(start);
  const b = clockMinutes(end);
  return a == null || b == null || b <= a ? null : round2((b - a) / 60);
}

/** A running timer's time: whole minutes, at least one, as hours to two decimals. */
export function timerHours(startedAt: Date, stoppedAt: Date): { minutes: number; hours: number } {
  const minutes = Math.max(1, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 60_000));
  return { minutes, hours: round2(minutes / 60) };
}

/** People who logged time in the four weeks before the last one but nothing in the last seven days. */
export function missingTimesheets(entries: Array<{ userId: string; userName: string; date: string }>, today: string): Array<{ userId: string; userName: string; lastDate: string }> {
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const weekAgo = day(7);
  const monthAgo = day(35);
  const last = new Map<string, { userName: string; date: string }>();
  for (const e of entries) {
    if (e.date < monthAgo || e.date > today) continue;
    const cur = last.get(e.userId);
    if (!cur || e.date > cur.date) last.set(e.userId, { userName: e.userName, date: e.date });
  }
  return [...last].filter(([, v]) => v.date <= weekAgo).map(([userId, v]) => ({ userId, userName: v.userName, lastDate: v.date })).sort((a, b) => a.lastDate.localeCompare(b.lastDate));
}
