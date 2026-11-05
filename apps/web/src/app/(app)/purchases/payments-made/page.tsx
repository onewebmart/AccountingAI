'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { ListToolbar, PageHeader, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { shortDate } from '@/components/purchases/purchase-data';
import { VendorAdvances } from '@/components/purchases/vendor-advances';

/** GET /payments?kind=payment — one payment to a vendor, across the bills it settles. */
interface PartyPayment {
  _id: string;
  partyId: string;
  partyName: string;
  date: string;
  amountPaise: number;
  via: 'bank' | 'cash' | 'gateway';
  source: 'money' | 'credit_note' | 'debit_note';
  reference: string | null;
  allocations: Array<{ documentId: string; documentNumber: string | null; amountPaise: number }>;
  unappliedPaise: number;
  refunds: Array<{ amountPaise: number; date: string }>;
  status: 'posted' | 'reversed';
}

/** GET /journals?voucherType=PAYMENT — every payment voucher, however it was made. */
interface PaymentVoucher {
  _id: string;
  voucherNumber: string;
  date: string;
  description: string;
  totalDebitPaise: number;
  status: string;
  reversedBy?: string;
}

type View = 'vendors' | 'vouchers';

/** Money paid out: to vendors across their bills, and every payment voucher in the books. */
export default function PaymentsMadePage() {
  const [view, setView] = useState<View>('vendors');
  const [search, setSearch] = useState('');
  const payments = useQuery({ queryKey: ['payments', 'list', 'payment'], queryFn: () => api.get<PartyPayment[]>('/payments?kind=payment') });
  const vouchers = useQuery({
    queryKey: ['journals', 'list', 'PAYMENT'],
    queryFn: () => api.get<{ data: PaymentVoucher[] }>('/journals?voucherType=PAYMENT'),
    enabled: view === 'vouchers',
    retry: false,
  });
  const q = search.trim().toLowerCase();

  const rows = (payments.data ?? []).filter((p) => !q || [p.partyName, p.reference, ...p.allocations.map((a) => a.documentNumber)].some((s) => s?.toLowerCase().includes(q)));
  const voucherRows = (vouchers.data?.data ?? []).filter((v) => !q || [v.voucherNumber, v.description].some((s) => s?.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments made"
        subtitle="Money out to vendors. One payment can settle several bills; what is left over is held as an advance."
        actions={
          <>
            <Button variant="secondary" asChild><Link href="/purchases/payment-runs">Payment runs</Link></Button>
            <Button asChild><Link href="/purchases/payments-made/new"><Plus size={14} /> Record payment</Link></Button>
          </>
        }
      />

      <VendorAdvances />

      <div>
        <ListToolbar
          search={search}
          onSearch={setSearch}
          placeholder={view === 'vendors' ? 'Search vendor, reference or bill' : 'Search voucher or narration'}
          filters={{ value: view, onChange: (v) => setView(v as View), options: [['vendors', 'Payments to vendors'], ['vouchers', 'All payment vouchers']] }}
        />
        {view === 'vendors' ? (
          <TableCard>
            <table className="w-full">
              <thead className="border-b border-line-200 bg-surface-sink">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Vendor</th>
                  <th className={th}>Paid through</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Bills paid</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Held</th>
                </tr>
              </thead>
              <tbody>
                {payments.isLoading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : payments.isError ? (
                  <TableError error={payments.error} colSpan={7} onRetry={() => void payments.refetch()} />
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-500">
                      No payments across bills yet. A payment recorded on a single bill shows on that bill, and under All payment vouchers.
                    </td>
                  </tr>
                ) : (
                  rows.map((p) => (
                    <tr key={p._id} className="border-b border-line-100 last:border-0">
                      <td className={`${td} text-caption`}>{shortDate(p.date)}</td>
                      <td className={td}>
                        <Link href={`/purchases/vendors/${p.partyId}`} className="hover:underline">{p.partyName}</Link>
                        {p.status === 'reversed' && <span className="ml-2"><StatusChip tone="neutral">Reversed</StatusChip></span>}
                      </td>
                      <td className={`${td} text-caption capitalize`}>{p.source === 'debit_note' ? 'Debit note credit' : p.via}</td>
                      <td className={`${td} text-caption text-ink-600`}>{p.reference ?? '—'}</td>
                      <td className={`${td} text-caption`}>
                        {p.allocations.length === 0 ? (
                          <span className="text-ink-400">None yet</span>
                        ) : (
                          p.allocations.map((a, i) => (
                            <span key={`${a.documentId}:${i}`} className="mr-2 inline-block">
                              <Link href={`/purchases/bills/${a.documentId}`} className="font-mono hover:underline">{a.documentNumber ?? 'Bill'}</Link> <span className="text-ink-500">{formatPaise(a.amountPaise)}</span>
                            </span>
                          ))
                        )}
                      </td>
                      <td className={tdMoney}>{formatPaise(p.amountPaise)}</td>
                      <td className={tdMoney}>{p.unappliedPaise > 0 ? <span className="text-pending-fg">{formatPaise(p.unappliedPaise)}</span> : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        ) : (
          <TableCard>
            <table className="w-full">
              <thead className="border-b border-line-200 bg-surface-sink">
                <tr>
                  <th className={th}>Voucher</th>
                  <th className={th}>Date</th>
                  <th className={th}>Narration</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.isLoading ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
                ) : vouchers.isError ? (
                  <TableError error={vouchers.error} colSpan={5} onRetry={() => void vouchers.refetch()} />
                ) : voucherRows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-caption text-ink-500">No payment vouchers yet.</td></tr>
                ) : (
                  voucherRows.map((v) => (
                    <tr key={v._id} className="border-b border-line-100 last:border-0">
                      <td className={`${td} font-mono text-caption`}>{v.voucherNumber}</td>
                      <td className={`${td} text-caption`}>{shortDate(v.date)}</td>
                      <td className={`${td} text-caption text-ink-700`}>{v.description}</td>
                      <td className={td}>{v.reversedBy ? <StatusChip tone="neutral">Reversed</StatusChip> : <StatusChip tone="success">Posted</StatusChip>}</td>
                      <td className={tdMoney}>{formatPaise(v.totalDebitPaise)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        )}
        {view === 'vouchers' && <p className="mt-2 text-caption text-ink-500">Includes payments on single bills, payment runs, expenses and reimbursements. Open <Link href="/vouchers" className="underline">All vouchers</Link> to reverse one.</p>}
      </div>
    </div>
  );
}
