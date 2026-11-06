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

/**
 * When TDS starts, by section (Finance Act 2025, from 1 April 2025), in
 * paise: a single bill over `single`, or the vendor's bills in the financial
 * year over `year`. Rent's limit is a month's rent, which one bill is.
 */
export const TDS_THRESHOLDS: Partial<Record<TdsSection, { single?: number; year?: number }>> = {
  '194C': { single: 30_000_00, year: 1_00_000_00 },
  '194J-a': { year: 50_000_00 },
  '194J-b': { year: 50_000_00 },
  '194I-a': { single: 50_000_00 },
  '194I-b': { single: 50_000_00 },
  '194H': { year: 20_000_00 },
};

/** What a bill's codes or words say it is, for TDS. Most specific first. */
const TDS_HINTS: Array<{ section: TdsSection; sac?: string[]; words?: RegExp; what: string }> = [
  { section: '194I-b', sac: ['9972'], words: /\b(office rent|shop rent|godown rent|warehouse rent|rent for (the )?(office|premises|shop|godown)|lease rent|rental of (the )?(premises|office|building))\b/i, what: 'rent of premises' },
  { section: '194I-a', sac: ['9973'], words: /\b(machinery hire|equipment hire|equipment rent(al)?|crane hire|generator (hire|rent(al)?)|jcb hire)\b/i, what: 'hire of machinery or equipment' },
  { section: '194J-b', sac: ['9982', '998311', '998312'], words: /\b(professional fees?|consultancy|consulting fees?|consultant|legal fees?|advocate|lawyer|audit fees?|chartered accountant|architect|interior design(er)?|retainership)\b/i, what: 'professional fees' },
  { section: '194J-a', words: /\b(technical services?|technical fees?|call cent(er|re) services?|technical support)\b/i, what: 'fees for technical services' },
  { section: '194H', sac: ['9961', '9962'], words: /\b(commission|brokerage)\b/i, what: 'commission or brokerage' },
  { section: '194C', sac: ['9954', '9965', '9967', '9985', '9988', '99836', '996334', '996335'], words: /\b(contractor|labour (charges|contract)|job ?work|fabrication|transport(ation)? charges|freight|carriage|courier|housekeeping|security services?|manpower|cleaning services?|catering contract|event management|printing (job|work)|advertis(ing|ement))\b/i, what: 'contract work' },
];

/**
 * The TDS section a vendor's bill most likely falls under, and whether this
 * bill takes the vendor past the section's threshold. A suggestion for a
 * person: a business that is not required to deduct (an individual or HUF
 * without a tax audit) ignores it, and a vendor's section is set by hand.
 */
export function suggestTdsSection(input: {
  vendorName?: string | null;
  lines: Array<{ description?: string | null; hsnSac?: string | null }>;
  /** This bill's taxable value, in paise: TDS is never on the GST. */
  taxablePaise: number;
  /** The vendor's taxable value in the financial year, this bill included. */
  yearPaise: number;
}): { section: TdsSection; what: string; where: string; crossed: string } | null {
  const text = [input.vendorName, ...input.lines.map((l) => l.description)].filter(Boolean).join(' ');
  for (const h of TDS_HINTS) {
    const byCode = input.lines.find((l) => {
      const code = (l.hsnSac ?? '').replace(/\D/g, '');
      return code && h.sac?.some((p) => code.startsWith(p));
    });
    const word = !byCode ? h.words?.exec(text) : null;
    if (!byCode && !word) continue;
    const limit = TDS_THRESHOLDS[h.section] ?? {};
    const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
    const crossed =
      limit.single !== undefined && input.taxablePaise > limit.single
        ? `this bill is over ${rupees(limit.single)}`
        : limit.year !== undefined && input.yearPaise > limit.year
          ? `this vendor's bills come to ${rupees(input.yearPaise)} this financial year, over ${rupees(limit.year)}`
          : null;
    if (!crossed) return null;
    return { section: h.section, what: h.what, where: byCode ? `SAC/HSN ${byCode.hsnSac}` : `"${word![0]}"`, crossed };
  }
  return null;
}
