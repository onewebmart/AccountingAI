'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { formatRupees } from '@/lib/utils';

export interface OpenDocumentRow {
  id: string;
  partyId: string | null;
  number: string | null;
  date: string;
  owedPaise: number;
}

interface Suggestion {
  allocations: Array<{ documentId: string; amountPaise: number }>;
  advancePaise: number;
  method: string;
  reason: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const rupeesText = (paise: number) => (paise ? (paise / 100).toFixed(2) : '');

/**
 * One receipt from a customer, or one payment to a vendor, across as many of
 * their open invoices or bills as it settles. Whatever is not applied is
 * held as an advance. "Suggest" fills the amounts from what the payment's
 * reference names, an exact combination, or oldest first; the person can
 * change any of them.
 */
export function RecordPartyPaymentDialog({
  open,
  kind,
  parties,
  documents,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: 'receipt' | 'payment';
  parties: Array<{ _id: string; name: string }>;
  documents: OpenDocumentRow[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState('');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [via, setVia] = useState<'bank' | 'cash'>('bank');
  const [reference, setReference] = useState('');
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [tds, setTds] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  const isReceipt = kind === 'receipt';
  const rows = documents.filter((d) => d.partyId === partyId && d.owedPaise > 0).sort((a, b) => a.date.localeCompare(b.date));
  const amountPaise = parseRupees(amount);
  const appliedPaise = rows.reduce((s, r) => s + (parseRupees(applied[r.id] ?? '') ?? 0), 0);
  const tdsPaise = rows.reduce((s, r) => s + (parseRupees(tds[r.id] ?? '') ?? 0), 0);
  const advance = (amountPaise ?? 0) - appliedPaise;
  const overOwed = rows.find((r) => (parseRupees(applied[r.id] ?? '') ?? 0) + (parseRupees(tds[r.id] ?? '') ?? 0) > r.owedPaise);
  const bad = amountPaise === null || amountPaise < 0 || advance < 0 || !!overOwed || [...Object.values(applied), ...Object.values(tds)].some((t) => (parseRupees(t) ?? -1) < 0);

  const reset = () => {
    setPartyId('');
    setDate(today());
    setAmount('');
    setVia('bank');
    setReference('');
    setApplied({});
    setTds({});
    setHint(null);
    suggest.reset();
    save.reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  const suggest = useMutation({
    mutationFn: () => api.post<Suggestion>('/payments/suggest', { kind, partyId, amountPaise: amountPaise ?? 0, text: reference || undefined }),
    onSuccess: (s) => {
      setApplied(Object.fromEntries(s.allocations.map((a) => [a.documentId, rupeesText(a.amountPaise)])));
      setTds({});
      setHint(s.reason);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        kind,
        partyId,
        date,
        amountPaise: amountPaise ?? 0,
        via,
        reference: reference.trim() || undefined,
        allocations: rows
          .map((r) => ({ documentId: r.id, amountPaise: parseRupees(applied[r.id] ?? '') ?? 0, tdsPaise: isReceipt ? parseRupees(tds[r.id] ?? '') ?? 0 : 0 }))
          .filter((a) => a.amountPaise > 0 || a.tdsPaise > 0)
          // A vendor payment carries no TDS: that was withheld when the bill was posted.
          .map((a) => (isReceipt ? a : { documentId: a.documentId, amountPaise: a.amountPaise })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [isReceipt ? 'sales' : 'purchase'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['journals'] });
      onDone(isReceipt ? 'Receipt recorded' : 'Payment recorded');
      close();
    },
  });

  const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const cell = 'w-24 rounded border border-line-200 bg-white px-2 py-1 text-right font-mono text-body focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const label = 'mb-1 block text-caption font-medium text-ink-700';
  const party = parties.find((p) => p._id === partyId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isReceipt ? 'Record receipt' : 'Record payment'}</DialogTitle>
          <DialogDescription>
            {isReceipt ? 'Money in from a customer, across as many invoices as it pays.' : 'Money out to a vendor, across as many bills as it pays.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 block">
              <span className={label}>{isReceipt ? 'Customer' : 'Vendor'}</span>
              <select
                className={field}
                value={partyId}
                onChange={(e) => {
                  setPartyId(e.target.value);
                  setApplied({});
                  setTds({});
                  setHint(null);
                }}
                required
              >
                <option value="">Choose…</option>
                {parties.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{isReceipt ? 'Received' : 'Paid'} (₹)</span>
              <input className={`${field} text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <label className="block">
              <span className={label}>On</span>
              <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="block">
              <span className={label}>Through</span>
              <select className={field} value={via} onChange={(e) => setVia(e.target.value as 'bank' | 'cash')}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>Reference or remittance</span>
              <input className={field} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR, cheque no., or the invoice numbers it pays" />
            </label>
          </div>

          {partyId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-caption font-semibold uppercase tracking-wide text-ink-500">Open {isReceipt ? 'invoices' : 'bills'}</p>
                <Button type="button" size="sm" variant="secondary" disabled={!amountPaise || suggest.isPending || rows.length === 0} onClick={() => suggest.mutate()} className="flex items-center gap-1.5">
                  <Sparkles size={13} className="text-marigold-400" /> {suggest.isPending ? 'Working it out…' : 'Suggest allocation'}
                </Button>
              </div>
              {hint && <p className="rounded-md bg-honey-100 px-3 py-1.5 text-caption text-pending-fg">Suggested: {hint} Check before recording.</p>}
              {rows.length === 0 ? (
                <p className="text-caption text-ink-400">{party?.name} has nothing open. All of this will be held as an advance.</p>
              ) : (
                <div className="max-h-64 divide-y divide-line-100 overflow-auto rounded-md border border-line-200">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="flex-1 text-body text-ink-900">
                        <span className="font-mono">{r.number ?? 'No number'}</span>
                        <span className="ml-2 text-caption text-ink-500">{r.date} · {formatRupees(r.owedPaise)} owed</span>
                      </span>
                      <input
                        aria-label={`Apply to ${r.number ?? r.id}`}
                        className={`${cell} ${overOwed?.id === r.id ? 'border-error-fg' : ''}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={applied[r.id] ?? ''}
                        onChange={(e) => setApplied({ ...applied, [r.id]: e.target.value })}
                      />
                      {isReceipt && (
                        <input aria-label={`TDS on ${r.number ?? r.id}`} className={cell} inputMode="decimal" placeholder="TDS" value={tds[r.id] ?? ''} onChange={(e) => setTds({ ...tds, [r.id]: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-5 rounded-md bg-surface-sink px-4 py-3 text-body">
            <span>
              Applied <span className="font-mono font-semibold">{formatRupees(appliedPaise)}</span>
            </span>
            {isReceipt && tdsPaise > 0 && (
              <span>
                TDS <span className="font-mono font-semibold">{formatRupees(tdsPaise)}</span>
              </span>
            )}
            <span className={advance < 0 ? 'text-error-fg' : advance > 0 ? 'text-pending-fg' : 'text-ink-700'}>
              {advance < 0 ? `Over by ${formatRupees(-advance)}` : advance > 0 ? `${formatRupees(advance)} held as an advance` : 'Nothing left over'}
            </span>
          </div>
          {advance > 0 && isReceipt && (
            <p className="text-caption text-ink-500">
              An advance waits on the Advances from Customers account until you apply it to an invoice. GST is due on advances for services when received; check with your CA.
            </p>
          )}
          {overOwed && <p className="text-caption text-error-fg">{overOwed.number ?? 'One of them'} has only {formatRupees(overOwed.owedPaise)} owed.</p>}
          {save.isError && <p className="text-caption text-error-fg">{save.error instanceof ApiError && save.error.message ? save.error.message : "Couldn't record it."}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!partyId || bad || save.isPending || ((amountPaise ?? 0) === 0 && tdsPaise === 0)}>
              {save.isPending ? 'Recording…' : isReceipt ? 'Record receipt' : 'Record payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
