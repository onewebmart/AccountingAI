'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { Field, inputClass } from '@/components/page/page-shell';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { GST_STATES } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { currentFinancialYear } from '@/lib/financial-year';
import { cn } from '@/lib/utils';

/**
 * The parts of the customer and vendor forms they share: who the party is,
 * the GSTIN prefill, the tabs for other details, addresses, contact persons
 * and remarks, and the opening balance. Only the display name is required.
 *
 * The API keeps the work phone as `phone` and the remarks as `notes`; the
 * billing address also sets the address, city and pincode documents print.
 */

export type PartyKind = 'customer' | 'vendor';
export type PartyType = 'business' | 'individual';

export interface PartyAddress {
  attention: string | null;
  country: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  fax: string | null;
}

export interface ContactPerson {
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  workPhone: string | null;
  mobile: string | null;
}

/** What GET /sales/customers/:id and GET /purchase/vendors/:id give beyond the name and GSTIN. */
export interface PartyProfile {
  customerType?: PartyType | null;
  vendorType?: PartyType | null;
  salutation?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  mobile?: string | null;
  language?: string | null;
  pan?: string | null;
  currency?: string;
  paymentTerms?: string | null;
  portalEnabled?: boolean;
  website?: string | null;
  department?: string | null;
  designation?: string | null;
  social?: { x: string | null; skype: string | null; facebook: string | null } | null;
  billingAddress?: PartyAddress | null;
  shippingAddress?: PartyAddress | null;
  contactPersons?: ContactPerson[];
}

/** A customer or vendor as the forms and record pages read it. */
export interface PartyRecordBase extends PartyProfile {
  _id: string;
  name: string;
  gstin: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  stateCode?: string | null;
  notes?: string | null;
}

export const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.'];

export const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'],
  ['mr', 'Marathi'], ['or', 'Odia'], ['pa', 'Punjabi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ur', 'Urdu'],
];

export const PAYMENT_TERMS: Array<[string, string]> = [
  ['due_on_receipt', 'Due on receipt'],
  ['net_7', 'Net 7'],
  ['net_15', 'Net 15'],
  ['net_30', 'Net 30'],
  ['net_45', 'Net 45'],
  ['net_60', 'Net 60'],
  ['net_90', 'Net 90'],
  ['end_of_month', 'Due end of the month'],
  ['end_of_next_month', 'Due end of next month'],
];

export const termsLabel = (terms: string | null | undefined) => PAYMENT_TERMS.find(([v]) => v === terms)?.[1] ?? null;

/**
 * The due date payment terms give a document dated `date` (YYYY-MM-DD), or
 * null with no terms. A form uses it as the default due date; it changes
 * nothing already issued.
 */
export function termsDueDate(terms: string | null | undefined, date: string): string | null {
  if (!terms || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (terms === 'due_on_receipt') return date;
  const net = /^net_(\d+)$/.exec(terms);
  if (net) return new Date(d.getTime() + Number(net[1]) * 86_400_000).toISOString().slice(0, 10);
  if (terms === 'end_of_month' || terms === 'end_of_next_month') {
    const months = terms === 'end_of_month' ? 1 : 2;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 0)).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * For a document form (invoice, bill): the due date follows the party's
 * payment terms and the document date until a due date is typed. Call
 * markTyped() from the due date's onChange. Only the form's default moves;
 * nothing already issued changes.
 *
 *   const terms = useTermsDueDate(customer?.paymentTerms, invoiceDate, setDueDate);
 *   <input type="date" … onChange={(e) => { terms.markTyped(); setDueDate(e.target.value); }} />
 */
export function useTermsDueDate(terms: string | null | undefined, date: string, setDueDate: (due: string) => void) {
  const typed = useRef(false);
  const setter = useRef(setDueDate);
  setter.current = setDueDate;
  useEffect(() => {
    if (typed.current) return;
    const due = termsDueDate(terms, date);
    if (due) setter.current(due);
  }, [terms, date]);
  return {
    markTyped: () => {
      typed.current = true;
    },
  };
}

export const languageLabel =(code: string | null | undefined) => LANGUAGES.find(([c]) => c === code)?.[1] ?? null;

const COUNTRIES = ['India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Singapore', 'Australia', 'Canada', 'Germany', 'Saudi Arabia', 'Nepal', 'Bangladesh', 'Sri Lanka'];
export const isIndia = (country: string | null | undefined) => !country?.trim() || /^(india|in|bharat)$/i.test(country.trim());

// ── GSTIN, checked here as the server checks it ─────────────────────────────

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Why a GSTIN is not one, or null when it is: the format, then its check character. */
export function gstinProblem(raw: string): string | null {
  const g = raw.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(g)) return 'A GSTIN is 15 characters, like 27AAPFU0939F1ZV.';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  if (GSTIN_CHARS[(36 - (sum % 36)) % 36] !== g[14]) return 'This GSTIN fails its check character: one of the characters is probably mistyped.';
  return null;
}

