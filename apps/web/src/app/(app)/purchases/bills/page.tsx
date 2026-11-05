'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { DocumentUploadButton } from '@/components/shell/document-upload-button';
import { AgeingBuckets } from '@/components/shell/ageing-buckets';
import { formatPaise } from '@/lib/gst';
import { BillStatusChip, dueInfo, shortDate, useBills, type BillRow } from '@/components/purchases/purchase-data';

type Filter = 'all' | 'draft' | 'open' | 'late' | 'msme' | 'paid';

const matches = (b: BillRow, f: Filter) => {
  if (f === 'all') return true;
  if (f === 'draft') return b.status === 'draft';
  if (f === 'paid') return b.status === 'paid';
  const open = b.status === 'posted' && b.outstandingPaise > 0;
  if (f === 'open') return open;
  if (f === 'late') return open && dueInfo(b.dueDate)?.tone === 'late';
  return open && !!b.msmePayBy;
};

/** Where a bill came from: typed, read off an upload, or drafted by a schedule. */
function SourceChip({ bill }: { bill: BillRow }) {
  if (bill.recurringTemplateId) return <span title="Drafted from a recurring bill" className="rounded bg-info-bg px-1.5 py-0.5 text-[10px] font-medium text-info-fg">Recurring</span>;
  if (bill.sourceDocumentId) return <span title="Read from an uploaded document" className="rounded bg-honey-100 px-1.5 py-0.5 text-[10px] font-medium text-pending-fg">Scanned</span>;
  return null;
}

/** Every bill: drafts to post, what is owed and when, and what an MSME must be paid by. */
export default function BillsPage() {
  const router = useRouter();
  const bills = useBills();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const all = bills.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((b) => matches(b, filter)).filter((b) => !q || [b.vendorName, b.billNumber, b.vendorGstin].some((s) => s?.toLowerCase().includes(q)));
  const count = (f: Filter) => all.filter((b) => matches(b, f)).length;

  return (
    <div>
      <PageHeader
        guide="bills"
        title="Bills"
        subtitle="What vendors have billed you. A bill is a draft until you post it to the ledger."
        actions={
          <>
            <DocumentUploadButton label="Upload bill" onUploaded={(m) => notify(m, 'info')} />
            <Button variant="secondary" asChild>
              <Link href="/purchases/payments-made/new">Record payment</Link>
            </Button>
            <Button asChild>
              <Link href="/purchases/bills/new"><Plus size={14} /> New bill</Link>
            </Button>
          </>
        }
      />

      <div className="mb-5">
        <p className="mb-2 text-caption text-ink-500">What you owe vendors, by days past the due date</p>
        <AgeingBuckets kind="payable" />
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search vendor or bill number"
        filters={{
          value: filter,
          onChange: (v) => setFilter(v as Filter),
          options: [
            ['all', 'All'],
            ['draft', `Drafts${count('draft') ? ` · ${count('draft')}` : ''}`],
            ['open', 'Unpaid'],
            ['late', `Late${count('late') ? ` · ${count('late')}` : ''}`],
            ['msme', 'MSME pay-by'],
            ['paid', 'Paid'],
          ],
        }}
      />

      {bills.data && all.length === 0 ? (
        <EmptyState
          guide="bills"
          title="No bills yet"
          body="Upload a bill to have it read for you, or type one in line by line."
          action={<Button asChild><Link href="/purchases/bills/new">New bill</Link></Button>}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Vendor</th>
                <th className={th}>Bill no.</th>
                <th className={th}>Date</th>
                <th className={th}>Due</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bills.isLoading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : bills.isError ? (
                <TableError error={bills.error} colSpan={6} onRetry={() => void bills.refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-500">No bills here.</td></tr>
              ) : (
                rows.map((b) => {
                  const due = b.status === 'posted' && b.outstandingPaise > 0 ? dueInfo(b.dueDate) : null;
                  return (
                    <tr key={b._id} className={rowLink} onClick={() => router.push(`/purchases/bills/${b._id}`)}>
                      <td className={`${td} font-medium`}>{b.vendorName}</td>
                      <td className={`${td} font-mono text-caption`}>
                        <span className="flex items-center gap-2">
                          <Link href={`/purchases/bills/${b._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{b.billNumber ?? 'No number'}</Link>
                          <SourceChip bill={b} />
                        </span>
                      </td>
                      <td className={`${td} text-caption`}>{shortDate(b.billDate)}</td>
                      <td className={`${td} text-caption`}>
                        {due ? <span className={due.tone === 'late' ? 'font-medium text-error-fg' : due.tone === 'soon' ? 'text-pending-fg' : 'text-ink-600'}>{due.label}</span> : <span className="text-ink-400">—</span>}
                        {b.msmePayBy && b.status === 'posted' && b.outstandingPaise > 0 && (
                          <span
                            className={`block ${b.msmeLate ? 'font-medium text-error-fg' : 'text-pending-fg'}`}
                            title="An MSME vendor: under section 43B(h), paying after this day makes the expense deductible only in the year it is paid."
                          >
                            MSME · {b.msmeLate ? 'was due' : 'pay by'} {shortDate(b.msmePayBy)}
                          </span>
                        )}
                      </td>
                      <td className={td}><BillStatusChip status={b.status} /></td>
                      <td className={tdMoney}>
                        {formatPaise(b.totalPaise)}
                        {b.amountPaidPaise > 0 && b.outstandingPaise > 0 && <span className="block text-caption text-pending-fg">{formatPaise(b.outstandingPaise)} owed</span>}
                      </td>
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
