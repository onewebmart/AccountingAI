'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { formatPaise } from '@/lib/gst';
import { useVendors } from '@/components/purchases/purchase-data';

type Filter = 'all' | 'owed' | 'msme';

/** Everyone you buy from, and what you owe each. */
export default function VendorsPage() {
  const router = useRouter();
  const vendors = useVendors();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const all = vendors.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((v) => filter === 'all' || (filter === 'owed' ? (v.outstandingPaise ?? 0) > 0 : !!v.msme))
    .filter((v) => !q || [v.name, v.gstin, v.email, v.phone, v.city].some((s) => s?.toLowerCase().includes(q)));
  const owed = all.reduce((s, v) => s + (v.outstandingPaise ?? 0), 0);

  return (
    <div>
      <PageHeader
        guide="vendors"
        title="Vendors"
        subtitle={vendors.data ? `${all.length} vendor${all.length === 1 ? '' : 's'} · you owe ${formatPaise(owed)} on posted bills` : 'Everyone you buy from, and what you owe each.'}
        actions={
          <Button asChild>
            <Link href="/purchases/vendors/new"><Plus size={14} /> New vendor</Link>
          </Button>
        }
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name, GSTIN, email"
        filters={{ value: filter, onChange: (v) => setFilter(v as Filter), options: [['all', 'All'], ['owed', 'You owe them'], ['msme', 'MSME']] }}
      />
      {vendors.data && all.length === 0 ? (
        <EmptyState
          guide="vendors"
          title="No vendors yet"
          body="Add the people you buy from, with their GSTIN and bank details, and bills and payments follow."
          action={<Button asChild><Link href="/purchases/vendors/new">New vendor</Link></Button>}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Vendor</th>
                <th className={th}>GSTIN</th>
                <th className={th}>TDS</th>
                <th className={th}>MSME</th>
                <th className={`${th} text-right`}>You owe</th>
              </tr>
            </thead>
            <tbody>
              {vendors.isLoading ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : vendors.isError ? (
                <TableError error={vendors.error} colSpan={5} onRetry={() => void vendors.refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-caption text-ink-500">No vendor matches.</td></tr>
              ) : (
                rows.map((v) => (
                  <tr key={v._id} className={rowLink} onClick={() => router.push(`/purchases/vendors/${v._id}`)}>
                    <td className={td}>
                      <Link href={`/purchases/vendors/${v._id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{v.name}</Link>
                      {(v.city || v.email) && <span className="block text-caption text-ink-500">{[v.city, v.email].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className={`${td} font-mono text-caption`}>{v.gstin ?? <span className="text-ink-400">Unregistered</span>}</td>
                    <td className={`${td} text-caption`}>{v.tdsSection ? `${v.tdsSection} · ${(v.tdsRateBps ?? 0) / 100}%` : <span className="text-ink-400">—</span>}</td>
                    <td className={`${td} text-caption`}>{v.msme ? <span className="capitalize">{v.msme.category}</span> : <span className="text-ink-400">—</span>}</td>
                    <td className={tdMoney}>
                      {(v.outstandingPaise ?? 0) > 0 ? formatPaise(v.outstandingPaise ?? 0) : <StatusChip tone="success">Cleared</StatusChip>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  );
}