/** GET /sales/gstin/:gstin and GET /purchase/gstin/:gstin. */
export interface GstinLookup {
  gstin: string;
  stateCode: string;
  stateName: string | null;
  pan: string;
  holder: { code: string; kind: string; label: string } | null;
  partyType: PartyType | null;
  registration: {
    legalName: string | null;
    tradeName: string | null;
    status: string | null;
    taxpayerType: string | null;
    registeredOn: string | null;
    address: { street1: string | null; street2: string | null; city: string | null; stateCode: string | null; pincode: string | null } | null;
  } | null;
  note: string | null;
  existing: Array<{ _id: string; name: string }>;
}

// ── The form's state ─────────────────────────────────────────────────────────

export type AddressForm = Record<keyof PartyAddress, string>;
export type ContactForm = Record<keyof ContactPerson, string>;

export interface ProfileForm {
  type: PartyType;
  salutation: string;
  firstName: string;
  lastName: string;
  companyName: string;
  /** The display name. */
  name: string;
  email: string;
  workPhone: string;
  mobile: string;
  language: string;
  gstin: string;
  /** A customer's place of supply, when there is no GSTIN to give it. */
  stateCode: string;
  pan: string;
  currency: string;
  paymentTerms: string;
  portalEnabled: boolean;
  website: string;
  department: string;
  designation: string;
  x: string;
  skype: string;
  facebook: string;
  billing: AddressForm;
  shipping: AddressForm;
  contacts: ContactForm[];
  remarks: string;
}

const s = (v: string | null | undefined) => v ?? '';

export const emptyAddress = (): AddressForm => ({ attention: '', country: 'India', street1: '', street2: '', city: '', stateCode: '', pincode: '', phone: '', fax: '' });
export const emptyContact = (): ContactForm => ({ salutation: '', firstName: '', lastName: '', email: '', workPhone: '', mobile: '' });

const addressForm = (a: PartyAddress | null | undefined): AddressForm =>
  a
    ? { attention: s(a.attention), country: s(a.country) || 'India', street1: s(a.street1), street2: s(a.street2), city: s(a.city), stateCode: s(a.stateCode), pincode: s(a.pincode), phone: s(a.phone), fax: s(a.fax) }
    : emptyAddress();

/** The form for a record, or a blank one. A record saved before addresses had parts fills the billing address from its address, city and pincode. */
export function profileFromRecord(r: PartyRecordBase | null | undefined, kind: PartyKind): ProfileForm {
  const legacy: AddressForm | null =
    r && !r.billingAddress && (r.address || r.city || r.pincode)
      ? { ...emptyAddress(), street1: s(r.address), city: s(r.city), pincode: s(r.pincode), stateCode: s(r.stateCode ?? r.gstin?.slice(0, 2)) }
      : null;
  const type = (kind === 'customer' ? r?.customerType : r?.vendorType) ?? 'business';
  return {
    type,
    salutation: s(r?.salutation),
    firstName: s(r?.firstName),
    lastName: s(r?.lastName),
    companyName: s(r?.companyName),
    name: s(r?.name),
    email: s(r?.email),
    workPhone: s(r?.phone),
    mobile: s(r?.mobile),
    language: s(r?.language),
    gstin: s(r?.gstin),
    stateCode: s(r?.stateCode),
    pan: s(r?.pan),
    currency: r?.currency || 'INR',
    paymentTerms: s(r?.paymentTerms),
    portalEnabled: r?.portalEnabled !== false,
    website: s(r?.website),
    department: s(r?.department),
    designation: s(r?.designation),
    x: s(r?.social?.x),
    skype: s(r?.social?.skype),
    facebook: s(r?.social?.facebook),
    billing: legacy ?? addressForm(r?.billingAddress),
    shipping: addressForm(r?.shippingAddress),
    contacts: (r?.contactPersons ?? []).map((p) => ({ salutation: s(p.salutation), firstName: s(p.firstName), lastName: s(p.lastName), email: s(p.email), workPhone: s(p.workPhone), mobile: s(p.mobile) })),
    remarks: s(r?.notes),
  };
}

const t = (v: string) => v.trim() || null;

function addressValue(a: AddressForm): PartyAddress | null {
  const india = isIndia(a.country);
  const out: PartyAddress = {
    attention: t(a.attention),
    country: t(a.country) ?? 'India',
    street1: t(a.street1),
    street2: t(a.street2),
    city: t(a.city),
    stateCode: india ? t(a.stateCode) : null,
    pincode: a.pincode.replace(/\s/g, '') || null,
    phone: t(a.phone),
    fax: t(a.fax),
  };
  const { country: _c, ...rest } = out;
  void _c;
  return Object.values(rest).some(Boolean) ? out : null;
}

