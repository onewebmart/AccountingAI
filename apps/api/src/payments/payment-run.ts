/**
 * Which bills to pay in a run, in what order, and why. Pure, in integer
 * paise. The person picks from it; nothing is paid by this.
 *
 * Order: MSME bills past their 43B(h) day, then MSME bills whose day falls
 * by the pay date, then other overdue bills, then those due by the pay date.
 * Within each, the earliest date first. A cash limit stops the run where the
 * money does.
 */

export interface PayableBill {
  billId: string;
  vendorId: string;
  vendorName: string;
  billNumber: string | null;
  billDate: string;
  dueDate: string | null;
  owedPaise: number;
  /** The 43B(h) last day for a micro or small vendor; null otherwise. */
  msmePayBy: string | null;
  hasBankAccount: boolean;
}

export type RunPriority = 'msme_late' | 'msme_due' | 'overdue' | 'due';

export interface RunCandidate extends PayableBill {
  priority: RunPriority;
  reason: string;
  /** Inside the cash limit. */
  included: boolean;
}

const RANK: Record<RunPriority, number> = { msme_late: 0, msme_due: 1, overdue: 2, due: 3 };
const shortDate = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

export function suggestRun(bills: PayableBill[], input: { today: string; payOn: string; cashLimitPaise?: number | null }): { candidates: RunCandidate[]; includedPaise: number } {
  const ranked: RunCandidate[] = [];
  for (const b of bills) {
    if (b.owedPaise <= 0) continue;
    const due = b.dueDate ?? b.billDate;
    let priority: RunPriority | null = null;
    let reason = '';
    if (b.msmePayBy && b.msmePayBy < input.today) {
      priority = 'msme_late';
      reason = `MSME vendor: the 43B(h) day was ${shortDate(b.msmePayBy)}. Paying now limits the damage to this year's deduction.`;
    } else if (b.msmePayBy && b.msmePayBy <= input.payOn) {
      priority = 'msme_due';
      reason = `MSME vendor: pay by ${shortDate(b.msmePayBy)} to keep the expense deductible this year (43B(h)).`;
    } else if (due < input.today) {
      priority = 'overdue';
      reason = `Overdue since ${shortDate(due)}.`;
    } else if (due <= input.payOn) {
      priority = 'due';
      reason = `Due ${shortDate(due)}.`;
    }
    if (!priority) continue;
    if (!b.hasBankAccount) reason += ' No bank account on file for this vendor: add one, or pay another way.';
    ranked.push({ ...b, priority, reason, included: false });
  }
  ranked.sort(
    (a, b) =>
      RANK[a.priority] - RANK[b.priority] ||
      (a.msmePayBy ?? a.dueDate ?? a.billDate).localeCompare(b.msmePayBy ?? b.dueDate ?? b.billDate) ||
      b.owedPaise - a.owedPaise,
  );

  // Within the limit, highest priority first. A bill that does not fit is
  // left out whole: a run pays bills, not parts of them.
  let left = input.cashLimitPaise ?? Number.POSITIVE_INFINITY;
  let includedPaise = 0;
  for (const c of ranked) {
    if (c.owedPaise <= left) {
      c.included = true;
      left -= c.owedPaise;
      includedPaise += c.owedPaise;
    }
  }
  return { candidates: ranked, includedPaise };
}

/**
 * A bulk-payment file most Indian banks' corporate portals take in some
 * form: one row per vendor, totalled across their bills in the run. Banks'
 * templates differ, so check yours before uploading.
 */
export function bankFileCsv(rows: Array<{ vendorName: string; accountName: string | null; accountNumber: string; ifsc: string; amountPaise: number; narration: string }>): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ['Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Narration'];
  const body = rows.map((r) =>
    [r.accountName || r.vendorName, r.accountNumber, r.ifsc, (r.amountPaise / 100).toFixed(2), r.narration.slice(0, 30)].map(cell).join(','),
  );
  return [header.join(','), ...body].join('\r\n') + '\r\n';
}
