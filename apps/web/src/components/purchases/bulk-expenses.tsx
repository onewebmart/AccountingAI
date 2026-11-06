'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { TableCard, inputClass } from '@/components/page/page-shell';
import { useProjects } from '@/components/projects/project-select';
import { useCustomers } from '@/components/sales/sales-data';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { todayIso, useExpenseAccounts, usePaidThroughAccounts, useVendors } from './purchase-data';

/** One row of the bulk grid, as typed. */
export interface BulkRow {
  key: number;
  date: string;
  expenseAccountId: string;
  /** Rupees, as typed. No GST in the grid: the amount is what was paid. */
  amount: string;
  paidThroughAccountId: string;
  vendorId: string;
  customerId: string;
  projectId: string;
  billable: boolean;
}

let rowSeq = 0;
export const blankRow = (over: Partial<BulkRow> = {}): BulkRow => ({
  key: ++rowSeq, date: todayIso(), expenseAccountId: '', amount: '', paidThroughAccountId: '', vendorId: '', customerId: '', projectId: '', billable: false, ...over,
});

/** Zoho's grid starts with ten. */
export const firstRows = () => Array.from({ length: 10 }, () => blankRow());

/** A row anyone has typed in: the date alone does not count. */
export const isFilled = (r: BulkRow) => !!(r.expenseAccountId || r.amount.trim() || r.paidThroughAccountId || r.vendorId || r.customerId || r.projectId);

