'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { PageHeader, ListToolbar, TableCard, EmptyState, StatusChip, th, td, tdMoney } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { shortDate, type Amounts } from '@/components/sales/sales-data';
import { AmountsList } from '@/components/sales/doc-view';

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
  /** value: a taxable value off the invoice; itemised: lines, each to an income account. */
  kind?: 'value' | 'itemised';
  lines?: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; discountPaise: number; taxRatePct: number; accountName: string | null }>;
  discount?: { percent: number | null; amountPaise: number } | null;
  referenceNumber?: string | null;
  subject?: string | null;
  salespersonName?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
}

/** What a note says beyond its row: its lines, words and figures. */
function NoteDetail({ n }: { n: CreditNoteRow }) {
  const lines = n.lines ?? [];
  const words: Array<[string, string]> = [
    ['Reference', n.referenceNumber ?? ''],
    ['Subject', n.subject ?? ''],
    ['Salesperson', n.salespersonName ?? ''],
  ].filter(([, v]) => v) as Array<[string, string]>;
  return (
    <div className="grid gap-5 bg-surface-sink/60 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        {words.length > 0 && (
          <dl className="flex flex-wrap gap-x-8 gap-y-1">
            {words.map(([k, v]) => (
              <div key={k}><dt className="text-caption text-ink-500">{k}</dt><dd className="text-body text-ink-900">{v}</dd></div>
            ))}
          </dl>
        )}
        {lines.length > 0 ? (
          <table className="w-full rounded-md bg-white">
            <thead>
              <tr className="border-b border-line-200">
                <th className={th}>Item</th>
                <th className={th}>Account</th>
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>GST</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-line-100 last:border-0">
                  <td className={td}>{l.description}{l.hsnSac && <span className="ml-2 font-mono text-caption text-ink-400">{l.hsnSac}</span>}</td>
                  <td className={`${td} text-caption text-ink-600`}>{l.accountName ?? 'Sales'}</td>
                  <td className={tdMoney}>{l.qty}</td>
                  <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
                  <td className={tdMoney}>{l.taxRatePct}%</td>
                  <td className={tdMoney}>
                    {formatPaise(l.amountPaise)}
                    {l.discountPaise > 0 && <span className="block text-caption text-ink-500">less {formatPaise(l.discountPaise)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-caption text-ink-500">By value: the taxable value taken off the invoice, tax in its proportions.</p>
        )}
        {n.notes && <p className="whitespace-pre-line text-body text-ink-700"><span className="text-caption text-ink-500">Notes: </span>{n.notes}</p>}
        {n.termsAndConditions && <p className="whitespace-pre-line text-body text-ink-700"><span className="text-caption text-ink-500">Terms: </span>{n.termsAndConditions}</p>}
      </div>
      <AmountsList amounts={n.amountsPaise} discount={n.discount} subTotalPaise={lines.reduce((s, l) => s + l.amountPaise, 0) || undefined} />
    </div>
  );
}

/** Credit notes raised against invoices: returns, discounts after the sale, corrections. Each one posts when raised. */
export default function CreditNotesPage() {
  const notes = useQuery({ queryKey: ['sales', 'credit-notes'], queryFn: () => api.get<CreditNoteRow[]>('/sales/credit-notes') });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  /** The note whose lines and words show under its row. */
  const [open, setOpen] = useState<string | null>(null);

  const all = notes.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((n) => filter === 'all' || n.status === filter)
    .filter((n) => !q || [n.noteNumber, n.invoiceNumber, n.customerName, n.reason, n.subject, n.referenceNumber].some((v) => v?.toLowerCase().includes(q)));
  const total = rows.filter((n) => n.status === 'posted').reduce((s, n) => s + n.totalPaise, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        guide="creditNotes"
        title="Credit notes"
        subtitle="What you took back off an invoice after it was posted: line by line, each at its own GST rate, or a taxable value with tax in the invoice's proportions. Open a note to see its lines."
        actions={<Button asChild><Link href="/sales/credit-notes/new"><Plus size={14} /> New credit note</Link></Button>}
      />

      {!notes.isLoading && !notes.isError && all.length === 0 ? (
        <EmptyState
          guide="creditNotes"
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
                  rows.flatMap((n) => {
                    const isOpen = open === n._id;
                    return [
                      <tr key={n._id} className="cursor-pointer border-b border-line-100 last:border-0 hover:bg-surface-sink" onClick={() => setOpen(isOpen ? null : n._id)} aria-expanded={isOpen}>
                        <td className={`${td} whitespace-nowrap text-caption text-ink-600`}>
                          <span className="inline-flex items-center gap-1">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{shortDate(n.noteDate)}</span>
                        </td>
                        <td className={`${td} font-mono text-caption`}>{n.noteNumber}</td>
                        <td className={td}>
                          <Link href={`/sales/invoices/${n.invoiceId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-caption hover:underline">{n.invoiceNumber ?? 'Open the invoice'}</Link>
                        </td>
                        <td className={`${td} font-medium`}>{n.customerName}</td>
                        <td className={`${td} text-caption text-ink-600`}>
                          {n.reason}
                          {n.subject && <span className="block text-ink-500">{n.subject}</span>}
                          <span className="block text-ink-400">{n.kind === 'itemised' ? `${n.lines?.length ?? 0} line${n.lines?.length === 1 ? '' : 's'}` : 'By value'}</span>
                        </td>
                        <td className={td}><StatusChip tone={n.status === 'posted' ? 'success' : 'neutral'}>{n.status === 'posted' ? 'Posted' : 'Reversed'}</StatusChip></td>
                        <td className={tdMoney}>{formatPaise(n.totalPaise)}</td>
                      </tr>,
                      ...(isOpen
                        ? [
                            <tr key={`${n._id}-detail`} className="border-b border-line-100">
                              <td colSpan={7} className="p-0"><NoteDetail n={n} /></td>
                            </tr>,
                          ]
                        : []),
                    ];
                  })
                )}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </div>
  );
}
