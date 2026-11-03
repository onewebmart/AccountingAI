'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatRupees } from '@/lib/utils';
import type { OpenDocumentRow } from './record-party-payment-dialog';

interface AdvanceRow {
  partyId: string;
  partyName: string;
  unappliedPaise: number;
  payments: number;
}

interface PartyPaymentRow {
  _id: string;
  date: string;
  unappliedPaise: number;
  status: 'posted' | 'reversed';
}

/**
 * Advances still held: money received from a customer (or paid to a vendor)
 * before the invoice or bill it is for. Applying one settles the document
 * from the advance with a journal; the money moved on the day it was paid.
 */
export function AdvancesPanel({ kind, documents, onDone }: { kind: 'receipt' | 'payment'; documents: OpenDocumentRow[]; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState<AdvanceRow | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const advances = useQuery({ queryKey: ['payments', 'advances', kind], queryFn: () => api.get<AdvanceRow[]>(`/payments/advances?kind=${kind}`) });

  const apply = useMutation({
    mutationFn: async () => {
      const row = applying!;
      const doc = documents.find((d) => d.id === documentId)!;
      // Oldest advance first, across as many of the party's receipts as it takes.
      const list = (await api.get<PartyPaymentRow[]>(`/payments?kind=${kind}&partyId=${row.partyId}`))
        .filter((p) => p.status === 'posted' && p.unappliedPaise > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      let left = Math.min(doc.owedPaise, row.unappliedPaise);
      for (const p of list) {
        if (left <= 0) break;
        const take = Math.min(left, p.unappliedPaise);
        await api.post(`/payments/${p._id}/apply`, { documentId, amountPaise: take, date: date < p.date ? p.date : date });
        left -= take;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: [kind === 'receipt' ? 'sales' : 'purchase'] });
      setApplying(null);
      setDocumentId('');
      onDone('Advance applied');
    },
  });

  const rows = advances.data ?? [];
  if (rows.length === 0) return null;
  const doc = kind === 'receipt' ? 'invoice' : 'bill';
  const open = applying ? documents.filter((d) => d.partyId === applying.partyId && d.owedPaise > 0) : [];

  return (
    <div className="rounded-lg border border-pending-fg/30 bg-pending-bg p-4">
      <p className="mb-2 text-body font-semibold text-ink-900">{kind === 'receipt' ? 'Advances from customers' : 'Advances to vendors'}</p>
      <ul className="divide-y divide-line-100">
        {rows.map((r) => (
          <li key={r.partyId} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-body text-ink-900">
                {r.partyName} <span className="ml-2 font-mono font-semibold">{formatRupees(r.unappliedPaise)}</span>
              </span>
              {applying?.partyId !== r.partyId && (
                <Button size="sm" variant="secondary" onClick={() => { setApplying(r); setDocumentId(''); apply.reset(); }}>
                  Apply to {doc}
                </Button>
              )}
            </div>
            {applying?.partyId === r.partyId && (
              <form
                className="mt-2 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  apply.mutate();
                }}
              >
                <label className="block">
                  <span className="mb-1 block text-caption font-medium text-ink-700">{kind === 'receipt' ? 'Invoice' : 'Bill'}</span>
                  <select className="rounded-md border border-line-200 bg-white px-3 py-1.5 text-body" value={documentId} onChange={(e) => setDocumentId(e.target.value)} required>
                    <option value="">Choose…</option>
                    {open.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.number ?? 'No number'} · {formatRupees(d.owedPaise)} owed
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-caption font-medium text-ink-700">On</span>
                  <input type="date" className="rounded-md border border-line-200 bg-white px-3 py-1.5 text-body" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <Button type="submit" size="sm" disabled={!documentId || apply.isPending}>
                  {apply.isPending ? 'Applying…' : 'Apply advance'}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setApplying(null)}>
                  Cancel
                </Button>
                {open.length === 0 && <p className="w-full text-caption text-ink-500">No open {doc}s for {r.partyName} yet.</p>}
                {apply.isError && (
                  <p className="w-full text-caption text-error-fg">{apply.error instanceof ApiError && apply.error.message ? apply.error.message : "Couldn't apply the advance."}</p>
                )}
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
