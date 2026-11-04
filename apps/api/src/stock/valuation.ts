/**
 * Stock, from its moves. Pure: weighted-average cost, run in date order, so
 * a move dated earlier changes what follows it and nothing is stored that
 * could drift from the documents.
 */

export interface Move {
  itemId: string;
  /** YYYY-MM-DD */
  date: string;
  /** + in, − out. */
  qty: number;
  /** Cost per unit, for moves in; null for moves out (valued at the average). */
  ratePaise: number | null;
  /** For moves in: the exact cost, when the document has it (a bill line's amount), so no rounding creeps in. */
  valuePaise?: number | null;
  source: { kind: 'bill' | 'invoice' | 'opening' | 'adjustment'; id: string; number: string | null };
  note?: string | null;
}

export interface LedgerRow extends Move {
  valuePaise: number;
  balanceQty: number;
  balanceValuePaise: number;
  avgPaise: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** In before out on the same day, so a day's sale is costed at what came in that day. */
export const moveOrder = (a: Move, b: Move) => a.date.localeCompare(b.date) || (b.qty > 0 ? 1 : 0) - (a.qty > 0 ? 1 : 0) || a.source.id.localeCompare(b.source.id);

/** One item's moves with the running quantity, value and average after each. */
export function itemLedger(moves: Move[]): LedgerRow[] {
  const out: LedgerRow[] = [];
  let qty = 0;
  let value = 0;
  for (const m of [...moves].sort(moveOrder)) {
    const nextQty = round3(qty + m.qty);
    let moveValue: number;
    let nextValue: number;
    if (m.qty > 0) {
      // Bought in: at its own cost, or the running average when none is given.
      const rate = m.ratePaise ?? (qty > 0 ? value / qty : 0);
      moveValue = m.valuePaise ?? Math.round(m.qty * rate);
      // Sold before it was billed, stock went under nothing: this makes those units good first, at its cost.
      nextValue = qty >= 0 ? value + moveValue : nextQty > 0 ? Math.round((moveValue * nextQty) / m.qty) : 0;
    } else {
      // Out at the average; the last unit out takes the rest of the value, so nothing is left over.
      const avg = qty > 0 ? value / qty : 0;
      moveValue = nextQty <= 0 ? 0 - value : Math.round(m.qty * avg);
      nextValue = value + moveValue;
    }
    qty = nextQty;
    value = qty > 0 ? nextValue : 0;
    out.push({ ...m, valuePaise: moveValue, balanceQty: qty, balanceValuePaise: value, avgPaise: qty > 0 ? Math.round(value / qty) : 0 });
  }
  return out;
}

export interface SummaryRow {
  itemId: string;
  qty: number;
  valuePaise: number;
  avgPaise: number;
  /** Out over the last 90 days to the date, for reordering. */
  out90: number;
  lastInRatePaise: number | null;
  prevInRatePaise: number | null;
  negative: boolean;
}

/** Each item's stock and value on a date. */
export function summary(moves: Move[], asOf: string): SummaryRow[] {
  const by = new Map<string, Move[]>();
  for (const m of moves) if (m.date <= asOf) by.set(m.itemId, [...(by.get(m.itemId) ?? []), m]);
  const from90 = new Date(Date.parse(`${asOf}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  return [...by].map(([itemId, ms]) => {
    const rows = itemLedger(ms);
    const last = rows[rows.length - 1];
    const ins = rows.filter((r) => r.qty > 0 && r.source.kind === 'bill' && r.ratePaise != null);
    return {
      itemId,
      qty: last.balanceQty,
      valuePaise: last.balanceQty > 0 ? last.balanceValuePaise : 0,
      avgPaise: last.avgPaise,
      out90: round3(-ms.filter((m) => m.qty < 0 && m.date >= from90).reduce((s, m) => s + m.qty, 0)),
      lastInRatePaise: ins.length ? ins[ins.length - 1].ratePaise : null,
      prevInRatePaise: ins.length > 1 ? ins[ins.length - 2].ratePaise : null,
      negative: last.balanceQty < 0,
    };
  });
}

export interface ReorderInput {
  qty: number;
  /** Ordered and not yet received: counted as good as in stock. */
  onOrder?: number;
  out90: number;
  reorderLevel: number | null;
  reorderQty: number | null;
}

/**
 * Whether to buy more, and how much. With a reorder level, at or under it.
 * Without one, when less than two weeks of sales are left; enough for six
 * weeks then. Nothing sold lately: nothing to reorder. What is on order
 * already counts as stock.
 */
export function reorder(r: ReorderInput): { reorder: boolean; suggestQty: number; daysLeft: number | null; reason: string } {
  const onOrder = r.onOrder ?? 0;
  const have = round3(r.qty + onOrder);
  const daily = r.out90 / 90;
  const daysLeft = daily > 0 ? Math.floor(Math.max(0, have) / daily) : null;
  const target = Math.ceil(daily * 42);
  const atLevel = r.reorderLevel != null && have <= r.reorderLevel;
  const short = r.reorderLevel == null && daily > 0 && (daysLeft ?? 0) < 14;
  if (!atLevel && !short) return { reorder: false, suggestQty: 0, daysLeft, reason: '' };
  const suggestQty = Math.max(1, r.reorderQty ?? Math.max(target - Math.max(0, have), Math.ceil(daily * 14)));
  const held = `${r.qty} in stock${onOrder ? ` and ${onOrder} on order` : ''}`;
  const reason = atLevel
    ? `${held}, at or under the reorder level of ${r.reorderLevel}.`
    : `${held}: about ${daysLeft} day${daysLeft === 1 ? '' : 's'} at the last 90 days' rate of ${Math.round(daily * 30)} a month.`;
  return { reorder: true, suggestQty, daysLeft, reason };
}
