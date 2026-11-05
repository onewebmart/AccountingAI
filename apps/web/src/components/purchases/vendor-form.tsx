'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { api } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { TDS_SECTIONS, errorText, type VendorRecord } from './purchase-data';
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
} from '@/components/parties/party-profile';

/** What only a vendor has: the TDS on their bills, where they are paid, their MSME registration. */
interface VendorExtra {
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

const extraOf = (v?: VendorRecord | null): VendorExtra => ({
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

const bankOf = (f: VendorExtra) =>
  f.accountNumber.trim()
    ? { accountName: f.accountName.trim() || null, accountNumber: f.accountNumber.replace(/[\s-]/g, ''), ifsc: f.ifsc.trim().toUpperCase(), bankName: f.bankName.trim() || null }
    : null;
const msmeOf = (f: VendorExtra) =>
  f.msmeRegistered ? { udyamNumber: f.udyamNumber.trim().toUpperCase(), category: f.category, activity: f.activity, writtenAgreement: f.writtenAgreement } : null;

type VendorTab = 'other' | 'address' | 'contacts' | 'bank' | 'remarks';
const TABS: Array<[VendorTab, string]> = [
  ['other', 'Other details'],
  ['address', 'Address'],
  ['contacts', 'Contact persons'],
  ['bank', 'Bank details'],
  ['remarks', 'Remarks'],
];

const panOf = (gstin: string) => (gstin.trim().length >= 12 ? gstin.trim().toUpperCase().slice(2, 12) : '');

/** A save the form refuses, and the tab to show it on. */
class FormProblem extends Error {
  constructor(message: string, readonly tab: VendorTab | null) {
    super(message);
  }
}

/**
 * A vendor's details on one page, in the same layout as a customer's: who
 * they are, then tabs for other details (PAN, terms, TDS, MSME), addresses,
 * contact persons, where they are paid, and remarks. Only the display name
 * is required. New and edit share it; an edit sends only what changed.
 */
export function VendorForm({ vendor, onDone }: { vendor?: VendorRecord | null; onDone: (id: string, name: string) => void | Promise<void> }) {
  const qc = useQueryClient();
  const entry = useDocumentEntry();
  const record = (vendor ?? null) as (VendorRecord & PartyProfile) | null;
  const editing = !!vendor;
  const [original] = useState<ProfileForm>(() => profileFromRecord(record, 'vendor'));
  const [originalExtra] = useState<VendorExtra>(() => extraOf(vendor));
  const [form, setForm] = useState<ProfileForm>(original);
  const [extra, setExtra] = useState<VendorExtra>(originalExtra);
  const [tab, setTab] = useState<VendorTab>('other');
  const [problem, setProblem] = useState<string | null>(null);
  const [filled, setFilled] = useState<string[]>([]);
  const [askGstin, setAskGstin] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [opening, setOpening] = useState({ amount: '', date: '' });
  const currencies = useCurrencies();
  const openingBalance = useOpeningBalance();

  const nameTyped = useRef(editing);
  const typeChosen = useRef(!!record?.vendorType);
  const latest = useRef(form);
  latest.current = form;

  const set = (patch: Partial<ProfileForm>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (!nameTyped.current && !('name' in patch)) next.name = suggestedName(next);
      return next;
    });
  const setX = <K extends keyof VendorExtra>(k: K, v: VendorExtra[K]) => setExtra((x) => ({ ...x, [k]: v }));
  const textX = (k: keyof VendorExtra) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setX(k, e.target.value as never);

  // A new vendor from a scan: their name and GSTIN as printed on it; the GSTIN then fills the rest.
  usePrefill((x) => {
    if (editing) return;
    if (x.party.name) nameTyped.current = true;
    setForm((f) => ({ ...f, name: f.name || (x.party.name ?? '').slice(0, 200), gstin: f.gstin || (x.party.gstin ?? '') }));
  });

  const prefill = useGstinPrefill('vendor', form.gstin, vendor?.gstin ?? null, (r: GstinLookup) => {
    let f = latest.current;
    if (f.pan && f.pan.toUpperCase() === panOf(original.gstin) && r.gstin !== original.gstin.trim().toUpperCase()) f = { ...f, pan: '' };
    const { form: next, filled: what } = applyLookup(f, r, { name: nameTyped.current, type: typeChosen.current });
    if (what.includes('display name')) nameTyped.current = true;
    setForm(next);
    setFilled(what);
    setAskGstin(false);
  });

  const gstin = form.gstin.trim().toUpperCase();
  const gstinBad = gstin.length >= 15 ? gstinProblem(gstin) : null;
  const section = TDS_SECTIONS.find((s) => s.code === extra.tdsSection);
  const bankChanged = !!vendor?.bankAccount && extra.accountNumber.replace(/[\s-]/g, '') !== vendor.bankAccount.accountNumber;
  const openingDate = opening.date || openingBalance.defaultDate;

  const save = useMutation({
    mutationFn: async () => {
      const p = profileProblem(form, 'vendor');
      if (p) throw new FormProblem(p.message, p.tab);
      const tdsRateBps = extra.tdsRate.trim() ? parseRupees(extra.tdsRate) : undefined;
      if (tdsRateBps === null || (tdsRateBps !== undefined && (tdsRateBps < 0 || tdsRateBps > 10000))) throw new FormProblem('The TDS rate is a per cent, like 2 or 0.1.', 'other');
      if (extra.msmeRegistered && extra.udyamNumber.trim().length !== 19) throw new FormProblem('A Udyam number looks like UDYAM-MH-26-0012345.', 'other');
      if (extra.accountNumber.trim() && extra.ifsc.trim().length !== 11) throw new FormProblem('An IFSC is 11 characters, like HDFC0001234.', 'bank');
      const op = openingPaise(opening.amount);
      if (op.problem) throw new FormProblem(op.problem, 'other');

      const body = profileBody(form, editing ? original : null, 'vendor');
      if (!editing) {
        const created = await api.post<{ _id: string }>('/purchase/vendors', {
          ...body,
          ...(extra.tdsSection ? { tdsSection: extra.tdsSection, ...(tdsRateBps !== undefined ? { tdsRateBps } : {}) } : {}),
        });
        // Bank and MSME go through the edit, which audits a bank account on its own.
        const rest: Record<string, unknown> = {};
        if (bankOf(extra)) rest.bankAccount = bankOf(extra);
        if (msmeOf(extra)) rest.msme = msmeOf(extra);
        if (Object.keys(rest).length) {
          try {
            await api.patch(`/purchase/vendors/${created._id}`, rest);
          } catch (e) {
            notify(`Vendor saved, but the ${rest.bankAccount ? 'bank details' : 'MSME details'} weren't: ${errorText(e)} Add them in Edit.`, 'error');
          }
        }
        return { id: created._id, opening: op.paise };
      }

      if (extra.tdsSection !== originalExtra.tdsSection) body.tdsSection = extra.tdsSection || null;
      if (extra.tdsRate.trim() !== originalExtra.tdsRate.trim()) body.tdsRateBps = tdsRateBps ?? null;
      if (body.tdsRateBps === null && extra.tdsSection) {
        // A blank rate is the section's default: sending the section alone resets it.
        delete body.tdsRateBps;
        body.tdsSection = extra.tdsSection;
      }
      if (JSON.stringify(bankOf(extra)) !== JSON.stringify(bankOf(originalExtra))) body.bankAccount = bankOf(extra);
      if (JSON.stringify(msmeOf(extra)) !== JSON.stringify(msmeOf(originalExtra))) body.msme = msmeOf(extra);
      if (Object.keys(body).length) await api.patch(`/purchase/vendors/${vendor!._id}`, body);
      return { id: vendor!._id, opening: 0 };
    },
    onSuccess: async ({ id, opening: openingAmount }) => {
      notify('Vendor saved');
      if (!editing) {
        if (files.length) {
          const failed = await attachFiles('Vendor', id, files);
          if (failed.length) notify(`Vendor saved, but ${failed.join(', ')} couldn't be attached. Attach it on their page.`, 'error');
        }
        if (openingAmount > 0 && openingBalance.allowed) {
          try {
            await postOpeningBalance('vendor', id, openingAmount, openingDate);
            notify('Opening balance posted to ledger');
          } catch (e) {
            notify(`Vendor saved, but the opening balance wasn't posted: ${errorText(e)} Enter it on Migration.`, 'error');
          }
        }
      }
      void qc.invalidateQueries({ queryKey: ['purchase'] });
      void qc.invalidateQueries({ queryKey: ['gst'] });
      void qc.invalidateQueries({ queryKey: ['gl'] });
      return onDone(id, form.name.trim());
    },
    onError: (e) => {
      if (e instanceof FormProblem && e.tab) setTab(e.tab);
      setProblem(errorText(e, "Couldn't save the vendor. Try again."));
    },
  });

  const onPrefill = () => {
    if (!gstin) {
      setAskGstin(true);
      document.getElementById('vendor-gstin')?.focus();
      return;
    }
    const bad = gstinProblem(gstin);
    if (bad) {
      setProblem(bad);
      document.getElementById('vendor-gstin')?.focus();
      return;
    }
    setProblem(null);
    prefill.run(gstin);
  };

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
          {!editing && <EntryActions busy={save.isPending} />}
          <Button type="button" variant="secondary" asChild>
            {/* Opened to add a vendor for a bill: Cancel goes back to it. */}
            <Link href={editing ? `/purchases/vendors/${vendor!._id}` : entry.returnTo ?? '/purchases/vendors'}>Cancel</Link>
          </Button>
        </>
      }
    >
      <Section>
        <PrefillBanner kind="vendor" busy={prefill.busy} onPrefill={onPrefill} />
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="Vendor type" className="md:col-span-2">
            <TypeChoice
              kind="vendor"
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
          <Field label="Display name" required hint="Shown on bills and in every list.">
            <DisplayNameInput
              value={form.name}
              autoFocus={!editing}
              placeholder="e.g. Sigma Electricals"
              options={displayNameOptions(form, [prefill.result?.registration?.tradeName, prefill.result?.registration?.legalName])}
              onChange={(v) => {
                nameTyped.current = v.trim() !== '';
                setForm((f) => ({ ...f, name: v }));
              }}
            />
          </Field>
          <Field
            label="GSTIN"
            className="md:col-span-2"
            hint={
              prefill.result && !gstinBad
                ? undefined
                : askGstin
                ? <span className="text-pending-fg">Type their GSTIN here: the details fill in as soon as it is whole.</span>
                : editing && gstin !== original.gstin.trim().toUpperCase()
                  ? 'Bills already in the books keep the GSTIN they were issued with. New ones use this.'
                  : 'Blank if they are not registered. A whole GSTIN fills the state, PAN and type.'
            }
          >
            <input
              id="vendor-gstin"
              className={`${inputClass} max-w-md font-mono uppercase`}
              value={form.gstin}
              onChange={(e) => {
                setFilled([]);
                setForm((f) => ({ ...f, gstin: e.target.value.replace(/\s/g, '') }));
              }}
              placeholder="29AABCS1429B1ZA"
              maxLength={15}
            />
            {gstinBad ? <p className="mt-1 text-caption text-error-fg">{gstinBad}</p> : <GstinFound kind="vendor" result={prefill.result} filled={filled} error={prefill.error} />}
          </Field>
          <Field label="Email address">
            <input type="email" className={inputClass} maxLength={200} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <div className="grid grid-cols-2 gap-2">
              <input type="tel" className={inputClass} aria-label="Work phone" placeholder="Work phone" maxLength={40} value={form.workPhone} onChange={(e) => setForm((f) => ({ ...f, workPhone: e.target.value }))} />
              <input type="tel" className={inputClass} aria-label="Mobile" placeholder="Mobile" maxLength={20} value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} />
            </div>
          </Field>
          <Field label="Vendor language">
            <LanguageSelect value={form.language} onChange={(v) => setForm((f) => ({ ...f, language: v }))} />
          </Field>
        </div>
      </Section>

