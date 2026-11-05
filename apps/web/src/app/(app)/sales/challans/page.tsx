'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, th, td, rowLink } from '@/components/page/page-shell';
import { CHALLAN_REASON, shortDate, useChallans } from '@/components/sales/sales-data';
import { DocStatusChip } from '@/components/sales/status';

export default function ChallansPage() {
  const router = useRouter();
  const challans = useChallans();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const all = challans.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((c) => filter === 'all' || c.status === filter)
    .filter((c) => !q || [c.number, c.customerName, c.vehicleNo, ...c.lines.map((l) => l.line.description)].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <PageHeader
        guide="challans"
        title="Delivery challans"
        subtitle="Goods that leave without a tax invoice: for supply invoiced later, job work, or on approval. A challan never posts."
        actions={<Button asChild><Link href="/sales/challans/new"><Plus size={14} /> New challan</Link></Button>}
      />

      {!challans.isLoading && !challans.isError && all.length === 0 ? (
        <EmptyState guide="challans" title="No challans yet" body="Issue one when goods move before, or without, an invoice." action={<Button asChild><Link href="/sales/challans/new"><Plus size={14} /> New challan</Link></Button>} />
      ) : (
        <div>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search number, customer, vehicle or item" filters={{ value: filter, onChange: setFilter, options: [['all', 'All'], ['issued', 'Issued'], ['returned', 'Returned'], ['cancelled', 'Cancelled']] }} />
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Challan</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Date</th>
                  <th className={th}>Why</th>
                  <th className={th}>Goods</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {challans.isLoading ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : challans.isError ? (
                  <TableError error={challans.error} colSpan={6} onRetry={() => void challans.refetch()} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-400">No challans match.</td></tr>
                ) : (
                  rows.map((c) => (
                    <tr key={c._id} className={rowLink} onClick={() => router.push(`/sales/challans/${c._id}`)}>
                      <td className={td}>
                        <Link href={`/sales/challans/${c._id}`} className="font-mono text-caption hover:underline" onClick={(e) => e.stopPropagation()}>{c.number}</Link>
                      </td>
                      <td className={`${td} font-medium`}>{c.customerName}</td>
                      <td className={`${td} text-caption text-ink-600`}>{shortDate(c.date)}</td>
                      <td className={`${td} text-caption text-ink-600`}>{CHALLAN_REASON[c.reason]}</td>
                      <td className={`${td} max-w-xs truncate text-caption text-ink-600`}>{c.lines.map((l) => `${l.line.qty} × ${l.line.description}`).join(', ')}</td>
                      <td className={td}><DocStatusChip status={c.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </div>
  );
}
