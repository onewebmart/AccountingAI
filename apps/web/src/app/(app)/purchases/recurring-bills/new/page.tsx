'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { GST_RATES, GstRate, splitGst } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { useWorkspace } from '@/lib/use-workspace';
import { AmountsSummary } from '@/components/purchases/bill-lines';
import { ScheduleFields, type Frequency } from '@/components/purchases/recurring';
import { errorText, todayIso, useVendors } from '@/components/purchases/purchase-data';

/** A bill that repeats. Each one is drafted on its date for you to check and post. */
export default function NewRecurringBillPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const vendors = useVendors();
  const workspace = useWorkspace();
  const [name, setName] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState<GstRate>(18);
  const [interState, setInterState] = useState<boolean | null>(null);
  const [reverseCharge, setReverseCharge] = useState(false);
  const [hsnSac, setHsnSac] = useState('');
  const [dueInDays, setDueInDays] = useState('15');
  const [schedule, setSchedule] = useState({ frequency: 'monthly' as Frequency, dayOfMonth: '1', startDate: todayIso(), endDate: '' });
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const vendor = (vendors.data ?? []).find((v) => v._id === vendorId);
  const ours = workspace.data?.org.gstin?.slice(0, 2) ?? null;
  const theirs = vendor?.gstin?.slice(0, 2) ?? null;
  // Where the vendor is registered decides it, unless you say otherwise.
  const igst = interState ?? (!!ours && !!theirs && ours !== theirs);
  const taxablePaise = parseRupees(amount) ?? 0;
  const amounts = splitGst(Math.max(0, taxablePaise), rate, igst);

  const save = useMutation({
    mutationFn: () => {
      const day = Number(schedule.dayOfMonth);
      const due = Number(dueInDays);
      if (!name.trim()) throw new Error('Give it a name, like "Office rent".');
      if (!vendorId) throw new Error('Choose the vendor.');
      if (!(taxablePaise > 0)) throw new Error('Enter the amount before tax, in rupees.');
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('The day is 1 to 31.');
      if (!Number.isInteger(due) || due < 0 || due > 365) throw new Error('Due in is 0 to 365 days.');
      if (schedule.endDate && schedule.endDate < schedule.startDate) throw new Error('The end date is before the start date.');
      return api.post('/recurring/bills', {
        name: name.trim(),
        partyId: vendorId,
        frequency: schedule.frequency,
        dayOfMonth: day,
        startDate: schedule.startDate,
        endDate: schedule.endDate || null,
        dueInDays: due,
        amountsPaise: amounts,
        lineItems: [{ description: name.trim(), hsnSac: hsnSac.trim() || null, qty: 1, ratePaise: amounts.taxableValue, amountPaise: amounts.taxableValue, taxRatePct: rate }],
        isReverseCharge: reverseCharge,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring'] });
      notify(`Recurring bill saved: ${name.trim()}`);
      router.push('/purchases/recurring-bills');
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the schedule.")),
  });

  return (
    <div>
      <PageHeader title="New recurring bill" subtitle="Drafted on its date for you to check and post. Nothing posts on its own." back={{ href: '/purchases/recurring-bills', label: 'Recurring bills' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          save.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save recurring bill'}</Button>
            <Button type="button" variant="secondary" asChild><Link href="/purchases/recurring-bills">Cancel</Link></Button>
          </>
        }
      >
        <Section title="Bill">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Name" required>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office rent" maxLength={120} />
            </Field>
            <Field label="Vendor" required className="md:col-span-2">
              <select className={inputClass} value={vendorId} onChange={(e) => { setVendorId(e.target.value); setInterState(null); }}>
                <option value="">{vendors.isLoading ? 'Loading…' : 'Choose a vendor…'}</option>
                {(vendors.data ?? []).map((v) => <option key={v._id} value={v._id}>{v.name}{v.gstin ? ` · ${v.gstin}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Amount before tax (₹)" required>
              <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50,000" />
            </Field>
            <Field label="GST rate">
              <select className={inputClass} value={rate} onChange={(e) => setRate(Number(e.target.value) as GstRate)}>
                {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </Field>
            <Field label="HSN/SAC">
              <input className={`${inputClass} font-mono`} inputMode="numeric" maxLength={8} value={hsnSac} onChange={(e) => setHsnSac(e.target.value.replace(/\D/g, ''))} placeholder="997212" />
            </Field>
            <label className="flex items-center gap-2 text-body text-ink-900">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={igst} onChange={(e) => setInterState(e.target.checked)} />
              Inter-state (IGST)
            </label>
            <label className="flex items-center gap-2 text-body text-ink-900 md:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
              Reverse charge: we pay the GST
            </label>
          </div>
          <div className="mt-4 border-t border-line-100 pt-4">
            <AmountsSummary amounts={amounts} note="Each bill, every time." />
          </div>
        </Section>
        <Section title="Schedule">
          <ScheduleFields value={schedule} onChange={(p) => setSchedule((s) => ({ ...s, ...p }))} />
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label="Due in (days)" hint="From each bill's date.">
              <input className={`${inputClass} font-mono`} inputMode="numeric" value={dueInDays} onChange={(e) => setDueInDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            </Field>
            <Field label="Notes" className="md:col-span-3">
              <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </Section>
      </FormPage>
    </div>
  );
}
