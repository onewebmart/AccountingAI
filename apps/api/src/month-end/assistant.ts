import { ASSET_HSN, AssetCategory } from './depreciation';

/**
 * The month-end assistant's rules. Pure: given the month's bills and the
 * months before, it says what usually needs adjusting before the books
 * close, each with its reason and its figures. It proposes; a person decides.
 */

export interface BillFact {
  billId: string;
  vendorId: string;
  vendorName: string;
  number: string | null;
  date: string;
  taxablePaise: number;
  /** Where its value was debited: the expense or asset account, and that account's type. */
  accountId: string | null;
  accountName: string | null;
  accountType: 'EXPENSE' | 'ASSETS' | 'OTHER' | null;
  lines: Array<{ description: string; hsnSac: string | null; amountPaise: number }>;
  isReverseCharge: boolean;
}

export interface AccrualCandidate {
  vendorId: string;
  vendorName: string;
  amountPaise: number;
  accountId: string;
  accountName: string;
  months: string[];
  reason: string;
}

const prevPeriods = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 2 - i, 1)).toISOString().slice(0, 7));
};

/**
 * A vendor billed every one of the last three months, for about the same,
 * and has not billed this month: the expense is the month's all the same.
 */
export function missingRecurringBills(period: string, bills: BillFact[]): AccrualCandidate[] {
  const months = prevPeriods(period, 3);
  const byVendor = new Map<string, BillFact[]>();
  for (const b of bills) if (!b.isReverseCharge) byVendor.set(b.vendorId, [...(byVendor.get(b.vendorId) ?? []), b]);
  const out: AccrualCandidate[] = [];
  for (const [vendorId, vb] of byVendor) {
    if (vb.some((b) => b.date.startsWith(period))) continue;
    const perMonth = months.map((m) => vb.filter((b) => b.date.startsWith(m)));
    if (perMonth.some((x) => x.length !== 1)) continue;
    const amounts = perMonth.map((x) => x[0].taxablePaise);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (mean <= 0 || amounts.some((a) => Math.abs(a - mean) > mean * 0.25)) continue;
    const latest = perMonth[0][0];
    if (!latest.accountId || latest.accountType !== 'EXPENSE') continue;
    const amount = Math.round(mean);
    out.push({
      vendorId,
      vendorName: latest.vendorName,
      amountPaise: amount,
      accountId: latest.accountId,
      accountName: latest.accountName ?? 'Expense',
      months: [...months].reverse(),
      reason: `${latest.vendorName} billed in each of ${[...months].reverse().join(', ')} (about ₹${(amount / 100).toFixed(2)} a month, to ${latest.accountName}) but not yet in ${period}. Accrue the month's cost; it reverses on the 1st, when the bill is booked.`,
    });
  }
  return out;
}

const ANNUAL = /\b(annual|yearly|per annum|p\.a\.|12 months|one year|1 year|subscription|renewal|amc|insurance)\b/i;
/** Below this, spreading an annual cost is more work than it is worth. */
export const PREPAID_MIN_PAISE = 12_000_00;
/** A common capitalisation floor for SMEs; below it, kept as an expense. */
export const CAPITALISE_MIN_PAISE = 10_000_00;

export interface PrepaidCandidate {
  billId: string;
  vendorName: string;
  description: string;
  amountPaise: number;
  accountId: string;
  accountName: string;
  reason: string;
}

/** A year's cost booked in one month: spread it over the months it covers. */
export function annualCosts(period: string, bills: BillFact[]): PrepaidCandidate[] {
  const out: PrepaidCandidate[] = [];
  for (const b of bills) {
    if (!b.date.startsWith(period) || b.accountType !== 'EXPENSE' || !b.accountId) continue;
    const text = [b.vendorName, ...b.lines.map((l) => l.description)].join(' ');
    if (!ANNUAL.test(text) || b.taxablePaise < PREPAID_MIN_PAISE) continue;
    const description = b.lines.find((l) => ANNUAL.test(l.description))?.description ?? b.lines[0]?.description ?? b.vendorName;
    out.push({
      billId: b.billId,
      vendorName: b.vendorName,
      description,
      amountPaise: b.taxablePaise,
      accountId: b.accountId,
      accountName: b.accountName ?? 'Expense',
      reason: `"${description}" from ${b.vendorName} (₹${(b.taxablePaise / 100).toFixed(2)}) looks like a year's cost, all booked to ${b.accountName} in ${period}. Keep this month's twelfth as expense and spread the rest over the next eleven.`,
    });
  }
  return out;
}

export interface CapitaliseCandidate {
  billId: string;
  vendorName: string;
  date: string;
  description: string;
  hsnSac: string;
  amountPaise: number;
  category: AssetCategory;
  accountId: string;
  accountName: string;
  reason: string;
}

/** Something kept for years (by its HSN), over the floor, sitting in an expense. */
export function capitalCandidates(period: string, bills: BillFact[]): CapitaliseCandidate[] {
  const out: CapitaliseCandidate[] = [];
  for (const b of bills) {
    if (!b.date.startsWith(period) || b.accountType !== 'EXPENSE' || !b.accountId) continue;
    for (const l of b.lines) {
      const hsn = (l.hsnSac ?? '').replace(/\s/g, '');
      const match = ASSET_HSN.find((h) => hsn.startsWith(h.prefix));
      if (!match || l.amountPaise < CAPITALISE_MIN_PAISE) continue;
      out.push({
        billId: b.billId,
        vendorName: b.vendorName,
        date: b.date,
        description: l.description,
        hsnSac: hsn,
        amountPaise: l.amountPaise,
        category: match.category,
        accountId: b.accountId,
        accountName: b.accountName ?? 'Expense',
        reason: `"${l.description}" (HSN ${hsn}, ₹${(l.amountPaise / 100).toFixed(2)}) from ${b.vendorName} is the kind of thing kept for years, but it was booked to ${b.accountName}. Capitalise it and depreciate it.`,
      });
    }
  }
  return out;
}
