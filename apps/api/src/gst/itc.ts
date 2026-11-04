import { TaxHeads, ZERO_HEADS, addHeads } from './gst-returns';

/**
 * Input tax credit, by the rules that decide when it may be claimed. Pure:
 * the service hands it bills and GSTR-2B lines; nothing here reads or writes.
 *
 * - Credit only for what the supplier reported: a bill's GST is claimed in
 *   the first month whose GSTR-2B carries it, at the lower of the two
 *   amounts (section 16(2)(aa), rule 36(4)). A month for which no 2B was
 *   imported falls back to claiming its bills by date, as before, with a
 *   warning; such a bill is then never claimed again.
 * - Rule 37: credit on a bill not paid within 180 days of its date is
 *   reversed, in proportion to what is unpaid, in the return for the month
 *   after the 180 days end, and claimed again in the month it is paid.
 */

export interface BillForItc {
  id: string;
  number: string | null;
  vendorName: string;
  vendorGstin: string | null;
  /** YYYY-MM-DD */
  billDate: string;
  isReverseCharge: boolean;
  /** Its GST, and its taxable value, as booked. */
  heads: TaxHeads;
  totalPaise: number;
  /** TDS withheld: counts as paid. */
  tdsPaise: number;
  /** Money paid and notes taken off, each dated. */
  settlements: Array<{ date: string; amountPaise: number }>;
}

export interface Line2bForItc {
  id: string;
  /** YYYY-MM: the 2B it came in. */
  period: string;
  gstin: string | null;
  supplierName: string | null;
  number: string | null;
  date: string | null;
  isReverseCharge: boolean;
  heads: TaxHeads;
}

export interface Match {
  billId: string;
  lineId: string;
  period: string;
  /** The bill's own month had no 2B: it was claimed by date, so this match claims nothing. */
  claimedByDate: boolean;
}

const tax = (h: TaxHeads) => h.iamt + h.camt + h.samt + h.csamt;
export const periodOf = (date: string) => date.slice(0, 7);
const lastDay = (period: string) => `${period}-31`;

/** "INV/0045", "inv-45" and "INV 45" are one invoice: case, punctuation and leading zeros dropped. */
export function normaliseInvoiceNumber(n: string | null): string {
  return (n ?? '')
    .toUpperCase()
    // Zeros leading any run of digits, before the punctuation that marks the runs goes.
    .replace(/(^|[^0-9])0+(?=\d)/g, '$1')
    .replace(/[^A-Z0-9]/g, '');
}

export const normaliseGstin = (g: string | null) => (g ?? '').trim().toUpperCase();

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Pairs 2B lines with bills, month by month in order, each bill at most
 * once: same supplier GSTIN, same invoice number once normalised, the bill
 * dated no later than the 2B month. Reverse-charge lines are left alone:
 * that credit comes from paying the tax, not from the supplier's return.
 */
