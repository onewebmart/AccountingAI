/**
 * The preview of a sales document's figures, worked out the way the server
 * works them out (apps/api/src/orders/doc-lines.ts): a discount before tax,
 * spread over the lines in proportion and rounded to the paisa, the last line
 * taking what is left; GST per line on its discounted value, halved within a
 * state; an adjustment after tax, at most ₹99.99 either way. The server's
 * figures are the ones stored.
 */
import { parseRupees } from '@/lib/money';
import type { Amounts } from './sales-data';

/** The most an adjustment may move a total, either way, in paise: ₹99.99. */
export const ADJUSTMENT_LIMIT_PAISE = 9_999;

export type DiscountMode = 'percent' | 'amount';

/** Shares of a discount, as the server spreads it. */
export function spreadDiscount(amounts: number[], discount: number): number[] {
  if (amounts.length === 0) return [];
  const sum = amounts.reduce((s, a) => s + Math.max(0, a), 0);
  if (discount <= 0 || sum <= 0) return amounts.map(() => 0);
  const shares = amounts.map((a, i) => (i === amounts.length - 1 ? 0 : Math.round((discount * Math.max(0, a)) / sum)));
  shares[shares.length - 1] = discount - shares.reduce((s, x) => s + x, 0);
  if (shares.every((s, i) => s >= 0 && s <= Math.max(0, amounts[i]))) return shares;
  const raw = amounts.map((a) => (Math.max(0, a) * discount) / sum);
  const parts = raw.map(Math.floor);
  let left = discount - parts.reduce((s, p) => s + p, 0);
  for (const [, i] of raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

export interface Pricing {
  subTotalPaise: number;
  discountPaise: number;
  /** As the API takes it, or null for none. */
  discount: { percent: number } | { amountPaise: number } | null;
  discountProblem: string | null;
  /** Each line's share of the discount, in the order given. */
  shares: number[];
  amounts: Amounts;
  adjustmentPaise: number;
  adjustmentProblem: string | null;
}

/**
 * One line's own discount as typed ("at line item level", on a bill): its
 * paise, or the problem with what was typed. A percent of the line to two
 * decimals, or rupees no more than the line.
 */
export function lineDiscountOf(grossPaise: number, mode: DiscountMode, text: string): { paise: number; asked: { percent: number } | { amountPaise: number } | null; problem: string | null } {
  const typed = text.trim();
  if (!typed) return { paise: 0, asked: null, problem: null };
  if (mode === 'percent') {
    const pct = Number(typed);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !/^\d+(\.\d{1,2})?$/.test(typed)) return { paise: 0, asked: null, problem: 'a percent from 0 to 100, to two decimals' };
    if (pct === 0) return { paise: 0, asked: null, problem: null };
    return { paise: Math.round((grossPaise * Math.round(pct * 100)) / 10_000), asked: { percent: pct }, problem: null };
  }
  const paise = parseRupees(typed);
  if (paise === null || paise < 0) return { paise: 0, asked: null, problem: 'an amount in rupees, like 150' };
  if (paise > grossPaise) return { paise: 0, asked: null, problem: 'more than the line comes to' };
  return { paise, asked: paise > 0 ? { amountPaise: paise } : null, problem: null };
}

/** The figures for lines of `gross` paise at their slabs, with the discount and adjustment as typed. */
export function previewPricing(
  lines: Array<{ grossPaise: number; taxRatePct: number; discount?: { mode: DiscountMode; value: string } }>,
  interState: boolean,
  opts: {
    discountMode?: DiscountMode;
    discount?: string;
    adjustment?: string;
    noTax?: boolean;
    /** Each line's own discount instead of one on the whole document (a bill's "at line item level"). */
    lineLevel?: boolean;
  } = {},
): Pricing {
  const gross = lines.map((l) => l.grossPaise);
  const subTotalPaise = gross.reduce((s, a) => s + a, 0);
  let discountPaise = 0;
  let discount: Pricing['discount'] = null;
  let discountProblem: string | null = null;
  const typed = opts.lineLevel ? '' : (opts.discount ?? '').trim();
  let lineShares: number[] | null = null;
  if (opts.lineLevel) {
    lineShares = lines.map((l, i) => {
      const d = lineDiscountOf(l.grossPaise, l.discount?.mode ?? 'percent', l.discount?.value ?? '');
      if (d.problem && !discountProblem) discountProblem = `Line ${i + 1}: ${d.problem}.`;
      return d.paise;
    });
    discountPaise = lineShares.reduce((s, x) => s + x, 0);
  }
  if (typed) {
    if (opts.discountMode === 'percent') {
      const pct = Number(typed);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !/^\d+(\.\d{1,2})?$/.test(typed)) discountProblem = 'A percent from 0 to 100, to two decimals.';
      else if (pct > 0) {
        discountPaise = Math.round((subTotalPaise * Math.round(pct * 100)) / 10_000);
        discount = { percent: pct };
      }
    } else {
      const paise = parseRupees(typed);
      if (paise === null || paise < 0) discountProblem = 'An amount in rupees, like 150.';
      else if (paise > subTotalPaise) discountProblem = 'More than the lines come to.';
      else if (paise > 0) {
        discountPaise = paise;
        discount = { amountPaise: paise };
      }
    }
  }
  const shares = lineShares ?? spreadDiscount(gross, discountPaise);
  const amounts: Amounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  lines.forEach((l, i) => {
    const taxable = l.grossPaise - shares[i];
    const tax = opts.noTax ? 0 : Math.round((taxable * (l.taxRatePct || 0)) / 100);
    amounts.taxableValue += taxable;
    if (interState) amounts.igst += tax;
    else {
      const half = Math.round(tax / 2);
      amounts.cgst += half;
      amounts.sgst += tax - half;
    }
  });
  amounts.total = amounts.taxableValue + amounts.cgst + amounts.sgst + amounts.igst;
  let adjustmentPaise = 0;
  let adjustmentProblem: string | null = null;
  const adj = (opts.adjustment ?? '').trim();
  if (adj && adj !== '-') {
    const paise = parseRupees(adj);
    if (paise === null) adjustmentProblem = 'An amount in rupees, like -0.40 or 0.60.';
    else if (Math.abs(paise) > ADJUSTMENT_LIMIT_PAISE) adjustmentProblem = 'At most ₹99.99 either way. To take value off, give a discount.';
    else if (amounts.total + paise <= 0 && paise !== 0) adjustmentProblem = 'It cannot bring the total to nothing.';
    else adjustmentPaise = paise;
  }
  amounts.total += adjustmentPaise;
  return { subTotalPaise, discountPaise, discount, discountProblem, shares, amounts, adjustmentPaise, adjustmentProblem };
}
