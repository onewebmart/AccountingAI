'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, th, td, tdMoney, rowLink } from '@/components/page/page-shell';
import { formatPaise } from '@/lib/gst';
import { shortDate, useOrders, type OrderRow } from '@/components/sales/sales-data';
import { DocStatusChip } from '@/components/sales/status';

/** How much of an order is invoiced and delivered, as a share of what was ordered. */
function progress(o: OrderRow, key: 'invoicedQty' | 'deliveredQty') {
  const ordered = o.lines.reduce((s, l) => s + l.qty, 0);
  const done = o.lines.reduce((s, l) => s + Math.min(l.qty, l[key] ?? 0), 0);
  return ordered ? Math.round((done / ordered) * 100) : 0;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const orders = useOrders();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('open');

  const all = orders.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((o) => filter === 'all' || o.status === filter)
    .filter((o) => !q || [o.number, o.customerName, o.customerPoNumber].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales orders"
        subtitle="What customers ordered. Invoice an order whole or in parts; nothing posts until the invoice is posted."
        actions={<Button asChild><Link href="/sales/orders/new"><Plus size={14} /> New sales order</Link></Button>}
      />

      {!orders.isLoading && !orders.isError && all.length === 0 ? (
        <EmptyState title="No sales orders yet" body="Accept a quote and make it an order, or enter one the customer sent." action={<Button asChild><Link href="/sales/orders/new"><Plus size={14} /> New sales order</Link></Button>} />
      ) : (
        <div>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search number, customer or their PO" filters={{ value: filter, onChange: setFilter, options: [['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled'], ['all', 'All']] }} />
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Order</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Date</th>
                  <th className={th}>Their PO</th>
                  <th className={th}>Invoiced</th>
                  <th className={th}>Delivered</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.isLoading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : orders.isError ? (
                  <TableError error={orders.error} colSpan={8} onRetry={() => void orders.refetch()} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-caption text-ink-400">No orders match.</td></tr>
                ) : (
                  rows.map((o) => (
                    <tr key={o._id} className={rowLink} onClick={() => router.push(`/sales/orders/${o._id}`)}>
                      <td className={td}>
                        <Link href={`/sales/orders/${o._id}`} className="font-mono text-caption hover:underline" onClick={(e) => e.stopPropagation()}>{o.number}</Link>
                      </td>
                      <td className={`${td} font-medium`}>{o.customerName}</td>
                      <td className={`${td} text-caption text-ink-600`}>{shortDate(o.date)}</td>
                      <td className={`${td} font-mono text-caption text-ink-600`}>{o.customerPoNumber ?? '—'}</td>
                      <td className={`${td} font-mono text-caption`}>{progress(o, 'invoicedQty')}%</td>
                      <td className={`${td} font-mono text-caption`}>{progress(o, 'deliveredQty')}%</td>
                      <td className={td}><DocStatusChip status={o.status} /></td>
                      <td className={tdMoney}>{formatPaise(o.amountsPaise.total)}</td>
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
