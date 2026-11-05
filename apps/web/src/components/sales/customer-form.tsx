'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { api } from '@/lib/api';
import { GST_STATES } from '@/lib/gst';
import { errorText, stateName, type CustomerRecord } from './sales-data';
import { EntryActions, useDocumentEntry, usePrefill } from '@/components/documents/document-entry';
import {
  AddressTab,
  ContactPersonsTab,
  DisplayNameInput,
  GstinFound,
  Group,
  LanguageSelect,
  OnlineFields,
  PendingFiles,
  PrefillBanner,
  PrimaryContactInputs,
  TabStrip,
  TermsFields,
  TypeChoice,
  applyLookup,
  attachFiles,
  displayNameOptions,
  gstinProblem,
  openingPaise,
  postOpeningBalance,
  profileBody,
  profileFromRecord,
  profileProblem,
  suggestedName,
  useCurrencies,
  useGstinPrefill,
  useOpeningBalance,
  type GstinLookup,
  type PartyProfile,
  type ProfileForm,
  type ProfileTab,
} from '@/components/parties/party-profile';

const TABS: Array<[ProfileTab, string]> = [
  ['other', 'Other details'],
  ['address', 'Address'],
  ['contacts', 'Contact persons'],
  ['remarks', 'Remarks'],
];

const panOf = (gstin: string) => (gstin.trim().length >= 12 ? gstin.trim().toUpperCase().slice(2, 12) : '');

/**
 * A customer's details, as a page: new when there is no customer, an edit
 * when there is. Only the display name is required. A whole GSTIN (or
 * Prefill) fills the state, PAN and type, and the legal name and address
 * when the GSP gives them, never over what was typed. An edit sends only
 * what changed; invoices already issued keep the name, GSTIN and state they
 * were issued with (the server sees to it).
 */
