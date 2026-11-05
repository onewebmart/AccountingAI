'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Section, StatusChip } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, shortDate } from './purchase-data';

type Match =
  | { linked: false; candidates: Array<{ id: string; number: string; date: string; totalPaise: number }> }
  | { linked: true; po: { id: string; number: string }; status: 'matched' | 'minor' | 'differences'; differences: Array<{ level: 'stop' | 'look'; message: string }> };

/**
 * A bill against its purchase order and what was received, each difference
 * in words; or the vendor's open purchase orders to match it to. Nothing
 * here posts.
 */
export function PoMatch({ billId }: { billId: string }) {
  const qc = useQueryClient();
  const key = ['orders', 'match', billId];
  const { data, isError } = useQuery({ queryKey: key, queryFn: () => api.get<Match>(`/orders/bills/${billId}/match`), retry: false });
  const link = useMutation({
    mutationFn: (poId: string) => api.post(`/orders/purchase-orders/${poId}/link-bill`, { billId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['orders', 'purchase-orders'] });
      notify('Matched to the purchase order');
    },
    onError: (e) => notify(errorText(e, "Couldn't match it."), 'error'),
  });
  if (isError || !data) return null;
  if (!data.linked && data.candidates.length === 0) return null;

  return (
    <Section
      title="Purchase order match"
      description={data.linked ? 'The bill against what was ordered and what was received.' : 'This vendor has open purchase orders. Match the bill to one to check it line by line.'}
      actions={data.linked ? <Link href={`/purchases/orders/${data.po.id}`} className="text-caption font-medium text-ink-600 hover:underline">Open {data.po.number}</Link> : undefined}
    >
      {data.linked ? (
        data.status === 'matched' ? (
          <p className="text-body text-success-fg">Matches {data.po.number} and what was received.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.differences.map((d, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">
                {d.level === 'stop' && <StatusChip tone="pending">Check before paying</StatusChip>}
                <span className="pt-0.5">{d.message}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="divide-y divide-line-100">
          {data.candidates.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body">
              <span>
                <Link href={`/purchases/orders/${c.id}`} className="font-mono hover:underline">{c.number}</Link> · {shortDate(c.date)} · <span className="font-mono">{formatPaise(c.totalPaise)}</span>
              </span>
              <button type="button" className="text-caption font-medium text-ink-700 hover:underline disabled:opacity-50" disabled={link.isPending} onClick={() => link.mutate(c.id)}>
                Match to this PO
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
