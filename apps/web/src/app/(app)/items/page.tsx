'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText } from '@/components/accountant/common';
import { formatPaise } from '@/lib/gst';
import { api } from '@/lib/api';
import { ItemOption, useItems } from '@/components/items/item-picker';
import { ItemsTabs } from '@/components/items/items-tabs';
import { SOURCE_LABEL } from '@/components/items/item-form';

type Filter = 'all' | 'sale' | 'purchase' | 'nocode';

/** Which documents an item is offered on. */
const sideLabel = (i: ItemOption) => (i.forSale === false ? 'Bought only' : i.forPurchase === false ? 'Sold only' : null);

/** What you sell and buy. A new item and an edit are pages: /items/new and /items/:id/edit. */
export default function ItemsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError, error, refetch } = useItems(showArchived);

  const toggle = useMutation({
    mutationFn: (item: ItemOption) => api.post(`/items/${item._id}/${item.isActive ? 'archive' : 'restore'}`),
    onSuccess: (_d, item) => {
      notify(item.isActive ? 'Item archived' : 'Item restored');
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (e) => notify(errorText(e, "Couldn't change the item. Try again."), 'error'),
  });

  const all = data ?? [];
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((i) => filter === 'all' || (filter === 'nocode' ? !i.hsnSac : filter === 'sale' ? i.forSale !== false : i.forPurchase !== false))
    .filter((i) => !needle || i.name.toLowerCase().includes(needle) || (i.hsnSac ?? '').startsWith(needle) || (i.code ?? '').toLowerCase().startsWith(needle));
  const missingCode = all.filter((i) => i.isActive && !i.hsnSac).length;
  const edit = (i: ItemOption) => `/items/${i._id}/edit`;

  return (
    <div>
      <ItemsTabs />
      <PageHeader
        title="Items"
        subtitle="What you sell and buy. Pick an item on an invoice or bill line and its HSN/SAC code, unit, rate and account fill in; the GSTR-1 HSN summary groups by them."
        guide="items"
        actions={
          <Button asChild>
            <Link href="/items/new"><Plus size={14} /> New item</Link>
          </Button>
        }
      />
      {missingCode > 0 && (
        <p className="mb-3 text-caption text-pending-fg">
          {missingCode} item{missingCode === 1 ? ' has' : 's have'} no HSN/SAC code. Lines that use {missingCode === 1 ? 'it' : 'them'} will be flagged on the GSTR-1.
        </p>
      )}

      <ListToolbar
        search={q}
        onSearch={setQ}
        placeholder="Search name, code or HSN"
        filters={{ value: filter, onChange: (v) => setFilter(v as Filter), options: [['all', 'All'], ['sale', 'Sold'], ['purchase', 'Bought'], ['nocode', 'No HSN/SAC']] }}
      >
        <label className="flex items-center gap-2 text-caption text-ink-600">
          <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </ListToolbar>

      {data && all.length === 0 && !showArchived ? (
        <EmptyState
          title="No items yet"
          body="Add what you sell or buy most often first. Its code, unit, rate and account then fill every line it is picked on."
          action={<Button asChild><Link href="/items/new"><Plus size={14} /> New item</Link></Button>}
          guide="items"
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Item</th>
                <th className={th}>HSN/SAC</th>
                <th className={th}>Unit</th>
                <th className={th}>GST</th>
                <th className={`${th} text-right`}>Selling price</th>
                <th className={`${th} text-right`}>Cost price</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading items…</td></tr>
              ) : isError ? (
                <TableError error={error} colSpan={7} onRetry={() => void refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-500">No item matches.</td></tr>
              ) : (
                rows.map((i) => (
                  <tr key={i._id} className={`${rowLink} ${i.isActive ? '' : 'opacity-60'}`} onClick={() => router.push(edit(i))}>
                    <td className={td}>
                      <Link href={edit(i)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{i.name}</Link>
                      <span className="block text-caption text-ink-500">
                        {[i.kind === 'goods' ? 'Goods' : 'Service', i.code, sideLabel(i), i.isActive ? null : 'archived'].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className={td}>
                      {i.hsnSac ? <span className="font-mono text-caption text-ink-900">{i.hsnSac}</span> : <span className="text-caption text-pending-fg">Not set</span>}
                      {i.hsnSource && i.hsnSource.by !== 'person' && <span className="block text-[0.7rem] text-ink-400">{SOURCE_LABEL[i.hsnSource.by]}</span>}
                    </td>
                    <td className={`${td} font-mono text-caption text-ink-600`}>{i.uqc === 'NA' ? '—' : i.uqc}</td>
                    <td className={`${td} font-mono text-caption`}>{i.gstRatePct === null ? <span className="text-ink-300">—</span> : `${i.gstRatePct}%`}</td>
                    <td className={tdMoney}>{i.forSale === false || i.salePricePaise === null ? <span className="text-ink-300">—</span> : formatPaise(i.salePricePaise)}</td>
                    <td className={tdMoney}>{i.forPurchase === false || i.purchasePricePaise === null ? <span className="text-ink-300">—</span> : formatPaise(i.purchasePricePaise)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Link href={edit(i)} className="mr-3 text-caption text-ink-600 hover:text-ink-900 hover:underline" onClick={(e) => e.stopPropagation()}>Edit</Link>
                      <button
                        type="button"
                        className="text-caption text-ink-500 hover:underline disabled:opacity-50"
                        disabled={toggle.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle.mutate(i);
                        }}
                      >
                        {i.isActive ? 'Archive' : 'Restore'}
                      </button>
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
