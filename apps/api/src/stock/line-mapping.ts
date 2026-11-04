/**
 * Which item a bill or invoice line is. Pure, rules only, each with its
 * reason: what this vendor's lines were linked to before, then any line with
 * the same words, then the item whose name shares them; nothing close, a new
 * item to create. A suggestion only: a person links it.
 */
import { ITEM_GST_RATES } from '../items/hsn';
import { matchItem } from '../orders/quote-parser';

export interface MappingItem {
  id: string;
  name: string;
  kind: 'goods' | 'service';
  hsnSac: string | null;
}

/** A line a person linked before, and where. */
export interface LinkedLine {
  partyId: string;
  description: string;
  itemId: string;
  docNumber: string | null;
}

export interface MappingLine {
  partyId: string;
  description: string;
  hsnSac: string | null;
  taxRatePct: number;
}

export type Suggestion =
  | { by: 'vendor_history' | 'history' | 'name'; itemId: string; itemName: string; confidence: number; reason: string }
  | { by: 'new'; itemId: null; itemName: null; confidence: number; reason: string; newItem: { name: string; kind: 'goods' | 'service'; hsnSac: string | null; gstRatePct: number | null } };

export const descriptionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hsn4 = (s: string | null) => (s ? s.replace(/\s+/g, '').slice(0, 4) : '');

/** Services (SAC 99…) are not stock. */
export const isServiceLine = (hsnSac: string | null) => !!hsnSac && hsnSac.trim().startsWith('99');

/** A line's text as an item name: codes and pack sizes kept, noise trimmed. */
export function itemNameFrom(description: string): string {
  const s = description.replace(/\s+/g, ' ').replace(/^[\s\-–•*.\d)]+(?=[A-Za-z])/, '').trim();
  return (s || description.trim()).slice(0, 200);
}

export function suggestItem(line: MappingLine, items: MappingItem[], linked: LinkedLine[], party: 'vendor' | 'customer' = 'vendor'): Suggestion {
  const byId = new Map(items.map((i) => [i.id, i]));
  const key = descriptionKey(line.description);

  // The same words, linked before: this party's first, then anyone's.
  const same = linked.filter((l) => descriptionKey(l.description) === key && byId.has(l.itemId));
  const own = same.filter((l) => l.partyId === line.partyId);
  const from = own.length ? own : same;
  const pick = from[from.length - 1];
  if (pick) {
    const item = byId.get(pick.itemId)!;
    const where = pick.docNumber ? ` on ${pick.docNumber}` : '';
    return own.length
      ? { by: 'vendor_history', itemId: item.id, itemName: item.name, confidence: 0.95, reason: `This ${party}'s "${pick.description}" was linked to ${item.name}${where}.` }
      : { by: 'history', itemId: item.id, itemName: item.name, confidence: 0.85, reason: `"${pick.description}" was linked to ${item.name}${where}.` };
  }

  const goods = items.filter((i) => i.kind === 'goods');
  const hit = matchItem(line.description, goods);
  if (hit) {
    let confidence = Math.min(0.8, hit.score * 0.8);
    let reason = `Shares its words with ${hit.item.name}.`;
    const a = hsn4(line.hsnSac);
    const b = hsn4(hit.item.hsnSac);
    if (a.length === 4 && b.length === 4) {
      if (a === b) {
        confidence = Math.min(0.85, confidence + 0.1);
        reason = `Shares its words and HSN ${a} with ${hit.item.name}.`;
      } else {
        confidence = Math.max(0.3, confidence - 0.25);
        reason = `Shares its words with ${hit.item.name}, but its HSN ${a} is not the item's ${b}: check it is the same thing.`;
      }
    }
    return { by: 'name', itemId: hit.item.id, itemName: hit.item.name, confidence: Math.round(confidence * 100) / 100, reason };
  }

  const rate = (ITEM_GST_RATES as readonly number[]).includes(line.taxRatePct) ? line.taxRatePct : null;
  return {
    by: 'new',
    itemId: null,
    itemName: null,
    confidence: 0.5,
    reason: 'No item matches these words: create one from the line.',
    newItem: { name: itemNameFrom(line.description), kind: isServiceLine(line.hsnSac) ? 'service' : 'goods', hsnSac: line.hsnSac?.replace(/\s+/g, '') || null, gstRatePct: rate },
  };
}