function contactValue(c: ContactForm): ContactPerson {
  return { salutation: t(c.salutation), firstName: t(c.firstName), lastName: t(c.lastName), email: t(c.email), workPhone: t(c.workPhone), mobile: t(c.mobile) };
}
const isPerson = (p: ContactPerson) => !!(p.firstName || p.lastName || p.email || p.workPhone || p.mobile);

/** The form as the API's fields, blank as null. */
function apiValues(f: ProfileForm, kind: PartyKind): Record<string, unknown> {
  const gstin = f.gstin.trim().toUpperCase() || null;
  const social = { x: t(f.x), skype: t(f.skype), facebook: t(f.facebook) };
  return {
    name: f.name.trim(),
    [kind === 'customer' ? 'customerType' : 'vendorType']: f.type,
    salutation: t(f.salutation),
    firstName: t(f.firstName),
    lastName: t(f.lastName),
    companyName: t(f.companyName),
    email: t(f.email),
    phone: t(f.workPhone),
    mobile: t(f.mobile),
    language: t(f.language),
    gstin,
    // The GSTIN gives the place of supply; without one, the state chosen.
    ...(kind === 'customer' ? { stateCode: gstin ? undefined : t(f.stateCode), portalEnabled: f.portalEnabled } : {}),
    pan: t(f.pan.toUpperCase()),
    currency: f.currency || 'INR',
    paymentTerms: t(f.paymentTerms),
    website: t(f.website),
    department: t(f.department),
    designation: t(f.designation),
    social: social.x || social.skype || social.facebook ? social : null,
    billingAddress: addressValue(f.billing),
    shippingAddress: addressValue(f.shipping),
    contactPersons: f.contacts.map(contactValue).filter(isPerson),
    notes: t(f.remarks),
  };
}

const DEFAULTS: Record<string, unknown> = { currency: 'INR', portalEnabled: true };

/**
 * The body to send: on a new record, what was filled in; on an edit, only
 * what changed from the record as it was opened (null clears a field).
 */
export function profileBody(form: ProfileForm, original: ProfileForm | null, kind: PartyKind): Record<string, unknown> {
  const now = apiValues(form, kind);
  const was = original ? apiValues(original, kind) : null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(now)) {
    if (v === undefined) continue;
    if (was) {
      if (JSON.stringify(v) !== JSON.stringify(was[k] ?? null)) out[k] = v;
    } else if (v !== null && !(Array.isArray(v) && v.length === 0) && DEFAULTS[k] !== v) out[k] = v;
  }
  return out;
}

export type ProfileTab = 'other' | 'address' | 'contacts' | 'remarks';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The first thing the server would refuse, and the tab it is on. */
export function profileProblem(f: ProfileForm, kind: PartyKind): { message: string; tab: ProfileTab | null } | null {
  const who = kind === 'customer' ? 'customer' : 'vendor';
  if (!f.name.trim()) return { message: `Give the ${who} a display name.`, tab: null };
  if (f.name.trim().length > 200) return { message: 'The display name can be at most 200 characters.', tab: null };
  if (f.email.trim() && !EMAIL.test(f.email.trim())) return { message: `${f.email.trim()} is not an email address.`, tab: null };
  if (f.gstin.trim()) {
    const p = gstinProblem(f.gstin);
    if (p) return { message: p, tab: null };
  }
  if (f.pan.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan.trim().toUpperCase())) return { message: 'A PAN looks like ABCDE1234F.', tab: 'other' };
  if (f.website.trim() && !/^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(f.website.trim())) return { message: `${f.website.trim()} is not a web address.`, tab: 'other' };
  for (const [label, a] of [['billing', f.billing], ['shipping', f.shipping]] as const) {
    const pin = a.pincode.replace(/\s/g, '');
    if (pin && isIndia(a.country) && !/^[1-9]\d{5}$/.test(pin)) return { message: `The ${label} pincode is six digits and does not start with 0.`, tab: 'address' };
  }
  const bad = f.contacts.find((c) => c.email.trim() && !EMAIL.test(c.email.trim()));
  if (bad) return { message: `${bad.email.trim()} is not an email address.`, tab: 'contacts' };
  return null;
}

/** "Mr. Suresh Rao", "Suresh Rao", "Rao, Suresh", the company name: what the display name can be. */
export function displayNameOptions(f: ProfileForm, extra: Array<string | null | undefined> = []): string[] {
  const first = f.firstName.trim();
  const last = f.lastName.trim();
  const full = [first, last].filter(Boolean).join(' ');
  const options = [
    f.companyName.trim(),
    full && f.salutation ? `${f.salutation} ${full}` : '',
    full,
    first && last ? `${last}, ${first}` : '',
    ...extra.map((e) => e?.trim() ?? ''),
  ];
  return options.filter((o, i) => o && options.indexOf(o) === i);
}

