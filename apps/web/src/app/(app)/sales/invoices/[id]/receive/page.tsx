'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, formatMinor, todayIst, toMinor, useLedgerRefresh, type InvoiceRecord } from '@/components/sales/sales-data';

/** Money in for a rupee invoice: all of what is owed or part of it, with any TDS the customer deducted. */
function RupeeReceipt({ invoice, owed }: { invoice: InvoiceRecord; owed: number }) {
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const [amount, setAmount] = useState((owed / 100).toFixed(2));
  const [tds, setTds] = useState('');
  const [paidOn, setPaidOn] = useState(todayIst());
  const amountPaise = parseRupees(amount);
  const tdsPaise = parseRupees(tds);
  const settled = (amountPaise ?? 0) + (tdsPaise ?? 0);
  const problem =
    amountPaise === null || amountPaise < 0 ? 'Enter the amount received in rupees.'
      : tdsPaise === null || tdsPaise < 0 ? 'Enter the TDS in rupees, or leave it blank.'
      : settled === 0 ? 'Enter what was received.'
      : settled > owed ? `That is more than the ${formatPaise(owed)} owed.`
      : !paidOn ? 'Enter the day the money arrived.'
      : paidOn < invoice.invoiceDate ? 'The money cannot arrive before the invoice date.'
      : null;
  const inFull = settled === owed;

  const pay = useMutation({
    mutationFn: () => api.post(`/sales/invoices/${invoice._id}/pay`, { amountPaise, paidOn, ...(tdsPaise ? { tdsPaise } : {}) }),
    onSuccess: () => {
      refresh();
      notify(inFull ? 'Receipt recorded' : `Part receipt of ${formatPaise(settled)} recorded`);
      router.push(`/sales/invoices/${invoice._id}`);
    },
  });

  return (
    <FormPage
      onSubmit={() => !problem && pay.mutate()}
      error={(amount || tds) && problem ? problem : pay.isError ? errorText(pay.error, "Couldn't record the receipt.") : null}
      actions={
        <>
          <Button type="submit" disabled={!!problem || pay.isPending}>{pay.isPending ? 'Recording…' : inFull ? 'Record receipt' : 'Record part receipt'}</Button>
          <Button asChild variant="secondary"><Link href={`/sales/invoices/${invoice._id}`}>Cancel</Link></Button>
        </>
      }
    >
      <Section title="The receipt" description={`${formatPaise(owed)} is owed on this invoice. Record what arrived, on the day it arrived.`}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Amount received (₹)" required>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="TDS deducted (₹)" hint="Tax the customer withheld and paid to the government for you. It settles the invoice too.">
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={tds} placeholder="0.00" onChange={(e) => setTds(e.target.value)} />
          </Field>
          <Field label="Received on" required>
            <input type="date" className={inputClass} value={paidOn} min={invoice.invoiceDate} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
        </div>
        <p className="mt-4 text-caption text-ink-500">
          Settles <span className="font-mono text-ink-900">{formatPaise(settled)}</span>
          {settled < owed && settled > 0 ? <>, leaving <span className="font-mono text-pending-fg">{formatPaise(owed - settled)}</span> owed.</> : '.'}{' '}
          To spread one payment across several invoices, or hold an advance, use <Link href={`/sales/payments-received/new?customerId=${invoice.customerId}`} className="underline">a receipt across invoices</Link>.
        </p>
      </Section>
    </FormPage>
  );
}

