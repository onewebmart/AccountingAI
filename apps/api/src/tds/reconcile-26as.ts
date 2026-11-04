/**
 * TDS customers deducted from what they paid us, against Form 26AS: what
 * the government credited to our PAN. Credit is claimed in the income-tax
 * return only as 26AS shows it, so each side's leftovers say what to chase.
 * Pure; nothing is stored or posted.
 */

export interface BookTds {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  /** YYYY-MM-DD the receipt was recorded. */
  paidOn: string;
  tdsPaise: number;
}

export interface Row26as {
  line: number;
  deductorName: string;
  tan: string | null;
  section: string | null;
  /** YYYY-MM-DD */
  date: string;
  amountPaise: number | null;
  tdsPaise: number;
}

const HEADERS: Record<keyof Omit<Row26as, 'line'>, RegExp> = {
  deductorName: /name of deductor|deductor name|^name$/i,
  tan: /tan/i,
  section: /^section/i,
  date: /transaction date|date of (payment|credit)|^date$/i,
  amountPaise: /amount paid|paid ?\/ ?credited|amount credited/i,
  tdsPaise: /tax deducted|tds deducted|^tds$|tax deposited|tds deposited/i,
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Rupees as written ("1,23,456.70") to paise, exactly; null when it is not an amount. */
export function rupeesText(v: string): number | null {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(v.replace(/[,\s₹]/g, ''));
  if (!m) return null;
  const p = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -p : p;
}

const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** 15-Oct-2026, 15/10/2026 or 2026-10-15 → 2026-10-15. */
export function dateText(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/.exec(s);
  if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${MON[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Part I of 26AS, as CSV with a header row. Rows that cannot be read are reported, not guessed. */
export function parse26asCsv(text: string): { rows: Row26as[]; skipped: Array<{ line: number; reason: string }> } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headerAt = lines.findIndex((l) => /deductor/i.test(l) && /(tax|tds)/i.test(l));
  if (headerAt < 0) throw new Error('No header row: the file needs columns like Name of Deductor, Transaction Date and Tax Deducted.');
  const header = splitCsvLine(lines[headerAt]);
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as Array<keyof typeof HEADERS>).map((k) => [k, header.findIndex((h) => HEADERS[k].test(h))]),
  ) as Record<keyof typeof HEADERS, number>;
  for (const k of ['deductorName', 'date', 'tdsPaise'] as const) if (col[k] < 0) throw new Error(`No ${k === 'tdsPaise' ? 'Tax Deducted' : k === 'date' ? 'Transaction Date' : 'Name of Deductor'} column.`);

  const rows: Row26as[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  lines.slice(headerAt + 1).forEach((l, i) => {
    const line = headerAt + i + 2;
    const cells = splitCsvLine(l);
    const date = dateText(cells[col.date] ?? '');
    const tds = rupeesText(cells[col.tdsPaise] ?? '');
    if (!date || tds === null) return void skipped.push({ line, reason: !date ? 'no date it could read' : 'no TDS amount it could read' });
    if (tds === 0) return;
    rows.push({
      line,
      deductorName: cells[col.deductorName] ?? '',
      tan: col.tan >= 0 ? cells[col.tan]?.toUpperCase() || null : null,
      section: col.section >= 0 ? cells[col.section] || null : null,
      date,
      amountPaise: col.amountPaise >= 0 ? rupeesText(cells[col.amountPaise] ?? '') : null,
      tdsPaise: tds,
    });
  });
  return { rows, skipped };
}

const STOP = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'the', 'and', 'co', 'india', 'company', 'corp', 'corporation']);
const tokens = (name: string) => new Set(name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)));

/** Share of the shorter name's words found in the other: "Rao Traders Pvt Ltd" and "RAO TRADERS" are one. */
export function nameLikeness(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  let hit = 0;
  for (const t of small) if (big.has(t)) hit++;
  return hit / small.size;
}

const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
/** The deductor may date it at the invoice, the payment, or the month's end. */
const WINDOW_DAYS = 60;
const TOLERANCE_PAISE = 100;

export function reconcile26as(books: BookTds[], rows: Row26as[]) {
  const usedRows = new Set<number>();
  const matched: Array<{ book: BookTds; row: Row26as }> = [];
  const differs: Array<{ book: BookTds; row: Row26as; differencePaise: number }> = [];
  const notIn26as: BookTds[] = [];

  // Exact amounts first, then the near ones, each pairing the likeliest name.
  const open = [...books].sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const leftover: BookTds[] = [];
  for (const book of open) {
    const best = rows
      .filter((r) => !usedRows.has(r.line) && Math.abs(r.tdsPaise - book.tdsPaise) <= TOLERANCE_PAISE && days(r.date, book.paidOn) <= WINDOW_DAYS && nameLikeness(r.deductorName, book.customerName) >= 0.5)
      .sort((a, b) => nameLikeness(b.deductorName, book.customerName) - nameLikeness(a.deductorName, book.customerName) || days(a.date, book.paidOn) - days(b.date, book.paidOn))[0];
    if (best) {
      usedRows.add(best.line);
      matched.push({ book, row: best });
    } else leftover.push(book);
  }
  for (const book of leftover) {
    const near = rows
      .filter((r) => !usedRows.has(r.line) && days(r.date, book.paidOn) <= WINDOW_DAYS && nameLikeness(r.deductorName, book.customerName) >= 0.5)
      .sort((a, b) => Math.abs(a.tdsPaise - book.tdsPaise) - Math.abs(b.tdsPaise - book.tdsPaise))[0];
    if (near) {
      usedRows.add(near.line);
      differs.push({ book, row: near, differencePaise: near.tdsPaise - book.tdsPaise });
    } else notIn26as.push(book);
  }
  const notInBooks = rows.filter((r) => !usedRows.has(r.line));
  const sum = (xs: Array<{ tdsPaise: number }>) => xs.reduce((s, x) => s + x.tdsPaise, 0);
  return {
    matched,
    differs,
    notIn26as,
    notInBooks,
    totals: {
      booksPaise: sum(books),
      in26asPaise: sum(rows),
      matchedPaise: sum(matched.map((m) => m.book)),
      /** Deducted from us but not credited: ask the customer to deposit and file it. */
      atRiskPaise: sum(notIn26as) + differs.reduce((s, d) => s + Math.max(0, -d.differencePaise), 0),
    },
  };
}
