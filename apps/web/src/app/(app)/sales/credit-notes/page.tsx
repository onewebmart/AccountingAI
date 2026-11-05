'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, StatusChip, th, td, tdMoney } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { shortDate, type Amounts } from '@/components/sales/sales-data';

interface CreditNoteRow {
  _id: string;
  noteNumber: string;
  noteDate: string;
  reason: string;
  status: 'posted' | 'reversed';
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  amountsPaise: Amounts;
  totalPaise: number;
  journalId: string;
}

/** Credit notes raised against invoices: returns, discounts after the sale, corrections. Each one posts when raised. */
export default function CreditNotesPage() {
  const notes = useQuery({ queryKey: ['sales', 'credit-notes'], queryFn: () => api.get<CreditNoteRow[]>('/sales/credit-notes') });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const all = notes.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((n) => filter === 'all' || n.status === filter)
    .filter((n) => !q || [n.noteNumber, n.invoiceNumber, n.customerName, n.reason].some((v) => v?.toLowerCase().includes(q)));
  const total = rows.filter((n) => n.status === 'posted').reduce((s, n) => s + n.totalPaise, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Credit notes"
        subtitle="What you took back off an invoice after it was posted. Tax follows in the invoice's own proportions."
        actions={<Button asChild><Link href="/sales/credit-notes/new"><Plus size={14} /> New credit note</Link></Button>}
      />

      {!notes.isLoading && !notes.isError && all.length === 0 ? (
        <EmptyState
          title="No credit notes yet"
          body="Raise one from a posted invoice when goods come back or a price is corrected."
          action={<Button asChild><Link href="/sales/credit-notes/new"><Plus size={14} /> New credit note</Link></Button>}
        />
      ) : (
        <div>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search note, invoice, customer or reason" filters={{ value: filter, onChange: setFilter, options: [['all', 'All'], ['posted', 'Posted'], ['reversed', 'Reversed']] }}>
            {rows.length > 0 && <span className="text-caption text-ink-500">Posted in view: <span className="font-mono text-ink-900">{formatPaise(total)}</span></span>}
          </ListToolbar>
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>Note no.</th>
                  <th className={th}>Invoice</th>
                  <th className={th}>Customer</th>
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
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">No credit notes match.</td></tr>
                ) : (
                  rows.map((n) => (
                    <tr key={n._id} className="border-b border-line-100 last:border-0">
                      <td className={`${td} whitespace-nowrap text-caption text-ink-600`}>{shortDate(n.noteDate)}</td>
                      <td className={`${td} font-mono text-caption`}>{n.noteNumber}</td>
                      <td className={td}>
                        <Link href={`/sales/invoices/${n.invoiceId}`} className="font-mono text-caption hover:underline">{n.invoiceNumber ?? 'Open the invoice'}</Link>
                      </td>
                      <td className={`${td} font-medium`}>{n.customerName}</td>
                      <td className={`${td} text-caption text-ink-600`}>{n.reason}</td>
                      <td className={td}><StatusChip tone={n.status === 'posted' ? 'success' : 'neutral'}>{n.status === 'posted' ? 'Posted' : 'Reversed'}</StatusChip></td>
                      <td className={tdMoney}>{formatPaise(n.totalPaise)}</td>
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
