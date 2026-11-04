/**
 * Time into invoice lines, and how a project is doing. Pure: hours, rates
 * and amounts are worked out here; the model, when there is one, only words
 * a line's description from the notes people wrote.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface TimeFact {
  id: string;
  date: string;
  hours: number;
  task: string;
  notes: string | null;
  ratePaise: number | null;
  userName: string;
}

export interface TimeGroup {
  task: string;
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

/** Billable time as invoice lines: one per task and rate, hours summed. */
export function groupTime(entries: TimeFact[], projectRatePaise: number | null): { groups: TimeGroup[]; unpriced: string[] } {
  const by = new Map<string, TimeGroup>();
  const unpriced: string[] = [];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const rate = e.ratePaise ?? projectRatePaise;
    if (rate == null) {
      unpriced.push(e.id);
      continue;
    }
    const key = `${e.task.trim().toLowerCase()}|${rate}`;
    const g = by.get(key) ?? { task: e.task.trim(), ratePaise: rate, hours: 0, from: e.date, to: e.date, notes: [], entryIds: [] };
    g.hours = round2(g.hours + e.hours);
    if (e.date < g.from) g.from = e.date;
    if (e.date > g.to) g.to = e.date;
    if (e.notes?.trim()) g.notes.push(e.notes.trim());
    g.entryIds.push(e.id);
    by.set(key, g);
  }
  return { groups: [...by.values()], unpriced };
}

/** The rules' description: the task and the dates it covers. */
export const lineDescription = (g: TimeGroup) => `${g.task}, ${dateSpan(g.from, g.to)}`;

export function timeLinesPrompt(project: string, groups: TimeGroup[]): string {
  return [
    `Write the description for each line of an invoice for time spent on "${project}", for the customer to read.`,
    'Summarise what was done from the notes, in under 20 words, plain and specific. No hours, rates, amounts or dates: those are printed beside it.',
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
    out.set(i, `${text.replace(/[.\s]+$/, '')}, ${dateSpan(g.from, g.to)}`);
  }
  return out;
}

// ── How a project is doing ───────────────────────────────────────────────

export interface ProjectFigures {
  billing: 'time' | 'fixed';
  budgetPaise: number | null;
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
 * Budget burn, by rules. Time-billed: what is billed and unbilled against
 * the cap. Fixed fee: costs against the fee, since every rupee of cost
 * comes off the margin. And hours against budgeted hours, either way.
 */
export function budgetAlerts(p: ProjectFigures): Alert[] {
  const out: Alert[] = [];
  const check = (used: number, of: number, what: string) => {
    const pct = Math.round((used / of) * 100);
    if (pct >= 100) out.push({ level: 'over', text: `${what} is at ${pct}% of the budget.` });
    else if (pct >= 80) out.push({ level: 'warn', text: `${what} is at ${pct}% of the budget.` });
  };
  if (p.budgetPaise) check(p.billing === 'time' ? p.billedPaise + p.unbilledPaise : p.costPaise, p.budgetPaise, p.billing === 'time' ? 'Time billed and unbilled' : 'Cost');
  if (p.budgetHours) check(p.hours, p.budgetHours, 'Time logged');
  return out;
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
