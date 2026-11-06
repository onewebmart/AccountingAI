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
import { shortDate, type Amounts } from '@/components/purchases/purchase-data';

interface DebitNoteRow {
  _id: string;
  noteNumber: string;
  noteDate: string;
  reason: string;
  status: 'posted' | 'reversed';
  billId: string;
  billNumber: string | null;
  vendorName: string;
  amountsPaise: Amounts;
  totalPaise: number;
  journalId: string;
  /** By value, or typed item by item; the vendor's own credit note number. */
  kind?: 'value' | 'itemised';
  vendorCreditNumber?: string | null;
  lines?: Array<{ description: string }>;
}

/** Debit notes raised on bills: goods returned, short supply, a rate agreed lower. */
export default function VendorCreditsPage() {
  const router = useRouter();
  const notes = useQuery({ queryKey: ['purchase', 'debit-notes'], queryFn: () => api.get<DebitNoteRow[]>('/purchase/debit-notes') });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const all = notes.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((n) => filter === 'all' || n.status === filter)
    .filter((n) => !q || [n.noteNumber, n.vendorName, n.billNumber, n.reason, n.vendorCreditNumber].some((s) => s?.toLowerCase().includes(q)));

  return (
    <div>
      <PageHeader
        guide="vendorCredits"
        title="Vendor credits"
        subtitle="Debit notes on bills. What a note takes off a paid bill becomes the vendor's credit, owed back to you."
        actions={
          <Button asChild>
            <Link href="/purchases/vendor-credits/new"><Plus size={14} /> New vendor credit</Link>
          </Button>
        }
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search note, their credit note, vendor, bill or reason"
        filters={{ value: filter, onChange: setFilter, options: [['all', 'All'], ['posted', 'Posted'], ['reversed', 'Reversed']] }}
      />
      {notes.data && all.length === 0 ? (
        <EmptyState
          guide="vendorCredits"
          title="No debit notes yet"
          body="Raise one from a posted bill when goods come back or the bill was too high."
          action={<Button asChild><Link href="/purchases/vendor-credits/new">New vendor credit</Link></Button>}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Note</th>
                <th className={th}>Date</th>
                <th className={th}>Vendor</th>
                <th className={th}>Bill</th>
                <th className={th}>Reason</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {notes.isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : notes.isError ? (
                <TableError error={notes.error} colSpan={7} onRetry={() => void notes.refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-500">No debit notes here.</td></tr>
              ) : (
                rows.map((n) => (
                  <tr key={n._id} className={rowLink} onClick={() => router.push(`/purchases/bills/${n.billId}`)}>
                    <td className={`${td} font-mono text-caption`}>
                      {n.noteNumber}
                      {n.vendorCreditNumber && <span className="block text-ink-400">their {n.vendorCreditNumber}</span>}
                    </td>
                    <td className={`${td} text-caption`}>{shortDate(n.noteDate)}</td>
                    <td className={td}>{n.vendorName}</td>
                    <td className={`${td} font-mono text-caption`}>
                      <Link href={`/purchases/bills/${n.billId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{n.billNumber ?? 'No number'}</Link>
                    </td>
                    <td className={`${td} text-caption text-ink-600`}>
                      {n.reason}
                      {n.kind === 'itemised' && (n.lines?.length ?? 0) > 0 && <span className="block text-ink-400">{n.lines!.length} line{n.lines!.length === 1 ? '' : 's'}</span>}
                    </td>
                    <td className={td}>{n.status === 'posted' ? <StatusChip tone="success">Posted</StatusChip> : <StatusChip tone="neutral">Reversed</StatusChip>}</td>
                    <td className={tdMoney}>{formatPaise(n.totalPaise)}</td>
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
