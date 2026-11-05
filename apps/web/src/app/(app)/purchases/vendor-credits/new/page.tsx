'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, shortDate, todayIso, useBills, useLedgerRefresh } from '@/components/purchases/purchase-data';

const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

/**
 * A debit note against a posted bill: the amount before tax to take off,
 * with the tax following in the bill's own proportions. The preview mirrors
 * the server's split; the server decides, and posts it.
 */
export default function NewDebitNotePage({ searchParams }: { searchParams: { billId?: string } }) {
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const bills = useBills();
  const [billId, setBillId] = useState(searchParams.billId ?? '');
  const [taxable, setTaxable] = useState('');
  const [reason, setReason] = useState('');
  const [noteDate, setNoteDate] = useState(todayIso());
  const [problem, setProblem] = useState<string | null>(null);

  // Notes go on bills in the books, in rupees.
  const eligible = (bills.data ?? []).filter((b) => b.status !== 'draft');
  const bill = eligible.find((b) => b._id === billId);
  const a = bill?.amountsPaise;
  const taxablePaise = parseRupees(taxable) ?? 0;
  const tax = HEADS.map((h) => (a && a.taxableValue > 0 ? Math.round((taxablePaise * a[h]) / a.taxableValue) : 0));
  const totalPaise = taxablePaise + tax.reduce((s, t) => s + t, 0);

  const raise = useMutation({
    mutationFn: () => {
      if (!bill) throw new Error('Choose the bill the note is against.');
      if (!(taxablePaise > 0)) throw new Error('Enter the amount before tax to take off.');
      if (a && totalPaise > a.total) throw new Error(`More than the ${formatPaise(a.total)} the bill was for.`);
      if (reason.trim().length < 3) throw new Error('Say why the note is raised.');
      if (noteDate < bill.billDate) throw new Error('A note cannot be dated before its bill.');
      return api.post<{ noteNumber: string }>(`/purchase/bills/${bill._id}/debit-notes`, { taxableValuePaise: taxablePaise, reason: reason.trim(), noteDate });
    },
    onSuccess: (note) => {
      refresh();
      notify(`Debit note ${note.noteNumber} posted`);
      router.push(`/purchases/bills/${billId}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't raise the debit note.")),
  });

  return (
    <div>
      <PageHeader title="New debit note" subtitle="Takes part of a posted bill back. Posted to the ledger when you save it." back={{ href: '/purchases/vendor-credits', label: 'Vendor credits' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          raise.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={raise.isPending}>{raise.isPending ? 'Posting…' : 'Post debit note'}</Button>
            <Button type="button" variant="secondary" asChild>
              <Link href={billId ? `/purchases/bills/${billId}` : '/purchases/vendor-credits'}>Cancel</Link>
            </Button>
          </>
        }
      >
        <Section title="Against">
          <Field label="Bill" required hint={bill ? `${bill.vendorName} · dated ${shortDate(bill.billDate)} · ${formatPaise(bill.totalPaise)}, ${formatPaise(bill.outstandingPaise)} owed` : undefined}>
            <select className={inputClass} value={billId} onChange={(e) => setBillId(e.target.value)}>
              <option value="">{bills.isLoading ? 'Loading…' : 'Choose a posted bill…'}</option>
              {eligible.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.vendorName} · {b.billNumber ?? 'No number'} · {formatPaise(b.totalPaise)}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Debit note">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Amount before tax to take off (₹)" required>
              <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={taxable} onChange={(e) => setTaxable(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Date" required>
              <input type="date" className={inputClass} value={noteDate} min={bill?.billDate} onChange={(e) => setNoteDate(e.target.value)} />
            </Field>
            <Field label="Reason" required className="md:col-span-3">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Short supply of 10 units" maxLength={300} />
            </Field>
          </div>

          {bill && a && taxablePaise > 0 && (
            <div className="mt-4 ml-auto w-full max-w-xs text-body">
              <div className="flex justify-between py-1 text-ink-600"><span>Before tax</span><span className="font-mono">{formatPaise(taxablePaise)}</span></div>
              {HEADS.map((h, i) =>
                tax[i] > 0 ? (
                  <div key={h} className="flex justify-between py-1 text-ink-600"><span className="uppercase">{h}</span><span className="font-mono">{formatPaise(tax[i])}</span></div>
                ) : null,
              )}
              <div className="flex justify-between border-t border-line-200 pt-2 font-semibold text-ink-900"><span>Debit note total</span><span className="font-mono">{formatPaise(totalPaise)}</span></div>
              {totalPaise > a.total ? (
                <p className="mt-1 text-caption text-error-fg">More than the {formatPaise(a.total)} the bill was for.</p>
              ) : (
                totalPaise > bill.outstandingPaise && (
                  <p className="mt-1 text-caption text-pending-fg">
                    {formatPaise(totalPaise - bill.outstandingPaise)} more than is owed: that part becomes the vendor&apos;s credit, owed back to you.
                  </p>
                )
              )}
            </div>
          )}
        </Section>
      </FormPage>
    </div>
  );
}
