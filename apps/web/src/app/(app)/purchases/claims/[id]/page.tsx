'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { CLAIM_STATUS, ClaimLinesEditor, claimLinesToApi, claimToEdit, type Claim, type ClaimEditLine } from '@/components/purchases/claim-lines';
import { HistoryLink, Line, Voucher, errorText, shortDate, todayIso, useExpenseAccounts } from '@/components/purchases/purchase-data';
import { getOrNull } from '@/components/sales/sales-data';

/** A draft's lines, editable by the employee who made it; saved, or saved and submitted. */
function DraftLines({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const accounts = useExpenseAccounts();
  const [lines, setLines] = useState<ClaimEditLine[]>(() => claimToEdit(claim));
  const act = useMutation({
    mutationFn: async (action: 'save' | 'submit') => {
      await api.patch(`/expense-claims/${claim._id}`, { lines: claimLinesToApi(lines) });
      if (action === 'submit') await api.post(`/expense-claims/${claim._id}/submit`, {});
      return action;
    },
    onSuccess: (action) => {
      notify(action === 'submit' ? 'Claim submitted for approval' : 'Claim saved');
      onDone();
    },
    onError: (e) => notify(errorText(e, "Couldn't save the claim."), 'error'),
  });
  return (
    <Section title="Lines" description="Attach a receipt to each line you paid for (the clip). Then submit it: someone else approves it.">
      <ClaimLinesEditor lines={lines} onChange={setLines} accounts={accounts.data} claimId={claim._id} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>{act.isPending && act.variables === 'submit' ? 'Submitting…' : 'Submit claim'}</Button>
        <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('save')}>{act.isPending && act.variables === 'save' ? 'Saving…' : 'Save claim'}</Button>
      </div>
    </Section>
  );
}

/** One claim: its lines and receipts, what the policy flagged, and its approval, posting and reimbursement. */
export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const claims = useQuery({ queryKey: ['expense-claims', id], queryFn: () => getOrNull<Claim>(`/expense-claims/${id}`) });
  const accounts = useExpenseAccounts();
  const [paidOn, setPaidOn] = useState(todayIso());
  const [held, setHeld] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['expense-claims'] });
    void qc.invalidateQueries({ queryKey: ['journals'] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  };

  const act = useMutation({
    mutationFn: (action: 'post' | 'reimburse') => api.post(`/expense-claims/${id}/${action}`, action === 'reimburse' ? { paidOn } : {}),
    onSuccess: (_r, action) => {
      setHeld(null);
      notify(action === 'post' ? 'Posted to ledger' : 'Reimbursement posted to ledger');
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setHeld(e.message);
        notify(e.message, 'info');
        refresh();
      } else notify(errorText(e, "Couldn't do that."), 'error');
    },
  });

  if (claims.isError) return <QueryError error={claims.error} onRetry={() => void claims.refetch()} />;
  if (claims.isLoading) return <p className="text-caption text-ink-400">Loading…</p>;
  const c = claims.data;
  if (!c) return <QueryError error={new Error('This claim was not found, or it is not yours to see.')} />;
  const s = CLAIM_STATUS[c.status];
  const accountName = (aid: string) => accounts.data.find((a) => a._id === String(aid))?.name ?? 'Account';

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Claim <span className="font-mono">{c.number}</span></>}
        meta={<StatusChip tone={s.tone}>{s.label}</StatusChip>}
        subtitle={`${c.employeeName} · ${c.title}`}
        back={{ href: '/purchases/claims', label: 'Employee claims' }}
        actions={
          <>
            <HistoryLink entityType="ExpenseClaim" entityId={c._id} />
            {c.status === 'approved' && <Button disabled={act.isPending} onClick={() => act.mutate('post')}>{act.isPending ? 'Posting…' : 'Post claim'}</Button>}
          </>
        }
      />

      {c.sentBackReason && c.status === 'draft' && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">Sent back: {c.sentBackReason}</p>
      )}
      {c.status === 'submitted' && (
        <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">
          Waiting for someone else&apos;s approval on the <Link href="/approvals" className="underline">Approvals</Link> page.
        </p>
      )}
      {held && <p className="rounded-md border border-pending-fg/30 bg-pending-bg px-4 py-3 text-body text-pending-fg">{held}</p>}

      {c.status === 'draft' ? (
        <DraftLines key={c._id} claim={c} onDone={refresh} />
      ) : (
        <Section title="Lines">
          <TableCard>
            <table className="w-full">
              <thead className="border-b border-line-200 bg-surface-sink">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>What for</th>
                  <th className={th}>Account</th>
                  <th className={th}>Merchant</th>
                  <th className={th}>Receipt</th>
                  <th className={`${th} text-right`}>GST</th>
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l, i) => (
                  <tr key={i} className="border-b border-line-100 last:border-0">
                    <td className={`${td} text-caption`}>{shortDate(l.date)}</td>
                    <td className={td}>{l.description}{l.kind === 'mileage' ? <span className="text-caption text-ink-500"> · {l.km} km</span> : null}</td>
                    <td className={`${td} text-caption`}>{accountName(l.expenseAccountId)}</td>
                    <td className={`${td} text-caption`}>{l.merchant ?? '—'}{l.merchantGstin ? <span className="block font-mono text-ink-500">{l.merchantGstin}</span> : null}</td>
                    <td className={`${td} text-caption`}>{l.receiptId ? <span className="text-success-fg">Attached</span> : <span className="text-ink-400">None</span>}</td>
                    <td className={tdMoney}>{l.gstPaise ? formatPaise(l.gstPaise) : '—'}</td>
                    <td className={tdMoney}>{formatPaise(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
          <div className="mt-3 ml-auto w-full max-w-xs">
            <Line label="Total" strong><span className="font-mono">{formatPaise(c.totalPaise)}</span></Line>
          </div>
        </Section>
      )}

      {c.flags.length > 0 && c.status !== 'draft' && (
        <Section title="What the policy flagged" description="For the approver to look at; nothing here stops the claim.">
          <ul className="space-y-1.5">
            {c.flags.map((f, i) => (
              <li key={i} className="rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">Line {f.line + 1}: {f.message}</li>
            ))}
          </ul>
        </Section>
      )}

      {(c.journalId || c.status === 'posted' || c.status === 'paid') && (
        <Section title="In the ledger">
          <Line label="Posted as">{c.journalId ? <Voucher id={String(c.journalId)} /> : '—'}</Line>
          {c.paymentJournalId && <Line label={`Reimbursed on ${shortDate(c.paidOn)}`}><Voucher id={String(c.paymentJournalId)} /></Line>}
          {c.status === 'posted' && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Field label="Paid on">
                <input type="date" className={`${inputClass} w-44`} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </Field>
              <Button disabled={act.isPending} onClick={() => act.mutate('reimburse')}>{act.isPending ? 'Recording…' : 'Record reimbursement'}</Button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
