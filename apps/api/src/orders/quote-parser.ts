/**
 * A customer's order message ("200 cartons of A4 paper and 10 boxes of
 * staples by Friday") read into lines, each matched to the org's own items.
 * Pure. Anything it cannot read is left for a person, never guessed.
 */

export interface ParsedLine {
  /** The part of the message this line came from. */
  text: string;
  qty: number;
  unit: string | null;
  itemText: string;
}

const UNIT = '(units?|pcs|pieces?|nos|numbers?|cartons?|ctns?|boxes|box|kgs?|kilos?|bags?|litres?|liters?|ltrs?|metres?|meters?|mtrs?|dozens?|doz|packs?|packets?|sets?|rolls?|reams?|bundles?|bottles?|cans?|sheets?|pairs?|tonnes?|tons?)';
const UNIT_CODE: Record<string, string> = {
  unit: 'NOS', units: 'NOS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS', nos: 'NOS', number: 'NOS', numbers: 'NOS', carton: 'CTN', cartons: 'CTN', ctn: 'CTN', ctns: 'CTN',
  box: 'BOX', boxes: 'BOX', kg: 'KGS', kgs: 'KGS', kilo: 'KGS', kilos: 'KGS', bag: 'BAG', bags: 'BAG', litre: 'LTR', litres: 'LTR', liter: 'LTR', liters: 'LTR', ltr: 'LTR', ltrs: 'LTR',
  metre: 'MTR', metres: 'MTR', meter: 'MTR', meters: 'MTR', mtr: 'MTR', mtrs: 'MTR', dozen: 'DOZ', dozens: 'DOZ', doz: 'DOZ', pack: 'PAC', packs: 'PAC', packet: 'PAC', packets: 'PAC',
  set: 'SET', sets: 'SET', roll: 'ROL', rolls: 'ROL', ream: 'OTH', reams: 'OTH', bundle: 'BDL', bundles: 'BDL', bottle: 'BTL', bottles: 'BTL', can: 'CAN', cans: 'CAN', sheet: 'NOS', sheets: 'NOS',
  pair: 'PRS', pairs: 'PRS', tonne: 'TON', tonnes: 'TON', ton: 'TON', tons: 'TON',
};
export const unitCode = (unit: string | null) => (unit ? UNIT_CODE[unit.toLowerCase()] ?? null : null);

const LEAD = /^(hi|hello|dear \w+|please|pls|kindly|we need|we want|need|send|supply|quote( me)?( for)?|quotation for|price for|rates? for|can you (send|supply|quote)|i need|we require|require|also|and|plus)[\s,:-]+/i;
const TAIL = /[\s,.]+(by|before|on|within)\s+[\w\s,]+$|[\s,.]+(asap|urgently|urgent|thanks|thank you|regards)\.?$/i;
const QTY_FIRST = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*(?:of|x|×)?\\s+(.{2,})$`, 'i');
const QTY_LAST = new RegExp(`^(.{2,}?)\\s*(?:[-:x×*@]|qty|quantity)\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?$`, 'i');

function clean(segment: string): string {
  let s = segment.trim().replace(/^(?:[-*•]+|\d+[.)])\s+/, '');
  for (let i = 0; i < 4 && LEAD.test(s); i++) s = s.replace(LEAD, '');
  return s.replace(/[.!]+$/, '').replace(TAIL, '').replace(/[.!]+$/, '').trim();
}

export function parseOrderText(text: string): ParsedLine[] {
  const segments = text
    // Lines, sentences, and lists run together: "…by Friday. Also 3 lamps", "10 pens, 5 pads".
    .split(/\r?\n|;|[.!?]\s+|,(?=\s*\d)|\s+and\s+(?=\d)|\s+&\s+(?=\d)|\s+plus\s+(?=\d)/i)
    .map(clean)
    .filter((s) => s.length > 1);
  const out: ParsedLine[] = [];
  for (const s of segments) {
    let m = QTY_FIRST.exec(s);
    if (m) {
      out.push({ text: s, qty: Number(m[1]), unit: m[2]?.toLowerCase() ?? null, itemText: m[3].trim() });
      continue;
    }
    m = QTY_LAST.exec(s);
    if (m) out.push({ text: s, qty: Number(m[2]), unit: m[3]?.toLowerCase() ?? null, itemText: m[1].trim() });
  }
  return out.filter((l) => l.qty > 0 && l.qty < 1_000_000);
}

const STOP = new Set(['of', 'the', 'a', 'an', 'for', 'with', 'and', 'size', 'quality', 'good', 'best', 'pcs', 'nos']);
const singular = (t: string) => (t.length > 3 && t.endsWith('es') && !t.endsWith('ses') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).map(singular));

/** The item a phrase names, by shared words; null under half a match. */
export function matchItem<T extends { name: string }>(phrase: string, items: T[]): { item: T; score: number } | null {
  const want = tokens(phrase);
  if (!want.size) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const have = tokens(item.name);
    if (!have.size) continue;
    let common = 0;
    for (const t of want) if (have.has(t)) common++;
    // Share of the item's own words found, weighed with the phrase's.
    const score = (common / have.size) * 0.6 + (common / want.size) * 0.4;
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.5 ? best : null;
}
