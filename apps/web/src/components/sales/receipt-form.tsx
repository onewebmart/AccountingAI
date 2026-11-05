'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormPage, Section, Field, inputClass, TableCard, th, td, tdMoney } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, formatMinor, shortDate, todayIst, useCustomers, useInvoices, useLedgerRefresh } from './sales-data';

interface Suggestion {
  allocations: Array<{ documentId: string; amountPaise: number }>;
  advancePaise: number;
  method: string;
  reason: string;
}

interface ForeignDoc { kind: 'invoice' | 'bill'; id: string; number: string | null; status: string; currency: string; openMinor: number; digits: number }

const rupeesText = (paise: number) => (paise ? (paise / 100).toFixed(2) : '');
const cell = 'w-28 rounded-md border border-line-200 bg-white px-2 py-1 text-right font-mono text-caption focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/**
 * One receipt from a customer across as many of their open invoices as it
 * settles, with any TDS they deducted on each. Whatever is not applied is
 * held as an advance. "Suggest allocation" fills the amounts from what the
 * reference names, an exact combination, or oldest first; the person checks
 * and changes any of them before recording.
 */
export function ReceiptForm({ initialCustomerId }: { initialCustomerId: string }) {
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const customers = useCustomers();
  const invoices = useInvoices();
  // Foreign invoices are received in their currency, from the invoice itself.
  const foreignDocs = useQuery({ queryKey: ['currency', 'documents'], queryFn: () => api.get<ForeignDoc[]>('/currency/documents'), retry: false });
  const foreignIds = new Set((foreignDocs.data ?? []).filter((d) => d.kind === 'invoice').map((d) => d.id));

  const [partyId, setPartyId] = useState(initialCustomerId);
  const [date, setDate] = useState(todayIst());
  const [amount, setAmount] = useState('');
  const [via, setVia] = useState<'bank' | 'cash'>('bank');
  const [reference, setReference] = useState('');
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [tds, setTds] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  const open = (invoices.data ?? []).filter((d) => d.customerId === partyId && d.status === 'posted' && d.outstandingPaise > 0);
  const rows = open.filter((d) => !foreignIds.has(d._id)).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const foreignOpen = (foreignDocs.data ?? []).filter((d) => d.kind === 'invoice' && d.status === 'posted' && d.openMinor > 0 && open.some((o) => o._id === d.id));

  const amountPaise = parseRupees(amount);
  const appliedPaise = rows.reduce((s, r) => s + (parseRupees(applied[r._id] ?? '') ?? 0), 0);
  const tdsPaise = rows.reduce((s, r) => s + (parseRupees(tds[r._id] ?? '') ?? 0), 0);
  const advance = (amountPaise ?? 0) - appliedPaise;
  const overOwed = rows.find((r) => (parseRupees(applied[r._id] ?? '') ?? 0) + (parseRupees(tds[r._id] ?? '') ?? 0) > r.outstandingPaise);
  const unreadable = [...Object.values(applied), ...Object.values(tds)].some((t) => (parseRupees(t) ?? -1) < 0);
  const problem =
    !partyId ? 'Choose the customer.'
      : amountPaise === null || amountPaise < 0 ? 'Enter the amount received in rupees.'
      : unreadable ? 'Each amount and TDS is in rupees, like 1250.50.'
      : overOwed ? `${overOwed.invoiceNumber ?? 'One invoice'} has only ${formatPaise(overOwed.outstandingPaise)} owed.`
      : advance < 0 ? `${formatPaise(-advance)} more is applied than was received.`
      : (amountPaise ?? 0) === 0 && tdsPaise === 0 ? 'Enter what was received.'
      : null;

  const pick = (id: string) => {
    setPartyId(id);
    setApplied({});
    setTds({});
    setHint(null);
  };

  const suggest = useMutation({
    mutationFn: () => api.post<Suggestion>('/payments/suggest', { kind: 'receipt', partyId, amountPaise: amountPaise ?? 0, text: reference || undefined }),
    onSuccess: (s) => {
      setApplied(Object.fromEntries(s.allocations.map((a) => [a.documentId, rupeesText(a.amountPaise)])));
      setTds({});
      setHint(s.reason);
    },
    onError: (e) => notify(errorText(e, "Couldn't suggest an allocation."), 'error'),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        kind: 'receipt',
        partyId,
        date,
        amountPaise: amountPaise ?? 0,
        via,
        reference: reference.trim() || undefined,
        allocations: rows
          .map((r) => ({ documentId: r._id, amountPaise: parseRupees(applied[r._id] ?? '') ?? 0, tdsPaise: parseRupees(tds[r._id] ?? '') ?? 0 }))
          .filter((a) => a.amountPaise > 0 || a.tdsPaise > 0),
      }),
    onSuccess: () => {
      refresh();
      notify('Receipt recorded');
      router.push('/sales/payments-received');
    },
  });

  const customer = customers.data?.find((c) => c._id === partyId);

  return (
    <FormPage
      onSubmit={() => !problem && save.mutate()}
      error={amount && problem ? problem : save.isError ? errorText(save.error, "Couldn't record the receipt.") : null}
      actions={
        <>
          <Button type="submit" disabled={!!problem || save.isPending}>{save.isPending ? 'Recording…' : 'Record receipt'}</Button>
          <Button asChild variant="secondary"><Link href="/sales/payments-received">Cancel</Link></Button>
        </>
      }
    >
      <Section title="The money" description="What arrived, on the day it arrived.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer" required className="md:col-span-3">
            <select className={inputClass} value={partyId} onChange={(e) => pick(e.target.value)}>
              <option value="">{customers.isLoading ? 'Loading…' : 'Choose a customer…'}</option>
              {(customers.data ?? []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}{c.receivablePaise > 0 ? ` · owes ${formatPaise(c.receivablePaise)}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Received (₹)" required>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="On" required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Through">
            <select className={inputClass} value={via} onChange={(e) => setVia(e.target.value as 'bank' | 'cash')}>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
            </select>
          </Field>
          <Field label="Reference or remittance" className="md:col-span-3" hint="UTR, cheque number, or the invoice numbers it pays. Suggest allocation reads invoice numbers from it.">
            <input className={inputClass} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      </Section>

      {partyId && (
        <Section
          title="Open invoices"
          description="How much of the receipt goes to each, and any TDS the customer deducted on it."
          actions={
            <Button type="button" size="sm" variant="secondary" disabled={!amountPaise || suggest.isPending || rows.length === 0} onClick={() => suggest.mutate()}>
              <Sparkles size={13} className="text-marigold-400" /> {suggest.isPending ? 'Working it out…' : 'Suggest allocation'}
            </Button>
          }
        >
          {hint && <p className="mb-3 rounded-md bg-honey-100 px-3 py-2 text-caption text-pending-fg">Suggested: {hint} Check before recording.</p>}
          {rows.length === 0 ? (
            <p className="text-caption text-ink-500">{customer?.name ?? 'This customer'} has no open rupee invoices. All of this will be held as an advance.</p>
          ) : (
            <TableCard className="border-line-100">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className={th}>Invoice</th>
                    <th className={th}>Date</th>
                    <th className={th}>Due</th>
                    <th className={`${th} text-right`}>Owed</th>
                    <th className={`${th} text-right`}>Apply (₹)</th>
                    <th className={`${th} text-right`}>TDS (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._id} className="border-b border-line-100 last:border-0">
                      <td className={`${td} font-mono text-caption`}>
                        <Link href={`/sales/invoices/${r._id}`} className="hover:underline">{r.invoiceNumber ?? 'Not numbered'}</Link>
                      </td>
                      <td className={`${td} text-caption`}>{shortDate(r.invoiceDate)}</td>
                      <td className={`${td} text-caption`}>{shortDate(r.dueDate)}</td>
                      <td className={tdMoney}>{formatPaise(r.outstandingPaise)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="inline-flex items-center gap-1">
                          <button type="button" className="text-caption text-ink-500 hover:underline" onClick={() => setApplied({ ...applied, [r._id]: rupeesText(r.outstandingPaise - (parseRupees(tds[r._id] ?? '') ?? 0)) })}>
                            All
                          </button>
                          <input
                            aria-label={`Apply to ${r.invoiceNumber ?? r._id}`}
                            className={`${cell} ${overOwed?._id === r._id ? 'border-error-fg' : ''}`}
                            inputMode="decimal"
                            placeholder="0"
                            value={applied[r._id] ?? ''}
                            onChange={(e) => setApplied({ ...applied, [r._id]: e.target.value })}
                          />
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input aria-label={`TDS on ${r.invoiceNumber ?? r._id}`} className={cell} inputMode="decimal" placeholder="0" value={tds[r._id] ?? ''} onChange={(e) => setTds({ ...tds, [r._id]: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}

          {foreignOpen.length > 0 && (
            <div className="mt-4 rounded-md border border-line-200 bg-surface-sink p-3">
              <p className="text-caption font-medium text-ink-700">In a foreign currency, received from the invoice at the day&apos;s rate:</p>
              <ul className="mt-1 space-y-1">
                {foreignOpen.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-caption">
                    <span className="font-mono">{d.number ?? 'Not numbered'} · {formatMinor(d.openMinor, d.currency, d.digits)} owed</span>
                    <Link href={`/sales/invoices/${d.id}/receive`} className="font-medium text-ink-700 hover:underline">Record receipt in {d.currency}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section>
        <div className="flex flex-wrap gap-6 text-body">
          <span>Applied <span className="font-mono font-semibold">{formatPaise(appliedPaise)}</span></span>
          {tdsPaise > 0 && <span>TDS <span className="font-mono font-semibold">{formatPaise(tdsPaise)}</span></span>}
          <span className={advance < 0 ? 'text-error-fg' : advance > 0 ? 'text-pending-fg' : 'text-ink-700'}>
            {advance < 0 ? <>Over by <span className="font-mono">{formatPaise(-advance)}</span></> : advance > 0 ? <><span className="font-mono">{formatPaise(advance)}</span> held as an advance</> : 'Nothing left over'}
          </span>
        </div>
        {advance > 0 && (
          <p className="mt-2 text-caption text-ink-500">
            An advance waits on the Advances from Customers account until you apply it to an invoice. GST is due on advances for services when received; check with your CA.
          </p>
        )}
      </Section>
    </FormPage>
  );
}
