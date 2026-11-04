/**
 * Ask your books, pure. A question becomes a call to one read-only report
 * tool, by rules for the common questions and by the model for the rest;
 * the answer is written from the rows the tool returned, and cites them.
 * Nothing here can change the books: the tools only read reports.
 */
import { figuresKnown, inr } from './figures';
import { MONTH, fyMonths, shiftMonth } from './management';
import { ReportTable, cellText } from './report-table';

export type ToolName = 'profit_and_loss' | 'expenses' | 'sales' | 'purchases' | 'receivables' | 'payables' | 'gst' | 'budget' | 'cash' | 'account';
export type By = 'customer' | 'vendor' | 'item' | 'month';

export interface ToolCall {
  tool: ToolName;
  args: { from?: string; to?: string; by?: By; account?: string };
}

export const TOOLS: Array<{ name: ToolName; does: string; args: string }> = [
  { name: 'profit_and_loss', does: 'Income, expenses and net profit for months, against the period before and a year before', args: 'from, to (months like 2026-04)' },
  { name: 'expenses', does: 'Expenses by account for months', args: 'from, to' },
  { name: 'sales', does: 'Sales by customer, item or month, less credit notes', args: 'by (customer | item | month), from, to' },
  { name: 'purchases', does: 'Purchases by vendor, item or month, less debit notes', args: 'by (vendor | item | month), from, to' },
  { name: 'receivables', does: 'What each customer owes now, by how overdue, and how long they take to pay', args: 'none' },
  { name: 'payables', does: 'What is owed to each vendor now, by how overdue', args: 'none' },
  { name: 'gst', does: 'Output tax, reverse charge and input credit by month, from the books', args: 'from, to' },
  { name: 'budget', does: 'Budget against actual for this financial year so far', args: 'none' },
  { name: 'cash', does: 'Bank and cash balances today, from the balance sheet', args: 'none' },
  { name: 'account', does: 'One account month by month', args: 'account (a name from the chart), from, to' },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The months a question asks about, if it says: "last month", "in October", "FY 2025-26", "Q2", "this year". */
export function periodIn(question: string, today: string): { from: string; to: string } | null {
  const q = question.toLowerCase();
  const now = today.slice(0, 7);
  const fy = fyMonths(now);
  if (/\b(last|previous) month\b/.test(q)) return { from: shiftMonth(now, -1), to: shiftMonth(now, -1) };
  if (/\b(this|current) month\b/.test(q)) return { from: now, to: now };
  const quarterStart = (m: string) => shiftMonth(m, -((Number(m.slice(5, 7)) - 1) % 3));
  if (/\b(last|previous) quarter\b/.test(q)) {
    const s = shiftMonth(quarterStart(now), -3);
    return { from: s, to: shiftMonth(s, 2) };
  }
  if (/\b(this|current) quarter\b/.test(q)) return { from: quarterStart(now), to: now };
  // 2025-26 (or FY 2025-26) is a financial year; 2026-04 is a month.
  const pair = /\b(?:fy\s?)?(\d{4})\s?[-/–]\s?(\d{2})\b(?!-\d)/.exec(q);
  if (pair && Number(pair[1]) > 1990) {
    const start = Number(pair[1]);
    if (Number(pair[2]) === (start + 1) % 100) {
      const end = shiftMonth(`${start}-04`, 11);
      return { from: `${start}-04`, to: end < now ? end : now };
    }
    if (/^(0[1-9]|1[0-2])$/.test(pair[2])) return { from: `${start}-${pair[2]}`, to: `${start}-${pair[2]}` };
  }
  const quarter = /\bq([1-4])\b/.exec(q);
  if (quarter) {
    const s = shiftMonth(fy.from, (Number(quarter[1]) - 1) * 3);
    return { from: s, to: shiftMonth(s, 2) < now ? shiftMonth(s, 2) : now };
  }
  if (/\b(last|previous) (financial |fiscal )?year\b|\blast fy\b/.test(q)) return { from: shiftMonth(fy.from, -12), to: shiftMonth(fy.from, -1) };
  if (/\b(this|current) (financial |fiscal )?year\b|\bthis fy\b|\bso far\b|\byear to date\b|\bytd\b/.test(q)) return { from: fy.from, to: now };
  // Whole month names only, so "marketing" is not March.
  const named = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:\s+(\d{4}))?/.exec(q);
  if (named && !/\bmay i\b|\bmay we\b/.test(q)) {
    const m = String(MONTHS.indexOf(named[1].slice(0, 3)) + 1).padStart(2, '0');
    let month = named[2] ? `${named[2]}-${m}` : `${now.slice(0, 4)}-${m}`;
    if (!named[2] && month > now) month = shiftMonth(month, -12);
    return { from: month, to: month };
  }
  return null;
}

