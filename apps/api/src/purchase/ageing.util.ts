export interface AgeingSummary {
  current: number;   // not yet due
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
}

export function ageingBucket(dueDateStr: string | null): keyof Omit<AgeingSummary, 'total'> {
  if (!dueDateStr) return 'current';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000);

  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days1_30';
  if (daysOverdue <= 60) return 'days31_60';
  if (daysOverdue <= 90) return 'days61_90';
  return 'over90';
}

/** Buckets what is still owed on each item — not its total, which overstated part-paid ones. */
export function buildAgeingSummary(
  items: Array<{ owedPaise: number; dueDate: string | null }>,
): AgeingSummary {
  const summary: AgeingSummary = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 };
  for (const item of items) {
    if (item.owedPaise <= 0) continue;
    const bucket = ageingBucket(item.dueDate);
    summary[bucket] += item.owedPaise;
    summary.total += item.owedPaise;
  }
  return summary;
}
