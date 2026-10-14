/**
 * TDS sections a business commonly deducts under when paying a vendor.
 *
 * Rates are in basis points (100 bps = 1%) so no fraction of a percent is ever
 * a float — 194Q's 0.1% is 10 bps. They are the defaults for a resident payee
 * with a PAN and are set per vendor, so a lower-deduction certificate or a rate
 * change in a Finance Act is a vendor edit, not a code change. Thresholds (e.g.
 * 194C's ₹30,000 single payment) are not checked: set a vendor's section once
 * it applies.
 */
export const TDS_SECTIONS = {
  '194C': { label: 'Contractors and sub-contractors', rateBps: 200, individualRateBps: 100 },
  '194H': { label: 'Commission or brokerage', rateBps: 200 },
  '194I-a': { label: 'Rent — plant, machinery or equipment', rateBps: 200 },
  '194I-b': { label: 'Rent — land, building or furniture', rateBps: 1000 },
  '194J-a': { label: 'Fees for technical services', rateBps: 200 },
  '194J-b': { label: 'Fees for professional services', rateBps: 1000 },
  '194Q': { label: 'Purchase of goods', rateBps: 10 },
  '194A': { label: 'Interest other than on securities', rateBps: 1000 },
} as const;

export type TdsSection = keyof typeof TDS_SECTIONS;

export const TDS_SECTION_CODES = Object.keys(TDS_SECTIONS) as TdsSection[];

/**
 * The default rate for a section and payee. 194C deducts 1% from an individual
 * or HUF — a PAN whose fourth character is P or H — and 2% from anyone else.
 */
export function defaultTdsRateBps(section: TdsSection, pan?: string | null): number {
  const s = TDS_SECTIONS[section];
  if ('individualRateBps' in s && pan && /^[A-Z]{3}[PH]/.test(pan.toUpperCase())) return s.individualRateBps;
  return s.rateBps;
}

/** TDS on a taxable value, in integer paise — GST is never part of the base. */
export function tdsOn(taxablePaise: number, rateBps: number): number {
  return Math.round((taxablePaise * rateBps) / 10_000);
}

/** The PAN inside a GSTIN (characters 3–12), when there is one. */
export function panFromGstin(gstin: string | null | undefined): string | null {
  const g = gstin?.trim().toUpperCase();
  return g && /^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(g) ? g.slice(2, 12) : null;
}

/**
 * TDS deducted in a month is due to the government by the 7th of the next —
 * except March's, which is due by 30 April.
 */
export function tdsDueDate(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (m === 3) return `${y}-04-30`;
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-07`;
}
