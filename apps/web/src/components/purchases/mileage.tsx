'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { Field, Section, inputClass } from '@/components/page/page-shell';
import { ProjectSelect } from '@/components/projects/project-select';
import { useCustomers } from '@/components/sales/sales-data';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { rupeesText, shortDate, todayIso } from './purchase-data';
import { BillableToggle, CustomerPicker, ExpenseAccountPicker, PaidThroughPicker, VendorPicker } from './expense-pickers';
import { NOTES_MAX, type ExpenseRow } from './expense-form';

export type MileageUnit = 'km' | 'mile';

/** GET /direct-expenses/mileage-settings. */
export interface MileageSettings {
  defaultAccountId: string | null;
  unit: MileageUnit;
  rates: Array<{ startDate: string; ratePaise: number }>;
  configured: boolean;
}

export const MILEAGE_SETTINGS_HREF = '/purchases/expenses/mileage-settings';

export function useMileageSettings() {
  return useQuery({ queryKey: ['direct-expenses', 'mileage-settings'], queryFn: () => api.get<MileageSettings>('/direct-expenses/mileage-settings'), retry: false });
}

export const unitWord = (unit: MileageUnit, n = 2) => (unit === 'km' ? 'km' : n === 1 ? 'mile' : 'miles');

/** The rate in force on a date, as the server picks it: the latest start on or before it. */
export function rateOn(rates: MileageSettings['rates'], date: string) {
  let best: MileageSettings['rates'][number] | null = null;
  for (const r of rates) if (r.startDate <= date && (!best || r.startDate > best.startDate)) best = r;
  return best;
}