export function match2b(lines: Line2bForItc[], bills: BillForItc[], periodsWith2b: Set<string>): Match[] {
  const byKey = new Map<string, BillForItc[]>();
  for (const b of bills) {
    if (b.isReverseCharge || !b.vendorGstin || !b.number) continue;
    const key = `${normaliseGstin(b.vendorGstin)}|${normaliseInvoiceNumber(b.number)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), b]);
  }
  const taken = new Set<string>();
  const matches: Match[] = [];
  const ordered = [...lines].sort((a, b) => a.period.localeCompare(b.period) || a.id.localeCompare(b.id));
  for (const line of ordered) {
    if (line.isReverseCharge || !line.gstin || !line.number) continue;
    const candidates = (byKey.get(`${normaliseGstin(line.gstin)}|${normaliseInvoiceNumber(line.number)}`) ?? []).filter(
      (b) => !taken.has(b.id) && b.billDate <= lastDay(line.period),
    );
    if (candidates.length === 0) continue;
    // Several bills under one number (a vendor reusing numbers across years): the closest in amount.
    const bill = candidates.sort((a, b) => Math.abs(tax(a.heads) - tax(line.heads)) - Math.abs(tax(b.heads) - tax(line.heads)))[0];
    taken.add(bill.id);
    matches.push({ billId: bill.id, lineId: line.id, period: line.period, claimedByDate: !periodsWith2b.has(periodOf(bill.billDate)) });
  }
  return matches;
}

const minHeads = (a: TaxHeads, b: TaxHeads): TaxHeads => ({
  txval: Math.min(a.txval, b.txval),
  iamt: Math.min(a.iamt, b.iamt),
  camt: Math.min(a.camt, b.camt),
  samt: Math.min(a.samt, b.samt),
  csamt: Math.min(a.csamt, b.csamt),
});

const scale = (h: TaxHeads, num: number, den: number): TaxHeads =>
  den <= 0
    ? { ...ZERO_HEADS }
    : {
        txval: Math.round((h.txval * num) / den),
        iamt: Math.round((h.iamt * num) / den),
        camt: Math.round((h.camt * num) / den),
        samt: Math.round((h.samt * num) / den),
        csamt: Math.round((h.csamt * num) / den),
      };

export interface Claim {
  billId: string;
  period: string;
  heads: TaxHeads;
  /** 'twoB': the supplier reported it; 'date': no 2B for its month, claimed by its date. */
  basis: 'twoB' | 'date';
}

/** When each bill's credit is claimed, and how much. Bills never in a 2B, in a month that had one, are not claimed. */
export function claims(lines: Line2bForItc[], bills: BillForItc[], periodsWith2b: Set<string>): Map<string, Claim> {
  const out = new Map<string, Claim>();
  const lineById = new Map(lines.map((l) => [l.id, l]));
  for (const b of bills) {
    if (b.isReverseCharge || tax(b.heads) === 0) continue;
    if (!periodsWith2b.has(periodOf(b.billDate))) out.set(b.id, { billId: b.id, period: periodOf(b.billDate), heads: b.heads, basis: 'date' });
  }
  for (const m of match2b(lines, bills, periodsWith2b)) {
    if (m.claimedByDate) continue;
    const bill = bills.find((b) => b.id === m.billId)!;
    if (tax(bill.heads) === 0) continue;
    out.set(bill.id, { billId: bill.id, period: m.period, heads: minHeads(bill.heads, lineById.get(m.lineId)!.heads), basis: 'twoB' });
  }
  return out;
}

export interface Rule37Row {
  billId: string;
  number: string | null;
  vendorName: string;
  billDate: string;
  /** The 180th day: pay by then to keep the credit. */
  payBy: string;
  unpaidPaise: number;
  heads: TaxHeads;
}

/** What was still owed at the end of a day: TDS and notes count as paid. */
export function unpaidOn(bill: BillForItc, date: string): number {
  const paid = bill.tdsPaise + bill.settlements.filter((s) => s.date <= date).reduce((s, x) => s + x.amountPaise, 0);
  return Math.max(0, bill.totalPaise - paid);
}

/** Rule 37 for one month: credit to reverse, and credit claimed again on late payment. */
export function rule37(period: string, bills: BillForItc[], claimed: Map<string, Claim>): { reversed: Rule37Row[]; reclaimed: Rule37Row[] } {
  const reversed: Rule37Row[] = [];
  const reclaimed: Rule37Row[] = [];
  for (const b of bills) {
    const claim = claimed.get(b.id);
    if (!claim || b.isReverseCharge) continue;
    const payBy = addDays(b.billDate, 180);
    const reversalPeriod = nextPeriod(periodOf(payBy));
    // Only credit already taken can be reversed.
    if (claim.period > reversalPeriod) continue;
    const unpaid = unpaidOn(b, payBy);
    if (unpaid === 0) continue;
    const row = (heads: TaxHeads, unpaidPaise: number): Rule37Row => ({ billId: b.id, number: b.number, vendorName: b.vendorName, billDate: b.billDate, payBy, unpaidPaise, heads });
    if (period === reversalPeriod) reversed.push(row(scale(claim.heads, unpaid, b.totalPaise), unpaid));
    // Paid late: claimed again in the month of payment, never before the reversal.
    const late = b.settlements
      .filter((s) => s.date > payBy && (s.date.slice(0, 7) > reversalPeriod ? periodOf(s.date) : reversalPeriod) === period)
      .reduce((s, x) => s + x.amountPaise, 0);
    const before = b.settlements
      .filter((s) => s.date > payBy && (s.date.slice(0, 7) > reversalPeriod ? periodOf(s.date) : reversalPeriod) < period)
      .reduce((s, x) => s + x.amountPaise, 0);
    const back = Math.min(late, Math.max(0, unpaid - before));
    if (back > 0) reclaimed.push(row(scale(claim.heads, back, b.totalPaise), back));
  }
  return { reversed, reclaimed };
}

export const sumRows = (rows: Array<{ heads: TaxHeads }>): TaxHeads => rows.reduce((acc, r) => addHeads(acc, r.heads), { ...ZERO_HEADS });

/** Bills whose 180 days end within `days` of today, or already have, with credit at stake. */
export function rule37Watchlist(asOf: string, bills: BillForItc[], claimed: Map<string, Claim>, days = 30): Array<Rule37Row & { daysLeft: number }> {
  const horizon = addDays(asOf, days);
  const out: Array<Rule37Row & { daysLeft: number }> = [];
  for (const b of bills) {
    const claim = claimed.get(b.id);
    if (!claim || b.isReverseCharge) continue;
    const payBy = addDays(b.billDate, 180);
    if (payBy > horizon) continue;
    const unpaid = unpaidOn(b, asOf);
    if (unpaid === 0) continue;
    const daysLeft = Math.round((Date.parse(`${payBy}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
    out.push({ billId: b.id, number: b.number, vendorName: b.vendorName, billDate: b.billDate, payBy, unpaidPaise: unpaid, heads: scale(claim.heads, unpaid, b.totalPaise), daysLeft });
  }
  return out.sort((a, b) => a.payBy.localeCompare(b.payBy));
}
