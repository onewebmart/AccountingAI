'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { DetailGrid, PageHeader, Section, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { AttachmentsSection } from '@/components/shell/attachments-section';
import { ConfirmDialog, Notice, errorText, isApprovalHold, shortDate } from '@/components/accountant/common';
import { VOUCHER_TYPE_LABELS, type JournalItem } from '@/components/accountant/journal-types';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

/** One voucher: its lines, its status, its files, and Reverse. Nothing here edits it. */
export default function ManualJournalPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [reversal, setReversal] = useState<JournalItem | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['journals', 'one', id], queryFn: () => api.get<JournalItem>(`/journals/${id}`) });
  const reverse = useMutation({
    mutationFn: () => api.post<JournalItem>(`/journals/${id}/reverse`),
    onSuccess: (r) => {
      setConfirming(false);
      setReversal(r);
      void qc.invalidateQueries({ queryKey: ['journals'] });
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      notify('Journal reversed');
    },
    onError: (err) => {
      setConfirming(false);
      if (isApprovalHold(err)) {
        setHeld(err.message);
        notify('Sent for approval', 'info');
      } else {
        notify(errorText(err, "Couldn't reverse the journal."), 'error');
      }
    },
  });

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading the voucher…</p>;

  const j = q.data;
  const reversed = j.status === 'reversed';
  return (
    <div className="space-y-5">
      {confirming && (
        <ConfirmDialog
          title="Reverse journal"
          destructive
          busy={reverse.isPending}
          confirmLabel="Reverse journal"
          onCancel={() => setConfirming(false)}
          onConfirm={() => reverse.mutate()}
          body={
            <>
              <p>This posts a reversing entry, dated today, that cancels <span className="font-mono text-ink-900">{j.voucherNumber}</span>. The original stays in the books as it was posted.</p>
              <p className="mt-2 text-caption text-ink-500">To correct an amount or an account, reverse it, then post the journal again.</p>
            </>
          }
        />
      )}

      <PageHeader
        title={<span className="font-mono">{j.voucherNumber}</span>}
        back={{ href: '/accountant/manual-journals', label: 'Manual journals' }}
        meta={reversed ? <StatusChip tone="neutral">Reversed{j.reversedBy ? ` by ${j.reversedBy}` : ''}</StatusChip> : <StatusChip tone="success">Posted</StatusChip>}
        subtitle={j.description !== '—' ? j.description : undefined}
        actions={
          !reversed && !reversal ? (
            <Button variant="secondary" onClick={() => setConfirming(true)} disabled={reverse.isPending}>
              <RotateCcw size={14} /> Reverse journal
            </Button>
          ) : undefined
        }
      />

      {reversal && (
        <Notice tone="success">
          Reversed by <Link href={`/accountant/manual-journals/${reversal._id}`} className="font-mono underline">{reversal.voucherNumber}</Link>. Post the corrected journal from <Link href="/accountant/manual-journals/new" className="underline">New journal</Link>.
        </Notice>
      )}
      {held && <Notice tone="pending">{held} <Link href="/approvals" className="underline">Open approvals</Link></Notice>}

      <Section>
        <DetailGrid
          items={[
            ['Date', shortDate(j.date)],
            ['Type', VOUCHER_TYPE_LABELS[j.voucherType] ?? j.voucherType],
            ['Financial year', j.financialYear],
            ['Amount', <span key="a" className="font-mono">{formatPaise(j.totalDebitPaise)}</span>],
          ]}
        />
      </Section>

      <Section title="Lines">
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Account</th>
                <th className={th}>Description</th>
                <th className={`${th} text-right`}>Debit</th>
                <th className={`${th} text-right`}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {j.lines.map((l, i) => (
                <tr key={i} className="border-b border-line-100 last:border-0">
                  <td className={td}>{l.accountName}</td>
                  <td className={`${td} text-ink-600`}>{l.description && l.description !== l.accountName ? l.description : ''}</td>
                  <td className={tdMoney}>{l.debitPaise ? formatPaise(l.debitPaise) : ''}</td>
                  <td className={tdMoney}>{l.creditPaise ? formatPaise(l.creditPaise) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-200 bg-surface-sink">
                <td className={`${td} font-medium`} colSpan={2}>Total</td>
                <td className={`${tdMoney} font-medium`}>{formatPaise(j.totalDebitPaise)}</td>
                <td className={`${tdMoney} font-medium`}>{formatPaise(j.totalCreditPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </TableCard>
      </Section>

      <Section>
        <AttachmentsSection entityType="Journal" entityId={j._id} />
      </Section>
    </div>
  );
}
