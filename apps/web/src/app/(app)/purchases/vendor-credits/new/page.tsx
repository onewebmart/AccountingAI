'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, shortDate, todayIso, useBills, useLedgerRefresh } from '@/components/purchases/purchase-data';
import { DocumentEntry, EntryActions, rupeesOf, scanTaxable, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';

const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

type Params = { billId?: string; document?: string };

/** Opened from a vendor's scanned credit note (?document=), the file shows beside the form, which starts filled from it. */
export default function NewDebitNotePage({ searchParams }: { searchParams: Params }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <NewDebitNoteForm searchParams={searchParams} />
    </DocumentEntry>
  );
}

/**
 * A debit note against a posted bill: the amount before tax to take off,
 * with the tax following in the bill's own proportions. The preview mirrors
 * the server's split; the server decides, and posts it.
 */
function NewDebitNoteForm({ searchParams }: { searchParams: Params }) {
  const refresh = useLedgerRefresh();
  const entry = useDocumentEntry();
  const bills = useBills();
  const [billId, setBillId] = useState(searchParams.billId ?? '');
  const [taxable, setTaxable] = useState('');
  const [reason, setReason] = useState('');
  const [noteDate, setNoteDate] = useState(todayIso());
  const [problem, setProblem] = useState<string | null>(null);
  /** From a scan: the vendor whose bills to choose from, unless every vendor's are asked for. */
  const [scanVendor, setScanVendor] = useState<{ id: string; name: string } | null>(null);
  const [allVendors, setAllVendors] = useState(false);

  // From a scan: the amount before tax and why. The bill is the person's to choose: the scan does not say which.
  usePrefill((x) => {
    setScanVendor(x.vendor);
    const taxablePaise = scanTaxable(x);
    if (taxablePaise > 0) setTaxable(rupeesOf(taxablePaise));
    if (x.date) setNoteDate(x.date);
    setReason((r) => r || `As per ${x.party.name ?? 'the vendor'}'s credit note${x.number ? ` ${x.number}` : ''}`.slice(0, 300));
  });

  // Notes go on bills in the books, in rupees.
  const posted = (bills.data ?? []).filter((b) => b.status !== 'draft');
  const theirs = scanVendor ? posted.filter((b) => b.vendorId === scanVendor.id) : [];
  const eligible = scanVendor && !allVendors ? posted.filter((b) => b.vendorId === scanVendor.id || b._id === billId) : posted;
  const bill = posted.find((b) => b._id === billId);

  // The vendor's only posted bill is the one: chosen once, to check.
  const picked = useRef(false);
  const onlyBill = theirs.length === 1 ? theirs[0]._id : null;
  useEffect(() => {
    if (picked.current || !onlyBill) return;
    picked.current = true;
    setBillId((b) => b || onlyBill);
  }, [onlyBill]);
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
      return api.post<{ _id: string; noteNumber: string }>(`/purchase/bills/${bill._id}/debit-notes`, { taxableValuePaise: taxablePaise, reason: reason.trim(), noteDate });
    },
    onSuccess: (note) => {
      refresh();
      notify(`Debit note ${note.noteNumber} posted`);
      return entry.finish({ entityType: 'DebitNote', entityId: note._id, label: `Debit note ${note.noteNumber}` }, `/purchases/bills/${billId}`);
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
            <EntryActions busy={raise.isPending} nextLabel="Post and next" />
            <Button type="button" variant="secondary" asChild>
              <Link href={billId ? `/purchases/bills/${billId}` : '/purchases/vendor-credits'}>Cancel</Link>
            </Button>
          </>
        }
      >
        <Section title="Against">
          {entry.extraction?.read && !scanVendor && entry.extraction.party.name && (
            <p className="mb-4 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-body text-pending-fg">
              No vendor in the books matches &quot;<span className="font-medium">{entry.extraction.party.name}</span>&quot;. A debit note goes against one of a vendor&apos;s posted bills: choose it below.
            </p>
          )}
          <Field
            label="Bill"
            required
            hint={
              bill ? (
                `${bill.vendorName} · dated ${shortDate(bill.billDate)} · ${formatPaise(bill.totalPaise)}, ${formatPaise(bill.outstandingPaise)} owed`
              ) : scanVendor && !bills.isLoading ? (
                <span>
                  {allVendors ? 'Every vendor’s posted bills.' : theirs.length ? `${scanVendor.name}’s posted bills.` : `${scanVendor.name} has no posted bill.`}{' '}
                  <button type="button" className="font-medium underline" onClick={() => setAllVendors((v) => !v)}>
                    {allVendors ? `Only ${scanVendor.name}’s` : 'Show every vendor’s'}
                  </button>
                </span>
              ) : undefined
            }
          >
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
