/**
 * The month in words. Every fact is computed here from figures the books
 * gave; the model may only rephrase and order them. Without a model, the
 * facts themselves are the narrative.
 */
import { figuresKnown, inr, pct } from './figures';
import { monthLabel } from './management';

export interface Fact {
  id: string;
  /** A sentence that says it, as the rules would. */
  text: string;
  /** The numbers it carries, in rupees or percent, for checking what the model writes. */
  figures: number[];
  /** Higher first. */
  weight: number;
}

export interface PlFigures {
  income: number;
  expenses: number;
  /** Each income and expense account, as a person reads it. */
  byAccount: Map<string, { name: string; amount: number }>;
}

export interface NarrativeInput {
  period: string;
  current: PlFigures;
  previous: PlFigures;
  lastYear: PlFigures;
  receivables: { owedPaise: number; overduePaise: number; over90Paise: number };
  payables: { overduePaise: number };
  /** Customers whose recent payments came later than their usual. */
  latePayers: Array<{ name: string; recentDays: number; usualDays: number }>;
  cash: { endPaise: number; previousEndPaise: number };
}

const r = (paise: number) => paise / 100;
const change = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);
/** "up 18% on the month before", or "the same as the month before". */
const moved = (c: number, against: string) => (Math.abs(c) < 0.05 ? `the same as ${against}` : `${c >= 0 ? 'up' : 'down'} ${pct(c)} on ${against}`);

export function narrativeFacts(x: NarrativeInput): Fact[] {
  const facts: Fact[] = [];
  const month = monthLabel(x.period);
  const profit = x.current.income - x.current.expenses;
  const prevProfit = x.previous.income - x.previous.expenses;
  const yearProfit = x.lastYear.income - x.lastYear.expenses;

  if (x.current.income || x.current.expenses) {
    const c = change(profit, prevProfit);
    const said = profit >= 0 ? `Profit for ${month} was ${inr(profit)}` : `${month} made a loss of ${inr(-profit)}`;
    const vs = c === null ? '' : `, ${moved(c, 'the month before')} (${inr(prevProfit)})`;
    facts.push({ id: 'profit', text: `${said}${vs}.`, figures: [r(profit), r(prevProfit), ...(c === null ? [] : [Math.abs(c)])], weight: 100 });

    const ci = change(x.current.income, x.previous.income);
    const cy = change(x.current.income, x.lastYear.income);
    const parts = [ci === null ? null : moved(ci, 'the month before'), cy === null ? null : moved(cy, monthLabel(`${Number(x.period.slice(0, 4)) - 1}${x.period.slice(4)}`))].filter(Boolean);
    facts.push({ id: 'income', text: `Income was ${inr(x.current.income)}${parts.length ? `, ${parts.join(' and ')}` : ''}.`, figures: [r(x.current.income), ...[ci, cy].filter((v): v is number => v !== null).map(Math.abs)], weight: 80 });

    const ce = change(x.current.expenses, x.previous.expenses);
    facts.push({ id: 'expenses', text: `Expenses were ${inr(x.current.expenses)}${ce === null ? '' : `, ${moved(ce, 'the month before')}`}.`, figures: [r(x.current.expenses), ...(ce === null ? [] : [Math.abs(ce)])], weight: 60 });
    if (yearProfit && !prevProfit) facts.push({ id: 'profit_year', text: `A year earlier, profit was ${inr(yearProfit)}.`, figures: [r(yearProfit)], weight: 40 });
  }

  // What moved most since the month before: the reason behind the totals.
  const movers = [...new Set([...x.current.byAccount.keys(), ...x.previous.byAccount.keys()])]
    .map((id) => {
      const now = x.current.byAccount.get(id)?.amount ?? 0;
      const before = x.previous.byAccount.get(id)?.amount ?? 0;
      return { id, name: x.current.byAccount.get(id)?.name ?? x.previous.byAccount.get(id)!.name, now, before, delta: now - before };
    })
    .filter((m) => Math.abs(m.delta) >= 1_000_00 && (m.before === 0 || Math.abs(m.delta / m.before) >= 0.1))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  movers.forEach((m, i) => {
    const how = m.before === 0 ? `came to ${inr(m.now)}, from nothing the month before` : m.now >= m.before * 2 ? `more than doubled, from ${inr(m.before)} to ${inr(m.now)}` : `${m.delta > 0 ? 'rose' : 'fell'} from ${inr(m.before)} to ${inr(m.now)}`;
    facts.push({ id: `mover_${i + 1}`, text: `${m.name} ${how}.`, figures: [r(m.before), r(m.now), r(Math.abs(m.delta))], weight: 70 - i * 5 });
  });

  if (x.latePayers.length) {
    const names = x.latePayers.slice(0, 3);
    facts.push({
      id: 'late_payers',
      text: `${x.latePayers.length} customer${x.latePayers.length === 1 ? ' is' : 's are'} paying later than usual: ${names.map((p) => `${p.name} (${p.recentDays} days, against ${p.usualDays})`).join(', ')}.`,
      figures: [x.latePayers.length, ...names.flatMap((p) => [p.recentDays, p.usualDays])],
      weight: 65,
    });
  }
  if (x.receivables.overduePaise > 0) {
    facts.push({
      id: 'overdue',
      text: `Customers owe ${inr(x.receivables.owedPaise)}, of which ${inr(x.receivables.overduePaise)} is overdue${x.receivables.over90Paise ? ` and ${inr(x.receivables.over90Paise)} more than 90 days late` : ''}.`,
      figures: [r(x.receivables.owedPaise), r(x.receivables.overduePaise), r(x.receivables.over90Paise)],
      weight: 55,
    });
  }
  if (x.payables.overduePaise > 0) facts.push({ id: 'payables', text: `${inr(x.payables.overduePaise)} of bills are past their due date.`, figures: [r(x.payables.overduePaise)], weight: 35 });
  if (x.cash.endPaise || x.cash.previousEndPaise) {
    const d = x.cash.endPaise - x.cash.previousEndPaise;
    facts.push({ id: 'cash', text: `Cash and bank stood at ${inr(x.cash.endPaise)} at the month's end, ${d >= 0 ? 'up' : 'down'} ${inr(Math.abs(d))} on the month before.`, figures: [r(x.cash.endPaise), r(Math.abs(d)), r(x.cash.previousEndPaise)], weight: 50 });
  }
  return facts.sort((a, b) => b.weight - a.weight);
}

