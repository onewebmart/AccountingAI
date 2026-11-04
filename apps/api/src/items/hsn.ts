/**
 * HSN and SAC codes, GST units and rates: what is valid, and a small table of
 * common items an Indian SME buys or sells. Pure, so it needs no AI key.
 *
 * The table carries only codes we are sure of. A rate is given only where it
 * has held steady; elsewhere it is left for a person to fill, since rates
 * moved in the September 2025 changes and an item master that quietly
 * charges the wrong rate is worse than one that asks.
 */

export type ItemKind = 'goods' | 'service';

/** Whole-number slabs only: invoice and bill lines carry the rate as an integer. */
export const ITEM_GST_RATES = [0, 3, 5, 12, 18, 28, 40] as const;

/** GST's unit quantity codes (UQC), as the GSTR-1 HSN summary takes them. NA is for services. */
export const UQC_CODES = [
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK',
  'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL',
  'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS', 'NA',
] as const;

/**
 * Whether a code is a well-formed HSN (goods: 4, 6 or 8 digits, not chapter
 * 99) or SAC (services: 6 digits starting 99). It does not prove the code
 * exists in the tariff; that list is the GST portal's.
 */
export function hsnProblem(code: string, kind: ItemKind): string | null {
  if (!/^\d+$/.test(code)) return 'An HSN or SAC code is digits only.';
  if (kind === 'service') {
    return /^99\d{4}$/.test(code) ? null : 'A SAC code for a service is 6 digits and starts with 99.';
  }
  if (code.startsWith('99')) return 'Codes starting 99 are SAC codes for services, not goods.';
  return [4, 6, 8].includes(code.length) ? null : 'An HSN code for goods is 4, 6 or 8 digits.';
}

export interface HsnGuess {
  hsnSac: string;
  kind: ItemKind;
  /** Null when the rate depends on details a name does not give. */
  gstRatePct: number | null;
  uqc: string;
  reason: string;
}

interface Rule extends HsnGuess {
  match: RegExp;
}

// Ordered: the first match wins, so services ("laptop repair") come before
// the goods they mention ("laptop").
const RULES: Rule[] = [
  { match: /\b(software|website|web ?site|mobile app|app|application)\s+(development|design|build|building)\b/i, hsnSac: '998314', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'IT design and development services' },
  { match: /\b(it support|it consult\w*|technical support|software support|software maintenance)\b/i, hsnSac: '998313', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'IT consulting and support services' },
  { match: /\b(web hosting|hosting|cloud server|server rent\w*|domain and hosting)\b/i, hsnSac: '998315', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Hosting and IT infrastructure provisioning' },
  { match: /\b(software licen[cs]e|saas|software subscription)\b/i, hsnSac: '997331', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Licensing the right to use software' },
  { match: /\b(computer|laptop|printer|desktop) repair\b|\brepair of (computer|laptop|printer)s?\b/i, hsnSac: '998713', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Maintenance and repair of computers and peripherals' },
  { match: /\b(management consult\w*|business consult\w*|consultancy|consulting fees?)\b/i, hsnSac: '998311', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Management consulting and management services' },
  { match: /\b(audit fees?|statutory audit|internal audit|auditing)\b/i, hsnSac: '998221', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Financial auditing services' },
  { match: /\b(accounting|book ?keeping)\b/i, hsnSac: '998222', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Accounting and bookkeeping services' },
  { match: /\b(tax consult\w*|gst filing|tax filing|return filing)\b/i, hsnSac: '998231', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Tax consultancy and preparation services' },
  { match: /\b(office|shop|warehouse|godown|commercial|showroom) rent\b|\brent (for|of) (the )?(office|shop|premises|warehouse|godown)\b/i, hsnSac: '997212', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Renting non-residential property' },
  { match: /\b(advertis\w*|ad campaign|google ads|facebook ads|meta ads)\b/i, hsnSac: '998361', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Advertising services' },
  { match: /\b(courier|parcel delivery)\b/i, hsnSac: '996812', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Courier services' },
  { match: /\b(training|coaching|workshop fees?|course fees?)\b/i, hsnSac: '999293', kind: 'service', gstRatePct: 18, uqc: 'NA', reason: 'Commercial training and coaching' },
  { match: /\b(freight|goods transport\w*|transport(ation)? of goods|lorry hire|truck hire|gta)\b/i, hsnSac: '996511', kind: 'service', gstRatePct: null, uqc: 'NA', reason: 'Road transport of goods (GTA); the rate depends on whether the transporter charges under reverse charge' },
  { match: /\b(restaurant|catering|meals?|food (and|&) beverages?)\b/i, hsnSac: '996331', kind: 'service', gstRatePct: null, uqc: 'NA', reason: 'Restaurant and catering services; the rate depends on where and how it is served' },
  { match: /\b(laptops?|notebook pcs?|desktops?|desktop computers?|computers?)\b/i, hsnSac: '8471', kind: 'goods', gstRatePct: 18, uqc: 'NOS', reason: 'Computers and their units (chapter 84.71)' },
  { match: /\b(mobile phones?|smart ?phones?|cell ?phones?)\b/i, hsnSac: '8517', kind: 'goods', gstRatePct: 18, uqc: 'NOS', reason: 'Telephones, including smartphones (chapter 85.17)' },
  { match: /\b(printers?)\b/i, hsnSac: '8443', kind: 'goods', gstRatePct: 18, uqc: 'NOS', reason: 'Printers (chapter 84.43)' },
  { match: /\b(office chairs?|chairs?|sofas?|stools?)\b/i, hsnSac: '9401', kind: 'goods', gstRatePct: null, uqc: 'NOS', reason: 'Seats and chairs (chapter 94.01)' },
  { match: /\b(tables?|desks?|cupboards?|almirahs?|furniture|shelves|racks?)\b/i, hsnSac: '9403', kind: 'goods', gstRatePct: null, uqc: 'NOS', reason: 'Other furniture (chapter 94.03)' },
  { match: /\bcement\b/i, hsnSac: '2523', kind: 'goods', gstRatePct: 18, uqc: 'BAG', reason: 'Cement (chapter 25.23)' },
];

/** The first rule a description matches, or null. */
export function ruleGuess(description: string): HsnGuess | null {
  const text = description.trim();
  if (!text) return null;
  const rule = RULES.find((r) => r.match.test(text));
  if (!rule) return null;
  const { match: _match, ...guess } = rule;
  return guess;
}

/** A name, for matching: lower case, single spaces, no punctuation. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
