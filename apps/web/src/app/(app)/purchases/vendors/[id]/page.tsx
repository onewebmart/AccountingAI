'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { DetailGrid, PageHeader, Section, StatusChip, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { BillStatusChip, HistoryLink, Line, TDS_SECTIONS, dueInfo, shortDate, useBills, type VendorRecord } from '@/components/purchases/purchase-data';

/** A vendor: who they are, where they are paid, what you owe them, and their bills. */
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const vendor = useQuery({ queryKey: ['purchase', 'vendor', id], queryFn: () => api.get<VendorRecord>(`/purchase/vendors/${id}`) });
  const owed = useQuery({ queryKey: ['purchase', 'vendor', id, 'outstanding'], queryFn: () => api.get<{ paise: number }>(`/purchase/vendors/${id}/outstanding`) });
  const advances = useQuery({ queryKey: ['payments', 'advances', 'payment'], queryFn: () => api.get<Array<{ partyId: string; unappliedPaise: number }>>('/payments/advances?kind=payment') });
  const bills = useBills();

  if (vendor.isError) return <QueryError error={vendor.error} onRetry={() => void vendor.refetch()} />;
  const v = vendor.data;
  if (!v) return <p className="text-caption text-ink-400">Loading…</p>;

  const theirs = (bills.data ?? []).filter((b) => b.vendorId === id);
  const open = theirs.filter((b) => b.status === 'posted' && b.outstandingPaise > 0);
  const late = open.filter((b) => dueInfo(b.dueDate)?.tone === 'late');
  const msmeLate = open.filter((b) => b.msmeLate);
  const advance = (advances.data ?? []).find((a) => a.partyId === id)?.unappliedPaise ?? 0;
  const tds = TDS_SECTIONS.find((s) => s.code === v.tdsSection);
  const protectedMsme = v.msme && v.msme.category !== 'medium' && v.msme.activity !== 'trading';

  return (
    <div className="space-y-5">
      <PageHeader
        title={v.name}
        meta={v.msme ? <StatusChip tone="neutral">MSME · {v.msme.category}</StatusChip> : undefined}
        subtitle={v.gstin ? <span className="font-mono">{v.gstin}</span> : 'Not registered for GST'}
        back={{ href: '/purchases/vendors', label: 'Vendors' }}
        actions={
          <>
            <HistoryLink entityType="Vendor" entityId={v._id} />
            <Button variant="secondary" asChild>
              <Link href={`/purchases/vendors/${v._id}/edit`}><Pencil size={14} /> Edit vendor</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/purchases/payments-made/new?vendorId=${v._id}`}>Record payment</Link>
            </Button>
            <Button asChild>
              <Link href={`/purchases/bills/new?vendorId=${v._id}`}><Plus size={14} /> New bill</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="What you owe" className="lg:col-span-1">
          <p className="font-mono text-h2 tabular-nums text-ink-900">{formatPaise(owed.data?.paise ?? 0)}</p>
          <div className="mt-3">
            <Line label="Open bills">{open.length}</Line>
            <Line label="Late">{late.length ? <span className="text-error-fg">{late.length}</span> : 0}</Line>
            {advance > 0 && (
              <Line label="Advance or credit held">
                <Link href="/purchases/payments-made" className="font-mono text-pending-fg hover:underline">{formatPaise(advance)}</Link>
              </Line>
            )}
          </div>
          {msmeLate.length > 0 && (
            <p className="mt-3 rounded-md border border-error-fg/30 bg-error-bg px-3 py-2 text-caption text-error-fg">
              {msmeLate.length} bill{msmeLate.length === 1 ? ' is' : 's are'} past the MSME pay-by day. Under 43B(h) the expense is deductible only in the year it is paid.
            </p>
          )}
        </Section>

        <Section title="Details" className="lg:col-span-2">
          <DetailGrid
            items={[
              ['Email', v.email],
              ['Phone', v.phone],
              ['City', v.city],
              ['Address', v.address],
              ['Pincode', v.pincode ? <span className="font-mono">{v.pincode}</span> : null],
              ['PAN', v.pan ? <span className="font-mono">{v.pan}</span> : null],
              ['TDS', v.tdsSection ? `${v.tdsSection}${tds ? ` · ${tds.label}` : ''} · ${(v.tdsRateBps ?? 0) / 100}%` : 'No TDS'],
              ['Notes', v.notes],
            ]}
          />
        </Section>
      </div>

      <Section title="Payment details" description="A changed bank account is worth a call to the vendor, on a number you already have, before the next payment.">
        <DetailGrid
          items={[
            [
              'Bank account',
              v.bankAccount ? (
                <span className="font-mono">
                  ••••{v.bankAccount.accountNumber.slice(-4)} · {v.bankAccount.ifsc}
                  {v.bankAccount.bankName ? ` · ${v.bankAccount.bankName}` : ''}
                </span>
              ) : (
                <span className="text-ink-400">Not on file</span>
              ),
            ],
            ['Account name', v.bankAccount?.accountName ?? null],
            [
              'MSME',
              v.msme ? (
                <span>
                  <span className="font-mono">{v.msme.udyamNumber}</span> · <span className="capitalize">{v.msme.category}, {v.msme.activity}</span>
                  {protectedMsme && <span className="block text-caption text-pending-fg">Pay within {v.msme.writtenAgreement ? 'the agreed days, at most 45' : '15 days'} (43B(h))</span>}
                </span>
              ) : (
                <span className="text-ink-400">Not registered, or not known</span>
              ),
            ],
          ]}
        />
      </Section>

      <Section title="Bills" actions={<Link href={`/purchases/bills/new?vendorId=${v._id}`} className="text-caption font-medium text-ink-600 hover:underline">New bill</Link>}>
        {theirs.length === 0 ? (
          <p className="text-caption text-ink-500">No bills from {v.name} yet.</p>
        ) : (
          <TableCard>
            <table className="w-full">
              <thead className="border-b border-line-200 bg-surface-sink">
                <tr>
                  <th className={th}>Bill</th>
                  <th className={th}>Date</th>
                  <th className={th}>Due</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {theirs.map((b) => {
                  const due = b.status === 'posted' ? dueInfo(b.dueDate) : null;
                  return (
                    <tr key={b._id} className={rowLink} onClick={() => router.push(`/purchases/bills/${b._id}`)}>
                      <td className={`${td} font-mono text-caption`}>{b.billNumber ?? 'No number'}</td>
                      <td className={`${td} text-caption`}>{shortDate(b.billDate)}</td>
                      <td className={`${td} text-caption`}>{due ? <span className={due.tone === 'late' ? 'text-error-fg' : due.tone === 'soon' ? 'text-pending-fg' : 'text-ink-600'}>{due.label}</span> : '—'}</td>
                      <td className={td}><BillStatusChip status={b.status} /></td>
                      <td className={tdMoney}>{formatPaise(b.totalPaise)}</td>
                      <td className={tdMoney}>{b.status === 'posted' ? formatPaise(b.outstandingPaise) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section>
        <AttachmentsSection entityType="Vendor" entityId={v._id} />
      </Section>
    </div>
  );
}
