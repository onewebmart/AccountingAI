'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageHeader, FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { errorText, shortDate, todayIst, useInvoices, useLedgerRefresh, type InvoiceRecord } from '@/components/sales/sales-data';
import { SalesDocumentForm } from '@/components/sales/doc-form';

const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

/**
 * A credit note by value: the taxable value to take off a posted invoice,
 * with tax following in the invoice's own proportions. It posts when it is
 * raised. The preview mirrors the server's split; the server decides.
 */
function ByValueForm() {
  const router = useRouter();
  const params = useSearchParams();
  const refresh = useLedgerRefresh();
  const invoices = useInvoices();
  const [invoiceId, setInvoiceId] = useState(params.get('invoiceId') ?? '');
  const [taxable, setTaxable] = useState('');
  const [reason, setReason] = useState('');
  const [noteDate, setNoteDate] = useState(todayIst());
  const [problem, setProblem] = useState<string | null>(null);

  const record = useQuery({
    queryKey: ['sales', 'invoice', invoiceId],
    queryFn: () => api.get<InvoiceRecord>(`/sales/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  });
  const choices = (invoices.data ?? []).filter((i) => i.status === 'posted' || i.status === 'paid');
  const row = (invoices.data ?? []).find((i) => i._id === invoiceId);
  const inv = record.data;
  const a = inv?.amountsPaise;
  const owed = inv ? inv.amountsPaise.total - (inv.amountPaidPaise ?? 0) - (inv.adjustedPaise ?? 0) : 0;
  const taxablePaise = parseRupees(taxable) ?? 0;
  const tax = HEADS.map((h) => (a && a.taxableValue > 0 ? Math.round((taxablePaise * a[h]) / a.taxableValue) : 0));
  const totalPaise = taxablePaise + tax.reduce((s, t) => s + t, 0);
  const usable = !!inv && (inv.status === 'posted' || inv.status === 'paid');

  const raise = useMutation({
    mutationFn: () => api.post<{ noteNumber: string }>(`/sales/invoices/${invoiceId}/credit-notes`, { taxableValuePaise: taxablePaise, reason: reason.trim(), noteDate }),
    onSuccess: (note) => {
      refresh();
      notify(`Credit note ${note.noteNumber} posted`);
      router.push(`/sales/invoices/${invoiceId}`);
    },
  });

  const submit = () => {
    if (!inv) return setProblem('Choose the invoice.');
    if (!usable) return setProblem('Only a posted invoice takes a credit note.');
    if (parseRupees(taxable) === null || taxablePaise <= 0) return setProblem('Enter the taxable value to take off, in rupees.');
    if (a && totalPaise > a.total) return setProblem(`More than the ${formatPaise(a.total)} the invoice was for.`);
    if (reason.trim().length < 3) return setProblem('Say why the note is raised.');
    if (noteDate < inv.invoiceDate) return setProblem('A credit note cannot be dated before its invoice.');
    setProblem(null);
    raise.mutate();
  };

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (raise.isError ? errorText(raise.error, "Couldn't raise the credit note.") : null)}
      actions={
        <>
          <Button type="submit" disabled={raise.isPending || !usable}>{raise.isPending ? 'Posting…' : 'Post credit note'}</Button>
          <Button asChild variant="secondary"><Link href={invoiceId ? `/sales/invoices/${invoiceId}` : '/sales/credit-notes'}>Cancel</Link></Button>
          <p className="text-caption text-ink-500">A credit note posts to the ledger as soon as it is raised.</p>
        </>
      }
    >
      <Section title="The invoice">
        <Field label="Invoice" required>
          <select className={inputClass} value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setProblem(null); }}>
            <option value="">{invoices.isLoading ? 'Loading…' : 'Choose a posted invoice…'}</option>
            {/* One linked here from an invoice may be older than the latest 200. */}
            {invoiceId && !choices.some((c) => c._id === invoiceId) && inv && <option value={invoiceId}>{inv.invoiceNumber ?? 'Not numbered'}</option>}
            {choices.map((i) => (
              <option key={i._id} value={i._id}>
                {i.invoiceNumber ?? 'Not numbered'} · {i.customerName} · {formatPaise(i.totalPaise)}
              </option>
            ))}
          </select>
        </Field>
        {inv && a && (
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-body sm:grid-cols-4">
            <div><dt className="text-caption text-ink-500">Customer</dt><dd>{row?.customerName ?? inv.partyAtIssue?.name ?? '—'}</dd></div>
            <div><dt className="text-caption text-ink-500">Date</dt><dd>{shortDate(inv.invoiceDate)}</dd></div>
            <div><dt className="text-caption text-ink-500">Total</dt><dd className="font-mono tabular-nums">{formatPaise(a.total)}</dd></div>
            <div><dt className="text-caption text-ink-500">Still owed</dt><dd className="font-mono tabular-nums">{formatPaise(Math.max(0, owed))}</dd></div>
          </dl>
        )}
        {inv && !usable && <p className="mt-3 text-caption text-error-fg">This invoice is {inv.status}: post it before raising a credit note.</p>}
      </Section>

      <Section title="The credit note">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Taxable value to take off (₹)" required>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" placeholder="0.00" value={taxable} onChange={(e) => setTaxable(e.target.value)} />
          </Field>
          <Field label="Date" required>
            <input type="date" className={inputClass} value={noteDate} min={inv?.invoiceDate} onChange={(e) => setNoteDate(e.target.value)} />
          </Field>
          <Field label="Reason" required>
            <input className={inputClass} maxLength={300} value={reason} placeholder="e.g. Two cartons returned" onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {a && taxablePaise > 0 && (
          <dl className="mt-4 max-w-sm rounded-md bg-surface-sink px-4 py-3">
            {HEADS.map((h, i) =>
              tax[i] > 0 ? (
                <div key={h} className="flex justify-between py-0.5 text-body">
                  <dt className="uppercase text-ink-600">{h}</dt>
                  <dd className="font-mono tabular-nums">{formatPaise(tax[i])}</dd>
                </div>
              ) : null,
            )}
            <div className="mt-1 flex justify-between border-t border-line-200 pt-1 font-semibold">
              <dt>Credit note total</dt>
              <dd className="font-mono tabular-nums">{formatPaise(totalPaise)}</dd>
            </div>
            {totalPaise > a.total ? (
              <p className="mt-1 text-caption text-error-fg">More than the {formatPaise(a.total)} the invoice was for.</p>
            ) : (
              totalPaise > owed && (
                <p className="mt-1 text-caption text-pending-fg">
                  {formatPaise(totalPaise - Math.max(0, owed))} more than is owed: that part becomes the customer&apos;s credit, to apply to their next invoice or refund.
                </p>
              )
            )}
          </dl>
        )}
      </Section>
    </FormPage>
  );
}

type Mode = 'lines' | 'value';

/** Itemised by default: what is credited, line by line. Or just a taxable value off the invoice. */
function NewCreditNote() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'value' ? 'value' : 'lines');
  return (
    <div className="space-y-5">
      <div className="inline-flex overflow-hidden rounded-md border border-line-200 bg-surface-card" role="tablist" aria-label="How to credit">
        {([['lines', 'Line by line'], ['value', 'Taxable value only']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn('px-4 py-2 text-caption font-medium', mode === m ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-surface-sink')}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'lines' ? <SalesDocumentForm kind="credit_note" /> : <ByValueForm />}
    </div>
  );
}

export default function NewCreditNotePage() {
  return (
    <div>
      <PageHeader
        title="New credit note"
        subtitle="Goods returned, a price corrected, a discount after the sale: against one of the customer's posted invoices. It posts when you raise it."
        back={{ href: '/sales/credit-notes', label: 'Credit notes' }}
      />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <NewCreditNote />
      </Suspense>
    </div>
  );
}
