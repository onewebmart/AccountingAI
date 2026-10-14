'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

/** What GET /sales/ar-ageing and /purchase/ap-ageing return, in paise. */
interface AgeingSummary {
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
}

const BUCKETS: Array<{ key: keyof Omit<AgeingSummary, 'total'>; label: string; overdue: boolean }> = [
  { key: 'current', label: 'Not yet due', overdue: false },
  { key: 'days1_30', label: '1–30 days late', overdue: true },
  { key: 'days31_60', label: '31–60 days late', overdue: true },
  { key: 'days61_90', label: '61–90 days late', overdue: true },
  { key: 'over90', label: '90+ days late', overdue: true },
];

/**
 * What is still owed, by how late it is. Both pages used to show four fixed
 * figures typed into the page, the same for every organisation.
 */
export function AgeingBuckets({ kind }: { kind: 'receivable' | 'payable' }) {
  const path = kind === 'receivable' ? '/sales/ar-ageing' : '/purchase/ap-ageing';
  const query = useQuery<AgeingSummary>({
    queryKey: [kind === 'receivable' ? 'sales' : 'purchase', 'ageing'],
    queryFn: () => api.get<AgeingSummary>(path),
  });

  if (query.isError) {
    return <p className="text-caption text-error-fg">Couldn&apos;t load the ageing. Refresh to try again.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {BUCKETS.map((bucket) => {
        const paise = query.data?.[bucket.key] ?? 0;
        const tone = paise === 0 ? 'text-ink-400' : bucket.overdue ? 'text-error-fg' : 'text-pending-fg';
        return (
          <div key={bucket.key} className="rounded-lg border border-line-200 bg-surface-card p-4">
            <p className="text-caption text-ink-500 mb-1">{bucket.label}</p>
            <p className={`text-h3 font-mono font-semibold ${query.isLoading ? 'text-ink-400' : tone}`}>
              {query.isLoading ? '—' : formatRupees(paise)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
