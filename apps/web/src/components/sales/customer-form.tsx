'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { GST_STATES } from '@/lib/gst';
import { errorText, stateName, type CustomerRecord } from './sales-data';

const FIELDS = ['name', 'gstin', 'stateCode', 'email', 'phone', 'address', 'city', 'pincode', 'notes'] as const;
type Form = Record<(typeof FIELDS)[number], string>;

const fromCustomer = (c?: CustomerRecord | null): Form =>
  Object.fromEntries(FIELDS.map((k) => [k, ((c?.[k as keyof CustomerRecord] as string | null | undefined) ?? '').toString()])) as Form;

/**
 * A customer's details, as a page: new when there is no customer, an edit
 * when there is. An edit sends only what changed; invoices already issued
 * keep the name, GSTIN and state they were issued with (the server sees to it).
 */
export function CustomerForm({ customer }: { customer?: CustomerRecord | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const original = fromCustomer(customer);
  const [form, setForm] = useState<Form>(original);
  const [problem, setProblem] = useState<string | null>(null);

  const gstin = form.gstin.trim().toUpperCase();
  // A GSTIN starts with the state it was issued in, so it settles the question.
  const stateFromGstin = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  const gstinChanged = !!customer && gstin !== original.gstin.trim().toUpperCase();
  const backHref = customer ? `/sales/customers/${customer._id}` : '/sales/customers';

  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      customer ? api.patch<{ _id: string }>(`/sales/customers/${customer._id}`, body) : api.post<{ _id: string }>('/sales/customers', body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['gst'] });
      notify('Customer saved');
      router.push(`/sales/customers/${saved?._id ?? customer?._id}`);
    },
  });

  const submit = () => {
    if (!form.name.trim()) return setProblem('Give the customer a name.');
    if (form.pincode.trim() && !/^[1-9]\d{5}$/.test(form.pincode.trim())) return setProblem('A pincode is six digits and does not start with 0.');
    setProblem(null);
    const body: Record<string, string | null> = {};
    for (const k of FIELDS) {
      if (k === 'stateCode' && stateFromGstin) continue;
      const value = k === 'gstin' ? gstin : form[k].trim();
      if (customer) {
        if (value !== original[k].trim()) body[k] = value || null;
      } else if (value) body[k] = value;
    }
    if (customer && Object.keys(body).length === 0) {
      router.push(backHref);
      return;
    }
    save.mutate(body);
  };

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (save.isError ? errorText(save.error, "Couldn't save the customer. Try again.") : null)}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save customer'}</Button>
          <Button asChild variant="secondary"><Link href={backHref}>Cancel</Link></Button>
        </>
      }
    >
      <Section title="Who they are" description="The name and GSTIN print on every invoice to them.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Customer name" required>
            <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Sharma Traders" autoFocus />
          </Field>
          <Field
            label="GSTIN"
            hint={gstinChanged ? 'Invoices already issued keep the GSTIN they were issued with. New ones use this.' : 'Leave blank if they are not registered.'}
          >
            <input className={`${inputClass} font-mono uppercase`} value={form.gstin} onChange={set('gstin')} placeholder="e.g. 27AAPFU0939F1ZV" maxLength={15} />
          </Field>
          <Field label="State" hint={stateFromGstin ? undefined : 'The place of supply on your GSTR-1 for sales to this customer.'}>
            {stateFromGstin ? (
              <p className="py-2 text-body text-ink-700">{stateName(stateFromGstin)}, from the GSTIN</p>
            ) : (
              <select className={inputClass} value={form.stateCode} onChange={set('stateCode')}>
                <option value="">Choose a state</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="How to reach them" description="Email invoice and payment reminders go to this email, or WhatsApp to this phone.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <input type="tel" className={inputClass} value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Address" className="md:col-span-2">
            <textarea className={inputClass} rows={2} value={form.address} onChange={set('address')} />
          </Field>
          <Field label="City">
            <input className={inputClass} value={form.city} onChange={set('city')} />
          </Field>
          <Field label="Pincode">
            <input className={`${inputClass} font-mono`} inputMode="numeric" maxLength={6} value={form.pincode} onChange={set('pincode')} />
          </Field>
        </div>
      </Section>

      <Section title="Notes">
        <textarea className={inputClass} rows={3} value={form.notes} onChange={set('notes')} placeholder="Only you see these." />
      </Section>
    </FormPage>
  );
}
