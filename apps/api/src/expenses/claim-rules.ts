import { blockedItc } from '../proposals/checks/bill-checks';

/**
 * Expense claims: the policy checks each line, and the journal a claim
 * posts. Pure; every figure is computed here.
 */

export interface ClaimLine {
  date: string;
  kind: 'expense' | 'mileage';
  merchant: string | null;
  description: string;
  expenseAccountId: string;
  /** What was paid, GST included. */
  amountPaise: number;
  /** GST on the receipt, if any. */
  gstPaise: number;
  merchantGstin: string | null;
  hsnSac: string | null;
  km: number | null;
  hasReceipt: boolean;
}

export interface ExpenseRules {
  receiptRequiredAbovePaise: number;
  lineLimitPaise: number | null;
  mileageRatePaise: number;
}

export interface Flag {
  line: number;
  code: 'no_receipt' | 'over_limit' | 'weekend' | 'duplicate' | 'blocked_itc' | 'no_gstin';
  message: string;
}

const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whether this line's GST can be claimed as input credit, and why not. */
export function itcOf(l: ClaimLine): { itcPaise: number; why: Flag['code'] | null; message: string | null } {
  if (l.kind !== 'expense' || l.gstPaise <= 0) return { itcPaise: 0, why: null, message: null };
  if (!l.merchantGstin) return { itcPaise: 0, why: 'no_gstin', message: "No GSTIN for the merchant: the GST can't be claimed, so it is booked as part of the expense." };
  const blocked = blockedItc({ vendorName: l.merchant, lines: [{ description: l.description, hsnSac: l.hsnSac }], gstPaise: l.gstPaise });
  if (blocked.length) return { itcPaise: 0, why: 'blocked_itc', message: `${blocked[0].message} It is booked as part of the expense.` };
  return { itcPaise: l.gstPaise, why: null, message: null };
}

export function checkLines(lines: ClaimLine[], rules: ExpenseRules, earlier: Array<{ date: string; amountPaise: number; merchant: string | null; claimNumber: string }>): Flag[] {
  const flags: Flag[] = [];
  const key = (d: string, a: number, m: string | null) => `${d}|${a}|${(m ?? '').trim().toLowerCase()}`;
  const seen = new Map<string, number>();
  lines.forEach((l, i) => {
    const at = `Line ${i + 1}`;
    if (l.kind === 'expense' && !l.hasReceipt && l.amountPaise > rules.receiptRequiredAbovePaise) {
      flags.push({ line: i, code: 'no_receipt', message: `${at}: ${rs(l.amountPaise)} with no receipt; the policy wants one above ${rs(rules.receiptRequiredAbovePaise)}.` });
    }
    if (rules.lineLimitPaise != null && l.amountPaise > rules.lineLimitPaise) {
      flags.push({ line: i, code: 'over_limit', message: `${at}: ${rs(l.amountPaise)} is over the ${rs(rules.lineLimitPaise)} limit for one item.` });
    }
    const day = new Date(`${l.date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) flags.push({ line: i, code: 'weekend', message: `${at}: dated on a ${day === 0 ? 'Sunday' : 'Saturday'}.` });
    if (l.kind === 'expense') {
      const k = key(l.date, l.amountPaise, l.merchant);
      const dup = earlier.find((e) => key(e.date, e.amountPaise, e.merchant) === k);
      if (dup) flags.push({ line: i, code: 'duplicate', message: `${at}: the same receipt (date, amount, merchant) is on claim ${dup.claimNumber}.` });
      else if (seen.has(k)) flags.push({ line: i, code: 'duplicate', message: `${at}: the same receipt as line ${seen.get(k)! + 1}.` });
      seen.set(k, i);
    }
    const itc = itcOf(l);
    if (itc.why) flags.push({ line: i, code: itc.why, message: `${at}: ${itc.message}` });
  });
  return flags;
}

/**
 * The claim's journal: each expense account its amount less the GST that can
 * be claimed; that GST to input credit (CGST and SGST within the state, else
 * IGST); and the whole to Employee Reimbursements Payable.
 */
export function claimJournal(lines: ClaimLine[], orgState: string | null) {
  const expense = new Map<string, number>();
  const itc = { cgst: 0, sgst: 0, igst: 0 };
  let total = 0;
  for (const l of lines) {
    const { itcPaise } = itcOf(l);
    expense.set(l.expenseAccountId, (expense.get(l.expenseAccountId) ?? 0) + l.amountPaise - itcPaise);
    total += l.amountPaise;
    if (itcPaise > 0) {
      if (orgState && l.merchantGstin?.slice(0, 2) === orgState) {
        const half = Math.round(itcPaise / 2);
        itc.cgst += half;
        itc.sgst += itcPaise - half;
      } else itc.igst += itcPaise;
    }
  }
  return { expense, itc, total };
}
