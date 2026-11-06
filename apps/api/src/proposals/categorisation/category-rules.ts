/**
 * Deterministic expense categories: HSN/SAC codes and narration keywords that
 * say plainly what a cost is. Pure functions, so every rule can be tested.
 *
 * A rule names an account by its default-chart code and name. The categoriser
 * looks the account up in the org's own chart and skips the rule if the org
 * has no such account; a rule never invents a ledger.
 */

export type CategoryKind = 'bill' | 'withdrawal' | 'deposit';

export interface RuleHit {
  code: string;
  name: string;
  confidence: number;
  reason: string;
}

interface CodeRule {
  prefixes: string[];
  code: string;
  name: string;
  confidence: number;
  what: string;
  /** A fixed asset account: only for things kept, at or above the capitalisation limit. */
  capital?: boolean;
}

/** One line of a bill, as read off it. Amounts in paise. */
export interface CategoryLine {
  description?: string | null;
  hsnSac?: string | null;
  qty?: number | null;
  ratePaise?: number | null;
  amountPaise?: number | null;
}

/** HSN (goods) and SAC (services, chapter 99) prefixes, most specific first. */
const CODE_RULES: CodeRule[] = [
  { prefixes: ['99836'], code: '6180', name: 'Advertising & Marketing', confidence: 0.85, what: 'advertising services' },
  { prefixes: ['9972'], code: '6100', name: 'Rent', confidence: 0.85, what: 'renting of property' },
  { prefixes: ['9984'], code: '6130', name: 'Telephone & Internet', confidence: 0.85, what: 'telecommunication services' },
  { prefixes: ['9982'], code: '6150', name: 'Professional Fees', confidence: 0.85, what: 'legal and accounting services' },
  { prefixes: ['9983'], code: '6150', name: 'Professional Fees', confidence: 0.75, what: 'professional and technical services' },
  { prefixes: ['9987'], code: '6160', name: 'Repairs & Maintenance', confidence: 0.85, what: 'maintenance and repair services' },
  { prefixes: ['9964'], code: '6140', name: 'Travelling & Conveyance', confidence: 0.85, what: 'passenger transport' },
  { prefixes: ['9963'], code: '6140', name: 'Travelling & Conveyance', confidence: 0.7, what: 'accommodation and food' },
  { prefixes: ['9965', '9967'], code: '5200', name: 'Freight & Carriage', confidence: 0.8, what: 'goods transport' },
  { prefixes: ['9968'], code: '6170', name: 'Office & Stationery', confidence: 0.75, what: 'postal and courier services' },
  { prefixes: ['9971'], code: '6190', name: 'Bank Charges', confidence: 0.85, what: 'financial services' },
  { prefixes: ['2716'], code: '6120', name: 'Electricity & Utilities', confidence: 0.9, what: 'electrical energy' },
  { prefixes: ['2710'], code: '6140', name: 'Travelling & Conveyance', confidence: 0.7, what: 'petrol and diesel' },
  { prefixes: ['48', '9608', '9609'], code: '6170', name: 'Office & Stationery', confidence: 0.75, what: 'paper and stationery' },
  { prefixes: ['8471', '8443', '8517'], code: '1510', name: 'Office Equipment', confidence: 0.7, what: 'computers, printers and phones', capital: true },
  { prefixes: ['9401', '9403'], code: '1520', name: 'Furniture & Fixtures', confidence: 0.7, what: 'furniture', capital: true },
];

/**
 * A fixed asset is something the business keeps and uses for more than a
 * year. Under the same HSN as a printer or a laptop sit things that are used
 * up — toner, ink, cables, a mouse — and those are expenses. So is anything
 * below the capitalisation limit a unit: most Indian SMEs expense items under
 * ₹5,000 rather than carry them in the fixed asset register.
 */
export const CAPITALISE_FROM_PAISE = 5_000_00;
/** Always used up, whatever else the line names ("Printer toner cartridge"). */
const CONSUMABLE = /\b(toner|cartridges?|ink|refills?|drum units?|ribbons?|recharge|repairs?|servicing|amc)\b/i;
/** Used up when sold on their own; part of the asset when it is named too ("Laptop with charger"). */
const ACCESSORY =
  /\b(cables?|adapters?|chargers?|mouse|mice|keyboards?|pen ?drives?|memory cards?|sd cards?|batter(y|ies)|spares?|spare parts?|accessor(y|ies)|covers?|cases?|tempered glass|screen guards?)\b/i;