export function CustomerForm({ customer }: { customer?: CustomerRecord | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const entry = useDocumentEntry();
  const record = (customer ?? null) as (CustomerRecord & PartyProfile) | null;
  const [original] = useState<ProfileForm>(() => profileFromRecord(record, 'customer'));
  const [form, setForm] = useState<ProfileForm>(original);
  const [tab, setTab] = useState<ProfileTab>('other');
  const [problem, setProblem] = useState<string | null>(null);
  const [filled, setFilled] = useState<string[]>([]);
  const [askGstin, setAskGstin] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [opening, setOpening] = useState({ amount: '', date: '' });
  const currencies = useCurrencies();
  const openingBalance = useOpeningBalance();

  // The display name follows the names typed until one is typed into it; an edit's is already theirs.
  const nameTyped = useRef(!!customer);
  const typeChosen = useRef(!!record?.customerType);
  const latest = useRef(form);
  latest.current = form;

  const set = (patch: Partial<ProfileForm>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (!nameTyped.current && !('name' in patch)) next.name = suggestedName(next);
      return next;
    });

  // A new customer from a scan: their name and GSTIN as printed on it; the GSTIN then fills the rest.
  usePrefill((x) => {
    if (customer) return;
    if (x.party.name) nameTyped.current = true;
    setForm((f) => ({ ...f, name: f.name || (x.party.name ?? '').slice(0, 200), gstin: f.gstin || (x.party.gstin ?? '') }));
  });

  const prefill = useGstinPrefill('customer', form.gstin, customer?.gstin ?? null, (r: GstinLookup) => {
    let f = latest.current;
    // A PAN that came with the old GSTIN gives way to the new one's.
    if (f.pan && f.pan.toUpperCase() === panOf(original.gstin) && r.gstin !== original.gstin.trim().toUpperCase()) f = { ...f, pan: '' };
    const { form: next, filled: what } = applyLookup(f, r, { name: nameTyped.current, type: typeChosen.current });
    if (what.includes('display name')) nameTyped.current = true;
    setForm(next);
    setFilled(what);
    setAskGstin(false);
  });

  const gstin = form.gstin.trim().toUpperCase();
  const gstinBad = gstin.length >= 15 ? gstinProblem(gstin) : null;
  // A GSTIN starts with the state it was issued in, so it settles the place of supply.
  const stateFromGstin = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  const gstinChanged = !!customer && gstin !== original.gstin.trim().toUpperCase();
  // Opened to add a customer for an invoice: Cancel goes back to it.
  const backHref = customer ? `/sales/customers/${customer._id}` : entry.returnTo ?? '/sales/customers';
  const openingDate = opening.date || openingBalance.defaultDate;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customer ? api.patch<{ _id: string }>(`/sales/customers/${customer._id}`, body) : api.post<{ _id: string }>('/sales/customers', body),
    onSuccess: async (saved) => {
      const id = saved?._id ?? customer?._id;
      notify('Customer saved');
      if (!customer && id) {
        // Once they exist: the files picked, and the opening balance.
        if (files.length) {
          const failed = await attachFiles('Customer', id, files);
          if (failed.length) notify(`Customer saved, but ${failed.join(', ')} couldn't be attached. Attach it on their page.`, 'error');
        }
        const { paise } = openingPaise(opening.amount);
        if (paise > 0 && openingBalance.allowed) {
          try {
            await postOpeningBalance('customer', id, paise, openingDate);
            notify('Opening balance posted to ledger');
          } catch (e) {
            notify(`Customer saved, but the opening balance wasn't posted: ${errorText(e)} Enter it on Migration.`, 'error');
          }
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['gst'] });
      void queryClient.invalidateQueries({ queryKey: ['gl'] });
      if (!customer && id) {
        return entry.finish({ entityType: 'Customer', entityId: id, label: `Customer ${form.name.trim()}` }, `/sales/customers/${id}`);
      }
      router.push(`/sales/customers/${id}`);
    },
  });

  const submit = () => {
    const p = profileProblem(form, 'customer');
    if (p) {
      if (p.tab) setTab(p.tab);
      return setProblem(p.message);
    }
    const op = openingPaise(opening.amount);
    if (op.problem) {
      setTab('other');
      return setProblem(op.problem);
    }
    setProblem(null);
    const body = profileBody(form, customer ? original : null, 'customer');
    if (customer && Object.keys(body).length === 0) {
      router.push(backHref);
      return;
    }
    save.mutate(body);
  };

  const onPrefill = () => {
    if (!gstin) {
      setAskGstin(true);
      document.getElementById('customer-gstin')?.focus();
      return;
    }
    const bad = gstinProblem(gstin);
    if (bad) {
      setProblem(bad);
      document.getElementById('customer-gstin')?.focus();
      return;
    }
    setProblem(null);
    prefill.run(gstin);
  };

  return (
    <FormPage
      onSubmit={submit}
      error={problem ?? (save.isError ? errorText(save.error, "Couldn't save the customer. Try again.") : null)}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save customer'}</Button>
          {!customer && <EntryActions busy={save.isPending} />}
          <Button asChild variant="secondary"><Link href={backHref}>Cancel</Link></Button>
        </>
      }
    >
      <Section>
        <PrefillBanner kind="customer" busy={prefill.busy} onPrefill={onPrefill} />
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="Customer type" className="md:col-span-2">
            <TypeChoice
              kind="customer"
              value={form.type}
              onChange={(v) => {
                typeChosen.current = true;
                set({ type: v });
              }}
            />
          </Field>
          <Field label="Primary contact" className="md:col-span-2">
            <div className="max-w-2xl">
              <PrimaryContactInputs form={form} set={set} />
            </div>
          </Field>
          <Field label="Company name">
            <input className={inputClass} maxLength={200} value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} />
          </Field>
          <Field label="Display name" required hint="Shown on invoices and in every list.">
            <DisplayNameInput
              value={form.name}
              autoFocus={!customer}
              options={displayNameOptions(form, [prefill.result?.registration?.tradeName, prefill.result?.registration?.legalName])}
              onChange={(v) => {
                nameTyped.current = v.trim() !== '';
                setForm((f) => ({ ...f, name: v }));
              }}
            />
          </Field>
          <Field
            label="GSTIN"
            hint={
              prefill.result && !gstinBad
                ? undefined
                : askGstin
                ? <span className="text-pending-fg">Type their GSTIN here: the details fill in as soon as it is whole.</span>
                : gstinChanged
                  ? 'Invoices already issued keep the GSTIN they were issued with. New ones use this.'
                  : 'Leave blank if they are not registered. A whole GSTIN fills the state, PAN and type.'
            }
          >
            <input
              id="customer-gstin"
              className={`${inputClass} font-mono uppercase`}
              value={form.gstin}
              onChange={(e) => {
                setFilled([]);
                setForm((f) => ({ ...f, gstin: e.target.value.replace(/\s/g, '') }));
              }}
              placeholder="e.g. 27AAPFU0939F1ZV"
              maxLength={15}
            />
            {gstinBad ? <p className="mt-1 text-caption text-error-fg">{gstinBad}</p> : <GstinFound kind="customer" result={prefill.result} filled={filled} error={prefill.error} />}
          </Field>
          <Field label="Place of supply" hint={stateFromGstin ? undefined : 'The state on your GSTR-1 for sales to them. Blank: their billing address’s state.'}>
            {stateFromGstin ? (
              <p className="py-2 text-body text-ink-700">{stateName(stateFromGstin)}, from the GSTIN</p>
            ) : (
              <select className={inputClass} value={form.stateCode} onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value }))}>
                <option value="">Choose a state</option>
                {GST_STATES.map((st) => (
                  <option key={st.code} value={st.code}>{st.code} · {st.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Email address" hint="Invoices and payment reminders are emailed here.">
            <input type="email" className={inputClass} maxLength={200} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <div className="grid grid-cols-2 gap-2">
              <input type="tel" className={inputClass} aria-label="Work phone" placeholder="Work phone" maxLength={40} value={form.workPhone} onChange={(e) => setForm((f) => ({ ...f, workPhone: e.target.value }))} />
              <input type="tel" className={inputClass} aria-label="Mobile" placeholder="Mobile" maxLength={20} value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} />
            </div>
          </Field>
          <Field label="Customer language" hint="What reminders to them will be written in.">
            <LanguageSelect value={form.language} onChange={(v) => setForm((f) => ({ ...f, language: v }))} />
          </Field>
        </div>
      </Section>

      <Section>
        <TabStrip label="Customer details" tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'other' && (
          <div className="space-y-6">
            <Group title="Tax and terms">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="PAN" hint="From the GSTIN when blank.">
                  <input className={`${inputClass} font-mono uppercase`} maxLength={10} placeholder="ABCDE1234F" value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} />
                </Field>
                <TermsFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} currencies={currencies.data ?? []} />
                {!customer && openingBalance.allowed && (
                  <Field
                    label="Opening balance (₹)"
                    className="md:col-span-3"
                    hint={`What they owed you on that day. Saving posts it to the ledger as an opening entry: their receivable, with the other side in Suspense until the rest of your opening balances are in.${openingBalance.earlier ? ` Your opening balances were brought in as at ${openingBalance.earlier}.` : ''}`}
                  >
                    <div className="grid max-w-md grid-cols-[1fr_11rem] gap-2">
                      <input className={`${inputClass} text-right font-mono`} inputMode="decimal" placeholder="0.00" aria-label="Opening balance in rupees" value={opening.amount} onChange={(e) => setOpening({ ...opening, amount: e.target.value })} />
                      <input type="date" className={inputClass} aria-label="Opening balance as on" value={openingDate} onChange={(e) => setOpening({ ...opening, date: e.target.value })} />
                    </div>
                  </Field>
                )}
                {!customer && !openingBalance.allowed && (
                  <p className="text-caption text-ink-500 md:col-span-3">An opening balance for them is entered by an admin, on Migration.</p>
                )}
              </div>
            </Group>

            <Group title="Portal and documents">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="flex items-center gap-2 text-body text-ink-900">
                    <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={form.portalEnabled} onChange={(e) => setForm((f) => ({ ...f, portalEnabled: e.target.checked }))} />
                    Allow portal access for this customer
                  </label>
                  <p className="mt-1 text-caption text-ink-500">They see their invoices and pay them from a link you share. Turned off, no link opens.</p>
                </div>
                <div>
                  {customer ? (
                    <AttachmentsSection entityType="Customer" entityId={customer._id} />
                  ) : (
                    <>
                      <p className="mb-1 text-caption font-medium text-ink-700">Documents</p>
                      <PendingFiles files={files} onChange={setFiles} />
                    </>
                  )}
                </div>
              </div>
            </Group>

            <Group title="More about them">
              <OnlineFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} />
            </Group>
          </div>
        )}

        {tab === 'address' && <AddressTab kind="customer" billing={form.billing} shipping={form.shipping} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />}

        {tab === 'contacts' && <ContactPersonsTab rows={form.contacts} onChange={(contacts) => setForm((f) => ({ ...f, contacts }))} />}

        {tab === 'remarks' && (
          <Field label="Remarks" hint="For internal use: never printed or sent.">
            <textarea className={inputClass} rows={5} maxLength={2000} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
        )}
      </Section>
    </FormPage>
  );
}
