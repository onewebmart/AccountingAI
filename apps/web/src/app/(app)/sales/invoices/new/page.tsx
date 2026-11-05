'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageHeader, FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { addDays, errorText, formatMinor, stateName, todayIst, useCustomers, useSupply } from '@/components/sales/sales-data';
import { InvoiceLinesEditor, emptyInvoiceLine, invoiceAmounts, lineValue, toApiLines, type InvoiceLine, type LineMoney } from '@/components/sales/invoice-lines';

interface Currency { code: string; name: string; digits: number }

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'mt-1 border-t border-line-200 pt-2 font-semibold' : ''}`}>
      <dt className="text-body text-ink-600">{label}</dt>
      <dd className="font-mono text-body text-ink-900">{value}</dd>
    </div>
  );
}

/**
 * A new invoice, line by line. In rupees it is taxed on the server for the
 * customer's state; in a foreign currency it is an export under LUT, with no
 * GST, booked in rupees at the day's rate. Either way it is saved as a draft:
 * the ledger moves only when someone posts it.
 */
function NewInvoiceForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const currencies = useQuery({ queryKey: ['currency', 'list'], queryFn: () => api.get<Currency[]>('/currency/currencies'), retry: false });

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIst());
  const [dueDate, setDueDate] = useState(addDays(todayIst(), 15));
  const [currency, setCurrency] = useState('INR');
  const [rate, setRate] = useState('');
  const [shipping, setShipping] = useState({ number: '', date: '', portCode: '' });
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([emptyInvoiceLine()]);
  const [problem, setProblem] = useState<string | null>(null);

  const foreign = currency !== 'INR';
  const digits = currencies.data?.find((c) => c.code === currency)?.digits ?? 2;
  const money: LineMoney = foreign ? { kind: 'foreign', currency, digits } : { kind: 'inr' };
  const supply = useSupply(foreign ? '' : customerId);
  const interState = supply.data?.interState ?? false;

  // The day's rate, from the stored rates; the person can change it.
  const storedRate = useQuery({
    queryKey: ['currency', 'on', currency, invoiceDate],
    queryFn: () => api.get<{ rate: number; date: string } | null>(`/currency/rates/on?currency=${currency}&date=${invoiceDate}`),
    enabled: foreign && !!invoiceDate,
    retry: false,
  });
  useEffect(() => {
    if (storedRate.data) setRate(String(storedRate.data.rate));
  }, [storedRate.data]);

  // A customer billed in their own currency starts in it.
  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.data?.find((x) => x._id === id);
    if (c?.currency && c.currency !== 'INR' && currencies.data?.some((x) => x.code === c.currency)) setCurrency(c.currency);
  };

  const amounts = invoiceAmounts(lines, interState);
  const foreignTotal = foreign ? lines.reduce((s, l) => s + (lineValue(l, money) ?? 0), 0) : 0;
  const rateNumber = Number(rate);
  const customer = customers.data?.find((c) => c._id === customerId);

  const save = useMutation({
    mutationFn: async () => {
      if (foreign) {
        const { lines: apiLines, problem: p } = toApiLines(lines, { kind: 'foreign', currency, digits });
        if (p) throw new Error(p);
        if (!(rateNumber > 0) || Math.abs(Math.round(rateNumber * 10_000) - rateNumber * 10_000) > 1e-6) throw new Error(`Enter the rupees for one ${currency}, to four decimals at most.`);
        return api.post<{ _id: string }>('/currency/invoices', {
          customerId,
          currency,
          rate: rateNumber,
          invoiceNumber: invoiceNumber.trim() || undefined,
          invoiceDate,
          dueDate: dueDate || undefined,
          lines: apiLines,
          shippingBill: shipping.number.trim() ? { number: shipping.number.trim(), date: shipping.date, portCode: shipping.portCode.trim().toUpperCase() } : null,
          notes: notes.trim() || undefined,
        });
      }
      const { lines: apiLines, problem: p } = toApiLines(lines, { kind: 'inr' });
      if (p) throw new Error(p);
      return api.post<{ _id: string }>('/sales/invoices/from-lines', {
        customerId,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceDate,
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
        lines: apiLines,
      });
    },
    onSuccess: (invoice) => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['currency'] });
      notify('Invoice saved');
      router.push(`/sales/invoices/${invoice._id}`);
    },
  });

  const submit = () => {
    if (!customerId) return setProblem('Choose the customer.');
    if (!invoiceDate) return setProblem('Enter the invoice date.');
    if (dueDate && dueDate < invoiceDate) return setProblem('The due date cannot be before the invoice date.');
    if (foreign && shipping.number.trim() && (!shipping.date || shipping.portCode.trim().length !== 6)) return setProblem('A shipping bill needs its date and the six-character port code.');
    setProblem(null);
    save.mutate();
  };

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (save.isError ? errorText(save.error, "Couldn't save the invoice. Try again.") : null)}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save invoice'}</Button>
          <Button asChild variant="secondary"><Link href="/sales/invoices">Cancel</Link></Button>
          <p className="text-caption text-ink-500">Saved as a draft. Nothing reaches the ledger until you post it.</p>
        </>
      }
    >
      <Section title="Customer and dates">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer" required className="md:col-span-2" hint={<Link href="/sales/customers/new" className="hover:underline">Not listed? Add a customer</Link>}>
            <select className={inputClass} value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">{customers.isLoading ? 'Loading…' : 'Choose a customer…'}</option>
              {(customers.data ?? []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}{c.gstin ? ` · ${c.gstin}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Invoice number" hint="Blank: the next number, given when it is posted.">
            <input className={`${inputClass} font-mono`} value={invoiceNumber} maxLength={16} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Automatic" />
          </Field>
          <Field label="Invoice date" required>
            <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <input type="date" className={inputClass} value={dueDate} min={invoiceDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Currency" hint={foreign ? 'An export: zero-rated under your LUT, no GST.' : undefined}>
            <select className={inputClass} value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(''); }}>
              <option value="INR">INR · Indian rupee</option>
              {(currencies.data ?? []).map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
              ))}
            </select>
          </Field>
          {foreign && (
            <Field
              label={`Rate (₹ for 1 ${currency})`}
              required
              hint={storedRate.data ? `From the stored rate of ${storedRate.data.date}.` : 'No stored rate on or before this date: enter the day’s rate.'}
            >
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="84.1025" />
            </Field>
          )}
        </div>
      </Section>

      <Section
        title="Lines"
        description={foreign ? `Prices in ${currency}. Each line is converted to rupees once, at the rate above.` : 'Pick an item to fill the line, or type it. The tax is worked out for the customer’s state when you save.'}
      >
        <InvoiceLinesEditor lines={lines} onChange={setLines} customerId={customerId} money={money} />
      </Section>

      {foreign && (
        <Section title="Shipping bill" description="For exported goods. Services have none; leave it blank.">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Shipping bill number">
              <input className={`${inputClass} font-mono`} value={shipping.number} onChange={(e) => setShipping({ ...shipping, number: e.target.value })} />
            </Field>
            <Field label="Shipping bill date">
              <input type="date" className={inputClass} value={shipping.date} onChange={(e) => setShipping({ ...shipping, date: e.target.value })} />
            </Field>
            <Field label="Port code">
              <input className={`${inputClass} font-mono uppercase`} maxLength={6} placeholder="INNSA1" value={shipping.portCode} onChange={(e) => setShipping({ ...shipping, portCode: e.target.value })} />
            </Field>
          </div>
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Section title="Notes" description="Printed on the invoice.">
          <textarea className={inputClass} rows={4} value={notes} maxLength={foreign ? 1000 : 2000} onChange={(e) => setNotes(e.target.value)} placeholder="Bank details, terms, a thank-you" />
        </Section>
        <Section title="Totals">
          {foreign ? (
            <dl>
              <Row label={`Total in ${currency}`} value={formatMinor(foreignTotal, currency, digits)} />
              <Row label="GST" value="Nil (LUT)" />
              <Row
                label="In rupees"
                value={rateNumber > 0 ? `≈ ${formatPaise(Math.round((foreignTotal / 10 ** digits) * rateNumber * 100))}` : '—'}
                strong
              />
            </dl>
          ) : (
            <>
              <dl>
                <Row label="Taxable value" value={formatPaise(amounts.taxableValue)} />
                {interState ? (
                  <Row label="IGST" value={formatPaise(amounts.igst)} />
                ) : (
                  <>
                    <Row label="CGST" value={formatPaise(amounts.cgst)} />
                    <Row label="SGST" value={formatPaise(amounts.sgst)} />
                  </>
                )}
                <Row label="Total" value={formatPaise(amounts.total)} strong />
              </dl>
              {customerId && supply.data && (
                <p className="mt-3 text-caption text-ink-500">
                  {!supply.data.customerStateCode ? (
                    <span className="text-pending-fg">
                      {customer?.name ?? 'This customer'} has no state: taxed as a sale within yours. <Link className="underline" href={`/sales/customers/${customerId}/edit`}>Set their state</Link>.
                    </span>
                  ) : interState ? (
                    `${stateName(supply.data.ourStateCode)} to ${stateName(supply.data.customerStateCode)}: IGST.`
                  ) : (
                    `Within ${stateName(supply.data.customerStateCode)}: CGST and SGST.`
                  )}
                </p>
              )}
            </>
          )}
        </Section>
      </div>
    </FormPage>
  );
}

export default function NewInvoicePage() {
  return (
    <div>
      <PageHeader title="New invoice" back={{ href: '/sales/invoices', label: 'Invoices' }} />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <NewInvoiceForm />
      </Suspense>
    </div>
  );
}
