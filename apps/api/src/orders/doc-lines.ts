/**
 * Lines of quotes, orders, challans and purchase orders, and their amounts.
 * Pure. Unlike an invoice typed in the browser, these documents never post,
 * so the server works the tax out from the lines itself.
 */

export interface DocLineInput {
  description: string;
  itemId?: string | null;
  hsnSac?: string | null;
  uqc?: string | null;
  /** Up to three decimals: 2.5 kg. */
  qty: number;
  ratePaise: number;
  taxRatePct: number;
}

export interface Amounts {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export const lineAmount = (l: { qty: number; ratePaise: number }) => Math.round(l.qty * l.ratePaise);

/** Inter-state when both states are known and differ; otherwise CGST and SGST. */
export const isInterState = (ours: string | null | undefined, theirs: string | null | undefined) => !!ours && !!theirs && ours !== theirs;

export function docAmounts(lines: Array<{ qty: number; ratePaise: number; taxRatePct: number }>, interState: boolean): Amounts {
  const a: Amounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const l of lines) {
    const taxable = lineAmount(l);
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

/** Checks a line as people type it: a description, a positive quantity, whole paise, a slab. */
export function lineProblem(l: DocLineInput, i: number): string | null {
  const at = `Line ${i + 1}`;
  if (!l.description?.trim()) return `${at} needs a description.`;
  if (!(l.qty > 0) || Math.round(l.qty * 1000) !== l.qty * 1000) return `${at}: the quantity is more than nothing, to three decimals at most.`;
  if (!Number.isInteger(l.ratePaise) || l.ratePaise < 0) return `${at}: the rate is whole paise, not negative.`;
  if (![0, 3, 5, 12, 18, 28, 40].includes(l.taxRatePct)) return `${at}: ${l.taxRatePct}% is not a GST slab.`;
  return null;
}