      <Section>
        <TabStrip label="Vendor details" tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'other' && (
          <div className="space-y-6">
            <Group title="Tax and terms">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="PAN" hint="From the GSTIN when blank. Needed on every TDS return line.">
                  <input className={`${inputClass} font-mono uppercase`} maxLength={10} placeholder="ABCDE1234F" value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} />
                </Field>
                <TermsFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} currencies={currencies.data ?? []} />
                {!editing && openingBalance.allowed && (
                  <Field
                    label="Opening balance (₹)"
                    className="md:col-span-3"
                    hint={`What you owed them on that day. Saving posts it to the ledger as an opening entry: their payable, with the other side in Suspense until the rest of your opening balances are in.${openingBalance.earlier ? ` Your opening balances were brought in as at ${openingBalance.earlier}.` : ''}`}
                  >
                    <div className="grid max-w-md grid-cols-[1fr_11rem] gap-2">
                      <input className={`${inputClass} text-right font-mono`} inputMode="decimal" placeholder="0.00" aria-label="Opening balance in rupees" value={opening.amount} onChange={(e) => setOpening({ ...opening, amount: e.target.value })} />
                      <input type="date" className={inputClass} aria-label="Opening balance as on" value={openingDate} onChange={(e) => setOpening({ ...opening, date: e.target.value })} />
                    </div>
                  </Field>
                )}
                {!editing && !openingBalance.allowed && (
                  <p className="text-caption text-ink-500 md:col-span-3">An opening balance for them is entered by an admin, on Migration.</p>
                )}
              </div>
            </Group>

            <Group title="TDS">
              <p className="-mt-1 mb-3 text-caption text-ink-500">Deducted from each of their bills from now on, on the amount before GST. Bills already posted keep theirs.</p>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Section">
                  <select className={inputClass} value={extra.tdsSection} onChange={textX('tdsSection')}>
                    <option value="">No TDS</option>
                    {TDS_SECTIONS.map((s) => (
                      <option key={s.code} value={s.code}>{s.code} · {s.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Rate (%)" hint={section ? `Blank for the usual ${section.rateBps / 100}% (194C: 1% for an individual or HUF).` : undefined}>
                  <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={extra.tdsRate} onChange={textX('tdsRate')} disabled={!extra.tdsSection} />
                </Field>
              </div>
            </Group>

            <Group title="MSME">
              <label className="flex items-center gap-2 text-body text-ink-900">
                <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={extra.msmeRegistered} onChange={(e) => setX('msmeRegistered', e.target.checked)} />
                Registered as an MSME (Udyam)
              </label>
              <p className="mt-1 text-caption text-ink-500">Micro and small enterprises must be paid within 15 days, or 45 with a written agreement (43B(h)).</p>
              {extra.msmeRegistered && (
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Field label="Udyam number" required>
                    <input className={`${inputClass} font-mono uppercase`} value={extra.udyamNumber} onChange={textX('udyamNumber')} maxLength={19} placeholder="UDYAM-MH-26-0012345" />
                  </Field>
                  <Field label="Category">
                    <select className={inputClass} value={extra.category} onChange={textX('category')}>
                      <option value="micro">Micro</option>
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                    </select>
                  </Field>
                  <Field label="Activity">
                    <select className={inputClass} value={extra.activity} onChange={textX('activity')}>
                      <option value="manufacturing">Manufacturing</option>
                      <option value="services">Services</option>
                      <option value="trading">Trading</option>
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-body text-ink-900 md:col-span-3">
                    <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={extra.writtenAgreement} onChange={(e) => setX('writtenAgreement', e.target.checked)} />
                    We have a written agreement on payment terms
                  </label>
                </div>
              )}
            </Group>

            <Group title="Documents">
              {editing ? <AttachmentsSection entityType="Vendor" entityId={vendor!._id} /> : <PendingFiles files={files} onChange={setFiles} />}
            </Group>

            <Group title="More about them">
              <OnlineFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} />
            </Group>
          </div>
        )}

        {tab === 'address' && <AddressTab kind="vendor" billing={form.billing} shipping={form.shipping} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />}

        {tab === 'contacts' && <ContactPersonsTab rows={form.contacts} onChange={(contacts) => setForm((f) => ({ ...f, contacts }))} />}

        {tab === 'bank' && (
          <div>
            <p className="-mt-1 mb-4 text-caption text-ink-500">Where payment runs pay them.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Account holder name">
                <input className={inputClass} value={extra.accountName} onChange={textX('accountName')} />
              </Field>
              <Field label="Bank">
                <input className={inputClass} value={extra.bankName} onChange={textX('bankName')} />
              </Field>
              <Field label="Account number">
                <input className={`${inputClass} font-mono`} inputMode="numeric" value={extra.accountNumber} onChange={textX('accountNumber')} />
              </Field>
              <Field label="IFSC">
                <input className={`${inputClass} font-mono uppercase`} value={extra.ifsc} onChange={textX('ifsc')} maxLength={11} placeholder="HDFC0001234" />
              </Field>
            </div>
            {bankChanged && (
              <p className="mt-3 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">
                Changing where a vendor is paid? Confirm it with them on a number you already have, not one from the email asking for the change.
              </p>
            )}
          </div>
        )}

        {tab === 'remarks' && (
          <Field label="Remarks" hint="For internal use: never printed or sent.">
            <textarea className={inputClass} rows={5} maxLength={2000} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
        )}
      </Section>
    </FormPage>
  );
}
