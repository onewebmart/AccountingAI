/**
 * Lines of quotes, orders, challans, invoices and credit notes, and their
 * amounts. Pure. The browser only previews these figures: the server works
 * the discount, the tax and the total out from the lines itself.
 */
import { BadRequestException } from '@nestjs/common';

export interface DocLineInput {
  description: string;
  itemId?: string | null;
  hsnSac?: string | null;
  uqc?: string | null;
  /** Up to three decimals: 2.5 kg. */
  qty: number;
  ratePaise: number;
  taxRatePct: number;
  /** This line's share of the document's discount. Set by the server, never by the browser. */
  discountPaise?: number;
}

export interface Amounts {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

/** A discount on the whole document, before tax: a percent of the lines, or an amount. */
export interface DiscountInput {
  percent?: number | null;
  amountPaise?: number | null;
}

/** The discount as stored: the percent asked for (null for an amount), and what it came to. */
export interface DocDiscount {
  percent: number | null;
  amountPaise: number;
}

/** Added after tax and not taxed: rounding the total. Signed paise. */
export interface DocAdjustment {
  label: string;
  paise: number;
}

/**
 * The most an adjustment may move a total, either way: ₹99.99. It is for
 * rounding, not for value; a real reduction is a discount, which GST sees.
 * It is also the most an e-invoice accepts as round-off.
 */
export const ADJUSTMENT_LIMIT_PAISE = 9_999;

export const lineAmount = (l: { qty: number; ratePaise: number }) => Math.round(l.qty * l.ratePaise);

/** What a line is taxed on: its amount less its share of the discount. */
export const lineTaxable = (l: { qty: number; ratePaise: number; discountPaise?: number | null }) => lineAmount(l) - (l.discountPaise ?? 0);

/** Inter-state when both states are known and differ; otherwise CGST and SGST. */
export const isInterState = (ours: string | null | undefined, theirs: string | null | undefined) => !!ours && !!theirs && ours !== theirs;

/** Tax per line on its discounted value at its slab, halved within a state. The total is value plus tax. */
export function docAmounts(lines: Array<{ qty: number; ratePaise: number; taxRatePct: number; discountPaise?: number | null }>, interState: boolean): Amounts {
  const a: Amounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const l of lines) {
    const taxable = lineTaxable(l);
    const tax = Math.round((taxable * (l.taxRatePct || 0)) / 100);
    a.taxableValue += taxable;
    if (interState) a.igst += tax;
    else {
      const half = Math.round(tax / 2);
      a.cgst += half;
      a.sgst += tax - half;
    }
  }
  a.total = a.taxableValue + a.cgst + a.sgst + a.igst + a.cess;
  return a;
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The discount the lines take: a percent of what they add up to (to two
 * decimals, rounded to the paisa), or an amount no larger than that. Null
 * when there is none.
 */
export function discountOf(subTotalPaise: number, input: DiscountInput | null | undefined): DocDiscount | null {
  if (!input) return null;
  const percent = input.percent ?? null;
  const amount = input.amountPaise ?? null;
  if (percent !== null && amount !== null && percent !== 0 && amount !== 0) throw new BadRequestException('A discount is a percent or an amount, not both.');
  if (percent !== null && percent !== 0) {
    const bp = Math.round(percent * 100);
    if (!(percent > 0) || percent > 100 || Math.abs(bp - percent * 100) > 1e-6) throw new BadRequestException('A discount percent is more than 0 and at most 100, to two decimals.');
    const paise = Math.round((subTotalPaise * bp) / 10_000);
    return paise > 0 ? { percent: bp / 100, amountPaise: paise } : null;
  }
  if (amount !== null && amount !== 0) {
    if (!Number.isInteger(amount) || amount < 0) throw new BadRequestException('A discount is whole paise, not negative.');
    if (amount > subTotalPaise) throw new BadRequestException(`The discount of ${rs(amount)} is more than the ${rs(subTotalPaise)} the lines come to.`);
    return { percent: null, amountPaise: amount };
  }
  return null;
}

/** A stored discount as it was asked for, to price the lines again: the percent, or else the amount. */
export const discountAsked = (d: DocDiscount | null | undefined): DiscountInput | null =>
  !d ? null : d.percent ? { percent: d.percent } : { amountPaise: d.amountPaise };

/**
 * A discount shared across lines in proportion to their amounts, to the
 * paisa: each line rounded, the last taking what is left, so the shares add
 * up to the discount exactly. Should rounding ever push a share outside its
 * line (only with lines of a few paise), the largest-remainder split is used
 * instead, which never does.
 */
export function spreadDiscount(amounts: number[], discount: number): number[] {
  if (amounts.length === 0) return [];
  const sum = amounts.reduce((s, a) => s + Math.max(0, a), 0);
  if (discount <= 0 || sum <= 0) return amounts.map(() => 0);
  const shares = amounts.map((a, i) => (i === amounts.length - 1 ? 0 : Math.round((discount * Math.max(0, a)) / sum)));
  shares[shares.length - 1] = discount - shares.reduce((s, x) => s + x, 0);
  if (shares.every((s, i) => s >= 0 && s <= Math.max(0, amounts[i]))) return shares;
  // Largest remainder: floors, then the paise left over to the largest fractions.
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

/** An adjustment checked: whole paise, within the limit, and leaving a total above nothing. Null for none. */
export function adjustmentOf(input: { label?: string | null; paise?: number | null } | null | undefined, totalBefore: number): DocAdjustment | null {
  const paise = input?.paise ?? 0;
  if (!paise) return null;
  if (!Number.isInteger(paise)) throw new BadRequestException('An adjustment is whole paise.');
  if (Math.abs(paise) > ADJUSTMENT_LIMIT_PAISE) {
    throw new BadRequestException(`An adjustment is at most ${rs(ADJUSTMENT_LIMIT_PAISE)} either way: it rounds the total. To take value off, give a discount, which GST counts.`);
  }
  if (totalBefore + paise <= 0) throw new BadRequestException('The adjustment cannot bring the total to nothing or below.');
  return { label: input?.label?.trim().slice(0, 40) || 'Adjustment', paise };
}

/**
 * A document priced: the discount spread over the lines, tax on the
 * discounted values, and the adjustment added after tax. The lines come back
 * with their discount share; the amounts' total includes the adjustment.
 */
export function priceDoc<L extends { qty: number; ratePaise: number; taxRatePct: number }>(
  lines: L[],
  interState: boolean,
  opts: { discount?: DiscountInput | null; adjustment?: { label?: string | null; paise?: number | null } | null } = {},
): { lines: Array<L & { discountPaise: number }>; amounts: Amounts; discount: DocDiscount | null; adjustment: DocAdjustment | null; subTotalPaise: number } {
  const gross = lines.map(lineAmount);
  const subTotalPaise = gross.reduce((s, a) => s + a, 0);
  const discount = discountOf(subTotalPaise, opts.discount);
  const shares = spreadDiscount(gross, discount?.amountPaise ?? 0);
  const priced = lines.map((l, i) => ({ ...l, discountPaise: shares[i] }));
  const amounts = docAmounts(priced, interState);
  const adjustment = adjustmentOf(opts.adjustment, amounts.total);
  if (adjustment) amounts.total += adjustment.paise;
  return { lines: priced, amounts, discount, adjustment, subTotalPaise };
}

/** The adjustment in a set of amounts: whatever the total is beyond value plus tax. */
export const adjustmentIn = (a: Amounts) => a.total - (a.taxableValue + a.cgst + a.sgst + a.igst + a.cess);

/** Checks a line as people type it: a description, a positive quantity, whole paise, a slab. */
export function lineProblem(l: DocLineInput, i: number): string | null {
  const at = `Line ${i + 1}`;
  if (!l.description?.trim()) return `${at} needs a description.`;
  if (!(l.qty > 0) || Math.round(l.qty * 1000) !== l.qty * 1000) return `${at}: the quantity is more than nothing, to three decimals at most.`;
  if (!Number.isInteger(l.ratePaise) || l.ratePaise < 0) return `${at}: the rate is whole paise, not negative.`;
  if (![0, 3, 5, 12, 18, 28, 40].includes(l.taxRatePct)) return `${at}: ${l.taxRatePct}% is not a GST slab.`;
  return null;
}

/** As GST asks of an invoice or challan number (rules 46 and 55): up to 16 characters, letters, digits, "/" and "-". */
export const DOC_NUMBER = /^[A-Za-z0-9/-]{1,16}$/;

/** Optional words on a document, trimmed; blank is none. */
export const text = (s: string | null | undefined, max: number) => s?.trim().slice(0, max) || null;
