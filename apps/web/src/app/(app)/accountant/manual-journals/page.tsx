'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { shortDate } from '@/components/accountant/common';
import type { JournalItem } from '@/components/accountant/journal-types';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

const dateInput = 'h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/** Journal vouchers typed by a person: adjustments, corrections, opening entries. */
export default function ManualJournalsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams({ voucherType: 'JOURNAL' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const q = useQuery({
    queryKey: ['journals', 'manual', from, to],
    queryFn: () => api.get<{ data: JournalItem[]; total: number }>(`/journals?${params.toString()}`),
  });

  const needle = search.trim().toLowerCase();
  const rows = (q.data?.data ?? []).filter(
    (j) =>
      (status === 'all' || j.status === status) &&
      (!needle ||
        j.voucherNumber.toLowerCase().includes(needle) ||
        j.description.toLowerCase().includes(needle) ||
        j.lines.some((l) => l.accountName.toLowerCase().includes(needle) || l.description.toLowerCase().includes(needle))),
  );

  return (
    <div>
      <PageHeader
        title="Manual journals"
        subtitle="Journal vouchers entered by hand. A posted journal is never edited: correct it by reversing it and posting again."
        actions={
          <Button asChild>
            <Link href="/accountant/manual-journals/new"><Plus size={14} /> New journal</Link>
          </Button>
        }
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search voucher, narration or account"
        filters={{ value: status, onChange: setStatus, options: [['all', 'All'], ['posted', 'Posted'], ['reversed', 'Reversed']] }}
      >
        <label className="flex items-center gap-1.5 text-caption text-ink-500">
          From <input type="date" className={dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-caption text-ink-500">
          To <input type="date" className={dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </ListToolbar>

      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading ? (
        <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading journals…</p>
      ) : rows.length === 0 && !q.isError ? (
        <EmptyState
          title={q.data?.data.length ? 'No journal matches' : 'No manual journals yet'}
          body={q.data?.data.length ? 'Change the search, status or dates.' : 'Post a journal for an adjustment the documents do not cover: a provision, a correction, an opening entry.'}
          action={!q.data?.data.length ? <Button asChild><Link href="/accountant/manual-journals/new">New journal</Link></Button> : undefined}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Voucher</th>
                <th className={th}>Date</th>
                <th className={th}>Narration</th>
                <th className={th}>Accounts</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const names = [...new Set(j.lines.map((l) => l.accountName))];
                return (
                  <tr key={j._id} className={rowLink} onClick={() => router.push(`/accountant/manual-journals/${j._id}`)}>
                    <td className={`${td} font-mono text-caption`}>
                      <Link href={`/accountant/manual-journals/${j._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{j.voucherNumber}</Link>
                    </td>
                    <td className={`${td} whitespace-nowrap text-ink-600`}>{shortDate(j.date)}</td>
                    <td className={`${td} max-w-[260px] truncate`}>{j.description}</td>
                    <td className={`${td} max-w-[260px] truncate text-caption text-ink-600`}>{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3}` : ''}</td>
                    <td className={tdMoney}>{formatPaise(j.totalDebitPaise)}</td>
                    <td className={td}>
                      {j.status === 'reversed'
                        ? <StatusChip tone="neutral">Reversed{j.reversedBy ? ` by ${j.reversedBy}` : ''}</StatusChip>
                        : <StatusChip tone="success">Posted</StatusChip>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">
            <span>{rows.length} journal{rows.length === 1 ? '' : 's'}{q.data && q.data.total >= 200 ? ' (the latest 200: narrow the dates to see older ones)' : ''}</span>
            <span>Journals waiting on an approval policy are in <Link href="/approvals" className="underline">Approvals</Link>.</span>
          </div>
        </TableCard>
      )}
    </div>
  );
}
