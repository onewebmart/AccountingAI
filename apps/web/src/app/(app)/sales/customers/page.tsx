'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, th, td, tdMoney, rowLink } from '@/components/page/page-shell';
import { formatPaise } from '@/lib/gst';
import { stateName, useCustomers } from '@/components/sales/sales-data';

/** Everyone you sell to, and what each still owes. */
export default function CustomersPage() {
  const router = useRouter();
  const customers = useCustomers();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const all = customers.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((c) => (filter === 'owing' ? c.receivablePaise > 0 : filter === 'cleared' ? c.receivablePaise <= 0 : true))
    .filter((c) => !q || [c.name, c.gstin, c.email, c.phone, c.city].some((v) => v?.toLowerCase().includes(q)));
  const owed = all.reduce((s, c) => s + c.receivablePaise, 0);

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={all.length ? <>They owe you <span className="font-mono text-ink-900">{formatPaise(owed)}</span> across {all.filter((c) => c.receivablePaise > 0).length} of {all.length} customers.</> : 'Who you sell to, and what each owes.'}
        actions={
          <Button asChild>
            <Link href="/sales/customers/new"><Plus size={14} /> New customer</Link>
          </Button>
        }
      />

      {!customers.isLoading && !customers.isError && all.length === 0 ? (
        <EmptyState
          title="Add your first customer"
          body="A customer's GSTIN or state decides the tax on every invoice to them."
          action={<Button asChild><Link href="/sales/customers/new"><Plus size={14} /> New customer</Link></Button>}
        />
      ) : (
        <>
          <ListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search name, GSTIN, email or phone"
            filters={{ value: filter, onChange: setFilter, options: [['all', 'All'], ['owing', 'Owe you'], ['cleared', 'Cleared']] }}
          />
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Customer</th>
                  <th className={th}>GSTIN</th>
                  <th className={th}>State</th>
                  <th className={th}>Contact</th>
                  <th className={`${th} text-right`}>They owe</th>
                </tr>
              </thead>
              <tbody>
                {customers.isLoading ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : customers.isError ? (
                  <TableError error={customers.error} colSpan={5} onRetry={() => void customers.refetch()} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-caption text-ink-400">No customers match.</td></tr>
                ) : (
                  rows.map((c) => (
                    <tr key={c._id} className={rowLink} onClick={() => router.push(`/sales/customers/${c._id}`)}>
                      <td className={`${td} font-medium`}>
                        <Link href={`/sales/customers/${c._id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                      </td>
                      <td className={`${td} font-mono text-caption text-ink-600`}>{c.gstin ?? <span className="text-ink-400">Unregistered</span>}</td>
                      <td className={`${td} text-caption text-ink-600`}>
                        {stateName(c.stateCode ?? c.gstin?.slice(0, 2)) ?? <span className="text-pending-fg" title="Needed for GSTR-1 when they have no GSTIN">Not set</span>}
                      </td>
                      <td className={`${td} text-caption text-ink-600`}>{[c.email, c.phone].filter(Boolean).join(' · ') || <span className="text-ink-400">—</span>}</td>
                      <td className={tdMoney}>
                        {c.receivablePaise > 0 ? formatPaise(c.receivablePaise) : <span className="font-sans text-caption font-medium text-success-fg">Cleared</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </>
      )}
    </div>
  );
}