/** An account the question names: "rent", "freight", "salaries". */
export function accountIn(question: string, accounts: string[]): string | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  const exact = accounts.filter((a) => q.includes(` ${a.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `));
  if (exact.length) return exact.sort((a, b) => b.length - a.length)[0];
  for (const a of accounts) {
    const word = a.toLowerCase().split(/[^a-z]+/).find((w) => w.length >= 4 && !['expenses', 'income', 'other', 'accounts', 'charges', 'and'].includes(w));
    if (word && new RegExp(`\\b${word.replace(/s$/, '')}s?\\b`).test(q)) return a;
  }
  return null;
}

/** The common questions, by rules: no model needed. */
export function parseQuestion(question: string, today: string, accounts: string[]): ToolCall | null {
  const q = question.toLowerCase();
  const p = periodIn(question, today) ?? undefined;
  const range = p ? { from: p.from, to: p.to } : {};
  if (/\bwho owes\b|\bowe[sd]? (me|us)\b|\breceivables?\b|\bunpaid invoices\b|\boverdue invoices\b|\bcustomers? (have not|haven't|yet to) pa(y|id)\b|\bcollect/.test(q)) return { tool: 'receivables', args: {} };
  if (/\b(we|i) owe\b|\bpayables?\b|\bbills?\b[^.?]*\b(due|to pay|unpaid|pending)\b|\bpay (our )?(vendors|suppliers)\b|\bowe (our )?(vendors|suppliers)\b/.test(q)) return { tool: 'payables', args: {} };
  if (/\bgst\b|\binput (tax )?credit\b|\bitc\b|\boutput tax\b/.test(q)) return { tool: 'gst', args: range };
  if (/\bbudget/.test(q)) return { tool: 'budget', args: {} };
  if (/\b(cash|bank) (balance|position|in hand)\b|\bhow much (cash|money)\b|\bmoney in (the )?bank\b|\bbank balance\b/.test(q)) return { tool: 'cash', args: {} };
  const buying = /\bpurchase|\bbought\b|\bsuppliers?\b|\bvendors?\b|\bbuy(ing)?\b/.test(q);
  if (buying) {
    const by: By = /\bitems?\b|\bproducts?\b|\bwhat (did )?we (buy|bought)\b/.test(q) ? 'item' : /\bby month\b|\bmonthly\b|\btrend\b|\beach month\b/.test(q) ? 'month' : 'vendor';
    return { tool: 'purchases', args: { by, ...range } };
  }
  if (/\b(best|top)[ -]?sell|\bwhich (items|products)\b|\bwhat sold\b|\bsales by item\b|\bitems? sold\b/.test(q)) return { tool: 'sales', args: { by: 'item', ...range } };
  if (/\b(top|best|biggest|largest|main) customers?\b|\bsales by customer\b|\bwho (bought|buys)\b|\bcustomers? (bought|spent)\b/.test(q)) return { tool: 'sales', args: { by: 'customer', ...range } };
  if (/\bexpenses?\b|\bspen[dt]\b|\bspending\b|\bcosts?\b|\bhow much (did )?(we|i) pay\b|\bpaid for\b/.test(q)) {
    const account = accountIn(question, accounts);
    return account ? { tool: 'account', args: { account, ...range } } : { tool: 'expenses', args: range };
  }
  if (/\bprofit|\bloss\b|\bmargin\b|\bnet income\b|\bhow (did|are|is) (we|the business|business) (do|doing|perform)/.test(q)) return { tool: 'profit_and_loss', args: range };
  if (/\bsales\b|\brevenue\b|\bturnover\b|\bincome\b|\bsold\b/.test(q)) return { tool: 'sales', args: { by: 'month', ...range } };
  const account = accountIn(question, accounts);
  if (account) return { tool: 'account', args: { account, ...range } };
  return null;
}

// ── Answers from the rows ────────────────────────────────────────────────

const rowIndex = (t: ReportTable, name: string) => t.rows.findIndex((r) => r.cells[0] === name);
const plain = (t: ReportTable) => t.rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.style);
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** An answer in a sentence or two, from the table, citing the rows it used. */
export function ruleAnswer(call: ToolCall, t: ReportTable): { answer: string; rows: number[] } {
  const num = (i: number, c: number) => Number(t.rows[i]?.cells[c] ?? 0);
  switch (call.tool) {
    case 'profit_and_loss': {
      const np = rowIndex(t, 'Net profit');
      const inc = rowIndex(t, 'Total income');
      const exp = rowIndex(t, 'Total expenses');
      const [cur, prev, , , ly] = [1, 2, 3, 4, 5].map((c) => num(np, c));
      const label = t.columns[1].label;
      const said = cur >= 0 ? `Net profit for ${label} was ${inr(cur)}` : `${label} made a net loss of ${inr(-cur)}`;
      return {
        answer: `${said}: income ${inr(num(inc, 1))} less expenses ${inr(num(exp, 1))}. It was ${inr(prev)} for ${t.columns[2].label}${ly ? ` and ${inr(ly)} for ${t.columns[5].label}` : ''}.`,
        rows: [inc, exp, np].filter((i) => i >= 0),
      };
    }
    case 'expenses': {
      const total = rowIndex(t, 'Total expenses');
      const last = t.columns.length - 1;
      const top = plain(t).sort((a, b) => Number(b.r.cells[last]) - Number(a.r.cells[last])).slice(0, 3);
      return {
        answer: `Expenses for ${t.subtitle} came to ${inr(num(total, last))}.${top.length ? ` The largest were ${list(top.map(({ r }) => `${r.cells[0]} (${inr(Number(r.cells[last]))})`))}.` : ''}`,
        rows: [...top.map(({ i }) => i), total],
      };
    }
    case 'account': {
      const total = t.rows.length - 1;
      return { answer: `${call.args.account} came to ${inr(num(total, 1))} over ${t.subtitle}.`, rows: [total] };
    }
    case 'sales':
    case 'purchases': {
      const word = call.tool === 'sales' ? 'sales' : 'purchases';
      const totalRow = t.rows.length - 1;
      if (call.args.by === 'month') {
        const months = plain(t).sort((a, b) => Number(b.r.cells[4]) - Number(a.r.cells[4]));
        const best = months[0];
        return {
          answer: `Net ${word} for ${t.subtitle} came to ${inr(num(totalRow, 4))}${best && months.length > 1 ? `; the most was in ${best.r.cells[0]} (${inr(Number(best.r.cells[4]))})` : ''}.`,
          rows: [...(best ? [best.i] : []), totalRow],
        };
      }
      if (call.args.by === 'item') {
        const top = plain(t).filter(({ r }) => r.cells[1] !== null).slice(0, 3);
        return { answer: top.length ? `By value, the most ${call.tool === 'sales' ? 'sold' : 'bought'} for ${t.subtitle}: ${list(top.map(({ r }) => `${r.cells[0]} (${inr(Number(r.cells[3]))}${r.cells[1] !== null ? `, ${r.cells[1]} ${r.cells[2] ?? ''}`.trimEnd() : ''})`))}.` : `No ${word} lines linked to items for ${t.subtitle}.`, rows: [...top.map(({ i }) => i), totalRow] };
      }
      const top = plain(t).slice(0, 3);
      return {
        answer: top.length ? `The top ${call.tool === 'sales' ? 'customers' : 'vendors'} for ${t.subtitle}: ${list(top.map(({ r }) => `${r.cells[0]} (${inr(Number(r.cells[4]))})`))}. Net ${word} in all: ${inr(num(totalRow, 4))}.` : `No ${word} for ${t.subtitle}.`,
        rows: [...top.map(({ i }) => i), totalRow],
      };
    }
    case 'receivables':
    case 'payables': {
      const totalRow = t.rows.length - 1;
      const total = num(totalRow, 6);
      const overdue = total - num(totalRow, 1);
      const top = plain(t)[0];
      const who = call.tool === 'receivables' ? 'Customers owe' : 'You owe vendors';
      if (!total) return { answer: call.tool === 'receivables' ? 'No customer owes anything right now.' : 'Nothing is owed to vendors right now.', rows: [totalRow] };
      return {
        answer: `${who} ${inr(total)}; ${inr(overdue)} of it is overdue.${top ? ` The most is ${call.tool === 'receivables' ? 'owed by' : 'owed to'} ${top.r.cells[0]} (${inr(Number(top.r.cells[6]))}).` : ''}`,
        rows: [...(top ? [top.i] : []), totalRow],
      };
    }
    case 'gst': {
      const totalRow = t.rows.length - 1;
      return { answer: `GST for ${t.subtitle}, before set-off rules: output tax ${inr(num(totalRow, 1))}, reverse charge ${inr(num(totalRow, 2))}, input credit ${inr(num(totalRow, 3))}, so ${inr(num(totalRow, 4))} net.`, rows: [totalRow] };
    }
    case 'budget': {
      const np = rowIndex(t, 'Net profit');
      return { answer: `Net profit is ${inr(num(np, 2))} against a budget of ${inr(num(np, 1))} for ${t.subtitle}.`, rows: [np] };
    }
    case 'cash': {
      const money = plain(t).filter(({ r }) => /bank|cash|gateway/i.test(String(r.cells[0])));
      return {
        answer: money.length ? `${list(money.map(({ r }) => `${r.cells[0]} ${inr(Number(r.cells[1]))}`))}, as the books stand today.` : 'No bank or cash balance in the books yet.',
        rows: money.map(({ i }) => i),
      };
    }
  }
}

// ── The model, for the rest ──────────────────────────────────────────────

export function planPrompt(question: string, today: string, accounts: string[]): string {
  return [
    'You choose which report answers a question about a small Indian business\'s books. You cannot change anything; you only pick a report.',
    `Today is ${today}. Indian financial years run April to March. Months are written like 2026-04.`,
    'Reports:',
    ...TOOLS.map((t) => `- ${t.name}: ${t.does}. Arguments: ${t.args}.`),
    'Accounts in the chart (for the account report, use one exactly as written):',
    accounts.slice(0, 200).join('; '),
    'Reply with JSON only: {"tool": "<report name>", "args": {...}}, or {"tool": null} if no report answers it.',
    '',
    `Question: ${question.slice(0, 500)}`,
  ].join('\n');
}

/** The model's choice, kept only if it names a real report with sensible arguments. */
export function readPlan(raw: unknown, accounts: string[], today: string): ToolCall | null {
  const o = raw as { tool?: unknown; args?: Record<string, unknown> } | null;
  const tool = TOOLS.find((t) => t.name === o?.tool)?.name;
  if (!tool) return null;
  const a = o?.args ?? {};
  const now = today.slice(0, 7);
  const month = (v: unknown) => (typeof v === 'string' && MONTH.test(v) && v <= now ? v : undefined);
  const args: ToolCall['args'] = {};
  const from = month(a.from);
  const to = month(a.to);
  if (from && to && from <= to) Object.assign(args, { from, to });
  if (tool === 'sales' || tool === 'purchases') {
    const allowed: By[] = tool === 'sales' ? ['customer', 'item', 'month'] : ['vendor', 'item', 'month'];
    args.by = allowed.includes(a.by as By) ? (a.by as By) : tool === 'sales' ? 'customer' : 'vendor';
  }
  if (tool === 'account') {
    const name = accounts.find((n) => n.toLowerCase() === String(a.account ?? '').trim().toLowerCase());
    if (!name) return null;
    args.account = name;
  }
  return { tool, args };
}

/** The rows as numbered lines of text for the model. */
export function tableText(t: ReportTable, max = 40): string {
  return [
    `${t.title}, ${t.subtitle}`,
    `# | ${t.columns.map((c) => c.label).join(' | ')}`,
    ...t.rows.slice(0, max).map((r, i) => `${i} | ${r.cells.map((v, c) => cellText(t.columns[c]?.kind ?? 'text', v)).join(' | ')}`),
  ].join('\n');
}

export function answerPrompt(question: string, t: ReportTable): string {
  return [
    'Answer the owner\'s question about their books from the report rows below, in one to three plain sentences.',
    'Copy every figure exactly as the rows write it; never add, subtract or work out a percentage. If the rows do not answer it, say what they do show.',
    'Reply with JSON only: {"answer": "<sentences>", "rows": [<the # of each row you used>]}.',
    '',
    tableText(t),
    '',
    `Question: ${question.slice(0, 500)}`,
  ].join('\n');
}

/** The model's answer, kept only if every figure in it is in a row it cites. */
export function readAnswer(raw: unknown, t: ReportTable): { answer: string; rows: number[] } | null {
  const o = raw as { answer?: unknown; rows?: unknown } | null;
  const answer = typeof o?.answer === 'string' ? o.answer.trim().slice(0, 800) : '';
  const rows = Array.isArray(o?.rows) ? [...new Set(o!.rows.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < Math.min(40, t.rows.length)))] : [];
  if (!answer || !rows.length) return null;
  const known = rows.flatMap((i) =>
    t.rows[i].cells.flatMap((v, c) => {
      if (typeof v !== 'number') return [];
      return t.columns[c]?.kind === 'money' ? [v / 100] : [v];
    }),
  );
  const labels = [t.subtitle, ...t.columns.map((c) => c.label)].join(' ');
  return figuresKnown(answer.replace(/\b(19|20)\d{2}-\d{2}\b/g, ''), [...known, ...[...labels.matchAll(/\d+/g)].map((m) => Number(m[0]))]) ? { answer, rows } : null;
}

export const SUGGESTED = [
  'What was my profit last month?',
  'Who owes me money?',
  'Who are my top customers this year?',
  'How much did we spend on rent this year?',
  'What is my GST for last month?',
  'Which items sold best last quarter?',
];

