'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { TDS_SECTIONS, errorText, type VendorRecord } from './purchase-data';

interface Form {
  name: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  pincode: string;
  notes: string;
  pan: string;
  tdsSection: string;
  /** Per cent, as typed: "2" or "0.1". */
  tdsRate: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  msmeRegistered: boolean;
  udyamNumber: string;
  category: 'micro' | 'small' | 'medium';
  activity: 'manufacturing' | 'services' | 'trading';
  writtenAgreement: boolean;
}

const fromVendor = (v?: VendorRecord | null): Form => ({
  name: v?.name ?? '',
  gstin: v?.gstin ?? '',
  phone: v?.phone ?? '',
  email: v?.email ?? '',
  address: v?.address ?? '',
  city: v?.city ?? '',
  pincode: v?.pincode ?? '',
  notes: v?.notes ?? '',
  pan: v?.pan ?? '',
  tdsSection: v?.tdsSection ?? '',
  tdsRate: v?.tdsRateBps != null ? String(v.tdsRateBps / 100) : '',
  accountName: v?.bankAccount?.accountName ?? '',
  accountNumber: v?.bankAccount?.accountNumber ?? '',
  ifsc: v?.bankAccount?.ifsc ?? '',
  bankName: v?.bankAccount?.bankName ?? '',
  msmeRegistered: !!v?.msme,
  udyamNumber: v?.msme?.udyamNumber ?? '',
  category: v?.msme?.category ?? 'micro',
  activity: v?.msme?.activity ?? 'manufacturing',
  writtenAgreement: v?.msme?.writtenAgreement ?? false,
});

const bankOf = (f: Form) =>
  f.accountNumber.trim()
    ? { accountName: f.accountName.trim() || null, accountNumber: f.accountNumber.replace(/[\s-]/g, ''), ifsc: f.ifsc.trim().toUpperCase(), bankName: f.bankName.trim() || null }
    : null;
const msmeOf = (f: Form) =>
  f.msmeRegistered ? { udyamNumber: f.udyamNumber.trim().toUpperCase(), category: f.category, activity: f.activity, writtenAgreement: f.writtenAgreement } : null;

/**
 * A vendor's details on one page: who they are, the TDS on their bills,
 * where they are paid, and their MSME registration. New and edit share it;
 * an edit sends only what changed.
 */
