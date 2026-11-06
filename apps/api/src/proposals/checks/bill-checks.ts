/**
 * Checks on a bill before a person approves it: is it one we already have,
 * does it look like it came from someone other than the vendor on file, and
 * is its GST likely not claimable as input credit.
 *
 * Rules only, by design: a compliance flag should say exactly why it fired,
 * and work with no AI key. Each check says what it saw. Only blocked GST
 * changes the proposal (ProposalsService moves it into the cost, the safer
 * side under 17(5)); the reviewer can move it back. The reviewer decides.
 */

export type CheckSeverity = 'high' | 'medium';

export interface BillCheck {
  code:
    | 'duplicate_number'
    | 'duplicate_amount'
    | 'gstin_differs'
    | 'new_vendor_large'
    | 'blocked_itc'
    | 'paid_at_counter'
    | 'tds_section';
  severity: CheckSeverity;
  message: string;
  /** blocked_itc only: the proposal books this GST into the cost (see Rule.move). Not stored. */
  moveToCost?: boolean;
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
  /** Words that, in the vendor's name alone, say what every line of the bill is (a restaurant's bill is food). */
  vendorWords?: RegExp;
  /**
   * When the proposal books the GST into the cost rather than as input credit:
   * 'any' on any evidence (no business resells a haircut); 'strong' only on
   * the SAC code or the vendor's trade (a restaurant meal), never on item
   * words alone, since a grocer buying tea to resell may claim it. Rules
   * without it only flag.
   */
  move?: 'any' | 'strong';
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
    words:
      /\b(restaurant|food|meals?|lunch|dinner|breakfast|snacks?|beverages?|catering|caterer|swiggy|zomato|cafe|canteen|tiffin|refreshments?|thali|veg|non[- ]veg|chaas|lassi|tea|chai|coffee|biryani|dosa|idli|vada|paratha|roti|naan|paneer|pizza|burger|sandwich|juice|sweets|mithai|starters?|main course|mineral water|soft drinks?)\b/i,
    vendorWords: /\b(restaurant|dhaba|caterers?|catering|cafe|bakery|bakers|sweets|sweet mart|bhojanalaya|food court|kitchen|biryani|pizza|pure veg|veg)\b/i,
    move: 'strong',
    what: 'food, drink or catering',
    why: 'GST on food, beverages and outdoor catering is blocked unless you supply them yourself (17(5)(b)(i))',
  },
  {
    hsn: ['99972', '999721', '999722', '999723', '999729'],
    words: /\b(salon|spa|beauty|cosmetic|parlour|parlor|hair ?cut|grooming|massage)\b/i,
    move: 'any',
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
    move: 'any',
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
    move: 'any',
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
    // The vendor's name speaks for a one-line bill, or for any bill when it
    // names the trade outright ("Hotel Annapurna Veg", "Sharma Caterers").
    const trade = !!rule.vendorWords?.test(input.vendorName ?? '');
    const byVendor = !hit && (trade || (input.lines.length <= 1 && !!rule.words?.test(input.vendorName ?? '')));
    if (!hit && !byVendor) continue;
    const byCode = !!hit?.hsnSac && !!rule.hsn?.some((p) => (hit.hsnSac ?? '').replace(/\s/g, '').startsWith(p));
    const where = byCode
      ? `HSN/SAC ${hit!.hsnSac}`
      : hit?.description
        ? `"${hit.description.slice(0, 60)}"${trade ? ` from ${input.vendorName}` : ''}`
        : `the vendor ${input.vendorName}`;
    const moveToCost = rule.move === 'any' || (rule.move === 'strong' && (byCode || trade));
    out.push({
      code: 'blocked_itc',
      severity: 'medium',
      message: moveToCost
        ? `This looks like ${rule.what} (${where}). ${rule.why}. So the GST is booked into the cost here, not claimed as input credit. If you can claim it, move it back to input GST before you approve.`
        : `This looks like ${rule.what} (${where}). ${rule.why}. If so, book the GST into the expense rather than as input credit.`,
      ...(moveToCost ? { moveToCost: true } : {}),
    });
  }
  return out;
}

/**
 * Whether a bill says it was paid there and then, and how: "Paid by UPI",
 * "Payment mode: Cash", "Received with thanks". Read from the document's own
 * text, so no model is asked. A bill paid at the counter is an expense paid
 * from bank or cash, not a bill to pay later.
 */
export type PaidMode = 'upi' | 'cash' | 'card' | 'bank' | 'unknown';
const PAID_MODES: Array<[PaidMode, RegExp]> = [
  ['upi', /\b(upi|gpay|google ?pay|phone ?pe|paytm|bhim|qr)\b/i],
  ['card', /\b(card|visa|master ?card|rupay|pos)\b/i],
  ['cash', /\bcash\b/i],
  ['bank', /\b(neft|imps|rtgs|net ?banking|bank transfer|cheque)\b/i],
];
const PAID_SAYS = [
  /\bpaid\s+(by|via|through|using|with|in)\s+[a-z ]{2,24}/i,
  /\b(payment|pay)\s*(mode|method|type)\s*[:\-]\s*[a-z ]{2,24}/i,
  /\bmode of payment\s*[:\-]\s*[a-z ]{2,24}/i,
  /\b(upi|cash|card)\s+(payment|paid|received)\b/i,
  /\breceived with thanks\b/i,
];
export function paidAtCounter(text: string | null | undefined): { mode: PaidMode; evidence: string } | null {
  if (!text) return null;
  const t = text.slice(0, 20_000);
  for (const rx of PAID_SAYS) {
    const m = t.match(rx);
    if (!m) continue;
    const said = m[0].replace(/\s+/g, ' ').trim();
    if (/\b(un|not )paid\b|\bto be paid\b/i.test(said)) continue;
    const mode = PAID_MODES.find(([, w]) => w.test(said))?.[0] ?? 'unknown';
    // "Payment mode: Credit" or "Payment terms" is not a payment made.
    if (mode === 'unknown' && !/received with thanks/i.test(said)) continue;
    return { mode, evidence: said.slice(0, 80) };
  }
  return null;
}

const MODE_WORD: Record<PaidMode, string> = { upi: 'by UPI', cash: 'in cash', card: 'by card', bank: 'by bank transfer', unknown: '' };

/** The check for a bill paid at the counter: book it as an expense paid, not a bill owed. */
export function paidCheck(paid: { mode: PaidMode; evidence: string } | null | undefined): BillCheck[] {
  if (!paid) return [];
  const how = MODE_WORD[paid.mode];
  return [{
    code: 'paid_at_counter',
    severity: 'medium',
    message: `The bill says it was paid${how ? ` ${how}` : ''} ("${paid.evidence}"). Record it as an expense paid from ${paid.mode === 'cash' ? 'cash' : 'your bank'} instead, so it is not left in what you owe vendors. Or approve it and record the payment.`,
  }];
}
