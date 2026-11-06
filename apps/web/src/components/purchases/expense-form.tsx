'use client';

import Link from 'next/link';
import { Plus, X } from 'lucide-react';
import { Field, Section, inputClass } from '@/components/page/page-shell';
import { ProjectSelect } from '@/components/projects/project-select';
import { useCustomers } from '@/components/sales/sales-data';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { useWorkspace } from '@/lib/use-workspace';
import { GST_SLABS, rupeesText, todayIso, useVendors } from './purchase-data';
import { BillableToggle, CustomerPicker, ExpenseAccountPicker, PaidThroughPicker, VendorPicker, useExpenseAccountOptions } from './expense-pickers';

/** Notes are kept short, as Zoho keeps them: what it was for. */
export const NOTES_MAX = 500;

/** One account of an itemized expense, as typed. */
export interface ExpenseLineValue {
  key: number;
  expenseAccountId: string;
  description: string;
  /** Rupees before tax, as typed. */
  amount: string;
  gstRatePct: number;
}

export interface ExpenseFormValue {
  date: string;
  vendorId: string;
  /** One account and one amount, unless itemized. */
  expenseAccountId: string;
  paidThroughAccountId: string;
  /** Rupees, as typed. */
  amount: string;
  gstRatePct: number;
  /** Split across several accounts, each line with its own GST rate. */
  itemized: boolean;
  lines: ExpenseLineValue[];
  /** Null: worked out from where the supplier is registered. */
  interState: boolean | null;
  claimable: boolean;
  vendorGstin: string;
  reference: string;
  notes: string;
  projectId: string;
  customerId: string;
  billable: boolean;
}

let lineSeq = 0;
export const blankLine = (over: Partial<ExpenseLineValue> = {}): ExpenseLineValue => ({ key: ++lineSeq, expenseAccountId: '', description: '', amount: '', gstRatePct: 0, ...over });

export const emptyExpense = (): ExpenseFormValue => ({
  date: todayIso(),
  vendorId: '',
  expenseAccountId: '',
  paidThroughAccountId: '',
  amount: '',
  gstRatePct: 0,
  itemized: false,
  lines: [],
  interState: null,
  claimable: false,
  vendorGstin: '',
  reference: '',
  notes: '',
  projectId: '',
  customerId: '',
  billable: false,
});

/** A stored expense back into the form: itemized when it has more than one line. */
export function expenseToForm(e: ExpenseRow): ExpenseFormValue {
  const lines = e.lines?.length ? e.lines : [{ expenseAccountId: e.expenseAccountId, description: null, amountPaise: e.taxablePaise, gstRatePct: e.gstRatePct }];
  const itemized = lines.length > 1;
  return {
    date: e.date, vendorId: e.vendorId ?? '', paidThroughAccountId: e.paidThroughAccountId,
    expenseAccountId: lines[0].expenseAccountId, amount: itemized ? '' : rupeesText(lines[0].amountPaise), gstRatePct: itemized ? 0 : lines[0].gstRatePct,
    itemized,
    lines: itemized ? lines.map((l) => blankLine({ expenseAccountId: l.expenseAccountId, description: l.description ?? '', amount: rupeesText(l.amountPaise), gstRatePct: l.gstRatePct })) : [],
    interState: e.interState, claimable: e.claimable, vendorGstin: e.vendorGstin ?? '', reference: e.reference ?? '', notes: e.notes ?? '', projectId: e.projectId ?? '',
    customerId: e.customerId ?? '', billable: !!e.billable,
  };
}

/** The lines the server will price: the single account as one, or the itemized lines typed so far. */
function pricedLines(v: ExpenseFormValue) {
  const typed = v.itemized ? v.lines : [{ amount: v.amount, gstRatePct: v.gstRatePct }];
  return typed.map((l) => ({ taxable: Math.max(0, parseRupees(l.amount) ?? 0), rate: l.gstRatePct }));
}