export function VendorForm({ vendor, onDone }: { vendor?: VendorRecord | null; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => fromVendor(vendor));
  const [problem, setProblem] = useState<string | null>(null);
  const original = fromVendor(vendor);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value as never);

  const editing = !!vendor;
  const section = TDS_SECTIONS.find((s) => s.code === form.tdsSection);
  const bankChanged = !!vendor?.bankAccount && form.accountNumber.replace(/[\s-]/g, '') !== vendor.bankAccount.accountNumber;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Enter the vendor’s name.');
      const tdsRateBps = form.tdsRate.trim() ? parseRupees(form.tdsRate) : undefined;
      if (tdsRateBps === null || (tdsRateBps !== undefined && (tdsRateBps < 0 || tdsRateBps > 10000))) throw new Error('The TDS rate is a per cent, like 2 or 0.1.');
      if (form.pincode.trim() && !/^[1-9]\d{5}$/.test(form.pincode.trim())) throw new Error('A pincode is six digits and does not start with 0.');
      if (form.accountNumber.trim() && form.ifsc.trim().length !== 11) throw new Error('An IFSC is 11 characters, like HDFC0001234.');
      if (form.msmeRegistered && form.udyamNumber.trim().length !== 19) throw new Error('A Udyam number looks like UDYAM-MH-26-0012345.');

      if (!editing) {
        const created = await api.post<{ _id: string }>('/purchase/vendors', {
          name: form.name.trim(),
          ...(form.gstin.trim() ? { gstin: form.gstin.trim().toUpperCase() } : {}),
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          ...(form.address.trim() ? { address: form.address.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          ...(form.pan.trim() ? { pan: form.pan.trim().toUpperCase() } : {}),
          ...(form.tdsSection ? { tdsSection: form.tdsSection, ...(tdsRateBps !== undefined ? { tdsRateBps } : {}) } : {}),
        });
        // City, pincode, bank and MSME go through the edit, which audits a bank account on its own.
        const rest: Record<string, unknown> = {};
        if (form.city.trim()) rest.city = form.city.trim();
        if (form.pincode.trim()) rest.pincode = form.pincode.trim();
        if (bankOf(form)) rest.bankAccount = bankOf(form);
        if (msmeOf(form)) rest.msme = msmeOf(form);
        if (Object.keys(rest).length) await api.patch(`/purchase/vendors/${created._id}`, rest);
        return created._id;
      }

      const body: Record<string, unknown> = {};
      for (const k of ['name', 'phone', 'email', 'address', 'city', 'pincode', 'notes'] as const) {
        if (form[k].trim() !== original[k].trim()) body[k] = form[k].trim() || null;
      }
      if (form.gstin.trim().toUpperCase() !== original.gstin.trim().toUpperCase()) body.gstin = form.gstin.trim().toUpperCase() || null;
      if (form.pan.trim().toUpperCase() !== original.pan.trim().toUpperCase()) body.pan = form.pan.trim().toUpperCase() || null;
      if (form.tdsSection !== original.tdsSection) body.tdsSection = form.tdsSection || null;
      if (form.tdsRate.trim() !== original.tdsRate.trim()) body.tdsRateBps = tdsRateBps ?? null;
      if (body.tdsRateBps === null && form.tdsSection) {
        // A blank rate is the section's default: sending the section alone resets it.
        delete body.tdsRateBps;
        body.tdsSection = form.tdsSection;
      }
      if (JSON.stringify(bankOf(form)) !== JSON.stringify(bankOf(original))) body.bankAccount = bankOf(form);
      if (JSON.stringify(msmeOf(form)) !== JSON.stringify(msmeOf(original))) body.msme = msmeOf(form);
      if (Object.keys(body).length) await api.patch(`/purchase/vendors/${vendor!._id}`, body);
      return vendor!._id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['purchase'] });
      void qc.invalidateQueries({ queryKey: ['gst'] });
      notify('Vendor saved');
      onDone(id);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the vendor. Try again.")),
  });

  return (
    <FormPage
      onSubmit={() => {
        setProblem(null);
        save.mutate();
      }}
      error={problem}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save vendor'}</Button>
          <Button type="button" variant="secondary" asChild>
            <Link href={editing ? `/purchases/vendors/${vendor!._id}` : '/purchases/vendors'}>Cancel</Link>
          </Button>
        </>
      }
    >
      <Section title="Vendor">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required className="md:col-span-2">
            <input className={inputClass} value={form.name} onChange={text('name')} placeholder="e.g. Sigma Electricals Pvt Ltd" autoFocus={!editing} />
          </Field>
          <Field label="GSTIN" hint={editing && form.gstin.trim().toUpperCase() !== original.gstin.trim().toUpperCase() ? 'Bills already in the books keep the GSTIN they were issued with. New ones use this.' : 'Blank if they are not registered.'}>
            <input className={`${inputClass} font-mono uppercase`} value={form.gstin} onChange={text('gstin')} placeholder="29AABCS1429B1ZA" maxLength={15} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={text('email')} />
          </Field>
          <Field label="Phone">
            <input type="tel" className={inputClass} value={form.phone} onChange={text('phone')} />
          </Field>
          <Field label="City">
            <input className={inputClass} value={form.city} onChange={text('city')} />
          </Field>
          <Field label="Address" className="md:col-span-2">
            <textarea className={inputClass} rows={2} value={form.address} onChange={text('address')} />
          </Field>
          <Field label="Pincode">
            <input className={`${inputClass} font-mono`} inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Notes" className="md:col-span-2">
            <textarea className={inputClass} rows={2} value={form.notes} onChange={text('notes')} />
          </Field>
        </div>
      </Section>

      <Section title="TDS" description="Deducted from each of their bills from now on, on the amount before GST. Bills already posted keep theirs.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="PAN" hint="Taken from the GSTIN when blank.">
            <input className={`${inputClass} font-mono uppercase`} value={form.pan} onChange={text('pan')} maxLength={10} placeholder="ABCDE1234F" />
          </Field>
          <Field label="Section">
            <select className={inputClass} value={form.tdsSection} onChange={text('tdsSection')}>
              <option value="">No TDS</option>
              {TDS_SECTIONS.map((s) => (
                <option key={s.code} value={s.code}>{s.code} · {s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Rate (%)" hint={section ? `Blank for the usual ${section.rateBps / 100}% (194C: 1% for an individual or HUF).` : undefined}>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={form.tdsRate} onChange={text('tdsRate')} disabled={!form.tdsSection} />
          </Field>
        </div>
      </Section>

      <Section title="Bank account" description="Where payment runs pay them.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Account name">
            <input className={inputClass} value={form.accountName} onChange={text('accountName')} />
          </Field>
          <Field label="Bank">
            <input className={inputClass} value={form.bankName} onChange={text('bankName')} />
          </Field>
          <Field label="Account number">
            <input className={`${inputClass} font-mono`} inputMode="numeric" value={form.accountNumber} onChange={text('accountNumber')} />
          </Field>
          <Field label="IFSC">
            <input className={`${inputClass} font-mono uppercase`} value={form.ifsc} onChange={text('ifsc')} maxLength={11} placeholder="HDFC0001234" />
          </Field>
        </div>
        {bankChanged && (
          <p className="mt-3 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">
            Changing where a vendor is paid? Confirm it with them on a number you already have, not one from the email asking for the change.
          </p>
        )}
      </Section>

      <Section title="MSME" description="Micro and small enterprises must be paid within 15 days, or 45 with a written agreement (43B(h)).">
        <label className="flex items-center gap-2 text-body text-ink-900">
          <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={form.msmeRegistered} onChange={(e) => set('msmeRegistered', e.target.checked)} />
          Registered as an MSME (Udyam)
        </label>
        {form.msmeRegistered && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Udyam number" required>
              <input className={`${inputClass} font-mono uppercase`} value={form.udyamNumber} onChange={text('udyamNumber')} maxLength={19} placeholder="UDYAM-MH-26-0012345" />
            </Field>
            <Field label="Category">
              <select className={inputClass} value={form.category} onChange={text('category')}>
                <option value="micro">Micro</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
              </select>
            </Field>
            <Field label="Activity">
              <select className={inputClass} value={form.activity} onChange={text('activity')}>
                <option value="manufacturing">Manufacturing</option>
                <option value="services">Services</option>
                <option value="trading">Trading</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-body text-ink-900 md:col-span-3">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={form.writtenAgreement} onChange={(e) => set('writtenAgreement', e.target.checked)} />
              We have a written agreement on payment terms
            </label>
          </div>
        )}
      </Section>
    </FormPage>
  );
}
