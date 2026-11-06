'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { cn } from '@/lib/utils';
import { shortDate } from '@/components/purchases/purchase-data';
import { unitWord } from '@/components/purchases/mileage';
import type { ExpenseRow } from '@/components/purchases/expense-form';

const tag = 'ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium';

/** Money paid straight from the bank or cash, with no bill to pay later. */
export default function ExpensesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [billableOnly, setBillableOnly] = useState(false);
  const expenses = useQuery({ queryKey: ['direct-expenses', 'list'], queryFn: () => api.get<ExpenseRow[]>('/direct-expenses') });
  const all = expenses.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((e) => status === 'all' || e.status === status)
    .filter((e) => !billableOnly || e.billable)
    .filter((e) => !q || [e.number, e.vendorName, e.customerName, e.paidThroughAccountName, e.reference, e.notes, ...(e.lines ?? []).map((l) => l.expenseAccountName), e.expenseAccountName].some((s) => s?.toLowerCase().includes(q)));
  const drafts = all.filter((e) => e.status === 'draft').length;
  const billable = all.filter((e) => e.billable && !e.invoiceId).length;

  return (
    <div>
      <PageHeader
        guide="expenses"
        title="Expenses"
        subtitle="Paid on the spot from bank or cash: a courier, fuel, a subscription on the card. Drafts until you post them."
        actions={
          <>
            <Button variant="secondary" asChild><Link href="/purchases/recurring-expenses">Recurring expenses</Link></Button>
            <Button variant="secondary" asChild><Link href="/purchases/expenses/new?tab=bulk">Bulk add</Link></Button>
            <Button asChild><Link href="/purchases/expenses/new"><Plus size={14} /> New expense</Link></Button>
          </>
        }
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search number, vendor, customer, account"
        filters={{ value: status, onChange: setStatus, options: [['all', 'All'], ['draft', `Drafts${drafts ? ` · ${drafts}` : ''}`], ['posted', 'Posted']] }}
      >
        <button
          type="button"
          aria-pressed={billableOnly}
          onClick={() => setBillableOnly((b) => !b)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-caption font-medium',
            billableOnly ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600 hover:bg-surface-sink',
          )}
        >
          Billable{billable ? ` · ${billable} not invoiced` : ''}
        </button>
      </ListToolbar>
      {expenses.data && all.length === 0 ? (
        <EmptyState
          guide="expenses"
          title="No expenses yet"
          body="Record what was paid straight from the bank or cash, a trip at your mileage rate, or many at once. A bill to pay later goes under Bills instead."
          action={<Button asChild><Link href="/purchases/expenses/new">New expense</Link></Button>}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Number</th>
                <th className={th}>Date</th>
                <th className={th}>Expense account</th>
                <th className={th}>Vendor</th>
                <th className={th}>Customer</th>
                <th className={th}>Paid through</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.isLoading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : expenses.isError ? (
                <TableError error={expenses.error} colSpan={8} onRetry={() => void expenses.refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-caption text-ink-500">{billableOnly ? 'No billable expenses here.' : 'No expenses here.'}</td></tr>
              ) : (
                rows.map((e) => {
                  const more = (e.lines?.length ?? 1) - 1;
                  return (
                    <tr key={e._id} className={rowLink} onClick={() => router.push(`/purchases/expenses/${e._id}`)}>
                      <td className={`${td} whitespace-nowrap font-mono text-caption`}>
                        <Link href={`/purchases/expenses/${e._id}`} onClick={(ev) => ev.stopPropagation()} className="hover:underline">{e.number}</Link>
                        {e.recurringTemplateId && <span className={`${tag} bg-info-bg text-info-fg`}>Recurring</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-caption`}>{shortDate(e.date)}</td>
                      <td className={td}>
                        {e.expenseAccountName}
                        {e.itemized && more > 0 && <span className="ml-1 text-caption text-ink-500">+ {more} more</span>}
                        {e.kind === 'mileage' && e.mileage && (
                          <span className="block text-caption text-ink-500">
                            Mileage · <span className="font-mono">{e.mileage.distance.toLocaleString('en-IN', { maximumFractionDigits: 2 })} {unitWord(e.mileage.unit, e.mileage.distance)}</span>
                          </span>
                        )}
                        {e.reference && <span className="block text-caption text-ink-500">{e.reference}</span>}
                      </td>
                      <td className={`${td} text-caption`}>{e.vendorName ?? <span className="text-ink-400">—</span>}</td>
                      <td className={`${td} text-caption`}>
                        {e.customerName ?? <span className="text-ink-400">—</span>}
                        {e.billable && <span className="block text-ink-500">{e.invoiceId ? 'Billed' : 'Billable'}</span>}
                      </td>
                      <td className={`${td} text-caption`}>{e.paidThroughAccountName}</td>
                      <td className={td}>{e.status === 'posted' ? <StatusChip tone="success">Posted</StatusChip> : <StatusChip tone="pending">Draft</StatusChip>}</td>
                      <td className={tdMoney}>{formatPaise(e.totalPaise)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  );
}