const EQUIPMENT =
  /\b(laptops?|desktops?|computers?|notebooks?|printers?|scanners?|copiers?|phones?|mobiles?|smartphones?|tablets?|monitors?|servers?|projectors?|routers?|chairs?|tables?|desks?|cupboards?|almirahs?|sofas?|cabinets?|workstations?)\b/i;

function usedUp(description: string | null | undefined): string | null {
  const d = description ?? '';
  const strong = d.match(CONSUMABLE);
  if (strong) return strong[0];
  const weak = d.match(ACCESSORY);
  return weak && !EQUIPMENT.test(d) ? weak[0] : null;
}
const SMALL_ITEMS = { code: '6170', name: 'Office & Stationery', confidence: 0.75 };

/** A line's value for one unit: its rate, or its amount over its quantity. */
function unitValuePaise(line: CategoryLine): number | null {
  if (line.ratePaise && line.ratePaise > 0) return line.ratePaise;
  if (line.amountPaise && line.amountPaise > 0) return line.qty && line.qty > 0 ? Math.round(line.amountPaise / line.qty) : line.amountPaise;
  return null;
}

/** The rule a line's HSN/SAC code satisfies, with assets kept apart from what is used up. */
function codeRuleFor(line: CategoryLine): RuleHit | null {
  const hsn = line.hsnSac?.replace(/\D/g, '') ?? '';
  if (!hsn) return null;
  const rule = CODE_RULES.find((r) => r.prefixes.some((p) => hsn.startsWith(p)));
  if (!rule) return null;
  if (rule.capital) {
    const used = usedUp(line.description);
    if (used) {
      return { ...SMALL_ITEMS, reason: `HSN ${hsn} is ${rule.what}, but "${used}" is used up, not kept: an expense, not a fixed asset` };
    }
    const unit = unitValuePaise(line);
    if (unit !== null && unit < CAPITALISE_FROM_PAISE) {
      const rupees = `₹${(unit / 100).toLocaleString('en-IN')}`;
      return { ...SMALL_ITEMS, reason: `HSN ${hsn} is ${rule.what}, but at ${rupees} a unit it is below the ₹5,000 capitalisation limit: an expense` };
    }
  }
  return { code: rule.code, name: rule.name, confidence: rule.confidence, reason: `HSN/SAC ${hsn} is ${rule.what}` };
}

interface WordRule {
  pattern: RegExp;
  code: string;
  name: string;
  confidence: number;
  what: string;
  /** Which way the money moves for the rule to apply. */
  kinds: CategoryKind[];
}

const OUT: CategoryKind[] = ['bill', 'withdrawal'];

/** Narration and vendor-name keywords, checked in order. */
const WORD_RULES: WordRule[] = [
  { pattern: /\b(charges?|chrgs?|chg|sms alert|annual fee|amc fee|min(imum)? bal(ance)?|service charge|cheque book|debit card fee|gst on charges)\b/i,
    code: '6190', name: 'Bank Charges', confidence: 0.85, what: 'a bank charge', kinds: ['withdrawal'] },
  { pattern: /\b(interest|int\.? ?(pd|paid|cr|credit)|sb int)\b/i,
    code: '4900', name: 'Other Income', confidence: 0.8, what: 'interest credited', kinds: ['deposit'] },
  { pattern: /\b(salary|salaries|payroll|wages|stipend)\b/i,
    code: '6110', name: 'Salaries & Wages', confidence: 0.8, what: 'salary', kinds: OUT },
  { pattern: /\brent(al)?\b/i, code: '6100', name: 'Rent', confidence: 0.75, what: 'rent', kinds: OUT },
  { pattern: /\b(electricity|electric|bescom|msedcl|mseb|tneb|tangedco|bses|tata power|adani electricity|torrent power|cesc|uppcl|pspcl|kseb|power bill)\b/i,
    code: '6120', name: 'Electricity & Utilities', confidence: 0.85, what: 'an electricity bill', kinds: OUT },
  { pattern: /\b(airtel|jio|vodafone|bsnl|act fibernet|hathway|broadband|internet|postpaid|mobile bill)\b/i,
    code: '6130', name: 'Telephone & Internet', confidence: 0.8, what: 'a phone or internet bill', kinds: OUT },
  { pattern: /\b(uber|ola|rapido|irctc|indigo|interglobe|air india|vistara|spicejet|akasa|makemytrip|goibibo|cleartrip|redbus|yatra|fastag|toll|petrol|diesel|fuel|hpcl|bpcl|indian oil|iocl)\b/i,
    code: '6140', name: 'Travelling & Conveyance', confidence: 0.75, what: 'travel or fuel', kinds: OUT },
  { pattern: /\b(advocate|lawyer|legal|consultancy|consulting|audit fees?|professional fees?|chartered accountant)\b/i,
    code: '6150', name: 'Professional Fees', confidence: 0.75, what: 'professional fees', kinds: OUT },
  { pattern: /\b(repairs?|maintenance|servicing|plumb(er|ing)|electrician|carpenter)\b/i,
    code: '6160', name: 'Repairs & Maintenance', confidence: 0.7, what: 'repairs', kinds: OUT },
  { pattern: /\b(stationery|stationary|printing|xerox|office supplies|courier|blue ?dart|dtdc|delhivery|speed post|india post)\b/i,
    code: '6170', name: 'Office & Stationery', confidence: 0.7, what: 'stationery or courier', kinds: OUT },
  { pattern: /\b(google ads|facebook|meta platforms|linkedin|advertis\w*|marketing|justdial|indiamart)\b/i,
    code: '6180', name: 'Advertising & Marketing', confidence: 0.75, what: 'advertising', kinds: OUT },
  { pattern: /\b(freight|logistics|cargo|transport(ers?)?|porter|lorry|truck)\b/i,
    code: '5200', name: 'Freight & Carriage', confidence: 0.7, what: 'freight', kinds: OUT },
];

