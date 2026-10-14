'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

export interface PayableDocument {
  id: string;
  number: string | null;
  partyName: string;
  outstandingPaise: number;
}

/**
 * Record a receipt (invoice) or payment (bill) — all of what is owed, or part
 * of it, on the day the money actually moved. "Mark paid" used to settle the
 * whole amount, dated today, with no way to say otherwise.
 */
export function RecordPaymentDialog({
  kind,
  document,
  onClose,
  onRecorded,
}: {
  kind: 'invoice' | 'bill';
  document: PayableDocument | null;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  return (
    <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {/* Keyed so each document opens with its own amount, not the last one's. */}
        {document && <PaymentForm key={document.id} kind={kind} document={document} onClose={onClose} onRecorded={onRecorded} />}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  kind,
  document,
  onClose,
  onRecorded,
}: {
  kind: 'invoice' | 'bill';
  document: PayableDocument;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  const [amount, setAmount] = useState((document.outstandingPaise / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const amountPaise = /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(parseFloat(amount) * 100) : NaN;
  const valid = Number.isInteger(amountPaise) && amountPaise > 0 && amountPaise <= document.outstandingPaise;
  const inFull = amountPaise === document.outstandingPaise;

  const pay = useMutation({
    mutationFn: () =>
      api.post(kind === 'invoice' ? `/sales/invoices/${document.id}/pay` : `/purchase/bills/${document.id}/pay`, {
        amountPaise,
        paidOn,
      }),
    onSuccess: () => {
      onRecorded(inFull ? 'Payment recorded' : `Part payment of ${formatRupees(amountPaise)} recorded`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError && err.message ? err.message : "Couldn't record that payment."),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{kind === 'invoice' ? 'Record receipt' : 'Record payment'}</DialogTitle>
        <DialogDescription>
          {document.partyName} · <span className="font-mono">{document.number ?? 'No number'}</span> ·{' '}
          {formatRupees(document.outstandingPaise)} owed
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Amount (₹)</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/,/g, ''))}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-right font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {!valid && amount !== '' && (
            <span className="mt-1 block text-caption text-error-fg">
              Enter an amount up to {formatRupees(document.outstandingPaise)}.
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">
            {kind === 'invoice' ? 'Received on' : 'Paid on'}
          </span>
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-md border border-error-fg/30 bg-error-bg px-3 py-2 text-caption text-error-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => pay.mutate()} disabled={!valid || !paidOn || pay.isPending}>
            {pay.isPending ? 'Recording…' : inFull ? 'Record payment' : 'Record part payment'}
          </Button>
        </div>
      </div>
    </>
  );
}
