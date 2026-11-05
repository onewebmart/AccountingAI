'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { formatPaise } from '@/lib/gst';
import { shortDate } from '@/components/purchases/purchase-data';
import { PoStatusChip, poProgress, usePurchaseOrders } from '@/components/purchases/po-data';

/** Purchase orders: what was ordered, what has come in, and what has been billed. None of it posts. */
export default function PurchaseOrdersPage() {
  const router = useRouter();
  const pos = usePurchaseOrders();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('open');
  const all = pos.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((p) => filter === 'all' || p.status === filter).filter((p) => !q || [p.number, p.vendorName].some((s) => s.toLowerCase().includes(q)));

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        subtitle="Raise, send, receive against, and bill. A PO never touches the ledger; the bill it becomes does, once posted."
        actions={<Button asChild><Link href="/purchases/orders/new"><Plus size={14} /> New purchase order</Link></Button>}
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search PO number or vendor"
        filters={{ value: filter, onChange: setFilter, options: [['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled'], ['all', 'All']] }}
      />
      {pos.data && all.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          body="Raise one before you buy: goods received are checked against it, and the bill is matched to both."
          action={<Button asChild><Link href="/purchases/orders/new">New purchase order</Link></Button>}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>PO</th>
                <th className={th}>Vendor</th>
                <th className={th}>Date</th>
                <th className={th}>Needed by</th>
                <th className={th}>Received</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {pos.isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : pos.isError ? (
                <TableError error={pos.error} colSpan={7} onRetry={() => void pos.refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-500">No purchase orders here.</td></tr>
              ) : (
                rows.map((po) => {
                  const p = poProgress(po);
                  return (
                    <tr key={po._id} className={rowLink} onClick={() => router.push(`/purchases/orders/${po._id}`)}>
                      <td className={`${td} font-mono text-caption`}>
                        <Link href={`/purchases/orders/${po._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{po.number}</Link>
                      </td>
                      <td className={td}>{po.vendorName}</td>
                      <td className={`${td} text-caption`}>{shortDate(po.date)}</td>
                      <td className={`${td} text-caption`}>{shortDate(po.expectedBy)}</td>
                      <td className={`${td} font-mono text-caption`}>{p.received} of {p.ordered}{p.billed > 0 ? ` · ${p.billed} billed` : ''}</td>
                      <td className={td}><PoStatusChip po={po} /></td>
                      <td className={tdMoney}>{formatPaise(po.amountsPaise.total)}</td>
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