/** Money in for an export: in its currency at the day's rate. The difference from the booked rate is an exchange gain or loss. */
function ForeignReceipt({ invoice }: { invoice: InvoiceRecord }) {
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const f = invoice.foreign!;
  const left = f.totalMinor - f.paidMinor;
  const [amount, setAmount] = useState((left / 10 ** f.digits).toFixed(f.digits));
  const [paidOn, setPaidOn] = useState(todayIst());
  const [rate, setRate] = useState('');
  const stored = useQuery({
    queryKey: ['currency', 'on', f.currency, paidOn],
    queryFn: () => api.get<{ rate: number; date: string } | null>(`/currency/rates/on?currency=${f.currency}&date=${paidOn}`),
    enabled: !!paidOn,
    retry: false,
  });
  useEffect(() => {
    if (stored.data) setRate(String(stored.data.rate));
  }, [stored.data]);

  const minor = toMinor(amount, f.digits);
  const rateNumber = Number(rate);
  const problem =
    !minor ? `Enter the ${f.currency} amount received.`
      : minor > left ? `That is more than the ${formatMinor(left, f.currency, f.digits)} owed.`
      : !(rateNumber > 0) ? `Enter the rupees for one ${f.currency} on that day.`
      : null;

  const receive = useMutation({
    mutationFn: () => api.post<{ exchangePaise: number; paidInFull: boolean }>(`/currency/invoices/${invoice._id}/receive`, { paidOn, amountMinor: minor, rate: rateNumber }),
    onSuccess: (r) => {
      refresh();
      notify(`Receipt recorded${r.exchangePaise ? `: exchange ${r.exchangePaise > 0 ? 'gain' : 'loss'} ${formatPaise(Math.abs(r.exchangePaise))}` : ''}`);
      router.push(`/sales/invoices/${invoice._id}`);
    },
  });

  return (
    <FormPage
      onSubmit={() => !problem && receive.mutate()}
      error={problem && amount ? problem : receive.isError ? errorText(receive.error, "Couldn't record the receipt.") : null}
      actions={
        <>
          <Button type="submit" disabled={!!problem || receive.isPending}>{receive.isPending ? 'Recording…' : 'Record receipt'}</Button>
          <Button asChild variant="secondary"><Link href={`/sales/invoices/${invoice._id}`}>Cancel</Link></Button>
        </>
      }
    >
      <Section
        title="The receipt"
        description={`${formatMinor(left, f.currency, f.digits)} is owed, booked at ₹${f.rate}. The bank moves at the day's rate; the difference is an exchange gain or loss in the same voucher.`}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={`Amount received (${f.currency})`} required>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Received on" required>
            <input type="date" className={inputClass} value={paidOn} min={invoice.invoiceDate} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label={`Rate that day (₹ for 1 ${f.currency})`} required hint={stored.data ? `From the stored rate of ${stored.data.date}.` : 'No stored rate: enter the rate the bank gave.'}>
            <input className={`${inputClass} font-mono`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>
        {minor && rateNumber > 0 ? (
          <p className="mt-4 text-caption text-ink-500">
            About <span className="font-mono text-ink-900">{formatPaise(Math.round((minor / 10 ** f.digits) * rateNumber * 100))}</span> into the bank.
          </p>
        ) : null}
      </Section>
    </FormPage>
  );
}

export default function ReceiveInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useQuery({ queryKey: ['sales', 'invoice', id], queryFn: () => api.get<InvoiceRecord>(`/sales/invoices/${id}`) });
  const inv = invoice.data;
  const owed = inv ? inv.amountsPaise.total - (inv.amountPaidPaise ?? 0) - (inv.adjustedPaise ?? 0) : 0;

  return (
    <div>
      <PageHeader
        title="Record receipt"
        subtitle={inv ? <>Invoice <span className="font-mono">{inv.invoiceNumber ?? '(not numbered)'}</span></> : undefined}
        back={{ href: `/sales/invoices/${id}`, label: inv?.invoiceNumber ? `Invoice ${inv.invoiceNumber}` : 'Invoice' }}
      />
      {invoice.isError && <QueryError error={invoice.error} onRetry={() => void invoice.refetch()} />}
      {!inv && !invoice.isError && <p className="text-caption text-ink-400">Loading…</p>}
      {inv && inv.status !== 'posted' && (
        <Section>
          <p className="text-body text-ink-700">
            {inv.status === 'paid' ? 'This invoice is paid in full.' : 'Post this invoice to the ledger before recording money against it.'}{' '}
            <Link href={`/sales/invoices/${id}`} className="underline">Back to the invoice</Link>
          </p>
        </Section>
      )}
      {inv && inv.status === 'posted' && (inv.foreign ? <ForeignReceipt invoice={inv} /> : <RupeeReceipt invoice={inv} owed={owed} />)}
    </div>
  );
}
