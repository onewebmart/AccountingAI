'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { useItems } from '@/components/items/item-picker';
import { errorText } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import type { Project } from './types';

interface Customer { _id: string; name: string }

const rs = (p: number | null | undefined) => (p == null ? '' : String(p / 100));

/** A project's details, as a page: new or edit. Saving returns the project's id. */
export function ProjectForm({ project, cancelHref, onSaved }: { project: Project | null; cancelHref: string; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/sales/customers'), retry: false });
  const services = (useItems().data ?? []).filter((i) => i.kind === 'service' && (i.isActive || i._id === project?.serviceItemId));
  const [f, setF] = useState({
    name: project?.name ?? '',
    code: project?.code ?? '',
    customerId: project?.customerId ?? '',
    billing: project?.billing ?? 'time',
    budget: rs(project?.budgetPaise),
    budgetHours: project?.budgetHours == null ? '' : String(project.budgetHours),
    rate: rs(project?.ratePaise),
    serviceItemId: project?.serviceItemId ?? '',
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
    notes: project?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const money = (v: string, what: string) => {
        if (!v.trim()) return null;
        const p = parseRupees(v);
        if (p === null || p < 0) throw new Error(`Enter the ${what} in rupees, like 2,500.`);
        return p;
      };
      const hours = f.budgetHours.trim() ? Number(f.budgetHours) : null;
      if (hours !== null && !(hours >= 0)) throw new Error('Enter the budgeted hours as a number.');
      if (f.startDate && f.endDate && f.startDate > f.endDate) throw new Error('The project ends before it starts.');
      const body = {
        name: f.name.trim(), code: f.code.trim() || null, customerId: f.customerId || null, billing: f.billing,
        budgetPaise: money(f.budget, f.billing === 'fixed' ? 'fee' : 'budget'), budgetHours: hours, ratePaise: money(f.rate, 'rate per hour'),
        serviceItemId: f.serviceItemId || null, startDate: f.startDate || null, endDate: f.endDate || null, notes: f.notes.trim() || null,
      };
      const saved = project ? await api.patch<{ _id: string }>(`/projects/${project.id}`, body) : await api.post<{ _id: string }>('/projects', body);
      return project?.id ?? String(saved._id);
    },
    onMutate: () => setError(null),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onSaved(id);
    },
    onError: (err) => setError(errorText(err, "Couldn't save the project.")),
  });

  return (
    <FormPage
      onSubmit={() => save.mutate()}
      error={error}
      actions={
        <>
          <Button type="submit" disabled={!f.name.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Save project'}</Button>
          <Button type="button" variant="secondary" asChild><Link href={cancelHref}>Cancel</Link></Button>
        </>
      }
    >
      <Section title="Project">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Name" required className="md:col-span-2">
            <input className={inputClass} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Website redesign" />
          </Field>
          <Field label="Code">
            <input className={`${inputClass} font-mono`} value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Customer" hint="Leave it as internal work for time that is never invoiced.">
            <select className={inputClass} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}>
              <option value="">Internal work</option>
              {(customers.data ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Starts">
            <input type="date" className={inputClass} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Ends">
            <input type="date" className={inputClass} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Billing" description="The service item gives time on an invoice its SAC code, GST rate and income account.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Billed">
            <select className={inputClass} value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value as 'time' | 'fixed' })}>
              <option value="time">By the hour, from timesheets</option>
              <option value="fixed">A fixed fee</option>
            </select>
          </Field>
          <Field label="Rate per hour (₹)">
            <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
          <Field label="Invoiced as">
            <select className={inputClass} value={f.serviceItemId} onChange={(e) => setF({ ...f, serviceItemId: e.target.value })}>
              <option value="">Choose a service item…</option>
              {services.map((i) => <option key={i._id} value={i._id}>{i.name}{i.hsnSac ? ` · SAC ${i.hsnSac}` : ''}</option>)}
            </select>
          </Field>
          <Field label={f.billing === 'fixed' ? 'Fee (₹)' : 'Budget cap (₹)'}>
            <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
          </Field>
          <Field label="Budgeted hours">
            <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Notes">
        <textarea className={`${inputClass} min-h-[90px]`} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Scope, contacts, anything the team should know" />
      </Section>
    </FormPage>
  );
}
