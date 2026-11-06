'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ListToolbar, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ConfirmDialog, Notice, errorText, shortDate, todayIso } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { type BudgetPeriod, PERIOD_NAMES, fyChoices } from './budget-periods';

export interface BudgetSummary {
  id: string; name: string; financialYear: string; period: BudgetPeriod; includeBalanceSheet: boolean; isDefault: boolean;
  status: 'active' | 'archived'; migrated: boolean; accounts: number; incomePaise: number; expensePaise: number; updatedAt: string | null;
}

/** Budget against actual for a budget, in Management reports. */
export const budgetReportHref = (b: Pick<BudgetSummary, 'id' | 'financialYear'>) => `/reports/management?report=budget_vs_actual&financialYear=${b.financialYear}&budgetId=${b.id}`;

/**
 * The budgets, by year, the default marked: open one to edit its grid, make
 * it the year's default, archive or restore it, or delete it.
 */
export function BudgetsList() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [fy, setFy] = useState('');
  const [deleting, setDeleting] = useState<BudgetSummary | null>(null);
  const list = useQuery({
    queryKey: ['reports', 'budgets', status, fy],
    queryFn: () => api.get<BudgetSummary[]>(`/reports/budgets?status=${status}${fy ? `&financialYear=${fy}` : ''}`),
  });
  const act = useMutation({
    mutationFn: ({ b, action }: { b: BudgetSummary; action: 'default' | 'archive' | 'restore' | 'delete' }) =>
      action === 'delete' ? api.delete(`/reports/budgets/${b.id}`) : api.post(`/reports/budgets/${b.id}/${action}`),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      setDeleting(null);
      notify({ default: `${v.b.name} is the default for ${v.b.financialYear}`, archive: 'Budget archived', restore: 'Budget restored', delete: 'Budget deleted' }[v.action]);
    },
    onError: (err) => notify(errorText(err, "Couldn't change the budget."), 'error'),
  });
  const rows = list.data ?? [];

  return (
    <div className="space-y-3">
      <ListToolbar filters={{ value: status, onChange: (v) => setStatus(v as 'active' | 'archived'), options: [['active', 'Active'], ['archived', 'Archived']] }}>
        <select className="h-10 rounded-md border border-line-200 bg-white px-2 text-body" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
          <option value="">Every year</option>
          {fyChoices(todayIso()).map((y) => <option key={y} value={y}>FY {y}</option>)}
        </select>
      </ListToolbar>
      {list.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading budgets…</p>}
      {list.isError && <Notice tone="error">{errorText(list.error)}</Notice>}
      {list.data && rows.length === 0 && (
        <EmptyState
          guide={status === 'active' && !fy ? 'budgets' : undefined}
          title={status === 'archived' ? 'No archived budgets' : 'No budgets yet'}
          body={status === 'archived' ? 'Archived budgets are kept here and can be restored.' : 'Make a budget for the year: pick the accounts, then type the amounts by month, quarter, half-year or year.'}
          action={status === 'active' ? <Link href="/accountant/budgets/new"><Button><Plus size={14} /> New budget</Button></Link> : undefined}
        />
      )}
      {rows.length > 0 && (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Name</th>
                <th className={th}>Financial year</th>
                <th className={th}>Period</th>
                <th className={`${th} text-right`}>Accounts</th>
                <th className={`${th} text-right`}>Income</th>
                <th className={`${th} text-right`}>Expenses</th>
                <th className={th}>Changed</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-line-100 last:border-0">
                  <td className={td}>
                    <div className="flex flex-wrap items-center gap-2">
                      {b.status === 'active' ? <Link href={`/accountant/budgets/${b.id}/edit`} className="font-medium hover:underline">{b.name}</Link> : <span className="font-medium">{b.name}</span>}
                      {b.isDefault && <StatusChip tone="success">Default</StatusChip>}
                    </div>
                    {b.migrated && <p className="text-caption text-ink-500">Carried over from the earlier budget for the year</p>}
                    {b.includeBalanceSheet && <p className="text-caption text-ink-500">With balance-sheet accounts</p>}
                  </td>
                  <td className={`${td} whitespace-nowrap font-mono`}>{b.financialYear}</td>
                  <td className={td}>{PERIOD_NAMES[b.period]}</td>
                  <td className={tdMoney}>{b.accounts}</td>
                  <td className={tdMoney}>{formatPaise(b.incomePaise)}</td>
                  <td className={tdMoney}>{formatPaise(b.expensePaise)}</td>
                  <td className={`${td} whitespace-nowrap text-caption text-ink-500`}>{b.updatedAt ? shortDate(b.updatedAt) : '—'}</td>
                  <td className={`${td} whitespace-nowrap text-right text-caption`}>
                    <div className="flex justify-end gap-3">
                      <Link href={budgetReportHref(b)} className="text-ink-600 hover:underline">Against actual</Link>
                      {b.status === 'active' && !b.isDefault && <button type="button" className="text-ink-600 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ b, action: 'default' })}>Make default</button>}
                      {b.status === 'active'
                        ? <button type="button" className="text-ink-600 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ b, action: 'archive' })}>Archive</button>
                        : <button type="button" className="text-ink-600 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ b, action: 'restore' })}>Restore</button>}
                      <button type="button" className="text-error-fg hover:underline" disabled={act.isPending} onClick={() => setDeleting(b)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<>It goes from every list and from budget against actual. Its last figures stay in the audit trail.{deleting.isDefault ? ' Another budget for the year becomes the default.' : ''} To keep it out of the way instead, archive it.</>}
          confirmLabel="Delete budget"
          destructive
          busy={act.isPending}
          onConfirm={() => act.mutate({ b: deleting, action: 'delete' })}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
