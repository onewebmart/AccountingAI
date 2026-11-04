import { allocate } from '../gst/gst-returns';

/**
 * A document's taxable value shared across the accounts its lines post to,
 * in proportion to each line's amount, to the paise. Lines with no account
 * of their own (no item, or an item with none set) go to the fallback. The
 * parts always add back to the total exactly, so the journal still balances.
 */
export function splitByAccount(
  total: number,
  lines: Array<{ amountPaise: number; accountId?: { toString(): string } | null }>,
  fallbackId: string,
): Array<{ accountId: string; amountPaise: number }> {
  if (!lines.some((l) => l.accountId)) return [{ accountId: fallbackId, amountPaise: total }];
  const shares = allocate(total, lines.map((l) => l.amountPaise));
  const byAccount = new Map<string, number>();
  lines.forEach((l, i) => {
    const id = l.accountId ? l.accountId.toString() : fallbackId;
    byAccount.set(id, (byAccount.get(id) ?? 0) + shares[i]);
  });
  const parts = [...byAccount].filter(([, amount]) => amount !== 0).map(([accountId, amountPaise]) => ({ accountId, amountPaise }));
  return parts.length ? parts : [{ accountId: fallbackId, amountPaise: total }];
}
