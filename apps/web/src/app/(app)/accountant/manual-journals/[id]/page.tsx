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
import { useProjects } from '@/components/projects/project-select';
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
  const projects = useProjects();
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
  const withProject = j.lines.some((l) => l.projectId);
  const withContact = j.lines.some((l) => l.contact);
  const projectName = (pid: string) => projects.data?.find((p) => p.id === pid)?.name ?? 'A project';
  const today = new Date().toISOString().slice(0, 10);
  // A reversal set for a date: posted already, waiting for its date, or due and waiting for the next daily run.
  const scheduled = j.autoReverse && !reversed && !reversal;
  const reverseNote = j.autoReverse
    ? reversed || reversal
      ? <>Reversed on {shortDate(j.autoReverse.on)}{j.reversedById ? <> by <Link href={`/accountant/manual-journals/${j.reversedById}`} className="font-mono underline">{j.reversedBy}</Link></> : null}</>
      : j.autoReverse.on > today
        ? <>Reverses on {shortDate(j.autoReverse.on)}, in that day&apos;s 6:30 am run</>
        : <>Reversal due on {shortDate(j.autoReverse.on)}: it posts in the next daily run, once the period is open</>
    : null;
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
              {j.autoReverse && <p className="mt-2">Its reversal set for {shortDate(j.autoReverse.on)} will then not post.</p>}
              <p className="mt-2 text-caption text-ink-500">To correct an amount or an account, reverse it, then post the journal again.</p>
            </>
          }
        />
      )}

      <PageHeader
        title={<span className="font-mono">{j.journalNumber ?? j.voucherNumber}</span>}
        back={{ href: '/accountant/manual-journals', label: 'Manual journals' }}
        meta={
          <>
            {reversed ? <StatusChip tone="neutral">Reversed{j.reversedBy ? ` by ${j.reversedBy}` : ''}</StatusChip> : <StatusChip tone="success">Posted</StatusChip>}
            {scheduled && <StatusChip tone="pending">Reverses {shortDate(j.autoReverse!.on)}</StatusChip>}
          </>
        }
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

      {j.reverses && (
        <Notice tone="success">
          This entry reverses <Link href={`/accountant/manual-journals/${j.reverses.id}`} className="font-mono underline">{j.reverses.voucherNumber || 'a voucher'}</Link>.
        </Notice>
      )}

      <Section>
        <DetailGrid
          items={[
            ['Date', shortDate(j.date)],
            ['Voucher number', <span key="v" className="font-mono">{j.voucherNumber}</span>],
            ...(j.journalNumber ? [['Journal#', <span key="n" className="font-mono">{j.journalNumber}</span>] as [string, React.ReactNode]] : []),
            ['Reference#', j.reference || '—'],
            ['Type', VOUCHER_TYPE_LABELS[j.voucherType] ?? j.voucherType],
            ['Financial year', j.financialYear],
            ['Amount', <span key="a" className="font-mono">{formatPaise(j.totalDebitPaise)}</span>],
            ...(reverseNote ? [['Reverse journal date', reverseNote] as [string, React.ReactNode]] : []),
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
                {withContact && <th className={th}>Contact</th>}
                {withProject && <th className={th}>Project</th>}
                <th className={`${th} text-right`}>Debit</th>
                <th className={`${th} text-right`}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {j.lines.map((l, i) => (
                <tr key={i} className="border-b border-line-100 last:border-0">
                  <td className={td}>{l.accountName}</td>
                  <td className={`${td} text-ink-600`}>{l.description && l.description !== l.accountName ? l.description : ''}</td>
                  {withContact && (
                    <td className={`${td} text-ink-600`}>
                      {l.contact ? (
                        <Link href={l.contact.kind === 'customer' ? `/sales/customers/${l.contact.id}` : `/purchases/vendors/${l.contact.id}`} className="hover:underline">
                          {l.contact.name} <span className="text-caption text-ink-400">{l.contact.kind === 'customer' ? 'Customer' : 'Vendor'}</span>
                        </Link>
                      ) : ''}
                    </td>
                  )}
                  {withProject &&<td className={`${td} text-ink-600`}>{l.projectId ? projectName(l.projectId) : ''}</td>}
                  <td className={tdMoney}>{l.debitPaise ? formatPaise(l.debitPaise) : ''}</td>
                  <td className={tdMoney}>{l.creditPaise ? formatPaise(l.creditPaise) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-200 bg-surface-sink">
                <td className={`${td} font-medium`} colSpan={2 + (withProject ? 1 : 0) + (withContact ? 1 : 0)}>Total</td>
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
