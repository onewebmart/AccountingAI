'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { parseRupees } from '@/lib/money';

interface BudgetRow { accountId: string; name: string; code: string; type: 'INCOME' | 'EXPENSE'; monthsPaise: number[] }
interface Budgets { financialYear: string; months: string[]; rows: BudgetRow[] }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const field = 'rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const label = 'mb-1 block text-caption font-medium text-ink-700';
const nowMonth = () => new Date().toISOString().slice(0, 7);
const fyOf = (m: string) => {
  const y = Number(m.slice(0, 4));
  const start = Number(m.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const fyName = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
const thisFyStart = () => Number(fyOf(nowMonth()).slice(0, 4));
const recentYears = () => [0, 1, 2].map((n) => fyName(thisFyStart() - n));
/** Next year too, for budgeting ahead. */
const nextYear = () => fyName(thisFyStart() + 1);
const MONTH_NAMES = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/**
 * The budgets grid: a month-by-month plan for each income and expense
 * account, filled from last year if wanted. A plan, not an entry: budgets
 * never touch the books. Used on Budgets and on the management reports.
 */
export function BudgetsEditor({ onToast = (m) => notify(m) }: { onToast?: (m: string) => void }) {
  const qc = useQueryClient();
  const [fy, setFy] = useState(fyOf(nowMonth()));
  const [grid, setGrid] = useState<Record<string, string[]>>({});
  const [change, setChange] = useState('0');
  const q = useQuery({ queryKey: ['reports', 'budgets', fy], queryFn: () => api.get<Budgets>(`/reports/budgets?financialYear=${fy}`) });
  useEffect(() => {
    if (q.data) setGrid(Object.fromEntries(q.data.rows.map((r) => [r.accountId, r.monthsPaise.map((v) => (v ? String(v / 100) : ''))])));
  }, [q.data]);
  const prevFy = `${Number(fy.slice(0, 4)) - 1}-${fy.slice(2, 4)}`;
  const fill = useMutation({
    mutationFn: () => api.post<{ rows: Array<{ accountId: string; monthsPaise: number[] }> }>('/reports/budgets/from-year', { financialYear: fy, fromYear: prevFy, changePct: Number(change) || 0 }),
    onSuccess: (r) => {
      setGrid((g) => ({ ...g, ...Object.fromEntries(r.rows.map((row) => [row.accountId, row.monthsPaise.map((v) => (v ? String(v / 100) : ''))])) }));
      onToast(`Filled from FY ${prevFy}: check it, then save`);
    },
  });
  const save = useMutation({
    mutationFn: () => {
      const rows = (q.data?.rows ?? []).map((r) => {
        const months = (grid[r.accountId] ?? []).map((v) => (v.trim() ? parseRupees(v) : 0));
        if (months.some((v) => v === null || (v as number) < 0)) throw new Error(`${r.name}: enter amounts in rupees, like 25,000.`);
        return { accountId: r.accountId, monthsPaise: months as number[] };
      });
      return api.put<{ saved: number }>('/reports/budgets', { financialYear: fy, rows });
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['reports'] }); onToast(r.saved ? 'Budgets saved' : 'Nothing changed'); },
  });
  const set = (id: string, i: number, v: string) => setGrid((g) => ({ ...g, [id]: (g[id] ?? Array(12).fill('')).map((x, n) => (n === i ? v : x)) }));
  const total = (id: string) => (grid[id] ?? []).reduce((s, v) => s + (parseRupees(v || '0') ?? 0), 0);
  const section = (type: 'INCOME' | 'EXPENSE') => (q.data?.rows ?? []).filter((r) => r.type === type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={label}>Financial year</label><select className={field} value={fy} onChange={(e) => setFy(e.target.value)}>{[nextYear(), ...recentYears()].map((y) => <option key={y} value={y}>FY {y}</option>)}</select></div>
        <div><label className={label}>From FY {prevFy}, changed by %</label><input className={`${field} w-24 font-mono`} inputMode="decimal" value={change} onChange={(e) => setChange(e.target.value)} /></div>
        <Button variant="secondary" disabled={fill.isPending} onClick={() => fill.mutate()}>Fill from last year</Button>
        <Button className="ml-auto" disabled={save.isPending || !q.data} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save budgets'}</Button>
      </div>
      {(save.isError || fill.isError) && <p className="text-caption text-error-fg">{message(save.error ?? fill.error)}</p>}
      {q.isError && <p className="text-caption text-error-fg">{message(q.error)}</p>}
      {q.isLoading && <p className="text-caption text-ink-400">Loading…</p>}
      {q.data && (
        <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
          <table className="w-full text-caption">
            <thead><tr className="border-b border-line-200 bg-surface-sink"><th className="px-2 py-2 text-left font-medium text-ink-500">Account (₹)</th>{MONTH_NAMES.map((m) => <th key={m} className="px-1 py-2 text-right font-medium text-ink-500">{m}</th>)}<th className="px-2 py-2 text-right font-medium text-ink-500">Year</th></tr></thead>
            <tbody>
              {(['INCOME', 'EXPENSE'] as const).map((type) => [
                <tr key={type} className="bg-surface-sink/60"><td colSpan={14} className="px-2 py-1 uppercase tracking-wide text-ink-500">{type === 'INCOME' ? 'Income' : 'Expenses'}</td></tr>,
                ...section(type).map((r) => (
                  <tr key={r.accountId} className="border-b border-line-100">
                    <td className="whitespace-nowrap px-2 py-1 text-body text-ink-900">{r.name}</td>
                    {Array.from({ length: 12 }, (_, i) => (
                      <td key={i} className="px-0.5 py-1"><input className="w-20 rounded border border-line-200 px-1.5 py-1 text-right font-mono" inputMode="decimal" aria-label={`${r.name} ${MONTH_NAMES[i]}`} value={grid[r.accountId]?.[i] ?? ''} onChange={(e) => set(r.accountId, i, e.target.value)} /></td>
                    ))}
                    <td className="px-2 py-1 text-right font-mono text-ink-900">{(total(r.accountId) / 100).toLocaleString('en-IN')}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-ink-500">A plan, not an entry: budgets never touch the books. Compare them in Management reports under Budget against actual.</p>
    </div>
  );
}
