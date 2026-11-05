'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, FormPage, Section, Field, inputClass, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { GST_RATES, formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { errorText, stateName, todayIst, useCustomers, useSupply, type Amounts } from '@/components/sales/sales-data';

type Frequency = 'monthly' | 'quarterly' | 'yearly';
interface Line { key: number; description: string; hsnSac: string; qty: string; rate: string; taxRatePct: number }

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, description: '', hsnSac: '', qty: '1', rate: '', taxRatePct: 18 });
const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/** A line's amounts in paise, or a problem with it. A schedule repeats whole units. */
function readLine(l: Line, n: number): { line?: { description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; taxRatePct: number }; problem?: string } {
  const at = `Line ${n}`;
  if (!l.description.trim()) return { problem: `${at} needs a description.` };
  const qty = Number(l.qty);
  if (!Number.isInteger(qty) || qty < 1) return { problem: `${at}: a repeating line is a whole quantity, 1 or more.` };
  const ratePaise = parseRupees(l.rate || '0');
  if (ratePaise === null || ratePaise < 0) return { problem: `${at}: the rate is an amount in rupees.` };
  return { line: { description: l.description.trim().slice(0, 300), hsnSac: l.hsnSac.trim() || null, qty, ratePaise, amountPaise: qty * ratePaise, taxRatePct: l.taxRatePct } };
}

function amountsOf(lines: Array<{ amountPaise: number; taxRatePct: number }>, interState: boolean): Amounts {
  const a: Amounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const l of lines) {
    const tax = Math.round((l.amountPaise * l.taxRatePct) / 100);
    a.taxableValue += l.amountPaise;
    if (interState) a.igst += tax;
    else {
      const half = Math.round(tax / 2);
      a.cgst += half;
      a.sgst += tax - half;
    }
  }
  a.total = a.taxableValue + a.cgst + a.sgst + a.igst;
  return a;
}

/**
 * A recurring invoice: a retainer, a rent, a subscription. Each one is
 * drafted on its date for a person to check and post; nothing posts itself.
 */
