'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, th, td, tdMoney, rowLink } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AgeingBuckets } from '@/components/shell/ageing-buckets';
import { DocumentUploadButton } from '@/components/shell/document-upload-button';
import { formatPaise } from '@/lib/gst';
import { shortDate, todayIst, useInvoices } from '@/components/sales/sales-data';
import { InvoiceStatusChip, SourceChip } from '@/components/sales/status';

const FILTERS: Array<[string, string]> = [
  ['all', 'All'],
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['posted', 'Posted'],
  ['paid', 'Paid'],
  ['overdue', 'Overdue'],
];

/** Every invoice, what is still owed on each, and how late the rest is. */
export default function InvoicesPage() {
  const router = useRouter();
  const invoices = useInvoices();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const today = todayIst();

  const all = invoices.data ?? [];
  const q = search.trim().toLowerCase();
  const isOverdue = (i: (typeof all)[number]) => (i.status === 'posted' || i.status === 'sent') && i.outstandingPaise > 0 && !!i.dueDate && i.dueDate < today;
  const rows = all
    .filter((i) => (filter === 'all' ? true : filter === 'overdue' ? isOverdue(i) : i.status === filter))
    .filter((i) => !q || [i.customerName, i.invoiceNumber, i.customerGstin].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        subtitle="What you have billed, and what is still owed. A draft reaches the ledger when you post it."
        actions={
          <>
            {/* Two ways in: let the pipeline read an upload into the review queue, or type it. */}
            <DocumentUploadButton label="Upload invoice" onUploaded={(m) => notify(m, 'info')} />
            <Button asChild variant="secondary"><Link href="/sales/payments-received/new">Record receipt</Link></Button>
            <Button asChild><Link href="/sales/invoices/new"><Plus size={14} /> New invoice</Link></Button>
          </>
        }
      />

      <div>
        <p className="mb-2 text-caption text-ink-500">Still owed, by days past the due date</p>
        <AgeingBuckets kind="receivable" />
      </div>

      {!invoices.isLoading && !invoices.isError && all.length === 0 ? (
        <EmptyState
          title="Create your first invoice"
          body="Pick the customer, add the lines, and save it as a draft. Post it when it is right."
          action={<Button asChild><Link href="/sales/invoices/new"><Plus size={14} /> New invoice</Link></Button>}
        />
      ) : (
        <div>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search customer, number or GSTIN" filters={{ value: filter, onChange: setFilter, options: FILTERS }} />
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>Invoice no.</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Due</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {invoices.isLoading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : invoices.isError ? (
                  <TableError error={invoices.error} colSpan={7} onRetry={() => void invoices.refetch()} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">No invoices match.</td></tr>
                ) : (
                  rows.map((i) => (
                    <tr key={i._id} className={rowLink} onClick={() => router.push(`/sales/invoices/${i._id}`)}>
                      <td className={`${td} whitespace-nowrap text-caption text-ink-600`}>{shortDate(i.invoiceDate)}</td>
                      <td className={td}>
                        <span className="flex items-center gap-2">
                          <Link href={`/sales/invoices/${i._id}`} className="font-mono text-caption hover:underline" onClick={(e) => e.stopPropagation()}>
                            {i.invoiceNumber ?? <span className="text-ink-400">Not numbered</span>}
                          </Link>
                          <SourceChip documentId={i.sourceDocumentId} recurring={!!i.recurringTemplateId} />
                          {i.paymentLink?.status === 'paid' && <span className="rounded bg-pending-bg px-1.5 py-0.5 text-[10px] font-medium text-pending-fg">Paid online · confirm</span>}
                        </span>
                      </td>
                      <td className={`${td} font-medium`}>{i.customerName}</td>
                      <td className={`${td} whitespace-nowrap text-caption ${isOverdue(i) ? 'text-error-fg' : 'text-ink-600'}`}>{shortDate(i.dueDate)}</td>
                      <td className={td}><InvoiceStatusChip status={i.status} /></td>
                      <td className={tdMoney}>{formatPaise(i.totalPaise)}</td>
                      <td className={`${tdMoney} ${i.status === 'draft' || i.outstandingPaise === 0 ? 'text-ink-400' : 'text-pending-fg'}`}>
                        {i.status === 'draft' ? '—' : formatPaise(i.outstandingPaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
          {all.length >= 200 && <p className="mt-2 text-caption text-ink-500">Showing the latest 200 invoices.</p>}
        </div>
      )}
    </div>
  );
}
