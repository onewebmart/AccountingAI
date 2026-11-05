'use client';

import Link from 'next/link';
import { Field, Section, inputClass } from '@/components/page/page-shell';
import { ProjectSelect } from '@/components/projects/project-select';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { useWorkspace } from '@/lib/use-workspace';
import { GST_SLABS, rupeesText, todayIso, useExpenseAccounts, usePaidThroughAccounts, useVendors } from './purchase-data';

export interface ExpenseFormValue {
  date: string;
  vendorId: string;
  expenseAccountId: string;
  paidThroughAccountId: string;
  /** Rupees, as typed. */
  amount: string;
  gstRatePct: number;
  /** Null: worked out from where the supplier is registered. */
  interState: boolean | null;
  claimable: boolean;
  vendorGstin: string;
  reference: string;
  notes: string;
  projectId: string;
}

export const emptyExpense = (): ExpenseFormValue => ({
  date: todayIso(),
  vendorId: '',
  expenseAccountId: '',
  paidThroughAccountId: '',
  amount: '',
  gstRatePct: 0,
  interState: null,
  claimable: false,
  vendorGstin: '',
  reference: '',
  notes: '',
  projectId: '',
});

/** A stored expense back into the form. */
export function expenseToForm(e: {
  date: string; vendorId: string | null; expenseAccountId: string; paidThroughAccountId: string; taxablePaise: number; gstRatePct: number;
  interState: boolean; claimable: boolean; vendorGstin: string | null; reference: string | null; notes: string | null; projectId: string | null;
}): ExpenseFormValue {
  return {
    date: e.date, vendorId: e.vendorId ?? '', expenseAccountId: e.expenseAccountId, paidThroughAccountId: e.paidThroughAccountId, amount: rupeesText(e.taxablePaise),
    gstRatePct: e.gstRatePct, interState: e.interState, claimable: e.claimable, vendorGstin: e.vendorGstin ?? '', reference: e.reference ?? '', notes: e.notes ?? '', projectId: e.projectId ?? '',
  };
}

/** The tax a form's values carry, as the server will work it out. */
export function expensePreview(v: ExpenseFormValue, interState: boolean) {
  const taxable = Math.max(0, parseRupees(v.amount) ?? 0);
  const tax = Math.round((taxable * v.gstRatePct) / 100);
  const half = Math.round(tax / 2);
  return interState
    ? { taxable, cgst: 0, sgst: 0, igst: tax, total: taxable + tax }
    : { taxable, cgst: half, sgst: tax - half, igst: 0, total: taxable + tax };
}

/** Whether the supplier is in another state: as chosen, else from their GSTIN against ours. */
export function useInterState(v: ExpenseFormValue): boolean {
  const workspace = useWorkspace();
  const vendors = useVendors();
  if (v.interState !== null) return v.interState;
  const gstin = v.vendorGstin.trim() || (vendors.data ?? []).find((x) => x._id === v.vendorId)?.gstin || '';
  const ours = workspace.data?.org.gstin?.slice(0, 2) ?? null;
  const theirs = gstin.slice(0, 2) || null;
  return !!ours && !!theirs && /^\d{2}$/.test(theirs) && ours !== theirs;
}

/** The body POST /direct-expenses (and the recurring form) takes: rupees to paise once, here. */
export function expenseBody(v: ExpenseFormValue, interState: boolean) {
  if (!v.expenseAccountId) throw new Error('Pick the expense account.');
  if (!v.paidThroughAccountId) throw new Error('Pick the bank or cash account it was paid from.');
  const taxablePaise = parseRupees(v.amount);
  if (taxablePaise === null || taxablePaise <= 0) throw new Error('Enter the amount before tax, in rupees.');
  const claimable = v.claimable && v.gstRatePct > 0;
  return {
    vendorId: v.vendorId || null,
    expenseAccountId: v.expenseAccountId,
    paidThroughAccountId: v.paidThroughAccountId,
    taxablePaise,
    gstRatePct: v.gstRatePct,
    interState,
    claimable,
    vendorGstin: v.vendorGstin.trim().toUpperCase() || null,
    reference: v.reference.trim() || null,
    projectId: v.projectId || null,
  };
}

/**
 * What was paid, for what, and from where. The GST is claimed to input
 * credit, or added to the cost when it cannot be (no GSTIN, or blocked).
 */
