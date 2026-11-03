/**
 * Which open invoices (or bills) a lump sum pays, as a person would work it
 * out: the ones the remittance names, or the ones whose amounts add up to it
 * exactly, or else oldest first. Pure and in integer paise. It only
 * suggests; the person changes it before recording anything.
 */

export interface OpenDocument {
  id: string;
  number: string | null;
  date: string;
  owedPaise: number;
}

export interface Suggestion {
  allocations: Array<{ documentId: string; number: string | null; date: string; owedPaise: number; amountPaise: number }>;
  /** What is left over, held as an advance. */
  advancePaise: number;
  method: 'named' | 'exact' | 'oldest_first' | 'none';
  reason: string;
}

const key = (s: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Search at most this many of the oldest documents for an exact combination. */
const EXACT_SEARCH = 16;

export function suggestAllocation(amountPaise: number, open: OpenDocument[], text?: string | null): Suggestion {
  const docs = [...open].filter((d) => d.owedPaise > 0).sort((a, b) => a.date.localeCompare(b.date) || key(a.number).localeCompare(key(b.number)));
  if (amountPaise <= 0 || docs.length === 0) {
    return { allocations: [], advancePaise: Math.max(0, amountPaise), method: 'none', reason: docs.length ? 'Nothing to apply.' : 'Nothing is owed, so it is all an advance.' };
  }
  const take = (picked: OpenDocument[], method: Suggestion['method'], reason: string): Suggestion => {
    let left = amountPaise;
    const allocations = [];
    for (const d of picked) {
      if (left <= 0) break;
      const amount = Math.min(left, d.owedPaise);
      allocations.push({ documentId: d.id, number: d.number, date: d.date, owedPaise: d.owedPaise, amountPaise: amount });
      left -= amount;
    }
    return { allocations, advancePaise: left, method, reason };
  };

  // 1. The remittance or narration names them.
  const said = key(text ?? '');
  if (said) {
    const named = docs.filter((d) => key(d.number).length >= 3 && said.includes(key(d.number)));
    if (named.length) {
      const rest = docs.filter((d) => !named.includes(d));
      return take([...named, ...rest], 'named', `The payment names ${named.map((d) => d.number).join(', ')}.`);
    }
  }

  // 2. Some of them add up to it exactly: fewest documents, then oldest.
  const pool = docs.slice(0, EXACT_SEARCH);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let sum = 0;
    const picked: number[] = [];
    for (let i = 0; i < pool.length && sum <= amountPaise; i++) {
      if (mask & (1 << i)) {
        sum += pool[i].owedPaise;
        picked.push(i);
      }
    }
    if (sum !== amountPaise) continue;
    if (!best || picked.length < best.length || (picked.length === best.length && picked.join() < best.join())) best = picked;
  }
  if (best) {
    const picked = best.map((i) => pool[i]);
    return take(
      picked,
      'exact',
      picked.length === 1 ? `${picked[0].number ?? 'One invoice'} is for exactly ${rupees(amountPaise)}.` : `${picked.map((d) => d.number).join(' + ')} add up to exactly ${rupees(amountPaise)}.`,
    );
  }

  // 3. Oldest first; any excess is an advance.
  const total = docs.reduce((s, d) => s + d.owedPaise, 0);
  return take(
    docs,
    'oldest_first',
    amountPaise > total
      ? `More than everything owed (${rupees(total)}): all of it is settled, and ${rupees(amountPaise - total)} is held as an advance.`
      : 'No combination adds up exactly, so the oldest are settled first.',
  );
}