/** Without a model: the weightiest facts, as they are. */
export function ruleNarrative(facts: Fact[], max = 5): string[] {
  return facts.slice(0, max).map((f) => f.text);
}

export function narrativePrompt(period: string, facts: Fact[]): string {
  return [
    `Write the monthly summary of a small Indian business's books for ${monthLabel(period)}, for its owner.`,
    'Use ONLY the facts below. Copy every figure exactly as it is written there; never work out a new number, total or percentage.',
    'Three to five short sentences, plain words, the most important first. Explain the profit with what moved, where the facts allow.',
    'Reply with JSON only: {"sentences": [{"text": "<sentence>", "facts": ["<fact id>", ...]}]}.',
    '',
    'Facts:',
    ...facts.map((f) => `[${f.id}] ${f.text}`),
  ].join('\n');
}

/** The model's sentences, kept only where each cites real facts and carries no figure of its own. */
export function readNarrative(raw: unknown, facts: Fact[]): { sentences: string[]; dropped: number } {
  const list = (raw as { sentences?: unknown })?.sentences;
  if (!Array.isArray(list)) return { sentences: [], dropped: 0 };
  const byId = new Map(facts.map((f) => [f.id, f]));
  let dropped = 0;
  const sentences: string[] = [];
  for (const s of list.slice(0, 6)) {
    const text = typeof s?.text === 'string' ? s.text.trim().slice(0, 400) : '';
    const cited = Array.isArray(s?.facts) ? s.facts.map((id: unknown) => byId.get(String(id))).filter(Boolean) as Fact[] : [];
    if (!text || !cited.length || !figuresKnown(text, cited.flatMap((f) => f.figures))) {
      dropped++;
      continue;
    }
    sentences.push(text);
  }
  return { sentences, dropped };
}