export default function NewRecurringInvoicePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const [form, setForm] = useState({ name: '', partyId: '', frequency: 'monthly' as Frequency, dayOfMonth: '1', startDate: todayIst(), endDate: '', dueInDays: '15', notes: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [problem, setProblem] = useState<string | null>(null);
  const supply = useSupply(form.partyId);
  const interState = supply.data?.interState ?? false;

  const filled = lines.filter((l) => l.description.trim() || l.rate.trim());
  const read = filled.map((l, i) => readLine(l, i + 1));
  const amounts = amountsOf(read.flatMap((r) => (r.line ? [r.line] : [])), interState);
  const set = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: (body: unknown) => api.post('/recurring/invoices', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      notify(`${form.name.trim()} scheduled`);
      router.push('/sales/recurring-invoices');
    },
  });

  const submit = () => {
    const day = Number(form.dayOfMonth);
    const due = Number(form.dueInDays);
    if (!form.name.trim()) return setProblem('Give it a name, like "Monthly retainer".');
    if (!form.partyId) return setProblem('Choose the customer.');
    if (filled.length === 0) return setProblem('Add at least one line.');
    const bad = read.find((r) => r.problem);
    if (bad) return setProblem(bad.problem!);
    if (amounts.total <= 0) return setProblem('A recurring invoice needs an amount.');
    if (!Number.isInteger(day) || day < 1 || day > 31) return setProblem('The day must be 1 to 31.');
    if (!Number.isInteger(due) || due < 0 || due > 365) return setProblem('Due in must be 0 to 365 days.');
    if (form.endDate && form.endDate < form.startDate) return setProblem('The end date is before the start date.');
    setProblem(null);
    save.mutate({
      name: form.name.trim(),
      partyId: form.partyId,
      frequency: form.frequency,
      dayOfMonth: day,
      startDate: form.startDate,
      endDate: form.endDate || null,
      dueInDays: due,
      amountsPaise: amounts,
      lineItems: read.map((r) => r.line!),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    });
  };

  return (
    <div>
      <PageHeader
        title="New recurring invoice"
        subtitle="Each one is drafted on its date for you to check and post. Nothing posts on its own."
        back={{ href: '/sales/recurring-invoices', label: 'Recurring invoices' }}
      />
      <FormPage
        onSubmit={submit}
        error={problem ?? (save.isError ? errorText(save.error, "Couldn't save the schedule. Try again.") : null)}
        actions={
          <>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save schedule'}</Button>
            <Button asChild variant="secondary"><Link href="/sales/recurring-invoices">Cancel</Link></Button>
          </>
        }
      >
        <Section title="What and who">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" required>
              <input className={inputClass} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Monthly retainer" />
            </Field>
            <Field label="Customer" required>
              <select className={inputClass} value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
                <option value="">{customers.isLoading ? 'Loading…' : 'Choose a customer…'}</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c._id} value={c._id}>{c.name}{c.gstin ? ` · ${c.gstin}` : ''}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="When">
          <div className="grid gap-4 md:grid-cols-5">
            <Field label="How often">
              <select className={inputClass} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="yearly">Every year</option>
              </select>
            </Field>
            <Field label="On day" hint="31 means the last day.">
              <input className={`${inputClass} font-mono`} inputMode="numeric" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </Field>
            <Field label="Starts">
              <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="Ends" hint="Optional.">
              <input type="date" className={inputClass} value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
            <Field label="Due in (days)">
              <input className={`${inputClass} font-mono`} inputMode="numeric" value={form.dueInDays} onChange={(e) => setForm({ ...form, dueInDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
            </Field>
          </div>
        </Section>

        <Section title="Lines" description="The same lines each time. Edit a draft before you post it if one period differs.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-line-200">
                  <th className={th}>Description</th>
                  <th className={`${th} w-28`}>HSN/SAC</th>
                  <th className={`${th} w-20`}>Qty</th>
                  <th className={`${th} w-32`}>Rate (₹)</th>
                  <th className={`${th} w-24`}>GST</th>
                  <th className={`${th} w-32 text-right`}>Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const r = readLine(l, 0);
                  return (
                    <tr key={l.key} className="border-b border-line-100 last:border-0">
                      <td className="px-1 py-1.5"><input className={cell} value={l.description} placeholder="What is billed each time" onChange={(e) => set(l.key, { description: e.target.value })} /></td>
                      <td className="px-1 py-1.5"><input className={`${cell} font-mono`} inputMode="numeric" value={l.hsnSac} placeholder="997212" onChange={(e) => set(l.key, { hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></td>
                      <td className="px-1 py-1.5"><input className={`${cell} text-right font-mono`} inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></td>
                      <td className="px-1 py-1.5"><input className={`${cell} text-right font-mono`} inputMode="decimal" value={l.rate} placeholder="0.00" onChange={(e) => set(l.key, { rate: e.target.value })} /></td>
                      <td className="px-1 py-1.5">
                        <select className={cell} value={l.taxRatePct} onChange={(e) => set(l.key, { taxRatePct: Number(e.target.value) })}>
                          {GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-caption">{r.line ? formatPaise(r.line.amountPaise) : '—'}</td>
                      <td className="text-center">
                        <button type="button" aria-label="Remove line" disabled={lines.length === 1} className="text-ink-400 hover:text-error-fg disabled:opacity-30" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline" onClick={() => setLines([...lines, emptyLine()])}>
            <Plus size={12} /> Add a line
          </button>
        </Section>

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Section title="Notes" description="Carried onto each draft.">
            <textarea className={inputClass} rows={3} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Section>
          <Section title="Each time">
            <dl className="space-y-1">
              <div className="flex justify-between"><dt className="text-body text-ink-600">Taxable value</dt><dd className="font-mono">{formatPaise(amounts.taxableValue)}</dd></div>
              {interState ? (
                <div className="flex justify-between"><dt className="text-body text-ink-600">IGST</dt><dd className="font-mono">{formatPaise(amounts.igst)}</dd></div>
              ) : (
                <>
                  <div className="flex justify-between"><dt className="text-body text-ink-600">CGST</dt><dd className="font-mono">{formatPaise(amounts.cgst)}</dd></div>
                  <div className="flex justify-between"><dt className="text-body text-ink-600">SGST</dt><dd className="font-mono">{formatPaise(amounts.sgst)}</dd></div>
                </>
              )}
              <div className="flex justify-between border-t border-line-200 pt-1 font-semibold"><dt>Total</dt><dd className="font-mono">{formatPaise(amounts.total)}</dd></div>
            </dl>
            {form.partyId && supply.data && (
              <p className="mt-2 text-caption text-ink-500">
                {!supply.data.customerStateCode ? 'The customer has no state: taxed as a sale within yours.' : interState ? `${stateName(supply.data.ourStateCode)} to ${stateName(supply.data.customerStateCode)}: IGST.` : `Within ${stateName(supply.data.customerStateCode)}: CGST and SGST.`}
              </p>
            )}
          </Section>
        </div>
      </FormPage>
    </div>
  );
}
