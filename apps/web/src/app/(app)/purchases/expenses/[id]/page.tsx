'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { DetailGrid, PageHeader, Section, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { useProjects } from '@/components/projects/project-select';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { HistoryLink, Line, errorText, shortDate, useLedgerRefresh } from '@/components/purchases/purchase-data';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import type { ExpenseRow } from '@/components/purchases/expense-form';

interface JournalView {
  _id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  reversedBy?: string;
  lines: Array<{ accountName: string; description: string; debitPaise: number; creditPaise: number }>;
}

/** The voucher an expense posted: each line, debit and credit. */
function PostedVoucher({ journalId }: { journalId: string }) {
  const j = useQuery({ queryKey: ['journals', journalId, 'full'], queryFn: () => api.get<JournalView>(`/journals/${journalId}`) });
  if (j.isError) return <p className="text-caption text-error-fg">Couldn&apos;t load the voucher.</p>;
  if (!j.data) return <p className="text-caption text-ink-400">Loading…</p>;
  return (
    <Section
      title={<>Posted as <span className="font-mono">{j.data.voucherNumber}</span></>}
      description={`${j.data.voucherType === 'PAYMENT' ? 'Payment voucher' : j.data.voucherType} dated ${shortDate(j.data.date)}. To correct it, reverse it from All vouchers and enter the expense again.`}
      actions={j.data.reversedBy ? <StatusChip tone="neutral">Reversed</StatusChip> : <StatusChip tone="success">Posted</StatusChip>}
    >
      <TableCard>
        <table className="w-full">
          <thead className="border-b border-line-200 bg-surface-sink">
            <tr>
              <th className={th}>Account</th>
              <th className={`${th} text-right`}>Debit</th>
              <th className={`${th} text-right`}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {j.data.lines.map((l, i) => (
              <tr key={i} className="border-b border-line-100 last:border-0">
                <td className={td}>{l.accountName || l.description}</td>
                <td className={tdMoney}>{l.debitPaise ? formatPaise(l.debitPaise) : ''}</td>
                <td className={tdMoney}>{l.creditPaise ? formatPaise(l.creditPaise) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Link href="/vouchers" className="mt-3 inline-block text-caption font-medium text-ink-600 hover:underline">Open All vouchers</Link>
    </Section>
  );
}

/** One expense: what was paid, from where, the GST, and the voucher once posted. */
export default function ExpensePage() {
  const { id } = useParams<{ id: string }>();
  const refresh = useLedgerRefresh();
  const projects = useProjects();
  const [held, setHeld] = useState<string | null>(null);
  const expense = useQuery({ queryKey: ['direct-expenses', id], queryFn: () => api.get<ExpenseRow>(`/direct-expenses/${id}`) });

  const post = useMutation({
    mutationFn: () => api.post(`/direct-expenses/${id}/post`),
    onSuccess: () => {
      setHeld(null);
      notify('Posted to ledger');
      refresh();
      void expense.refetch();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setHeld(e.message);
        notify(e.message, 'info');
      } else notify(errorText(e, "Couldn't post the expense."), 'error');
    },
  });

  if (expense.isError) return <QueryError error={expense.error} onRetry={() => void expense.refetch()} />;
  const e = expense.data;
  if (!e) return <p className="text-caption text-ink-400">Loading…</p>;
  const tax = e.cgstPaise + e.sgstPaise + e.igstPaise;
  const project = e.projectId ? projects.data?.find((p) => p.id === e.projectId)?.name ?? 'A project' : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Expense <span className="font-mono">{e.number}</span></>}
        meta={e.status === 'posted' ? <StatusChip tone="success">Posted</StatusChip> : <StatusChip tone="pending">Draft</StatusChip>}
        subtitle={`${e.expenseAccountName} · paid ${shortDate(e.date)} from ${e.paidThroughAccountName}`}
        back={{ href: '/purchases/expenses', label: 'Expenses' }}
        actions={
          <>
            <HistoryLink entityType="DirectExpense" entityId={e._id} />
            {e.status === 'draft' && (
              <>
                <Button variant="secondary" asChild><Link href={`/purchases/expenses/${e._id}/edit`}><Pencil size={14} /> Edit expense</Link></Button>
                <Button disabled={post.isPending} onClick={() => post.mutate()}>{post.isPending ? 'Posting…' : 'Post to ledger'}</Button>
              </>
            )}
          </>
        }
      />

      {held && e.status === 'draft' && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
          {held} It posts when approved, on the <Link href="/approvals" className="underline">Approvals</Link> page.
        </p>
      )}
      {e.recurringTemplateId && e.status === 'draft' && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
          Drafted by a <Link href="/purchases/recurring-expenses" className="underline">recurring expense</Link>. Check this month&apos;s amount, then post it.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Details" className="lg:col-span-2">
          <DetailGrid
            items={[
              ['Date', shortDate(e.date)],
              ['Expense account', e.expenseAccountName],
              ['Paid through', e.paidThroughAccountName],
              ['Vendor', e.vendorId ? <Link key="v" href={`/purchases/vendors/${e.vendorId}`} className="hover:underline">{e.vendorName}</Link> : null],
              ['Supplier GSTIN', e.vendorGstin ? <span key="g" className="font-mono">{e.vendorGstin}</span> : null],
              ['Reference', e.reference],
              ['Project', project],
              ['Notes', e.notes],
            ]}
          />
        </Section>
        <Section title="Amount">
          <Line label="Before tax"><span className="font-mono">{formatPaise(e.taxablePaise)}</span></Line>
          {e.cgstPaise > 0 && <Line label={`CGST ${e.gstRatePct / 2}%`}><span className="font-mono">{formatPaise(e.cgstPaise)}</span></Line>}
          {e.sgstPaise > 0 && <Line label={`SGST ${e.gstRatePct / 2}%`}><span className="font-mono">{formatPaise(e.sgstPaise)}</span></Line>}
          {e.igstPaise > 0 && <Line label={`IGST ${e.gstRatePct}%`}><span className="font-mono">{formatPaise(e.igstPaise)}</span></Line>}
          <Line label="Paid" strong><span className="font-mono">{formatPaise(e.totalPaise)}</span></Line>
          {tax > 0 && <p className="mt-2 text-caption text-ink-500">{e.claimable ? 'The GST goes to input credit.' : 'The GST is not claimed: it is part of the expense.'}</p>}
        </Section>
      </div>

      {e.journalId ? (
        <PostedVoucher journalId={e.journalId} />
      ) : (
        <Section title="In the ledger">
          <p className="text-body text-ink-600">Not posted yet. Posting makes one payment voucher: the expense{e.claimable && tax > 0 ? ' and input GST' : ''} debited, {e.paidThroughAccountName} credited.</p>
        </Section>
      )}

      <AttachmentsSection entityType="DirectExpense" entityId={e._id} />
    </div>
  );
}