/** What is missing from a filled row, before the server is asked. */
export function rowProblem(r: BulkRow): string | null {
  const missing: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) missing.push('the date');
  if (!r.expenseAccountId) missing.push('the expense account');
  const amount = parseRupees(r.amount);
  if (amount === null || amount <= 0) missing.push('the amount');
  if (!r.paidThroughAccountId) missing.push('paid through');
  if (missing.length) return `Enter ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
  return null;
}

/** The body row POST /direct-expenses/bulk takes: rupees to paise here, once. */
export function rowBody(r: BulkRow) {
  return {
    date: r.date,
    expenseAccountId: r.expenseAccountId,
    taxablePaise: parseRupees(r.amount) ?? 0,
    paidThroughAccountId: r.paidThroughAccountId,
    ...(r.vendorId ? { vendorId: r.vendorId } : {}),
    ...(r.customerId ? { customerId: r.customerId, billable: r.billable } : {}),
    ...(r.projectId ? { projectId: r.projectId } : {}),
  };
}

/** A row's menu, drawn over the page so the grid's scroll box cannot clip it. */
function RowMenu({ index, onDuplicate, onRemove, canRemove }: { index: number; onDuplicate: () => void; onRemove: () => void; canRemove: boolean }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (menu.current?.contains(e.target as Node) || button.current?.contains(e.target as Node))) return;
      setAt(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [at]);
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-honey-100 disabled:opacity-40';
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={`Row ${index + 1} actions`}
        onClick={() => {
          if (at) return setAt(null);
          const r = button.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
        className="rounded p-2 text-ink-500 hover:bg-surface-sink hover:text-ink-900"
      >
        <MoreHorizontal size={16} />
      </button>
      {at &&
        createPortal(
          <div ref={menu} role="menu" style={{ position: 'fixed', top: at.top, right: at.right }} className="z-50 w-44 overflow-hidden rounded-md border border-line-200 bg-surface-card py-1 shadow-e2">
            <button type="button" role="menuitem" className={cn(item, 'text-ink-900')} onClick={() => { setAt(null); onDuplicate(); }}>
              <Copy size={14} /> Duplicate row
            </button>
            <button type="button" role="menuitem" disabled={!canRemove} className={cn(item, 'text-error-fg')} onClick={() => { setAt(null); onRemove(); }}>
              <Trash2 size={14} /> Remove row
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

const cell = 'px-1.5 py-1.5 align-top';
const head = 'px-1.5 py-2 text-left text-caption font-medium text-ink-500 whitespace-nowrap';

/**
 * Many expenses at once, a row each: date, account, amount, paid through,
 * vendor, customer, project and billable. Blank rows are left out; errors
 * show on their rows.
 */
export function BulkGrid({ rows, onChange, errors }: { rows: BulkRow[]; onChange: (rows: BulkRow[]) => void; errors: Map<number, string> }) {
  const accounts = useExpenseAccounts();
  const paidThrough = usePaidThroughAccounts();
  const vendors = useVendors();
  const customers = useCustomers();
  const projects = useProjects();
  const set = (key: number, patch: Partial<BulkRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter(isFilled);
  const total = filled.reduce((s, r) => s + Math.max(0, parseRupees(r.amount) ?? 0), 0);
  const openProjects = (projects.data ?? []).filter((p) => p.status !== 'completed');

  return (
    <div>
      <TableCard>
        <table className="w-full min-w-[1080px]">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              <th className={`${head} w-8 text-right`}>#</th>
              <th className={`${head} w-[140px]`}>Date<span className="text-error-fg"> *</span></th>
              <th className={head}>Expense account<span className="text-error-fg"> *</span></th>
              <th className={`${head} w-[120px] text-right`}>Amount (₹)<span className="text-error-fg"> *</span></th>
              <th className={head}>Paid through<span className="text-error-fg"> *</span></th>
              <th className={head}>Vendor</th>
              <th className={head}>Customer name</th>
              <th className={head}>Project</th>
              <th className={`${head} w-16 text-center`}>Billable</th>
              <th className={`${head} w-10`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const error = errors.get(r.key);
              return [
                <tr key={r.key} className={cn('border-b border-line-100', error && 'border-b-0 bg-error-bg/40')}>
                  <td className={cn(cell, 'pt-3.5 text-right font-mono text-caption text-ink-400', error && 'border-l-2 border-error-fg')}>{i + 1}</td>
                  <td className={cell}>
                    <input type="date" className={inputClass} value={r.date} onChange={(e) => set(r.key, { date: e.target.value })} aria-label={`Row ${i + 1} date`} />
                  </td>
                  <td className={cell}>
                    <select className={inputClass} value={r.expenseAccountId} onChange={(e) => set(r.key, { expenseAccountId: e.target.value })} aria-label={`Row ${i + 1} expense account`}>
                      <option value="">{accounts.isLoading ? 'Loading…' : 'Select'}</option>
                      {accounts.data.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} placeholder="0.00" aria-label={`Row ${i + 1} amount`} />
                  </td>
                  <td className={cell}>
                    <select className={inputClass} value={r.paidThroughAccountId} onChange={(e) => set(r.key, { paidThroughAccountId: e.target.value })} aria-label={`Row ${i + 1} paid through`}>
                      <option value="">{paidThrough.isLoading ? 'Loading…' : 'Select'}</option>
                      {(paidThrough.data ?? []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <select className={inputClass} value={r.vendorId} onChange={(e) => set(r.key, { vendorId: e.target.value })} aria-label={`Row ${i + 1} vendor`}>
                      <option value="">—</option>
                      {(vendors.data ?? []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <select className={inputClass} value={r.customerId} onChange={(e) => set(r.key, { customerId: e.target.value, billable: e.target.value ? r.billable : false })} aria-label={`Row ${i + 1} customer`}>
                      <option value="">—</option>
                      {(customers.data ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <select className={inputClass} value={r.projectId} onChange={(e) => set(r.key, { projectId: e.target.value })} aria-label={`Row ${i + 1} project`} disabled={openProjects.length === 0}>
                      <option value="">—</option>
                      {openProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className={cn(cell, 'pt-3.5 text-center')}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600 disabled:opacity-30"
                      checked={r.billable}
                      disabled={!r.customerId}
                      title={r.customerId ? 'Bill it on to the customer' : 'Choose a customer first'}
                      onChange={(e) => set(r.key, { billable: e.target.checked })}
                      aria-label={`Row ${i + 1} billable`}
                    />
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <RowMenu
                      index={i}
                      canRemove={rows.length > 1}
                      onDuplicate={() => onChange([...rows.slice(0, i + 1), blankRow({ ...r, key: ++rowSeq }), ...rows.slice(i + 1)])}
                      onRemove={() => onChange(rows.filter((x) => x.key !== r.key))}
                    />
                  </td>
                </tr>,
                error ? (
                  <tr key={`${r.key}-error`} className="border-b border-line-100 bg-error-bg/40">
                    <td className="border-l-2 border-error-fg" />
                    <td colSpan={9} className="px-1.5 pb-2 text-caption text-error-fg" role="alert">{error}</td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
          <tfoot className="border-t border-line-200 bg-surface-sink">
            <tr>
              <td colSpan={3} className="px-3 py-2.5 text-caption text-ink-500">{filled.length === 1 ? '1 expense' : `${filled.length} expenses`} filled in; blank rows are left out.</td>
              <td className="px-1.5 py-2.5 text-right font-mono text-body font-semibold text-ink-900">{formatPaise(total)}</td>
              <td colSpan={6} />
            </tr>
          </tfoot>
        </table>
      </TableCard>
      <button type="button" className="mt-3 inline-flex items-center gap-1 text-body font-medium text-brand-800 hover:underline" onClick={() => onChange([...rows, ...Array.from({ length: 5 }, () => blankRow())])}>
        <Plus size={15} /> Add more expenses
      </button>
    </div>
  );
}