/** The display name the form starts with until one is typed: the company's, or the person's. */
export function suggestedName(f: ProfileForm): string {
  const full = [f.firstName.trim(), f.lastName.trim()].filter(Boolean).join(' ');
  return f.type === 'individual' ? full || f.companyName.trim() : f.companyName.trim() || full;
}

/**
 * Fill the form from a GSTIN lookup, leaving everything already typed: the
 * PAN, the type (unless chosen), the billing state, and the legal name,
 * trade name and address when the GSP gave them.
 */
export function applyLookup(f: ProfileForm, r: GstinLookup, keep: { name: boolean; type: boolean }): { form: ProfileForm; filled: string[] } {
  const filled: string[] = [];
  const next: ProfileForm = { ...f, billing: { ...f.billing } };
  if (!f.pan.trim()) {
    next.pan = r.pan;
    filled.push('PAN');
  }
  if (!keep.type && r.partyType) {
    next.type = r.partyType;
    filled.push(r.partyType === 'individual' ? 'type (individual)' : 'type (business)');
  }
  const india = isIndia(next.billing.country);
  if (india && !f.billing.stateCode) {
    next.billing.stateCode = r.stateCode;
    filled.push('billing state');
  }
  const reg = r.registration;
  if (reg) {
    const legal = reg.legalName?.trim() || null;
    const trade = reg.tradeName?.trim() || null;
    const company = r.partyType === 'individual' ? trade : legal;
    if (company && !f.companyName.trim()) {
      next.companyName = company.slice(0, 200);
      filled.push('company name');
    }
    if (!keep.name && !f.name.trim() && (trade || legal)) {
      next.name = (trade || legal)!.slice(0, 200);
      filled.push('display name');
    }
    const a = reg.address;
    const b = f.billing;
    if (a && india && !b.street1.trim() && !b.street2.trim() && !b.city.trim() && !b.pincode.trim()) {
      next.billing = { ...next.billing, street1: s(a.street1), street2: s(a.street2), city: s(a.city), pincode: s(a.pincode), stateCode: next.billing.stateCode || s(a.stateCode) };
      filled.push('billing address');
    }
  }
  return { form: next, filled };
}

/** The GSTIN lookup for a form: run when a whole, valid GSTIN is typed, or when Prefill is pressed. */
export function useGstinPrefill(kind: PartyKind, gstin: string, initial: string | null, onResult: (r: GstinLookup) => void) {
  const lookup = useMutation({
    mutationFn: (g: string) => api.get<GstinLookup>(`/${kind === 'customer' ? 'sales' : 'purchase'}/gstin/${encodeURIComponent(g)}`),
  });
  // An edit opens with the GSTIN it has: looking it up again waits for Prefill.
  const last = useRef<string | null>(initial?.trim().toUpperCase() || null);
  const handler = useRef(onResult);
  handler.current = onResult;
  const { mutate } = lookup;
  const run = (g: string) => {
    last.current = g;
    mutate(g, { onSuccess: (r) => handler.current(r) });
  };
  const g = gstin.trim().toUpperCase();
  useEffect(() => {
    if (g.length !== 15 || gstinProblem(g) || last.current === g) return;
    last.current = g;
    mutate(g, { onSuccess: (r) => handler.current(r) });
  }, [g, mutate]);
  const current = lookup.data && lookup.data.gstin === g ? lookup.data : null;
  return { run, busy: lookup.isPending, result: current, error: lookup.isError && lookup.variables === g ? lookup.error : null };
}

// ── Pieces of the form ───────────────────────────────────────────────────────

/** "Prefill … from the GST portal using the GSTIN." Not AI: read from the GSTIN and the GSP. */
export function PrefillBanner({ kind, onPrefill, busy }: { kind: PartyKind; onPrefill: () => void; busy: boolean }) {
  const Who = kind === 'customer' ? 'Customer' : 'Vendor';
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-200 bg-surface-sink px-4 py-2.5 text-body text-ink-700">
      <span>
        Prefill {Who} details from the GST portal using the {Who}&apos;s GSTIN.
      </span>
      <button type="button" onClick={onPrefill} disabled={busy} className="inline-flex items-center gap-0.5 font-medium text-brand-800 hover:underline disabled:opacity-60">
        {busy ? 'Looking it up…' : 'Prefill'} <ChevronRight size={14} />
      </button>
    </div>
  );
}