/** The tax a form's values carry, as the server will work it out: line by line, each line's GST halved into CGST and SGST. */
export function expensePreview(v: ExpenseFormValue, interState: boolean) {
  const out = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  for (const l of pricedLines(v)) {
    const tax = Math.round((l.taxable * l.rate) / 100);
    const half = Math.round(tax / 2);
    out.taxable += l.taxable;
    if (interState) out.igst += tax;
    else {
      out.cgst += half;
      out.sgst += tax - half;
    }
    out.total += l.taxable + tax;
  }
  return out;
}

/** Any line carries GST. */
export const hasGst = (v: ExpenseFormValue) => (v.itemized ? v.lines.some((l) => l.gstRatePct > 0) : v.gstRatePct > 0);

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
  if (!v.paidThroughAccountId) throw new Error('Pick the bank or cash account it was paid from.');
  const common = {
    vendorId: v.vendorId || null,
    paidThroughAccountId: v.paidThroughAccountId,
    interState,
    claimable: v.claimable && hasGst(v),
    vendorGstin: v.vendorGstin.trim().toUpperCase() || null,
    reference: v.reference.trim() || null,
    projectId: v.projectId || null,
    customerId: v.customerId || null,
    billable: !!v.customerId && v.billable,
  };
  if (v.itemized) {
    // Lines left blank are dropped; a half-filled one is named.
    const filled = v.lines.filter((l) => l.expenseAccountId || l.amount.trim() || l.description.trim());
    if (filled.length === 0) throw new Error('Add a line: the account and its amount before tax.');
    const lines = filled.map((l, i) => {
      if (!l.expenseAccountId) throw new Error(`Line ${i + 1}: pick the expense account.`);
      const amountPaise = parseRupees(l.amount);
      if (amountPaise === null || amountPaise <= 0) throw new Error(`Line ${i + 1}: enter the amount before tax, in rupees.`);
      return { expenseAccountId: l.expenseAccountId, amountPaise, gstRatePct: l.gstRatePct, description: l.description.trim() || null };
    });
    return { ...common, lines };
  }
  if (!v.expenseAccountId) throw new Error('Pick the expense account.');
  const taxablePaise = parseRupees(v.amount);
  if (taxablePaise === null || taxablePaise <= 0) throw new Error('Enter the amount before tax, in rupees.');
  // An empty list tells a draft being edited that it is one account again.
  return { ...common, expenseAccountId: v.expenseAccountId, taxablePaise, gstRatePct: v.gstRatePct, lines: [] as never[] };
}

