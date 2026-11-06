/**
 * The arithmetic of an expense, kept pure so it is easy to test: the GST on
 * a line, a mileage amount, the mileage rate in force on a date. Integer
 * paise throughout (Invariant 1): a distance is carried in hundredths so a
 * mileage amount is worked out without floating point.
 */

export const GST_SLABS = [0, 3, 5, 12, 18, 28, 40] as const;
export const MILEAGE_UNITS = ['km', 'mile'] as const;
export type MileageUnit = (typeof MILEAGE_UNITS)[number];
export type ExpenseKind = 'expense' | 'mileage';

/** An itemized expense: at most this many lines. */
export const MAX_LINES = 50;
/** Bulk add: at most this many expenses in one go. */
export const MAX_BULK = 100;
/** A mileage expense: at most this far, in its unit. */
export const MAX_DISTANCE = 100_000;

/** GST on an amount before tax: IGST whole, or CGST and SGST halves that add up to it. Integer paise. */
export function expenseTax(taxablePaise: number, gstRatePct: number, interState: boolean) {
  const tax = Math.round((taxablePaise * gstRatePct) / 100);
  if (interState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise: taxablePaise + tax };
  const half = Math.round(tax / 2);
  return { cgstPaise: half, sgstPaise: tax - half, igstPaise: 0, totalPaise: taxablePaise + tax };
}

/** A distance as typed, more than nothing with up to two decimals, in hundredths: 42.5 → 4250. Null when it is not one. */
export function distanceHundredths(distance: unknown): number | null {
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0 || distance > MAX_DISTANCE) return null;
  const hundredths = Math.round(distance * 100);
  if (hundredths <= 0 || Math.abs(distance * 100 - hundredths) > 1e-6) return null;
  return hundredths;
}

/** distance × rate, rounded to the paisa: 42.5 km at ₹10.50 a km is 44625 paise. */
export function mileageAmount(hundredths: number, ratePaise: number): number {
  return Math.round((hundredths * ratePaise) / 100);
}

/** The mileage rate in force on a date: the one with the latest start on or before it. Null before the first. */
export function rateOn<R extends { startDate: string; ratePaise: number }>(rates: readonly R[], date: string): R | null {
  let best: R | null = null;
  for (const r of rates) if (r.startDate <= date && (!best || r.startDate > best.startDate)) best = r;
  return best;
}

/** ₹10.50, for a narration. */
export const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 42.5 km at ₹10.50/km: how a mileage expense describes itself. */
export function mileageWords(distance: number, unit: MileageUnit, ratePaise: number): string {
  const d = distance.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${d} ${unit === 'km' ? 'km' : distance === 1 ? 'mile' : 'miles'} at ${rupees(ratePaise)}/${unit}`;
}
