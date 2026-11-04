'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

type Match =
  | { linked: false; candidates: Array<{ id: string; number: string; date: string; totalPaise: number }> }
  | { linked: true; po: { id: string; number: string }; status: 'matched' | 'minor' | 'differences'; differences: Array<{ level: 'stop' | 'look'; message: string }> };

/** A bill against its purchase order and what was received, or the vendor's open POs to tie it to. */
export function PoMatchSection({ billId }: { billId: string }) {
  const qc = useQueryClient();
  const key = ['orders', 'match', billId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<Match>(`/orders/bills/${billId}/match`), retry: false });
  const link = useMutation({
    mutationFn: (poId: string) => api.post(`/orders/purchase-orders/${poId}/link-bill`, { billId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  if (!data) return null;
  if (!data.linked && data.candidates.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">Purchase order match</p>
      {data.linked ? (
        data.status === 'matched' ? (
          <p className="text-caption text-success-fg">Matches {data.po.number} and what was received.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-caption text-ink-600">Against {data.po.number}:</p>
            <ul className="space-y-1">
              {data.differences.map((d, i) => (
                <li key={i} className="rounded-md bg-pending-bg p-2 text-caption text-pending-fg">{d.level === 'stop' ? 'Check before paying: ' : ''}{d.message}</li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <div className="space-y-1 text-caption">
          <p className="text-ink-500">Open purchase orders from this vendor:</p>
          {data.candidates.map((c) => (
            <div key={c.id} className="flex items-center justify-between">
              <span>{c.number} · {c.date} · <span className="font-mono">{formatPaise(c.totalPaise)}</span></span>
              <button className="font-medium text-ink-600 hover:underline disabled:opacity-50" disabled={link.isPending} onClick={() => link.mutate(c.id)}>Match to this PO</button>
            </div>
          ))}
          {link.isError && <p className="text-error-fg">{link.error instanceof ApiError ? link.error.message : 'Could not match.'}</p>}
        </div>
      )}
    </div>
  );
}