export function ExpenseFields({ value, onChange, withDate = true, title = 'Expense', notice }: {
  value: ExpenseFormValue;
  onChange: (patch: Partial<ExpenseFormValue>) => void;
  withDate?: boolean;
  title?: string;
  /** Above the fields: a scan's vendor not yet in the books. */
  notice?: React.ReactNode;
}) {
  const vendors = useVendors();
  const expenseAccounts = useExpenseAccounts();
  const paidThrough = usePaidThroughAccounts();
  const interState = useInterState(value);
  const p = expensePreview(value, interState);
  const vendor = (vendors.data ?? []).find((x) => x._id === value.vendorId);

  return (
    <>
      <Section title={title}>
        {notice}
        <div className="grid gap-4 md:grid-cols-3">
          {withDate && (
            <Field label="Date" required>
              <input type="date" className={inputClass} value={value.date} onChange={(e) => onChange({ date: e.target.value })} />
            </Field>
          )}
          <Field label="Expense account" required hint={expenseAccounts.data.length === 0 && !expenseAccounts.isLoading ? <Link href="/accountant/chart-of-accounts" className="underline">Add an expense account</Link> : undefined}>
            <select className={inputClass} value={value.expenseAccountId} onChange={(e) => onChange({ expenseAccountId: e.target.value })}>
              <option value="">{expenseAccounts.isLoading ? 'Loading…' : 'Choose…'}</option>
              {expenseAccounts.data.map((a) => <option key={a._id} value={a._id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Paid through" required hint="A bank or cash account.">
            <select className={inputClass} value={value.paidThroughAccountId} onChange={(e) => onChange({ paidThroughAccountId: e.target.value })}>
              <option value="">{paidThrough.isLoading ? 'Loading…' : 'Choose…'}</option>
              {(paidThrough.data ?? []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Vendor" hint="Optional: who was paid, when they are in your vendors.">
            <select id="expense-vendor" className={inputClass} value={value.vendorId} onChange={(e) => onChange({ vendorId: e.target.value, interState: null })}>
              <option value="">No vendor</option>
              {(vendors.data ?? []).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Amount before tax (₹)" required>
            <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={value.amount} onChange={(e) => onChange({ amount: e.target.value })} placeholder="0.00" />
          </Field>
          <Field label="GST rate">
            <select className={inputClass} value={value.gstRatePct} onChange={(e) => onChange({ gstRatePct: Number(e.target.value) })}>
              {GST_SLABS.map((r) => <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>)}
            </select>
          </Field>
          <Field label="Reference" hint="UTR, card slip, receipt number.">
            <input className={inputClass} value={value.reference} onChange={(e) => onChange({ reference: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Project">
            <ProjectSelect className={inputClass} value={value.projectId} onChange={(projectId) => onChange({ projectId })} />
          </Field>
        </div>

        {value.gstRatePct > 0 && (
          <div className="mt-4 grid gap-4 rounded-md border border-line-200 bg-surface-sink p-4 md:grid-cols-3">
            <label className="flex items-center gap-2 text-body text-ink-900">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={interState} onChange={(e) => onChange({ interState: e.target.checked })} />
              Inter-state (IGST)
            </label>
            <label className="flex items-center gap-2 text-body text-ink-900">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={value.claimable} onChange={(e) => onChange({ claimable: e.target.checked })} />
              Claim the GST as input credit
            </label>
            {value.claimable && (
              <Field label="Supplier's GSTIN" required={!vendor?.gstin} hint={vendor?.gstin ? `Blank uses ${vendor.name}'s, ${vendor.gstin}.` : 'As printed on their invoice.'}>
                <input className={`${inputClass} font-mono uppercase`} value={value.vendorGstin} onChange={(e) => onChange({ vendorGstin: e.target.value, interState: null })} maxLength={15} placeholder={vendor?.gstin ?? '27AABCS1429B1ZA'} />
              </Field>
            )}
            {!value.claimable && <p className="text-caption text-ink-500 md:col-span-1">Not claimed: the GST is added to the expense.</p>}
          </div>
        )}

        <div className="mt-4 ml-auto w-full max-w-xs border-t border-line-100 pt-3 text-body">
          <div className="flex justify-between py-1 text-ink-600"><span>Before tax</span><span className="font-mono">{formatPaise(p.taxable)}</span></div>
          {p.cgst > 0 && <div className="flex justify-between py-1 text-ink-600"><span>CGST</span><span className="font-mono">{formatPaise(p.cgst)}</span></div>}
          {p.sgst > 0 && <div className="flex justify-between py-1 text-ink-600"><span>SGST</span><span className="font-mono">{formatPaise(p.sgst)}</span></div>}
          {p.igst > 0 && <div className="flex justify-between py-1 text-ink-600"><span>IGST</span><span className="font-mono">{formatPaise(p.igst)}</span></div>}
          <div className="flex justify-between border-t border-line-200 pt-2 font-semibold text-ink-900"><span>Paid</span><span className="font-mono">{formatPaise(p.total)}</span></div>
          {value.gstRatePct > 0 && <p className="mt-1 text-caption text-ink-500">{value.claimable ? 'The GST goes to input credit.' : 'The GST is part of the expense.'}</p>}
        </div>
      </Section>

      <Section title="Notes">
        <textarea className={inputClass} rows={2} value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} maxLength={1000} placeholder="What it was for" />
      </Section>
    </>
  );
}

/** GET /direct-expenses and /direct-expenses/:id. */
export interface ExpenseRow {
  _id: string;
  number: string;
  date: string;
  vendorId: string | null;
  vendorName: string | null;
  expenseAccountId: string;
  expenseAccountName: string;
  paidThroughAccountId: string;
  paidThroughAccountName: string;
  taxablePaise: number;
  gstRatePct: number;
  interState: boolean;
  claimable: boolean;
  vendorGstin: string | null;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  reference: string | null;
  notes: string | null;
  projectId: string | null;
  status: 'draft' | 'posted';
  journalId: string | null;
  recurringTemplateId: string | null;
  createdBy: string;
}
