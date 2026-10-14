/**
 * Reads a bank statement out of the text of a PDF.
 *
 * Banks lay their statements out differently, but nearly all print a running
 * balance on every line. So the parser does not guess which column is which.
 * Each line's movement is the change in balance from the line before; the
 * amount printed on the line must match it, and the sign says whether money
 * went out or came in. A statement whose lines do not add up that way is not
 * read at all: half-right bank lines are worse than none.
 *
 * Pure functions, in integer paise (Invariant 1).
 */

export interface StatementLineOut {
  date: string;
  description: string;
  reference: string | null;
  debitPaise: number;
  creditPaise: number;
  runningBalancePaise: number | null;
}

export interface ParsedStatement {
  openingBalancePaise: number;
  closingBalancePaise: number;
  lines: StatementLineOut[];
  accountNumber: string | null;
  bankName: string | null;
}

export type ParseOutcome = { ok: true; statement: ParsedStatement } | { ok: false; reason: string };

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** A date at the start of a line: 01/09/2026, 01-09-26, 01.09.2026, 01-Sep-2026, 1 Sep 2026. */
const LEADING_DATE = /^(?:(\d{1,2})([/.-])(\d{1,2}|[A-Za-z]{3})\2(\d{4}|\d{2})|(\d{1,2}) ([A-Za-z]{3}) (\d{4}))\b/;
/** Any date in the line (value dates too), stripped before amounts are read: 01.09.26 is not ₹1.09. */
const ANY_DATE = /\b\d{1,2}([/.-])(?:\d{1,2}|[A-Za-z]{3})\1(?:\d{4}|\d{2})\b|\b\d{1,2} [A-Za-z]{3} \d{4}\b/g;
const HAS_AMOUNT = /(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}(?!\d)/;
/** 1,23,456.78 or 123456.78, optionally followed by Cr/Dr. */
const AMOUNT = /(?<![\d.,])(-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})(?![\d])(?:\s*(Cr|Dr|CR|DR)\b)?/g;

const BANKS = [
  'HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank', 'Yes Bank', 'IndusInd Bank',
  'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India', 'IDFC FIRST Bank', 'Federal Bank',
  'Bank of India', 'Indian Bank', 'Central Bank of India', 'AU Small Finance Bank', 'RBL Bank', 'IDBI Bank',
];

