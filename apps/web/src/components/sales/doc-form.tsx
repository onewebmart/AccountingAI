'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { EditLine, LineEditor, emptyLine, toApiLines } from '@/components/orders/line-editor';
import { api } from '@/lib/api';
import { addDays, errorText, todayIst, useCustomers } from './sales-data';

export type SalesDocKind = 'quote' | 'order' | 'challan';

const WORDS: Record<SalesDocKind, { save: string; saved: string; list: string; path: string }> = {
  quote: { save: 'Save quote', saved: 'Quote saved', list: '/sales/quotes', path: '/orders/quotes' },
  order: { save: 'Save sales order', saved: 'Sales order saved', list: '/sales/orders', path: '/orders/sales-orders' },
  challan: { save: 'Issue challan', saved: 'Challan issued', list: '/sales/challans', path: '/orders/challans' },
};

/**
 * A new quote, sales order or delivery challan. None of them posts: the
 * server prices the lines for the customer's state and numbers it; an order
 * or quote becomes a draft invoice later, which a person posts.
 */
export function SalesDocForm({ kind }: { kind: SalesDocKind }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const words = WORDS[kind];
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [date, setDate] = useState(todayIst());
  const [validUntil, setValidUntil] = useState(addDays(todayIst(), 15));
  const [expectedBy, setExpectedBy] = useState('');
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [reason, setReason] = useState('supply');
  const [vehicleNo, setVehicleNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditLine[]>([emptyLine()]);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (apiLines: NonNullable<ReturnType<typeof toApiLines>>) => {
      const common = { customerId, date, lines: apiLines, ...(notes.trim() ? { notes: notes.trim() } : {}) };
      if (kind === 'quote') return api.post<{ _id: string }>(words.path, { ...common, ...(validUntil ? { validUntil } : {}) });
      if (kind === 'order') return api.post<{ _id: string }>(words.path, { ...common, customerPoNumber: customerPoNumber.trim() || null, ...(expectedBy ? { expectedBy } : {}) });
      return api.post<{ _id: string }>(words.path, { ...common, reason, vehicleNo: vehicleNo.trim() || null });
    },
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      notify(words.saved);
      router.push(`${words.list}/${doc._id}`);
    },
  });

  const submit = () => {
    if (!customerId) return setProblem('Choose the customer.');
    if (!date) return setProblem('Enter the date.');
    if (kind === 'quote' && validUntil && validUntil < date) return setProblem('Valid until is on or after the quote date.');
    const apiLines = toApiLines(lines);
    if (!apiLines) return setProblem('Each line needs a description, a quantity and a rate in rupees.');
    if (apiLines.length === 0) return setProblem('Add at least one line.');
    setProblem(null);
    save.mutate(apiLines);
  };

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (save.isError ? errorText(save.error, "Couldn't save it. Try again.") : null)}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : words.save}</Button>
          <Button asChild variant="secondary"><Link href={words.list}>Cancel</Link></Button>
        </>
      }
    >
      <Section title={kind === 'challan' ? 'Customer and movement' : 'Customer and dates'}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer" required className="md:col-span-2" hint={<Link href="/sales/customers/new" className="hover:underline">Not listed? Add a customer</Link>}>
            <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{customers.isLoading ? 'Loading…' : 'Choose a customer…'}</option>
              {(customers.data ?? []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}{c.gstin ? ` · ${c.gstin}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Date" required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {kind === 'quote' && (
            <Field label="Valid until" hint="Blank: 15 days from the date.">
              <input type="date" className={inputClass} value={validUntil} min={date} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          )}
          {kind === 'order' && (
            <>
              <Field label="Customer's PO number">
                <input className={`${inputClass} font-mono`} maxLength={60} value={customerPoNumber} onChange={(e) => setCustomerPoNumber(e.target.value)} />
              </Field>
              <Field label="Expected by">
                <input type="date" className={inputClass} value={expectedBy} min={date} onChange={(e) => setExpectedBy(e.target.value)} />
              </Field>
            </>
          )}
          {kind === 'challan' && (
            <>
              <Field label="Why the goods move" required>
                <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="supply">Supply, invoiced later</option>
                  <option value="job_work">Job work</option>
                  <option value="approval">On approval</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Vehicle number">
                <input className={`${inputClass} font-mono uppercase`} maxLength={20} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="MH12AB1234" />
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section title="Lines" description="Pick an item to fill a line; this customer's last price fills the rate. Tax is worked out for their state when you save.">
        <LineEditor lines={lines} onChange={setLines} customerId={customerId} />
      </Section>

      <Section title="Notes" description={kind === 'challan' ? 'Printed on the challan.' : 'Printed on the PDF.'}>
        <textarea className={inputClass} rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Section>
    </FormPage>
  );
}
