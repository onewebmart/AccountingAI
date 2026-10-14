'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

export interface AdjustableDocument {
  id: string;
  number: string | null;
  partyName: string;
  date: string;
  outstandingPaise: number;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
}

const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

/**
 * Raise a credit note against an invoice, or a debit note against a bill: the
 * taxable value to take off, with tax following in the document's own
 * proportions. The preview mirrors the server's split; the server decides.
 */
export function AdjustmentNoteDialog({
  kind,
  document,
  onClose,
  onRaised,
}: {
  kind: 'credit' | 'debit';
  document: AdjustableDocument | null;
  onClose: () => void;
  onRaised: (message: string) => void;
}) {
  return (
    <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {document && <NoteForm key={document.id} kind={kind} document={document} onClose={onClose} onRaised={onRaised} />}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({
  kind,
  document,
  onClose,
  onRaised,
}: {
  kind: 'credit' | 'debit';
  document: AdjustableDocument;
  onClose: () => void;
  onRaised: (message: string) => void;
}) {
  const [taxable, setTaxable] = useState('');
  const [reason, setReason] = useState('');
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const a = document.amountsPaise;
  const taxablePaise = /^\d+(\.\d{1,2})?$/.test(taxable) ? Math.round(parseFloat(taxable) * 100) : 0;
  const tax = HEADS.map((h) => (a.taxableValue > 0 ? Math.round((taxablePaise * a[h]) / a.taxableValue) : 0));
  const totalPaise = taxablePaise + tax.reduce((s, t) => s + t, 0);
  const valid = taxablePaise > 0 && totalPaise <= document.outstandingPaise && reason.trim().length >= 3 && noteDate >= document.date;
  const word = kind === 'credit' ? 'Credit note' : 'Debit note';

  const raise = useMutation({
    mutationFn: () =>
      api.post<{ noteNumber: string }>(
        kind === 'credit' ? `/sales/invoices/${document.id}/credit-notes` : `/purchase/bills/${document.id}/debit-notes`,
        { taxableValuePaise: taxablePaise, reason: reason.trim(), noteDate },
      ),
    onSuccess: (note) => {
      onRaised(`${word} ${note.noteNumber} posted`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError && err.message ? err.message : `Couldn't raise the ${word.toLowerCase()}.`),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{kind === 'credit' ? 'Raise credit note' : 'Raise debit note'}</DialogTitle>
        <DialogDescription>
          {document.partyName} · <span className="font-mono">{document.number ?? 'No number'}</span> ·{' '}
          {formatRupees(document.outstandingPaise)} owed
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Taxable value to take off (₹)</span>
          <input
            inputMode="decimal"
            value={taxable}
            placeholder="0.00"
            onChange={(e) => setTaxable(e.target.value.replace(/,/g, ''))}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-right font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        {taxablePaise > 0 && (
          <div className="rounded-md bg-surface-sink px-3 py-2 text-caption text-ink-600">
            {HEADS.map((h, i) =>
              tax[i] > 0 ? (
                <div key={h} className="flex justify-between">
                  <span className="uppercase">{h}</span>
                  <span className="font-mono">{formatRupees(tax[i])}</span>
                </div>
              ) : null,
            )}
            <div className="mt-1 flex justify-between border-t border-line-200 pt-1 font-semibold text-ink-900">
              <span>{word} total</span>
              <span className="font-mono">{formatRupees(totalPaise)}</span>
            </div>
            {totalPaise > document.outstandingPaise && (
              <p className="mt-1 text-error-fg">More than the {formatRupees(document.outstandingPaise)} still owed.</p>
            )}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Reason</span>
          <input
            value={reason}
            placeholder={kind === 'credit' ? 'e.g. Two cartons returned' : 'e.g. Short supply of 10 units'}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-ink-700">Date</span>
          <input
            type="date"
            value={noteDate}
            min={document.date}
            onChange={(e) => setNoteDate(e.target.value)}
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
          <Button onClick={() => raise.mutate()} disabled={!valid || raise.isPending}>
            {raise.isPending ? 'Posting…' : `Post ${word.toLowerCase()}`}
          </Button>
        </div>
      </div>
    </>
  );
}