/** The split across accounts: a small table of lines, with its own GST rate each. */
function ItemizedLines({ value, onChange }: { value: ExpenseFormValue; onChange: (patch: Partial<ExpenseFormValue>) => void }) {
  const setLine = (key: number, patch: Partial<ExpenseLineValue>) => onChange({ lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const total = value.lines.reduce((s, l) => s + Math.max(0, parseRupees(l.amount) ?? 0), 0);
  return (
    <div className="md:col-span-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-caption font-medium text-ink-700">Expense accounts<span className="text-error-fg"> *</span></span>
        <button
          type="button"
          className="text-caption font-medium text-saffron-700 hover:underline"
          onClick={() => {
            const filled = value.lines.filter((l) => l.expenseAccountId || l.amount.trim());
            if (filled.length > 1 && !window.confirm("Use one account? The lines' amounts are added together on the first line's account, at its GST rate.")) return;
            const first = filled[0] ?? value.lines[0];
            onChange({ itemized: false, lines: [], expenseAccountId: first?.expenseAccountId ?? '', amount: total ? (total / 100).toFixed(2) : '', gstRatePct: first?.gstRatePct ?? 0 });
          }}
        >
          Use one account
        </button>
      </div>
      <div className="overflow-visible rounded-md border border-line-200">
        <table className="w-full">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              <th className="px-2 py-2 text-left text-caption font-medium text-ink-500">Expense account</th>
              <th className="px-2 py-2 text-left text-caption font-medium text-ink-500">Description</th>
              <th className="w-36 px-2 py-2 text-right text-caption font-medium text-ink-500">Amount (₹)</th>
              <th className="w-28 px-2 py-2 text-left text-caption font-medium text-ink-500">GST</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.lines.map((l, i) => (
              <tr key={l.key} className="border-b border-line-100 last:border-0 align-top">
                <td className="min-w-[200px] px-2 py-2">
                  <ExpenseAccountPicker value={l.expenseAccountId} onChange={(expenseAccountId) => setLine(l.key, { expenseAccountId })} aria-label={`Line ${i + 1} expense account`} />
                </td>
                <td className="px-2 py-2">
                  <input className={inputClass} value={l.description} maxLength={300} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Optional" aria-label={`Line ${i + 1} description`} />
                </td>
                <td className="px-2 py-2">
                  <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={l.amount} onChange={(e) => setLine(l.key, { amount: e.target.value })} placeholder="0.00" aria-label={`Line ${i + 1} amount before tax`} />
                </td>
                <td className="px-2 py-2">
                  <select className={inputClass} value={l.gstRatePct} onChange={(e) => setLine(l.key, { gstRatePct: Number(e.target.value) })} aria-label={`Line ${i + 1} GST rate`}>
                    {GST_SLABS.map((r) => <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    disabled={value.lines.length <= 1}
                    onClick={() => onChange({ lines: value.lines.filter((x) => x.key !== l.key) })}
                    className="rounded p-2 text-ink-400 hover:bg-surface-sink hover:text-error-fg disabled:opacity-30"
                    aria-label={`Remove line ${i + 1}`}
                    title="Remove line"
                  >
                    <X size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line-200 bg-surface-sink">
            <tr>
              <td colSpan={2} className="px-2 py-2">
                <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-saffron-700 hover:underline" onClick={() => onChange({ lines: [...value.lines, blankLine()] })}>
                  <Plus size={13} /> Add another line
                </button>
              </td>
              <td className="px-2 py-2 text-right font-mono text-body text-ink-900">{formatPaise(total)}</td>
              <td colSpan={2} className="px-2 py-2 text-caption text-ink-500">before tax</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * What was paid, for what, and from where. The GST is claimed to input
 * credit, or added to the cost when it cannot be (no GSTIN, or blocked).
 * "Itemize" splits the expense across accounts; a customer makes it
 * billable on to them.
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
  const customers = useCustomers();
  const accounts = useExpenseAccountOptions();
  const interState = useInterState(value);
  const p = expensePreview(value, interState);
  const vendor = (vendors.data ?? []).find((x) => x._id === value.vendorId);
  const customer = (customers.data ?? []).find((c) => c._id === value.customerId);
  const gst = hasGst(value);

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
          {value.itemized ? (
            <ItemizedLines value={value} onChange={onChange} />
          ) : (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-caption font-medium text-ink-700">Expense account<span className="text-error-fg"> *</span></span>
                  <button
                    type="button"
                    className="text-caption font-medium text-saffron-700 hover:underline"
                    onClick={() => onChange({ itemized: true, lines: [blankLine({ expenseAccountId: value.expenseAccountId, amount: value.amount, gstRatePct: value.gstRatePct }), blankLine()] })}
                  >
                    Itemize
                  </button>
                </div>
                <ExpenseAccountPicker value={value.expenseAccountId} onChange={(expenseAccountId) => onChange({ expenseAccountId })} />
                {accounts.empty && <p className="mt-1 text-caption text-ink-500"><Link href="/accountant/chart-of-accounts" className="underline">Add an expense account</Link></p>}
              </div>
              <Field label="Amount before tax (₹)" required>
                <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={value.amount} onChange={(e) => onChange({ amount: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="GST rate">
                <select className={inputClass} value={value.gstRatePct} onChange={(e) => onChange({ gstRatePct: Number(e.target.value) })}>
                  {GST_SLABS.map((r) => <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>)}
                </select>
              </Field>
            </>
          )}
          <Field label="Paid through" required hint="A bank or cash account.">
            <PaidThroughPicker value={value.paidThroughAccountId} onChange={(paidThroughAccountId) => onChange({ paidThroughAccountId })} />
          </Field>
          <Field label="Vendor" hint="Optional: who was paid, when they are in your vendors.">
            <VendorPicker id="expense-vendor" value={value.vendorId} onChange={(vendorId) => onChange({ vendorId, interState: null })} />
          </Field>
          <Field label="Invoice# / reference" hint="Their invoice number, a UTR or card slip.">
            <input className={`${inputClass} font-mono`} value={value.reference} onChange={(e) => onChange({ reference: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Customer name" hint="Optional: the customer it was spent for.">
            <CustomerPicker value={value.customerId} onChange={(customerId) => onChange({ customerId, billable: customerId ? value.billable : false })} />
          </Field>
          {value.customerId ? (
            <div className="flex items-end pb-2">
              <BillableToggle checked={value.billable} onChange={(billable) => onChange({ billable })} customerName={customer?.name} />
            </div>
          ) : null}
          <Field label="Project">
            <ProjectSelect className={inputClass} value={value.projectId} customerId={value.customerId || null} onChange={(projectId) => onChange({ projectId })} />
          </Field>
        </div>

        {gst && (
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
            {!value.claimable && <p className="text-caption text-ink-500 md:col-span-1">Not claimed: the GST is added to {value.itemized ? 'each line’s account' : 'the expense'}.</p>}
          </div>
        )}

        <div className="mt-4 ml-auto w-full max-w-xs border-t border-line-100 pt-3 text-body">
          <div className="flex justify-between py-1 text-ink-600"><span>Before tax</span><span className="font-mono">{formatPaise(p.taxable)}</span></div>
          {p.cgst > 0 && <div className="flex justify-between py-1 text-ink-600"><span>CGST</span><span className="font-mono">{formatPaise(p.cgst)}</span></div>}
          {p.sgst > 0 && <div className="flex justify-between py-1 text-ink-600"><span>SGST</span><span className="font-mono">{formatPaise(p.sgst)}</span></div>}
          {p.igst > 0 && <div className="flex justify-between py-1 text-ink-600"><span>IGST</span><span className="font-mono">{formatPaise(p.igst)}</span></div>}
          <div className="flex justify-between border-t border-line-200 pt-2 font-semibold text-ink-900"><span>Paid</span><span className="font-mono">{formatPaise(p.total)}</span></div>
          {gst && <p className="mt-1 text-caption text-ink-500">{value.claimable ? 'The GST goes to input credit.' : 'The GST is part of the expense.'}</p>}
        </div>
      </Section>

      <Section title="Notes">
        <textarea className={inputClass} rows={2} value={value.notes} onChange={(e) => onChange({ notes: e.target.value.slice(0, NOTES_MAX) })} maxLength={NOTES_MAX} placeholder="What it was for" />
        <p className="mt-1 text-right text-caption text-ink-400">{value.notes.length}/{NOTES_MAX}</p>
      </Section>
    </>
  );
}

/** One line of an expense, as GET /direct-expenses returns it. */
export interface ExpenseRowLine {
  expenseAccountId: string;
  expenseAccountName: string;
  description: string | null;
  amountPaise: number;
  gstRatePct: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/** GET /direct-expenses and /direct-expenses/:id. */
export interface ExpenseRow {
  _id: string;
  number: string;
  kind: 'expense' | 'mileage';
  date: string;
  vendorId: string | null;
  vendorName: string | null;
  /** The first line's account. */
  expenseAccountId: string;
  expenseAccountName: string;
  itemized: boolean;
  lines: ExpenseRowLine[];
  mileage: { distance: number; unit: 'km' | 'mile'; ratePaise: number; rateSource: 'preferences' | 'typed'; employeeName: string | null } | null;
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
  customerId: string | null;
  customerName: string | null;
  billable: boolean;
  invoiceId: string | null;
  status: 'draft' | 'posted';
  journalId: string | null;
  recurringTemplateId: string | null;
  createdBy: string;
}
