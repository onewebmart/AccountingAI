'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, Section, StatusChip, th, td, tdMoney } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AdvancesPanel } from '@/components/payments/advances-panel';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { shortDate, useInvoices } from '@/components/sales/sales-data';

/** GET /payments?kind=receipt — one receipt, however many invoices it settled. */
interface Receipt {
  _id: string;
  partyId: string;
  partyName: string;
  date: string;
  amountPaise: number;
  tdsPaise: number;
  via: 'bank' | 'cash' | 'gateway';
  source: 'money' | 'credit_note' | 'debit_note';
  reference: string | null;
  refunds: Array<{ amountPaise: number; date: string; via: 'bank' | 'cash' }>;
  allocations: Array<{ documentId: string; documentNumber: string | null; amountPaise: number; tdsPaise: number; appliedOn: string }>;
  unappliedPaise: number;
  status: 'posted' | 'reversed';
}

const VIA: Record<Receipt['via'], string> = { bank: 'Bank', cash: 'Cash', gateway: 'Online' };

/**
 * Money received from customers, and what each receipt settled. Money that
 * arrived before its invoice is held as an advance: apply it or refund it
 * below. Foreign-currency invoices are received from the invoice itself.
 */
export default function PaymentsReceivedPage() {
  const receipts = useQuery({ queryKey: ['payments', 'list', 'receipt'], queryFn: () => api.get<Receipt[]>('/payments?kind=receipt') });
  const invoices = useInvoices();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const all = receipts.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((r) => (filter === 'advance' ? r.status === 'posted' && r.unappliedPaise > 0 : filter === 'reversed' ? r.status === 'reversed' : true))
    .filter((r) => !q || [r.partyName, r.reference, ...r.allocations.map((a) => a.documentNumber)].some((v) => v?.toLowerCase().includes(q)));
  // Open invoices an advance can be applied to.
  const openDocuments = (invoices.data ?? [])
    .filter((d) => d.status === 'posted' && d.outstandingPaise > 0)
    .map((d) => ({ id: d._id, partyId: d.customerId ?? null, number: d.invoiceNumber, date: d.invoiceDate, owedPaise: d.outstandingPaise }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments received"
        subtitle="Money in from customers, and the invoices each receipt settled."
        actions={<Button asChild><Link href="/sales/payments-received/new"><Plus size={14} /> Record receipt</Link></Button>}
      />

      <div id="advances">
        <AdvancesPanel kind="receipt" documents={openDocuments} onDone={(m) => notify(m)} />
      </div>

      {!receipts.isLoading && !receipts.isError && all.length === 0 ? (
        <EmptyState
          title="No receipts yet"
          body="Record money in from a customer: one receipt can settle several invoices, and anything left over is held as an advance."
          action={<Button asChild><Link href="/sales/payments-received/new"><Plus size={14} /> Record receipt</Link></Button>}
        />
      ) : (
        <div>
          <ListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search customer, reference or invoice"
            filters={{ value: filter, onChange: setFilter, options: [['all', 'All'], ['advance', 'Holds an advance'], ['reversed', 'Reversed']] }}
          />
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Through</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Settled</th>
                  <th className={`${th} text-right`}>Received</th>
                  <th className={`${th} text-right`}>TDS</th>
                  <th className={`${th} text-right`}>Held</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {receipts.isLoading ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : receipts.isError ? (
                  <TableError error={receipts.error} colSpan={9} onRetry={() => void receipts.refetch()} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-caption text-ink-400">No receipts match.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r._id} className={`border-b border-line-100 align-top last:border-0 ${r.status === 'reversed' ? 'opacity-60' : ''}`}>
                      <td className={`${td} whitespace-nowrap text-caption text-ink-600`}>{shortDate(r.date)}</td>
                      <td className={`${td} font-medium`}>
                        <Link href={`/sales/customers/${r.partyId}`} className="hover:underline">{r.partyName}</Link>
                        {r.source === 'credit_note' && <p className="text-[0.7rem] font-normal text-ink-500">Credit from a credit note</p>}
                      </td>
                      <td className={`${td} text-caption`}>{r.source === 'money' ? VIA[r.via] : '—'}</td>
                      <td className={`${td} max-w-[12rem] truncate text-caption text-ink-600`} title={r.reference ?? undefined}>{r.reference ?? '—'}</td>
                      <td className={`${td} text-caption`}>
                        {r.allocations.length === 0 ? (
                          <span className="text-ink-400">Nothing yet</span>
                        ) : (
                          <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                            {r.allocations.map((a, i) => (
                              <Link key={`${a.documentId}-${i}`} href={`/sales/invoices/${a.documentId}`} className="font-mono hover:underline" title={`${formatPaise(a.amountPaise)}${a.tdsPaise ? ` + TDS ${formatPaise(a.tdsPaise)}` : ''} on ${shortDate(a.appliedOn)}`}>
                                {a.documentNumber ?? 'Invoice'}
                              </Link>
                            ))}
                          </span>
                        )}
                        {r.refunds.length > 0 && <p className="text-[0.7rem] text-ink-500">Refunded {formatPaise(r.refunds.reduce((s, x) => s + x.amountPaise, 0))}</p>}
                      </td>
                      <td className={tdMoney}>{formatPaise(r.amountPaise)}</td>
                      <td className={`${tdMoney} ${r.tdsPaise ? '' : 'text-ink-400'}`}>{r.tdsPaise ? formatPaise(r.tdsPaise) : '—'}</td>
                      <td className={`${tdMoney} ${r.unappliedPaise > 0 && r.status === 'posted' ? 'text-pending-fg' : 'text-ink-400'}`}>{r.unappliedPaise ? formatPaise(r.unappliedPaise) : '—'}</td>
                      <td className={td}><StatusChip tone={r.status === 'posted' ? 'success' : 'neutral'}>{r.status === 'posted' ? 'Posted' : 'Reversed'}</StatusChip></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
          {all.length >= 200 && <p className="mt-2 text-caption text-ink-500">Showing the latest 200 receipts.</p>}
        </div>
      )}

      <Section title="Received in a foreign currency?" description="Export invoices are received in their currency at the day's rate, from the invoice: open it and choose Mark paid.">
        <Link href="/sales/invoices" className="text-caption font-medium text-ink-600 hover:underline">Go to invoices</Link>
      </Section>
    </div>
  );
}
