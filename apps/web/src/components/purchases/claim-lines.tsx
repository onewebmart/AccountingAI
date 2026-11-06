'use client';

import { useRef } from 'react';
import { Paperclip, Plus, X } from 'lucide-react';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { errorText, rupeesText, todayIso, type LedgerAccountRow } from './purchase-data';

export interface ClaimLine {
  date: string;
  kind: 'expense' | 'mileage';
  merchant: string | null;
  description: string;
  expenseAccountId: string;
  amountPaise: number;
  gstPaise: number;
  merchantGstin: string | null;
  km: number | null;
  receiptId: string | null;
}

/** GET /expense-claims — an employee sees their own; whoever posts sees all. */
export interface Claim {
  _id: string;
  number: string;
  employeeName: string;
  employeeId: string;
  title: string;
  status: 'draft' | 'submitted' | 'approved' | 'posted' | 'paid';
  lines: ClaimLine[];
  totalPaise: number;
  flags: Array<{ line: number; message: string }>;
  sentBackReason: string | null;
  paidOn: string | null;
  journalId: string | null;
  paymentJournalId: string | null;
  createdAt?: string;
}

export interface ClaimEditLine {
  date: string;
  kind: 'expense' | 'mileage';
  merchant: string;
  description: string;
  expenseAccountId: string;
  amount: string;
  gst: string;
  gstin: string;
  km: string;
  receiptId: string | null;
}

export const blankClaimLine = (): ClaimEditLine => ({ date: todayIso(), kind: 'expense', merchant: '', description: '', expenseAccountId: '', amount: '', gst: '', gstin: '', km: '', receiptId: null });

export const claimToEdit = (c: Claim): ClaimEditLine[] =>
  c.lines.map((l) => ({
    date: l.date, kind: l.kind, merchant: l.merchant ?? '', description: l.description, expenseAccountId: String(l.expenseAccountId), amount: rupeesText(l.amountPaise),
    gst: l.gstPaise ? rupeesText(l.gstPaise) : '', gstin: l.merchantGstin ?? '', km: l.km ? String(l.km) : '', receiptId: l.receiptId ? String(l.receiptId) : null,
  }));

/** Lines as the API takes them: rupees to paise once, here. Blank rows are left out. */
export function claimLinesToApi(lines: ClaimEditLine[]) {
  return lines
    .filter((l) => l.description.trim())
    .map((l, i) => {
      if (!l.expenseAccountId) throw new Error(`Line ${i + 1}: pick the expense account.`);
      if (l.kind === 'mileage') {
        const km = Number(l.km);
        if (!(km > 0)) throw new Error(`Line ${i + 1}: enter the kilometres.`);
        return { date: l.date, kind: 'mileage' as const, description: l.description.trim(), expenseAccountId: l.expenseAccountId, km, receiptId: l.receiptId };
      }
      const amountPaise = parseRupees(l.amount);
      const gstPaise = l.gst.trim() ? parseRupees(l.gst) : 0;
      if (amountPaise === null || gstPaise === null || amountPaise <= 0) throw new Error(`Line ${i + 1}: enter amounts in rupees, like 1,250.50.`);
      return { date: l.date, kind: 'expense' as const, merchant: l.merchant.trim() || null, description: l.description.trim(), expenseAccountId: l.expenseAccountId, amountPaise, gstPaise, merchantGstin: l.gstin.trim() || null, receiptId: l.receiptId };
    });
}

const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40';

/**
 * The lines of a claim: a date, what it was for, the account, and what was
 * paid with its GST, or the kilometres driven. On a saved claim each line
 * can carry its receipt.
 */
