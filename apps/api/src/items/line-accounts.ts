import { allocate } from '../gst/gst-returns';

/**
 * A document's taxable value shared across the accounts its lines post to,
 * in proportion to each line's amount, to the paise. Lines with no account
 * of their own (no item, or an item with none set) go to the fallback. Lines
 * on different projects stay apart, so each project's income or cost is its
 * own journal line. The parts always add back to the total exactly, so the
 * journal still balances.
 */
export function splitByAccount(
  total: number,
  lines: Array<{ amountPaise: number; accountId?: { toString(): string } | null; projectId?: { toString(): string } | null }>,
  fallbackId: string,
): Array<{ accountId: string; projectId: string | null; amountPaise: number }> {
  if (!lines.some((l) => l.accountId || l.projectId)) return [{ accountId: fallbackId, projectId: null, amountPaise: total }];
  const shares = allocate(total, lines.map((l) => l.amountPaise));
  const byKey = new Map<string, { accountId: string; projectId: string | null; amountPaise: number }>();
  lines.forEach((l, i) => {
    const accountId = l.accountId ? l.accountId.toString() : fallbackId;
    const projectId = l.projectId ? l.projectId.toString() : null;
    const key = `${accountId}|${projectId ?? ''}`;
    const part = byKey.get(key) ?? { accountId, projectId, amountPaise: 0 };
    part.amountPaise += shares[i];
    byKey.set(key, part);
  });
  const parts = [...byKey.values()].filter((p) => p.amountPaise !== 0);
  return parts.length ? parts : [{ accountId: fallbackId, projectId: null, amountPaise: total }];
}
