/**
 * Foreign currencies, pure. The books stay in INR paise (Invariant 1); a
 * foreign document keeps its own amounts beside them in that currency's
 * minor units (cents, fils, yen), and converts once, at its rate, to paise.
 */

/** The currencies Indian SMEs invoice and buy in, with their minor-unit digits (ISO 4217). */
export const CURRENCIES: Record<string, { name: string; digits: number }> = {
  USD: { name: 'US dollar', digits: 2 },
  EUR: { name: 'Euro', digits: 2 },
  GBP: { name: 'Pound sterling', digits: 2 },
  AED: { name: 'UAE dirham', digits: 2 },
  SGD: { name: 'Singapore dollar', digits: 2 },
  AUD: { name: 'Australian dollar', digits: 2 },
  CAD: { name: 'Canadian dollar', digits: 2 },
  CHF: { name: 'Swiss franc', digits: 2 },
  SAR: { name: 'Saudi riyal', digits: 2 },
  HKD: { name: 'Hong Kong dollar', digits: 2 },
  CNY: { name: 'Chinese yuan', digits: 2 },
  NZD: { name: 'New Zealand dollar', digits: 2 },
  JPY: { name: 'Japanese yen', digits: 0 },
  KWD: { name: 'Kuwaiti dinar', digits: 3 },
  OMR: { name: 'Omani rial', digits: 3 },
  BHD: { name: 'Bahraini dinar', digits: 3 },
};

export const isForeign = (code: string | null | undefined) => !!code && code !== 'INR' && code in CURRENCIES;

/** INR for one unit; up to four decimals, as reference rates are quoted. */
export function rateProblem(rate: number): string | null {
  if (!Number.isFinite(rate) || rate <= 0) return 'A rate is rupees for one unit, more than nothing.';
  if (rate > 100_000) return 'That rate is too large to be rupees for one unit.';
  if (Math.abs(Math.round(rate * 10_000) - rate * 10_000) > 1e-6) return 'A rate has four decimals at most.';
  return null;
}

/** Minor units of a currency to INR paise at a rate: $12.34 at 84.1025 → 1,03,782 paise. Rounded once, here. */
export function toPaise(minor: number, rate: number, digits: number): number {
  // minor / 10^digits units × rate rupees × 100 paise; scaled to integers first so floating error cannot round the wrong way.
  const rate4 = Math.round(rate * 10_000);
  const num = BigInt(Math.round(minor)) * BigInt(rate4) * 100n;
  const den = 10n ** BigInt(digits) * 10_000n;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return Number(neg ? -rounded : rounded);
}

/** 123456 minor USD → "USD 1,234.56". */
export function formatMinor(minor: number, code: string): string {
  const digits = CURRENCIES[code]?.digits ?? 2;
  const v = minor / 10 ** digits;
  return `${code} ${v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