export function ClaimLinesEditor({ lines, onChange, accounts, claimId }: { lines: ClaimEditLine[]; onChange: (l: ClaimEditLine[]) => void; accounts: LedgerAccountRow[]; claimId: string | null }) {
  const set = (i: number, patch: Partial<ClaimEditLine>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const fileFor = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    const i = fileFor.current;
    if (i === null || !claimId) return;
    const body = new FormData();
    body.append('entityType', 'ExpenseClaim');
    body.append('entityId', claimId);
    body.append('file', file);
    try {
      const saved = await api.post<{ _id: string }>('/attachments', body);
      set(i, { receiptId: saved._id });
      notify('Receipt attached. Save the claim to keep it.', 'info');
    } catch (e) {
      notify(errorText(e, "Couldn't attach the receipt."), 'error');
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 px-0.5 text-caption font-medium text-ink-500">
        <span className="col-span-2">Date</span>
        <span className="col-span-1">Kind</span>
        <span className="col-span-3">What for</span>
        <span className="col-span-2">Account</span>
        <span className="col-span-2">Paid (₹) · GST (₹), or km</span>
        <span className="col-span-2">Merchant</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-2">
          <input type="date" className={`${cell} col-span-2`} value={l.date} onChange={(e) => set(i, { date: e.target.value })} aria-label={`Line ${i + 1} date`} />
          <select className={`${cell} col-span-1`} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as ClaimEditLine['kind'] })} aria-label={`Line ${i + 1} kind`}>
            <option value="expense">Spent</option>
            <option value="mileage">Km</option>
          </select>
          <input className={`${cell} col-span-3`} placeholder={l.kind === 'mileage' ? 'Trip' : 'What for'} value={l.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
          <select className={`${cell} col-span-2`} value={l.expenseAccountId} onChange={(e) => set(i, { expenseAccountId: e.target.value })} aria-label={`Line ${i + 1} account`}>
            <option value="">Account…</option>
            {accounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
          {l.kind === 'mileage' ? (
            <input className={`${cell} col-span-2 text-right font-mono`} inputMode="decimal" placeholder="km" value={l.km} onChange={(e) => set(i, { km: e.target.value })} aria-label={`Line ${i + 1} kilometres`} />
          ) : (
            <span className="col-span-2 grid grid-cols-2 gap-1">
              <input className={`${cell} text-right font-mono`} inputMode="decimal" placeholder="Paid" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-label={`Line ${i + 1} amount paid`} />
              <input className={`${cell} text-right font-mono`} inputMode="decimal" placeholder="GST" value={l.gst} onChange={(e) => set(i, { gst: e.target.value })} aria-label={`Line ${i + 1} GST`} />
            </span>
          )}
          <span className="col-span-2 flex items-center gap-2">
            {l.kind === 'expense' ? (
              <input className={cell} placeholder="Merchant" value={l.merchant} onChange={(e) => set(i, { merchant: e.target.value })} aria-label={`Line ${i + 1} merchant`} />
            ) : (
              <span className="flex-1" />
            )}
            {claimId && l.kind === 'expense' && (
              <button type="button" title={l.receiptId ? 'Receipt attached' : 'Attach receipt'} className={l.receiptId ? 'text-success-fg' : 'text-ink-400 hover:text-ink-700'} onClick={() => { fileFor.current = i; input.current?.click(); }}>
                <Paperclip size={14} />
              </button>
            )}
            <button type="button" aria-label={`Remove line ${i + 1}`} className="text-ink-400 hover:text-error-fg" onClick={() => onChange(lines.filter((_, n) => n !== i))}>
              <X size={14} />
            </button>
          </span>
          {l.kind === 'expense' && (parseRupees(l.gst || '0') ?? 0) > 0 && (
            <input className={`${cell} col-span-4 col-start-4 font-mono uppercase`} placeholder="Merchant's GSTIN (to claim the GST)" value={l.gstin} onChange={(e) => set(i, { gstin: e.target.value.toUpperCase() })} aria-label={`Line ${i + 1} merchant GSTIN`} />
          )}
        </div>
      ))}
      <input ref={input} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline" onClick={() => onChange([...lines, blankClaimLine()])}>
        <Plus size={12} /> Add a line
      </button>
      {!claimId && <p className="text-caption text-ink-500">Save the claim, then attach a receipt to each line on its page.</p>}
    </div>
  );
}

export const CLAIM_STATUS: Record<Claim['status'], { label: string; tone: 'pending' | 'success' | 'neutral' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting for approval', tone: 'pending' },
  approved: { label: 'Approved, to post', tone: 'pending' },
  posted: { label: 'Posted, to reimburse', tone: 'success' },
  paid: { label: 'Reimbursed', tone: 'success' },
};