/** What the lookup found, under the GSTIN: the state, PAN and type, the GSP's note, and a party already here with it. */
export function GstinFound({ kind, result, filled, error }: { kind: PartyKind; result: GstinLookup | null; filled: string[]; error: unknown }) {
  if (error) {
    const message = error instanceof ApiError || error instanceof Error ? error.message : "Couldn't look the GSTIN up.";
    return <p className="mt-1 text-caption text-error-fg">{message}</p>;
  }
  if (!result) return null;
  const href = (id: string) => (kind === 'customer' ? `/sales/customers/${id}` : `/purchases/vendors/${id}`);
  const reg = result.registration;
  return (
    <div className="mt-1.5 space-y-1 text-caption">
      <p className="flex flex-wrap items-center gap-x-1.5 text-ink-600">
        <CheckCircle2 size={12} className="shrink-0 text-success-fg" />
        <span>{result.stateName ?? `State ${result.stateCode}`}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">PAN {result.pan}</span>
        {result.holder && (
          <>
            <span aria-hidden>·</span>
            <span>{result.holder.label}</span>
          </>
        )}
        {reg?.status && (
          <>
            <span aria-hidden>·</span>
            <span>{reg.status}</span>
          </>
        )}
      </p>
      {reg?.legalName && <p className="text-ink-600">Legal name: {reg.legalName}{reg.tradeName && reg.tradeName !== reg.legalName ? ` (trading as ${reg.tradeName})` : ''}</p>}
      {filled.length > 0 && <p className="text-ink-500">Filled in: {filled.join(', ')}.</p>}
      {result.note && <p className="text-ink-500">{result.note}</p>}
      {result.existing.length > 0 && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-2 py-1 text-pending-fg">
          Already in your books with this GSTIN:{' '}
          {result.existing.map((e, i) => (
            <span key={e._id}>
              {i > 0 && ', '}
              <Link href={href(e._id)} className="font-medium underline">{e.name}</Link>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}

export function TypeChoice({ kind, value, onChange }: { kind: PartyKind; value: PartyType; onChange: (v: PartyType) => void }) {
  return (
    <div role="radiogroup" aria-label={kind === 'customer' ? 'Customer type' : 'Vendor type'} className="flex items-center gap-5 py-2">
      {(['business', 'individual'] as const).map((v) => (
        <label key={v} className="flex cursor-pointer items-center gap-2 text-body text-ink-900">
          <input type="radio" className="h-4 w-4 accent-brand-600" checked={value === v} onChange={() => onChange(v)} />
          {v === 'business' ? 'Business' : 'Individual'}
        </label>
      ))}
    </div>
  );
}

/**
 * The display name: type anything, or pick one of the names already typed
 * ("Select or type to add").
 */
export function DisplayNameInput({ value, onChange, options, autoFocus, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = options.filter((o) => o !== value.trim());
  return (
    <div className="relative">
      <input
        className={`${inputClass} pr-9`}
        value={value}
        maxLength={200}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Select or type to add'}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        // Picking an option keeps the focus here (mousedown is prevented), so leaving the field closes the list at once.
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!open || shown.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            onChange(shown[active]);
            setOpen(false);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show the names typed"
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-400 hover:text-ink-700"
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <ChevronDown size={15} />
      </button>
      {open && shown.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border border-line-200 bg-surface-card py-1 shadow-e2">
          {shown.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                setOpen(false);
              }}
              className={cn('cursor-pointer px-3 py-2 text-body text-ink-700', i === active && 'bg-honey-100')}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PrimaryContactInputs({ form, set }: { form: ProfileForm; set: (patch: Partial<ProfileForm>) => void }) {
  return (
    <div className="grid grid-cols-[7rem_1fr_1fr] gap-2">
      <select className={inputClass} aria-label="Salutation" value={form.salutation} onChange={(e) => set({ salutation: e.target.value })}>
        <option value="">Salutation</option>
        {SALUTATIONS.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <input className={inputClass} aria-label="First name" placeholder="First name" maxLength={100} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} />
      <input className={inputClass} aria-label="Last name" placeholder="Last name" maxLength={100} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
    </div>
  );
}

/** Tabs across a section: the active one underlined in saffron. */
export function TabStrip<T extends string>({ tabs, active, onChange, label }: { tabs: Array<[T, string]>; active: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex flex-wrap gap-x-6 border-b border-line-200">
      {tabs.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          onClick={() => onChange(key)}
          className={cn(
            '-mb-px border-b-2 px-0.5 pb-2.5 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
            active === key ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A small heading inside a tab. */
export function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-3 text-caption font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {children}
    </div>
  );
}

function AddressFields({ value, onChange, idPrefix }: { value: AddressForm; onChange: (a: AddressForm) => void; idPrefix: string }) {
  const set = (k: keyof AddressForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const india = isIndia(value.country);
  return (
    <div className="grid gap-3">
      <Field label="Attention">
        <input className={inputClass} maxLength={100} value={value.attention} onChange={set('attention')} />
      </Field>
      <Field label="Country / Region">
        <input className={inputClass} list={`${idPrefix}-countries`} maxLength={60} value={value.country} onChange={set('country')} />
        <datalist id={`${idPrefix}-countries`}>
          {COUNTRIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Address">
        <div className="space-y-2">
          <input className={inputClass} aria-label="Street 1" placeholder="Street 1" maxLength={200} value={value.street1} onChange={set('street1')} />
          <input className={inputClass} aria-label="Street 2" placeholder="Street 2" maxLength={200} value={value.street2} onChange={set('street2')} />
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="City">
          <input className={inputClass} maxLength={100} value={value.city} onChange={set('city')} />
        </Field>
        <Field label={india ? 'State' : 'State (India only)'}>
          <select className={inputClass} value={india ? value.stateCode : ''} onChange={set('stateCode')} disabled={!india}>
            <option value="">{india ? 'Choose a state' : 'Not in India'}</option>
            {GST_STATES.map((st) => (
              <option key={st.code} value={st.code}>{st.name}</option>
            ))}
          </select>
        </Field>
        <Field label={india ? 'Pin code' : 'Postal code'}>
          <input
            className={`${inputClass} font-mono`}
            inputMode={india ? 'numeric' : 'text'}
            maxLength={india ? 6 : 10}
            value={value.pincode}
            onChange={(e) => onChange({ ...value, pincode: india ? e.target.value.replace(/\D/g, '') : e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input type="tel" className={inputClass} maxLength={20} value={value.phone} onChange={set('phone')} />
        </Field>
        <Field label="Fax">
          <input type="tel" className={inputClass} maxLength={20} value={value.fax} onChange={set('fax')} />
        </Field>
      </div>
    </div>
  );
}

/** Billing and shipping, side by side; shipping can copy billing. */
export function AddressTab({ billing, shipping, onChange, kind }: {
  billing: AddressForm;
  shipping: AddressForm;
  onChange: (patch: { billing?: AddressForm; shipping?: AddressForm }) => void;
  kind: PartyKind;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-body font-semibold text-ink-900">Billing address</h3>
          <span className="text-caption text-ink-500">Printed on {kind === 'customer' ? 'invoices to them' : 'purchase orders to them'}</span>
        </div>
        <AddressFields idPrefix="billing" value={billing} onChange={(b) => onChange({ billing: b })} />
      </div>
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-body font-semibold text-ink-900">Shipping address</h3>
          <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-brand-800 hover:underline" onClick={() => onChange({ shipping: { ...billing } })}>
            <Copy size={12} /> Copy billing address
          </button>
        </div>
        <AddressFields idPrefix="shipping" value={shipping} onChange={(sh) => onChange({ shipping: sh })} />
      </div>
    </div>
  );
}

const cell = 'w-full rounded-sm border border-line-200 bg-white px-2 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40';

export function ContactPersonsTab({ rows, onChange }: { rows: ContactForm[]; onChange: (rows: ContactForm[]) => void }) {
  const set = (i: number, k: keyof ContactForm, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-line-200">
        <table className="w-full min-w-[52rem]">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              {['Salutation', 'First name', 'Last name', 'Email address', 'Work phone', 'Mobile', ''].map((h, i) => (
                <th key={i} className="px-2 py-2 text-left text-caption font-medium text-ink-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-caption text-ink-400">No contact persons yet. The primary contact above is who documents go to.</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line-100 last:border-0">
                <td className="w-28 px-2 py-1.5">
                  <select className={cell} aria-label="Salutation" value={r.salutation} onChange={(e) => set(i, 'salutation', e.target.value)}>
                    <option value="" />
                    {SALUTATIONS.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5"><input className={cell} aria-label="First name" maxLength={100} value={r.firstName} onChange={(e) => set(i, 'firstName', e.target.value)} /></td>
                <td className="px-2 py-1.5"><input className={cell} aria-label="Last name" maxLength={100} value={r.lastName} onChange={(e) => set(i, 'lastName', e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="email" className={cell} aria-label="Email address" maxLength={200} value={r.email} onChange={(e) => set(i, 'email', e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="tel" className={cell} aria-label="Work phone" maxLength={20} value={r.workPhone} onChange={(e) => set(i, 'workPhone', e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="tel" className={cell} aria-label="Mobile" maxLength={20} value={r.mobile} onChange={(e) => set(i, 'mobile', e.target.value)} /></td>
                <td className="w-10 px-2 py-1.5 text-right">
                  <button type="button" aria-label="Remove this contact person" className="text-ink-400 hover:text-error-fg" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 text-body font-medium text-brand-800 hover:underline disabled:opacity-50"
        disabled={rows.length >= 50}
        onClick={() => onChange([...rows, emptyContact()])}
      >
        <Plus size={14} /> Add contact person
      </button>
    </div>
  );
}

/** Website, department, designation and social handles. */
export function OnlineFields({ form, set }: { form: ProfileForm; set: (patch: Partial<ProfileForm>) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field label="Website URL">
        <input className={inputClass} maxLength={200} placeholder="www.example.in" value={form.website} onChange={(e) => set({ website: e.target.value })} />
      </Field>
      <Field label="Department">
        <input className={inputClass} maxLength={100} value={form.department} onChange={(e) => set({ department: e.target.value })} />
      </Field>
      <Field label="Designation">
        <input className={inputClass} maxLength={100} value={form.designation} onChange={(e) => set({ designation: e.target.value })} />
      </Field>
      <Field label="X">
        <input className={inputClass} maxLength={100} placeholder="@handle" value={form.x} onChange={(e) => set({ x: e.target.value })} />
      </Field>
      <Field label="Skype name">
        <input className={inputClass} maxLength={100} value={form.skype} onChange={(e) => set({ skype: e.target.value })} />
      </Field>
      <Field label="Facebook">
        <input className={inputClass} maxLength={200} placeholder="facebook.com/…" value={form.facebook} onChange={(e) => set({ facebook: e.target.value })} />
      </Field>
    </div>
  );
}

export function TermsFields({ form, set, currencies }: { form: ProfileForm; set: (patch: Partial<ProfileForm>) => void; currencies: Array<{ code: string; name: string }> }) {
  return (
    <>
      <Field label="Currency">
        <select className={inputClass} value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
          <option value="INR">INR · Indian rupee</option>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
          ))}
          {form.currency !== 'INR' && !currencies.some((c) => c.code === form.currency) && <option value={form.currency}>{form.currency}</option>}
        </select>
      </Field>
      <Field label="Payment terms" hint={form.paymentTerms ? 'The due date a new document to them starts with.' : undefined}>
        <select className={inputClass} value={form.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })}>
          <option value="">None</option>
          {PAYMENT_TERMS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

export function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">English</option>
      {LANGUAGES.filter(([c]) => c !== 'en').map(([c, l]) => (
        <option key={c} value={c}>{l}</option>
      ))}
    </select>
  );
}

export function useCurrencies() {
  return useQuery({
    queryKey: ['currency', 'list'],
    queryFn: () => api.get<Array<{ code: string; name: string; digits: number }>>('/currency/currencies'),
    retry: false,
    staleTime: 600_000,
  });
}

// ── On the record page ───────────────────────────────────────────────────────

const stateLabel = (code: string | null | undefined) => (code ? GST_STATES.find((st) => st.code === code)?.name ?? code : null);

/** An address as lines: attention, streets, city and pincode, state, and the country when not India. */
export function addressLines(a: PartyAddress | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, a.pincode].filter(Boolean).join(' ');
  return [a.attention ? `Attn: ${a.attention}` : null, a.street1, a.street2, cityLine || null, stateLabel(a.stateCode), isIndia(a.country) ? null : a.country].filter(
    (l): l is string => !!l,
  );
}

function AddressView({ a }: { a: PartyAddress | null | undefined }) {
  const lines = addressLines(a);
  if (!lines.length) return <span className="text-ink-400">—</span>;
  return (
    <span className="block">
      {lines.map((l, i) => (
        <span key={i} className="block">{l}</span>
      ))}
      {(a?.phone || a?.fax) && <span className="block text-caption text-ink-500">{[a?.phone && `Phone ${a.phone}`, a?.fax && `Fax ${a.fax}`].filter(Boolean).join(' · ')}</span>}
    </span>
  );
}

const personName = (p: { salutation?: string | null; firstName?: string | null; lastName?: string | null }) =>
  [p.salutation, p.firstName, p.lastName].filter(Boolean).join(' ');

/**
 * The profile as label and value pairs for a record page's details: the
 * person, phones, terms, addresses, and what else was filled in. Blank
 * fields that are rarely filled are left out.
 */
export function profileDetailItems(r: PartyRecordBase, kind: PartyKind): Array<[string, React.ReactNode]> {
  const type = kind === 'customer' ? r.customerType : r.vendorType;
  const person = personName(r);
  const role = [r.designation, r.department].filter(Boolean).join(', ');
  const social = [r.social?.x && `X ${r.social.x}`, r.social?.skype && `Skype ${r.social.skype}`, r.social?.facebook && `Facebook ${r.social.facebook}`].filter(Boolean).join(' · ');
  const billing = r.billingAddress ?? (r.address || r.city || r.pincode ? { attention: null, country: 'India', street1: r.address ?? null, street2: null, city: r.city ?? null, stateCode: null, pincode: r.pincode ?? null, phone: null, fax: null } : null);
  const items: Array<[string, React.ReactNode]> = [
    ['Type', type ? (type === 'individual' ? 'Individual' : 'Business') : '—'],
    ['Primary contact', person ? <span>{person}{role && <span className="block text-caption text-ink-500">{role}</span>}</span> : '—'],
    ['Company name', r.companyName || '—'],
    ['Email', r.email || '—'],
    ['Work phone', r.phone || '—'],
    ['Mobile', r.mobile || '—'],
    ['Payment terms', termsLabel(r.paymentTerms) ?? '—'],
  ];
  if (r.currency && r.currency !== 'INR') items.push(['Currency', r.currency]);
  if (r.language && r.language !== 'en') items.push(['Language', languageLabel(r.language) ?? r.language]);
  if (r.website) {
    const href = /^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`;
    items.push(['Website', <a key="w" href={href} target="_blank" rel="noopener noreferrer" className="text-brand-800 hover:underline">{r.website}</a>]);
  }
  if (social) items.push(['Social', social]);
  items.push(['Billing address', <AddressView key="b" a={billing} />]);
  items.push(['Shipping address', <AddressView key="s" a={r.shippingAddress} />]);
  return items;
}

/** The contact persons, one line each. */
export function ContactPersonsList({ people }: { people: ContactPerson[] | undefined }) {
  if (!people?.length) return <p className="text-caption text-ink-400">None added.</p>;
  return (
    <ul className="divide-y divide-line-100">
      {people.map((p, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-body">
          <span className="font-medium text-ink-900">{personName(p) || '—'}</span>
          <span className="text-caption text-ink-600">{[p.email, p.workPhone && `Work ${p.workPhone}`, p.mobile && `Mobile ${p.mobile}`].filter(Boolean).join(' · ') || '—'}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

const MAX_FILES = 10;

/** Files picked on a new record: kept here and attached once it is saved. */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-200 px-3 py-2 text-body text-ink-700 hover:bg-surface-sink disabled:opacity-50"
        disabled={files.length >= MAX_FILES}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={14} /> Upload files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          onChange([...files, ...picked].slice(0, MAX_FILES));
        }}
      />
      <p className="mt-1 text-caption text-ink-500">Up to {MAX_FILES} files: an agreement, a GST certificate, a cancelled cheque. Attached when you save.</p>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-caption text-ink-700">
              <Paperclip size={12} className="text-ink-400" />
              <span className="min-w-0 truncate font-mono">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="text-ink-400 hover:text-error-fg" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Attach the picked files to the saved record. The names that could not be attached. */
export async function attachFiles(entityType: 'Customer' | 'Vendor', entityId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const file of files) {
    const body = new FormData();
    body.append('entityType', entityType);
    body.append('entityId', entityId);
    body.append('file', file);
    try {
      await api.post('/attachments', body);
    } catch {
      failed.push(file.name);
    }
  }
  return failed;
}

// ── Opening balance ─────────────────────────────────────────────────────────

/**
 * Who may enter an opening balance here (the same people as on Migration),
 * and the day it opens on: the day earlier opening balances were brought in
 * as at, or 1 April of this financial year.
 */
export function useOpeningBalance() {
  const { user } = useAuth();
  const allowed = !!user && hasPermission(user.role as UserRole, Permission.MANAGE_ORG);
  const history = useQuery({
    queryKey: ['migration', 'list'],
    queryFn: () => api.get<Array<{ status: string; openingDate: string | null }>>('/migration'),
    enabled: allowed,
    retry: false,
  });
  const earlier = (history.data ?? []).find((b) => b.status === 'committed' && b.openingDate)?.openingDate ?? null;
  return { allowed, defaultDate: earlier ?? `${currentFinancialYear().slice(0, 4)}-04-01`, earlier };
}

/** Rupees typed → paise, or a reason it is not an amount. Blank is none. */
export function openingPaise(text: string): { paise: number; problem: string | null } {
  if (!text.trim()) return { paise: 0, problem: null };
  const paise = parseRupees(text);
  if (paise === null || paise < 0) return { paise: 0, problem: 'The opening balance is an amount in rupees, like 25000 or 1,250.50.' };
  return { paise, problem: null };
}

/**
 * Post a party's opening balance through Migration, as one manual opening
 * entry: their opening invoice or bill, against Receivables or Payables,
 * with the other side in Suspense until the rest of the opening balances
 * are in (Migration offers the same when typed balances do not agree).
 */
export async function postOpeningBalance(kind: PartyKind, partyId: string, balancePaise: number, openingDate: string): Promise<void> {
  if (!Number.isInteger(balancePaise) || balancePaise <= 0) return;
  const batch = await api.post<{ _id: string }>('/migration/manual', { parties: [{ kind, partyId, balancePaise }] });
  await api.post(`/migration/${batch._id}/commit`, { openingDate, differenceToSuspense: true });
}
