/**
 * Checks on a bill before a person approves it: is it one we already have,
 * does it look like it came from someone other than the vendor on file, and
 * is its GST likely not claimable as input credit.
 *
 * Rules only, by design: a compliance flag should say exactly why it fired,
 * and work with no AI key. Each check says what it saw; none of them changes
 * the proposal's lines. The reviewer decides.
 */

export type CheckSeverity = 'high' | 'medium';

export interface BillCheck {
  code:
    | 'duplicate_number'
    | 'duplicate_amount'
    | 'gstin_differs'
    | 'new_vendor_large'
    | 'blocked_itc';
  severity: CheckSeverity;
  message: string;
}

/** "INV/2026-27/001" and "inv 2026 27 001" are the same number. */
export function normaliseBillNumber(raw: string | null | undefined): string | null {
  const n = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n.length >= 2 ? n : null;
}

/** "Sigma Supplies Pvt. Ltd." and "SIGMA SUPPLIES PRIVATE LIMITED" are one vendor. */
export function normaliseName(raw: string | null | undefined): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|INC|THE|M\/S|MS)\b\.?/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

interface Rule {
  /** HSN/SAC prefixes that point at it. */
  hsn?: string[];
  /** Words in a line description or the vendor's name. */
  words?: RegExp;
  what: string;
  why: string;
}

/**
 * Section 17(5) of the CGST Act: credit that is blocked, whatever the bill
 * says. Each has exceptions (a car dealer may claim on cars; food bought to
 * resell is stock in trade), so a hit is "likely", for the reviewer to judge.
 */
const BLOCKED: Rule[] = [
  {
    hsn: ['8703', '8711'],
    words: /\b(motor ?car|new car|car purchase|purchase of (a )?car|scooter|motorcycle|two[- ]wheeler|vehicle purchase|ex[- ]showroom)\b/i,
    what: 'a motor vehicle',
    why: 'GST on cars and two-wheelers is blocked unless you deal in them, run a transport service or a driving school (17(5)(a))',
  },
  {
    hsn: ['99633', '996331', '996332', '996333', '996334', '996335', '996336', '996337'],
    words: /\b(restaurant|food|meals?|lunch|dinner|breakfast|snacks?|beverages?|catering|caterer|swiggy|zomato|cafe|canteen|tiffin|refreshments?)\b/i,
    what: 'food, drink or catering',
    why: 'GST on food, beverages and outdoor catering is blocked unless you supply them yourself (17(5)(b)(i))',
  },
  {
    hsn: ['99972', '999721', '999722', '999723', '999729'],
    words: /\b(salon|spa|beauty|cosmetic|parlour|parlor|hair ?cut|grooming|massage)\b/i,
    what: 'beauty or cosmetic treatment',
    why: 'GST on beauty treatment and cosmetic surgery is blocked (17(5)(b)(i))',
  },
  {
    hsn: ['9993'],
    words: /\b(hospital|clinic|medical treatment|health ?check|diagnostic|pathology|dental)\b/i,
    what: 'health services',
    why: 'GST on health services is blocked unless the law requires you to provide them to employees (17(5)(b)(i))',
  },
  {
    words: /\b(club membership|membership fee|gym|fitness|health club|golf)\b/i,
    what: 'a club or fitness membership',
    why: 'GST on club, health and fitness centre memberships is blocked (17(5)(b)(ii))',
  },
  {
    words: /\b(life insurance|health insurance|mediclaim|term insurance|medical insurance|group health)\b/i,
    what: 'life or health insurance',
    why: 'GST on life and health insurance is blocked unless the law requires you to provide it to employees (17(5)(b)(i))',
  },
  {
    words: /\b(car rental|cab hire|rent[- ]a[- ]cab|vehicle hire|car hire|vehicle on rent|vehicle lease)\b/i,
    what: 'renting or leasing a car',
    why: 'GST on renting, leasing or hiring motor vehicles is blocked where credit on the vehicle itself would be (17(5)(ab))',
  },
  {
    words: /\b(leave travel|LTC|holiday package|tour package|vacation)\b/i,
    what: 'travel for employees on holiday',
    why: 'GST on travel benefits for employees on leave or holiday is blocked (17(5)(b)(iii))',
  },
  {
    hsn: ['9954'],
    words: /\b(construction of|civil work|building work|works contract|renovation of (the )?(office|building|premises))\b/i,
    what: 'construction work',
    why: 'GST on building immovable property (other than plant and machinery) is blocked, even when it is for the business (17(5)(c), (d))',
  },
  {
    words: /\b(gifts?|diwali|hampers?|sweets? box|dry ?fruits? box|free samples?)\b/i,
    what: 'gifts or free samples',
    why: 'GST on goods given away as gifts or free samples is blocked (17(5)(h))',
  },
];

/**
 * Lines whose GST is likely not claimable, one flag per kind of supply. A
 * bill with no GST on it has nothing to block.
 */
export function blockedItc(input: {
  vendorName?: string | null;
  lines: Array<{ description?: string | null; hsnSac?: string | null }>;
  gstPaise: number;
}): BillCheck[] {
  if (input.gstPaise <= 0) return [];
  const out: BillCheck[] = [];
  for (const rule of BLOCKED) {
    const hit = input.lines.find((l) => {
      const code = (l.hsnSac ?? '').replace(/\s/g, '');
      if (code && rule.hsn?.some((p) => code.startsWith(p))) return true;
      return !!rule.words && rule.words.test(l.description ?? '');
    });
    const byVendor = !hit && input.lines.length <= 1 && rule.words?.test(input.vendorName ?? '');
    if (!hit && !byVendor) continue;
    const where = hit?.hsnSac && rule.hsn?.some((p) => (hit.hsnSac ?? '').replace(/\s/g, '').startsWith(p))
      ? `HSN/SAC ${hit.hsnSac}`
      : hit?.description
        ? `"${hit.description.slice(0, 60)}"`
        : `the vendor ${input.vendorName}`;
    out.push({
      code: 'blocked_itc',
      severity: 'medium',
      message: `This looks like ${rule.what} (${where}). ${rule.why}. If so, book the GST into the expense rather than as input credit.`,
    });
  }
  return out;
}
