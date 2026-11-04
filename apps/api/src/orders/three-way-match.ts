import { matchItem } from './quote-parser';

/**
 * A bill against its purchase order and what was received (the 3-way
 * match), each difference in words. Pure: every figure is computed here.
 */

export interface MatchLine {
  description: string;
  itemId: string | null;
  qty: number;
  ratePaise: number;
  taxRatePct: number;
}

export interface PoLine extends MatchLine {
  /** Received so far, over all GRNs. */
  receivedQty: number;
  /** Billed so far on other bills. */
  billedQty: number;
}

export interface Difference {
  level: 'stop' | 'look';
  billLine: number | null;
  poLine: number | null;
  message: string;
}

const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const q = (n: number) => String(Math.round(n * 1000) / 1000);

/** Which PO line each bill line is: the same item, else the closest description. */
export function pairLines(bill: MatchLine[], po: PoLine[]): Array<number | null> {
  const used = new Set<number>();
  return bill.map((b) => {
    let at = b.itemId ? po.findIndex((p, i) => !used.has(i) && p.itemId === b.itemId) : -1;
    if (at < 0) {
      const open = po.map((p, i) => ({ name: p.description, i })).filter((x) => !used.has(x.i));
      const hit = matchItem(b.description, open);
      at = hit ? hit.item.i : -1;
    }
    if (at < 0) return null;
    used.add(at);
    return at;
  });
}

export function threeWayMatch(input: { bill: MatchLine[]; po: PoLine[]; lastRates?: Map<number, number> }) {
  const pairs = pairLines(input.bill, input.po);
  const differences: Difference[] = [];
  input.bill.forEach((b, i) => {
    const at = pairs[i];
    const label = `"${b.description}"`;
    if (at === null) {
      differences.push({ level: 'stop', billLine: i, poLine: null, message: `${label} is billed but not on the purchase order.` });
      return;
    }
    const p = input.po[at];
    const billable = p.receivedQty - p.billedQty;
    if (b.qty > billable + 1e-9) {
      differences.push({
        level: 'stop', billLine: i, poLine: at,
        message: p.billedQty > 0
          ? `${label}: billed ${q(b.qty)}, but only ${q(billable)} received and not yet billed (${q(p.receivedQty)} received, ${q(p.billedQty)} billed before).`
          : `${label}: billed ${q(b.qty)}, received ${q(p.receivedQty)}.`,
      });
    }
    if (b.qty + p.billedQty > p.qty + 1e-9) differences.push({ level: 'stop', billLine: i, poLine: at, message: `${label}: ${q(b.qty + p.billedQty)} billed in all against ${q(p.qty)} ordered.` });
    if (b.ratePaise > p.ratePaise) differences.push({ level: 'stop', billLine: i, poLine: at, message: `${label}: rate ${rs(b.ratePaise)}, ${rs(b.ratePaise - p.ratePaise)} above the PO's ${rs(p.ratePaise)}.` });
    else if (b.ratePaise < p.ratePaise) differences.push({ level: 'look', billLine: i, poLine: at, message: `${label}: rate ${rs(b.ratePaise)}, below the PO's ${rs(p.ratePaise)}.` });
    if (b.taxRatePct !== p.taxRatePct) differences.push({ level: 'look', billLine: i, poLine: at, message: `${label}: GST ${b.taxRatePct}% on the bill, ${p.taxRatePct}% on the PO.` });
    const last = input.lastRates?.get(i);
    if (last && last !== b.ratePaise && Math.abs(b.ratePaise - last) / last >= 0.05) {
      differences.push({ level: 'look', billLine: i, poLine: at, message: `${label}: ${rs(b.ratePaise)} is ${b.ratePaise > last ? 'up' : 'down'} ${Math.round((Math.abs(b.ratePaise - last) / last) * 100)}% on the last purchase at ${rs(last)}.` });
    }
  });
  input.po.forEach((p, at) => {
    if (!pairs.includes(at) && p.receivedQty > p.billedQty) differences.push({ level: 'look', billLine: null, poLine: at, message: `"${p.description}": ${q(p.receivedQty - p.billedQty)} received but not on this bill.` });
  });
  return {
    pairs,
    differences,
    status: differences.some((d) => d.level === 'stop') ? ('differences' as const) : differences.length ? ('minor' as const) : ('matched' as const),
  };
}
