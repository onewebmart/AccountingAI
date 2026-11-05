'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, formatMinor, parseMinor, rupeesText, shortDate, todayIso, useBills, useLedgerRefresh, useVendors } from '@/components/purchases/purchase-data';

interface Suggestion {
  allocations: Array<{ documentId: string; amountPaise: number }>;
  advancePaise: number;
  method: string;
  reason: string;
}

/** GET /currency/documents — foreign invoices and bills with what is still open in their currency. */
interface ForeignDoc {
  kind: 'invoice' | 'bill';
  id: string;
  number: string | null;
  date: string;
  status: string;
  currency: string;
  rate: number;
  totalMinor: number;
  openMinor: number;
  digits: number;
}

/** A foreign bill is paid in its currency, at the day's rate; the difference is exchange gain or loss. */
function ForeignBillPayment({ doc, onDone }: { doc: ForeignDoc; onDone: () => void }) {
  const [amount, setAmount] = useState((doc.openMinor / 10 ** doc.digits).toFixed(doc.digits));
  const [rate, setRate] = useState(String(doc.rate));
  const [paidOn, setPaidOn] = useState(todayIso());
  const minor = parseMinor(amount, doc.digits);
  const pay = useMutation({
    mutationFn: () => api.post(`/currency/bills/${doc.id}/pay`, { paidOn, amountMinor: minor, rate: Number(rate) }),
    onSuccess: () => {
      notify('Payment recorded');
      onDone();
    },
    onError: (e) => notify(errorText(e, "Couldn't record that payment."), 'error'),
  });
  const cell = `${inputClass} py-1.5`;
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line-100 py-3 last:border-0">
      <div className="min-w-[180px] flex-1">
        <Link href={`/purchases/bills/${doc.id}`} className="font-mono text-body hover:underline">{doc.number ?? 'No number'}</Link>
        <p className="text-caption text-ink-500">{shortDate(doc.date)} · {formatMinor(doc.openMinor, doc.currency, doc.digits)} owed · booked at ₹{doc.rate}</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Amount ({doc.currency})</span>
        <input className={`${cell} w-32 text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Rate (₹)</span>
        <input className={`${cell} w-28 text-right font-mono`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-caption font-medium text-ink-700">Paid on</span>
        <input type="date" className={`${cell} w-40`} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      <Button type="button" size="sm" disabled={pay.isPending || minor === null || minor <= 0 || minor > doc.openMinor || !(Number(rate) > 0)} onClick={() => pay.mutate()}>
        {pay.isPending ? 'Recording…' : 'Record payment'}
      </Button>
    </div>
  );
}

/**
 * One payment to a vendor, across as many of their open bills as it pays.
 * What is not applied is held as an advance. "Suggest allocation" fills the
 * amounts from what the reference names, an exact combination, or oldest
 * first; you can change any of them. A payment policy may hold it for approval.
 */
export default function NewPaymentPage({ searchParams }: { searchParams: { vendorId?: string } }) {
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const vendors = useVendors();
  const bills = useBills();
  const foreignDocs = useQuery({ queryKey: ['currency', 'documents'], queryFn: () => api.get<ForeignDoc[]>('/currency/documents'), retry: false });

  const [vendorId, setVendorId] = useState(searchParams.vendorId ?? '');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [via, setVia] = useState<'bank' | 'cash'>('bank');
  const [reference, setReference] = useState('');
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  const foreignIds = new Set((foreignDocs.data ?? []).filter((d) => d.kind === 'bill').map((d) => d.id));
  const theirs = (bills.data ?? []).filter((b) => b.vendorId === vendorId && b.status === 'posted' && b.outstandingPaise > 0);
  const rows = theirs.filter((b) => !foreignIds.has(b._id)).sort((a, b) => a.billDate.localeCompare(b.billDate));
  const foreignOpen = (foreignDocs.data ?? []).filter((d) => d.kind === 'bill' && d.status === 'posted' && d.openMinor > 0 && theirs.some((b) => b._id === d.id));

  const amountPaise = parseRupees(amount);
  const appliedPaise = rows.reduce((s, r) => s + (parseRupees(applied[r._id] ?? '') ?? 0), 0);
  const advance = (amountPaise ?? 0) - appliedPaise;
  const overOwed = rows.find((r) => (parseRupees(applied[r._id] ?? '') ?? 0) > r.outstandingPaise);
  const unreadable = Object.values(applied).some((t) => (parseRupees(t) ?? -1) < 0);
  const vendor = (vendors.data ?? []).find((v) => v._id === vendorId);

  const suggest = useMutation({
    mutationFn: () => api.post<Suggestion>('/payments/suggest', { kind: 'payment', partyId: vendorId, amountPaise: amountPaise ?? 0, text: reference || undefined }),
    onSuccess: (s) => {
      setApplied(Object.fromEntries(s.allocations.map((a) => [a.documentId, rupeesText(a.amountPaise)])));
      setHint(s.reason);
    },
    onError: (e) => notify(errorText(e, "Couldn't suggest an allocation."), 'error'),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!vendorId) throw new Error('Choose the vendor.');
      if (amountPaise === null || amountPaise <= 0) throw new Error('Enter what was paid, in rupees.');
      if (unreadable) throw new Error('Enter each amount in rupees, like 1,250.50.');
      if (overOwed) throw new Error(`${overOwed.billNumber ?? 'One bill'} has only ${formatPaise(overOwed.outstandingPaise)} owed.`);
      if (advance < 0) throw new Error(`More is applied than was paid, by ${formatPaise(-advance)}.`);
      return api.post('/payments', {
        kind: 'payment',
        partyId: vendorId,
        date,
        amountPaise,
        via,
        reference: reference.trim() || undefined,
        allocations: rows.map((r) => ({ documentId: r._id, amountPaise: parseRupees(applied[r._id] ?? '') ?? 0 })).filter((a) => a.amountPaise > 0),
      });
    },
    onSuccess: () => {
      refresh();
      notify('Payment recorded');
      router.push('/purchases/payments-made');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setHeld(e.message);
        notify(e.message, 'info');
        refresh();
      } else setProblem(errorText(e, "Couldn't record the payment."));
    },
  });

  return (
    <div>
      <PageHeader title="Record payment" subtitle="Money out to a vendor, across as many bills as it pays." back={{ href: '/purchases/payments-made', label: 'Payments made' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          save.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={save.isPending || !vendorId}>{save.isPending ? 'Recording…' : 'Record payment'}</Button>
            <Button type="button" variant="secondary" asChild>
              <Link href="/purchases/payments-made">Cancel</Link>
            </Button>
          </>
        }
      >
        {held && (
          <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
            {held} It posts when approved, on the <Link href="/approvals" className="underline">Approvals</Link> page.
          </p>
        )}

        <Section title="Payment">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Vendor" required className="md:col-span-2">
              <select
                className={inputClass}
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  setApplied({});
                  setHint(null);
                }}
              >
                <option value="">{vendors.isLoading ? 'Loading…' : 'Choose a vendor…'}</option>
                {(vendors.data ?? []).map((v) => (
                  <option key={v._id} value={v._id}>{v.name}{(v.outstandingPaise ?? 0) > 0 ? ` · ${formatPaise(v.outstandingPaise ?? 0)} owed` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Paid (₹)" required>
              <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Paid on" required>
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Through">
              <select className={inputClass} value={via} onChange={(e) => setVia(e.target.value as 'bank' | 'cash')}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
            <Field label="Reference">
              <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR, cheque no., or the bills it pays" maxLength={120} />
            </Field>
          </div>
        </Section>

        {vendorId && (
          <Section
            title="Open bills"
            description="How much of the payment goes to each. The rest is held as an advance."
            actions={
              <Button type="button" size="sm" variant="secondary" disabled={!amountPaise || suggest.isPending || rows.length === 0} onClick={() => suggest.mutate()} className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-marigold-400" /> {suggest.isPending ? 'Working it out…' : 'Suggest allocation'}
              </Button>
            }
          >
            {hint && <p className="mb-3 rounded-md bg-honey-100 px-3 py-2 text-caption text-pending-fg">Suggested: {hint} Check before recording.</p>}
            {rows.length === 0 ? (
              <p className="text-caption text-ink-500">{vendor?.name ?? 'This vendor'} has no open bills in rupees. All of this payment will be held as an advance.</p>
            ) : (
              <div className="divide-y divide-line-100 rounded-md border border-line-200">
                {rows.map((r) => (
                  <div key={r._id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 text-body text-ink-900">
                      <Link href={`/purchases/bills/${r._id}`} className="font-mono hover:underline">{r.billNumber ?? 'No number'}</Link>
                      <span className="ml-2 text-caption text-ink-500">{shortDate(r.billDate)} · {formatPaise(r.outstandingPaise)} owed{r.msmePayBy ? ` · MSME, pay by ${shortDate(r.msmePayBy)}` : ''}</span>
                    </span>
                    <button type="button" className="text-caption font-medium text-ink-500 hover:underline" onClick={() => setApplied({ ...applied, [r._id]: rupeesText(r.outstandingPaise) })}>
                      All
                    </button>
                    <input
                      aria-label={`Apply to ${r.billNumber ?? r._id}`}
                      className={`w-32 rounded-md border bg-white px-2 py-1.5 text-right font-mono text-body focus:outline-none focus:ring-2 focus:ring-saffron-600/40 ${overOwed?._id === r._id ? 'border-error-fg' : 'border-line-200'}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={applied[r._id] ?? ''}
                      onChange={(e) => setApplied({ ...applied, [r._id]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-5 rounded-md bg-surface-sink px-4 py-3 text-body">
              <span>Applied <span className="font-mono font-semibold">{formatPaise(appliedPaise)}</span></span>
              <span className={advance < 0 ? 'text-error-fg' : advance > 0 ? 'text-pending-fg' : 'text-ink-700'}>
                {advance < 0 ? `Over by ${formatPaise(-advance)}` : advance > 0 ? `${formatPaise(advance)} held as an advance` : 'Nothing left over'}
              </span>
            </div>
          </Section>
        )}

        {vendorId && foreignOpen.length > 0 && (
          <Section title="Bills in a foreign currency" description="Each is paid on its own, in its currency at the day's rate: the difference from the booked rate is exchange gain or loss.">
            {foreignOpen.map((d) => (
              <ForeignBillPayment key={d.id} doc={d} onDone={() => { refresh(); void foreignDocs.refetch(); }} />
            ))}
          </Section>
        )}
      </FormPage>
    </div>
  );
}