/** The first rule a document's HSN/SAC codes or words satisfy, or null. */
export function ruleFor(input: {
  kind: CategoryKind;
  partyName?: string | null;
  narration?: string | null;
  lines?: CategoryLine[];
}): RuleHit | null {
  const lines = input.lines ?? [];

  // Codes are the stronger signal: they are what the supplier declared. On a
  // bill of several lines the largest line speaks for the bill; each line's
  // own account is worked out separately (ruleForLine) when they differ.
  if (input.kind === 'bill') {
    const byValue = [...lines].sort((a, b) => (b.amountPaise ?? 0) - (a.amountPaise ?? 0));
    for (const line of byValue) {
      const hit = codeRuleFor(line);
      if (hit) return hit;
    }
  }

  const text = [input.partyName, input.narration, ...lines.map((l) => l.description)].filter(Boolean).join(' ');
  if (!text) return null;
  for (const rule of WORD_RULES) {
    if (!rule.kinds.includes(input.kind)) continue;
    const match = text.match(rule.pattern);
    if (match) {
      return { code: rule.code, name: rule.name, confidence: rule.confidence, reason: `"${match[0]}" reads as ${rule.what}` };
    }
  }
  return null;
}

/**
 * One bill line's own account, from its code or its words: so a bill for a
 * laptop and a box of paper books the laptop as an asset and the paper as
 * stationery, rather than the whole bill under one of them.
 */
export function ruleForLine(line: CategoryLine): RuleHit | null {
  return codeRuleFor(line) ?? ruleFor({ kind: 'bill', lines: [{ description: line.description }] });
}

/** Words in bank narrations that name the rail or the bank, not the party. */
const NOISE = new Set([
  'UPI', 'DR', 'CR', 'NEFT', 'IMPS', 'RTGS', 'POS', 'ACH', 'NACH', 'ECS', 'P2A', 'P2M', 'MMT', 'INB', 'IB', 'TRF',
  'TRANSFER', 'PAYMENT', 'PAY', 'TO', 'FROM', 'BY', 'REF', 'TXN', 'ATM', 'WDL', 'CASH', 'DEBIT', 'CREDIT', 'CARD',
  'BIL', 'BILLPAY', 'ONL', 'ONLINE', 'NA', 'OTHERS', 'MOB', 'MOBILE', 'BANK', 'LTD', 'LIMITED', 'PVT', 'PRIVATE', 'IN', 'INDIA',
  'YESB', 'HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'PUNB', 'BARB', 'CNRB', 'IDFB', 'INDB', 'PYTM', 'AIRP', 'FDRL',
]);

/**
 * The party a bank narration names: "UPI/DR/412345678901/SWIGGY LIMITED/YESB/…"
 * → "SWIGGY". The learned vendor memory keys on this, so a person filing one
 * line from a party teaches the categoriser for the next.
 */
export function counterpartyFrom(narration: string): string | null {
  const parts = narration
    .toUpperCase()
    .split(/[/\-_:*|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    // Drop handles like "swiggy@ybl" and IFSC codes; then any word with a digit
    // in it (card and reference numbers), and the rail's own words.
    if (part.includes('@') || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(part)) continue;
    const words = part.split(/[\s,]+/).filter((w) => /^[A-Z&.]{2,}$/.test(w) && !NOISE.has(w));
    if (words.length && words.join(' ').length >= 3) return words.join(' ');
  }
  return null;
}