function isoDate(d: string, m: string, y: string): string | null {
  const month = /^\d+$/.test(m) ? m.padStart(2, '0') : MONTHS[m.toLowerCase()];
  if (!month || Number(month) < 1 || Number(month) > 12) return null;
  const day = Number(d);
  if (day < 1 || day > 31) return null;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function toPaise(amount: string, marker?: string): number {
  const negative = amount.startsWith('-') || marker?.toLowerCase() === 'dr';
  const [whole, fraction] = amount.replace(/[-,]/g, '').split('.');
  const paise = Number(whole) * 100 + Number(fraction);
  return negative ? -paise : paise;
}

/** Whether OCR'd text is a bank statement rather than an invoice or bill. */
export function looksLikeBankStatement(text: string): boolean {
  let score = 0;
  if (/statement of account|account statement|bank statement|statement for (the )?period/i.test(text)) score += 2;
  if (/opening balance/i.test(text)) score += 1;
  if (/closing balance/i.test(text)) score += 1;
  if (/\b(withdrawals?|debits?)\b/i.test(text) && /\b(deposits?|credits?)\b/i.test(text)) score += 1;
  if (/\bbalance\b/i.test(text)) score += 1;
  // Invoices talk about tax; statements rarely do.
  if (/\b(tax invoice|invoice no|gstin of (the )?(buyer|recipient)|hsn|place of supply)\b/i.test(text)) score -= 2;
  const datedRows = text
    .split(/\r?\n/)
    .filter((l) => LEADING_DATE.test(l.trim()) && HAS_AMOUNT.test(l.trim().replace(ANY_DATE, ' '))).length;
  if (datedRows >= 3) score += 2;
  // A supplier's ledger statement looks just like this; only a bank's has a bank on it.
  const fromABank =
    BANKS.some((bank) => text.toLowerCase().includes(bank.toLowerCase())) ||
    /\b[A-Z]{4}0[A-Z0-9]{6}\b/.test(text) ||
    /\b(IFSC|MICR)\b|\bbranch\b/i.test(text);
  return fromABank && score >= 4 && datedRows >= 2;
}

function amountsIn(text: string): Array<{ paise: number; index: number }> {
  const out: Array<{ paise: number; index: number }> = [];
  for (const m of text.replace(ANY_DATE, ' ').matchAll(AMOUNT)) out.push({ paise: toPaise(m[1], m[2]), index: m.index ?? 0 });
  return out;
}

/** Narration words that say which way money moved, for the one line the balance cannot settle. */
function directionHint(text: string): 'out' | 'in' | null {
  if (/\b(dr|debit|wdl|withdrawal|atm|pos|chrgs?|charges?|to transfer|upi\/dr|neft dr|imps dr)\b/i.test(text)) return 'out';
  if (/\b(cr|credit|deposit|by transfer|upi\/cr|neft cr|imps cr|int\.?\s?pd|interest)\b/i.test(text)) return 'in';
  return null;
}

/** Turns statement text into lines that add up, or says why it could not. */
export function parseStatementText(text: string): ParseOutcome {
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const opening = text.match(/opening balance[^\d\n-]{0,20}(-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*(Cr|Dr|CR|DR)?/i);
  let openingPaise: number | null = opening ? toPaise(opening[1], opening[2]) : null;

  // Group physical lines into transactions: a dated line starts one; undated
  // lines after it continue its narration (statements wrap long ones).
  const rows: Array<{ date: string; text: string }> = [];
  for (const line of rawLines) {
    const m = line.match(LEADING_DATE);
    const date = m ? (m[1] ? isoDate(m[1], m[3], m[4]) : isoDate(m[5], m[6], m[7])) : null;
    if (date) {
      rows.push({ date, text: line.slice(m![0].length).trim() });
    } else if (rows.length && !/page \d+ (of|\/) \d+|^-+ ?\d+ of \d+ ?-+$|closing balance|opening balance|statement summary/i.test(line)) {
      // (pdf.js marks page breaks "-- 1 of 3 --"; those are not narration.)
      rows[rows.length - 1].text += ` ${line}`;
    }
  }

  const lines: StatementLineOut[] = [];
  let previous = openingPaise;
  for (const row of rows) {
    const amounts = amountsIn(row.text);
    if (amounts.length === 0) continue; // a dated heading or note, not a transaction
    const balance = amounts[amounts.length - 1].paise;
    const movements = amounts.slice(0, -1).map((a) => Math.abs(a.paise)).filter((p) => p > 0);

    // An "opening balance" or "B/F" row carries only the balance.
    if (movements.length === 0) {
      if (/opening|b\/f|brought forward/i.test(row.text) && lines.length === 0) {
        openingPaise = balance;
        previous = balance;
        continue;
      }
      return { ok: false, reason: `The line dated ${row.date} shows a balance but no amount.` };
    }

    let debit = 0;
    let credit = 0;
    if (previous !== null) {
      const delta = balance - previous;
      if (!movements.includes(Math.abs(delta))) {
        return {
          ok: false,
          reason: `The line dated ${row.date} does not add up: the balance moved by ${(delta / 100).toFixed(2)} but the line shows ${movements.map((p) => (p / 100).toFixed(2)).join(' / ')}.`,
        };
      }
      if (delta < 0) debit = -delta;
      else credit = delta;
    } else {
      // The first line, with no opening balance printed: its narration decides.
      const hint = directionHint(row.text);
      if (!hint || movements.length !== 1) {
        return { ok: false, reason: 'No opening balance is printed, and the first line does not say which way its money moved.' };
      }
      if (hint === 'out') debit = movements[0];
      else credit = movements[0];
      openingPaise = balance + debit - credit;
    }
    previous = balance;

    // A UTR or RRN: the long all-digit number most rails print.
    const reference = row.text.match(/\b\d{10,18}\b/)?.[0] ?? null;
    const description = row.text.replace(ANY_DATE, ' ').replace(AMOUNT, ' ').replace(/\s+/g, ' ').trim() || 'Bank transaction';
    lines.push({ date: row.date, description, reference, debitPaise: debit, creditPaise: credit, runningBalancePaise: balance });
  }

  if (lines.length === 0 || openingPaise === null) return { ok: false, reason: 'No transaction lines with a balance were found.' };

  const closingPaise = lines[lines.length - 1].runningBalancePaise!;
  const closing = text.match(/closing balance[^\d\n-]{0,20}(-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*(Cr|Dr|CR|DR)?/i);
  if (closing && toPaise(closing[1], closing[2]) !== closingPaise) {
    return {
      ok: false,
      reason: `The printed closing balance ${closing[1]} is not what the lines add up to (${(closingPaise / 100).toFixed(2)}): a page may be missing.`,
    };
  }

  return {
    ok: true,
    statement: {
      openingBalancePaise: openingPaise,
      closingBalancePaise: closingPaise,
      lines,
      accountNumber: accountNumberIn(text),
      bankName: BANKS.find((b) => text.toLowerCase().includes(b.toLowerCase())) ?? null,
    },
  };
}

/** The account number printed on a statement, masked digits kept as X. */
export function accountNumberIn(text: string): string | null {
  const m = text.match(/(?:a\/c|account)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([X*\d][X*\d -]{5,24}\d)/i);
  if (!m) return null;
  const cleaned = m[1].replace(/[\s-]/g, '').replace(/\*/g, 'X');
  return /\d{4}$/.test(cleaned) ? cleaned : null;
}

/**
 * Checks a statement read some other way (by the model): opening plus every
 * movement must reach the closing balance, and every printed balance must
 * follow from the one before.
 */
export function statementAddsUp(s: Pick<ParsedStatement, 'openingBalancePaise' | 'closingBalancePaise' | 'lines'>): string | null {
  let balance = s.openingBalancePaise;
  for (const line of s.lines) {
    if (!Number.isInteger(line.debitPaise) || !Number.isInteger(line.creditPaise) || line.debitPaise < 0 || line.creditPaise < 0) {
      return `The line dated ${line.date} has an amount that is not whole paise.`;
    }
    if ((line.debitPaise > 0) === (line.creditPaise > 0)) return `The line dated ${line.date} must be either money in or money out.`;
    balance += line.creditPaise - line.debitPaise;
    if (line.runningBalancePaise !== null && line.runningBalancePaise !== balance) {
      return `The balance after the line dated ${line.date} should be ${(balance / 100).toFixed(2)}, not ${(line.runningBalancePaise / 100).toFixed(2)}.`;
    }
  }
  if (balance !== s.closingBalancePaise) {
    return `Opening balance plus the lines comes to ${(balance / 100).toFixed(2)}, not the closing ${(s.closingBalancePaise / 100).toFixed(2)}.`;
  }
  return null;
}