/** "42.5" → 4250 hundredths, by string arithmetic. Null when it is not a distance of up to two decimals. */
export function parseDistance(text: string): number | null {
  const m = text.replace(/[,\s]/g, '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return hundredths > 0 && hundredths <= 10_000_000 ? hundredths : null;
}

export interface MileageFormValue {
  date: string;
  vendorId: string;
  employeeName: string;
  /** As typed, up to two decimals. */
  distance: string;
  /** Rupees per unit, typed to use instead of the preferences' rate; blank uses that. */
  rate: string;
  /** Blank: the preferences' default account. */
  expenseAccountId: string;
  paidThroughAccountId: string;
  customerId: string;
  billable: boolean;
  reference: string;
  notes: string;
  projectId: string;
}

export const emptyMileage = (): MileageFormValue => ({
  date: todayIso(), vendorId: '', employeeName: '', distance: '', rate: '', expenseAccountId: '', paidThroughAccountId: '', customerId: '', billable: false, reference: '', notes: '', projectId: '',
});

export function mileageToForm(e: ExpenseRow): MileageFormValue {
  return {
    date: e.date, vendorId: e.vendorId ?? '', employeeName: e.mileage?.employeeName ?? '', distance: e.mileage ? String(e.mileage.distance) : '',
    // A rate from the preferences is looked up again on save: only a typed one is kept as typed.
    rate: e.mileage?.rateSource === 'typed' ? rupeesText(e.mileage.ratePaise) : '',
    expenseAccountId: e.expenseAccountId, paidThroughAccountId: e.paidThroughAccountId, customerId: e.customerId ?? '', billable: !!e.billable,
    reference: e.reference ?? '', notes: e.notes ?? '', projectId: e.projectId ?? '',
  };
}

/** The rate that applies and the amount it comes to, as the server will work it out. */
export function mileagePreview(v: MileageFormValue, settings: MileageSettings | undefined) {
  const typed = v.rate.trim() ? parseRupees(v.rate) : null;
  const inForce = settings ? rateOn(settings.rates, v.date) : null;
  const ratePaise = typed !== null && typed > 0 ? typed : v.rate.trim() ? null : inForce?.ratePaise ?? null;
  const hundredths = parseDistance(v.distance);
  const amountPaise = ratePaise !== null && hundredths !== null ? Math.round((hundredths * ratePaise) / 100) : null;
  return { inForce, typed: !!v.rate.trim(), ratePaise, hundredths, amountPaise, unit: settings?.unit ?? 'km' };
}

/** The body POST /direct-expenses takes for a mileage expense. */
export function mileageBody(v: MileageFormValue, settings: MileageSettings | undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('Enter the date of the trip.');
  const hundredths = parseDistance(v.distance);
  if (hundredths === null) throw new Error('Enter the distance: more than nothing, up to two decimals.');
  let ratePaise: number | null = null;
  if (v.rate.trim()) {
    ratePaise = parseRupees(v.rate);
    if (ratePaise === null || ratePaise <= 0) throw new Error('Enter the rate in rupees, or clear it to use the rate in your preferences.');
  } else if (!settings || !rateOn(settings.rates, v.date)) {
    throw new Error(`No mileage rate is set for ${shortDate(v.date)}. Type the rate, or add one in mileage preferences.`);
  }
  const expenseAccountId = v.expenseAccountId || settings?.defaultAccountId || '';
  if (!expenseAccountId) throw new Error('Pick the account mileage is booked to.');
  if (!v.paidThroughAccountId) throw new Error('Pick the bank or cash account it was paid from.');
  return {
    kind: 'mileage' as const,
    date: v.date,
    vendorId: v.vendorId || null,
    expenseAccountId,
    paidThroughAccountId: v.paidThroughAccountId,
    mileage: { distance: hundredths / 100, ...(ratePaise !== null ? { ratePaise } : {}), employeeName: v.employeeName.trim() || null },
    customerId: v.customerId || null,
    billable: !!v.customerId && v.billable,
    reference: v.reference.trim() || null,
    projectId: v.projectId || null,
    notes: v.notes.trim() || null,
  };
}

/** A trip: how far, at the rate in force on its date (or one typed), and the amount that comes to. No GST. */
export function MileageFields({ value, onChange, settings, canManage }: {
  value: MileageFormValue;
  onChange: (patch: Partial<MileageFormValue>) => void;
  settings: MileageSettings | undefined;
  /** May change the preferences (else a note says who can). */
  canManage: boolean;
}) {
  const customers = useCustomers();
  const p = mileagePreview(value, settings);
  const customer = (customers.data ?? []).find((c) => c._id === value.customerId);
  const unit = p.unit;
  const prefsLink = (
    <Link href={MILEAGE_SETTINGS_HREF} className="inline-flex items-center gap-1 font-medium text-brand-800 hover:underline">
      <Settings2 size={13} /> Mileage preferences
    </Link>
  );

  return (
    <>
      <Section title="Mileage" description="A trip in a personal or hired vehicle, paid at a rate per km or mile. No GST." actions={<span className="text-caption">{prefsLink}</span>}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Date" required>
            <input type="date" className={inputClass} value={value.date} onChange={(e) => onChange({ date: e.target.value })} />
          </Field>
          <Field label="Employee" hint="Optional: who drove.">
            <input className={inputClass} value={value.employeeName} maxLength={120} onChange={(e) => onChange({ employeeName: e.target.value })} placeholder="Name" />
          </Field>
          <Field label="Vendor" hint="Optional: a cab or transport vendor.">
            <VendorPicker value={value.vendorId} onChange={(vendorId) => onChange({ vendorId })} />
          </Field>
          <Field label={`Distance (${unitWord(unit)})`} required>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={value.distance} onChange={(e) => onChange({ distance: e.target.value })} placeholder="0.0" />
          </Field>
          <Field
            label={`Rate per ${unit} (₹)`}
            hint={
              p.typed
                ? 'Typed for this trip. Clear it to use the rate in your preferences.'
                : p.inForce
                  ? `In force from ${shortDate(p.inForce.startDate)}, in your preferences.`
                  : undefined
            }
          >
            <input
              className={`${inputClass} text-right font-mono`}
              inputMode="decimal"
              value={value.rate}
              onChange={(e) => onChange({ rate: e.target.value })}
              placeholder={p.inForce ? (p.inForce.ratePaise / 100).toFixed(2) : '0.00'}
            />
          </Field>
          <Field label="Expense account" required hint={!value.expenseAccountId && settings?.defaultAccountId ? 'Your default mileage account.' : undefined}>
            <ExpenseAccountPicker value={value.expenseAccountId || settings?.defaultAccountId || ''} onChange={(expenseAccountId) => onChange({ expenseAccountId })} />
          </Field>
          <Field label="Paid through" required hint="A bank or cash account.">
            <PaidThroughPicker value={value.paidThroughAccountId} onChange={(paidThroughAccountId) => onChange({ paidThroughAccountId })} />
          </Field>
          <Field label="Customer name" hint="Optional: the customer the trip was for.">
            <CustomerPicker value={value.customerId} onChange={(customerId) => onChange({ customerId, billable: customerId ? value.billable : false })} />
          </Field>
          {value.customerId ? (
            <div className="flex items-end pb-2">
              <BillableToggle checked={value.billable} onChange={(billable) => onChange({ billable })} customerName={customer?.name} />
            </div>
          ) : null}
          <Field label="Reference">
            <input className={`${inputClass} font-mono`} value={value.reference} onChange={(e) => onChange({ reference: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Project">
            <ProjectSelect className={inputClass} value={value.projectId} customerId={value.customerId || null} onChange={(projectId) => onChange({ projectId })} />
          </Field>
        </div>

        {!p.typed && !p.inForce && settings && (
          <p className="mt-4 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-body text-pending-fg">
            {settings.configured ? `No rate is in force on ${shortDate(value.date)}: the first starts ${shortDate(settings.rates[0].startDate)}.` : 'No mileage rate is set yet.'}{' '}
            Type the rate for this trip{canManage ? <>, or set one in {prefsLink}</> : ', or ask an admin to set one in mileage preferences'}.
          </p>
        )}

        <div className="mt-4 ml-auto w-full max-w-sm border-t border-line-100 pt-3 text-body">
          <div className="flex justify-between py-1 text-ink-600">
            <span>Distance</span>
            <span className="font-mono">{p.hundredths !== null ? `${(p.hundredths / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unitWord(unit, p.hundredths / 100)}` : '—'}</span>
          </div>
          <div className="flex justify-between py-1 text-ink-600">
            <span>Rate</span>
            <span className="font-mono">{p.ratePaise !== null ? `${formatPaise(p.ratePaise)}/${unit}` : '—'}</span>
          </div>
          <div className="flex justify-between border-t border-line-200 pt-2 font-semibold text-ink-900">
            <span>Amount</span>
            <span className="font-mono">{p.amountPaise !== null ? formatPaise(p.amountPaise) : '—'}</span>
          </div>
          <p className="mt-1 text-caption text-ink-500">Distance × rate, to the paisa. No GST on mileage.</p>
        </div>
      </Section>

      <Section title="Notes">
        <textarea className={inputClass} rows={2} value={value.notes} onChange={(e) => onChange({ notes: e.target.value.slice(0, NOTES_MAX) })} maxLength={NOTES_MAX} placeholder="Where to, and why" />
        <p className="mt-1 text-right text-caption text-ink-400">{value.notes.length}/{NOTES_MAX}</p>
      </Section>
    </>
  );
}
