'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, Loader2, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { Field, PageHeader, Section, StatusChip, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ConfirmDialog, errorText, shortDate } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { currentFinancialYear, recentFinancialYears } from '@/lib/financial-year';
import { formatPaise } from '@/lib/gst';

interface ClosingStatus {
  lockedThrough: string | null;
  history: Array<{ lockedThrough: string | null; changedBy: string; changedAt: string; reason: string | null }>;
  years: Array<{ financialYear: string; status: 'closed' | 'reopened'; netIncomePaise: number; closedAt: string }>;
}
interface Checklist {
  through: string;
  ready: boolean;
  items: Array<{ key: string; label: string; count: number; href: string }>;
}
type Pending = { kind: 'unlock' } | { kind: 'close'; fy: string } | { kind: 'reopen'; fy: string };

/** Last day of the month before `at`, e.g. 2026-09-30 in October. */
function lastMonthEnd(at = new Date()): string {
  return new Date(Date.UTC(at.getFullYear(), at.getMonth(), 0)).toISOString().slice(0, 10);
}

/**
 * Lock a period so nothing more posts into it, and close a financial year
 * into retained earnings. The checklist says what is still open before you
 * do; it does not stop you.
 */
export default function TransactionLockingPage() {
  const qc = useQueryClient();
  const [through, setThrough] = useState(lastMonthEnd());
  const [pending, setPending] = useState<Pending | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['closing'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
    void qc.invalidateQueries({ queryKey: ['journals'] });
  };

  const status = useQuery({ queryKey: ['closing', 'status'], queryFn: () => api.get<ClosingStatus>('/closing') });
  const checklist = useQuery({
    queryKey: ['closing', 'checklist', through],
    queryFn: () => api.get<Checklist>(`/closing/checklist?through=${through}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(through),
  });

  const lock = useMutation({
    mutationFn: (lockedThrough: string | null) => api.post('/closing/lock', { lockedThrough }),
    onSuccess: (_d, lockedThrough) => {
      setPending(null);
      notify(lockedThrough ? `Books locked through ${shortDate(lockedThrough)}` : 'Books unlocked');
      refresh();
    },
    onError: (err) => {
      setPending(null);
      notify(errorText(err, "Couldn't change the lock."), 'error');
    },
  });
  const closeYear = useMutation({
    mutationFn: (fy: string) => api.post(`/closing/years/${fy}/close`),
    onSuccess: (_d, fy) => {
      setPending(null);
      notify(`FY ${fy} closed`);
      refresh();
    },
    onError: (err) => {
      setPending(null);
      notify(errorText(err, "Couldn't close the year."), 'error');
    },
  });
  const reopenYear = useMutation({
    mutationFn: (fy: string) => api.post(`/closing/years/${fy}/reopen`),
    onSuccess: (_d, fy) => {
      setPending(null);
      notify(`FY ${fy} reopened`);
      refresh();
    },
    onError: (err) => {
      setPending(null);
      notify(errorText(err, "Couldn't reopen the year."), 'error');
    },
  });

  if (status.isError) return <QueryError error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  const busy = lock.isPending || closeYear.isPending || reopenYear.isPending;
  // Past years only: the current one cannot be closed until it ends.
  const years = recentFinancialYears(4).filter((fy) => fy !== currentFinancialYear());
  const runFor = (fy: string) => s?.years.find((y) => y.financialYear === fy);
  const open = (checklist.data?.items ?? []).filter((i) => i.count > 0).length;

  return (
    <div className="max-w-[920px] space-y-5">
      {pending?.kind === 'unlock' && (
        <ConfirmDialog
          title="Unlock the books"
          confirmLabel="Unlock books"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => lock.mutate(null)}
          body={<p>Entries could then be posted on any date, including periods whose returns are filed. The change is kept in the lock history.</p>}
        />
      )}
      {pending?.kind === 'close' && (
        <ConfirmDialog
          title={`Close FY ${pending.fy}`}
          confirmLabel={`Close FY ${pending.fy}`}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => closeYear.mutate(pending.fy)}
          body={<p>Posts one entry dated 31 March moving the year&apos;s income and expense into Retained Earnings, then locks the year. Reopening reverses it.</p>}
        />
      )}
      {pending?.kind === 'reopen' && (
        <ConfirmDialog
          title={`Reopen FY ${pending.fy}`}
          confirmLabel={`Reopen FY ${pending.fy}`}
          destructive
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => reopenYear.mutate(pending.fy)}
          body={<p>Reverses the closing entry and lifts the lock on the year, so entries can be posted into it again.</p>}
        />
      )}

      <PageHeader
        title="Transaction locking"
        subtitle="Lock a period once its returns are filed, and close each year into retained earnings."
        meta={s ? (s.lockedThrough ? <StatusChip tone="success">Locked through {shortDate(s.lockedThrough)}</StatusChip> : <StatusChip tone="neutral">Nothing locked</StatusChip>) : undefined}
      />

      <Section
        title="Lock"
        actions={s?.lockedThrough ? <Button variant="secondary" disabled={busy} onClick={() => setPending({ kind: 'unlock' })}><LockOpen size={14} /> Unlock books</Button> : undefined}
      >
        <div className="mb-4 flex items-center gap-3">
          {s?.lockedThrough ? <Lock size={20} className="text-ink-700" /> : <LockOpen size={20} className="text-ink-400" />}
          <div>
            <p className="text-body font-semibold text-ink-900">{s?.lockedThrough ? `Locked through ${shortDate(s.lockedThrough)}` : 'Nothing is locked'}</p>
            <p className="text-caption text-ink-500">
              {s?.lockedThrough ? 'No entry dated on or before this can be posted: payments, notes and reversals included.' : 'Entries can be posted on any date.'}
            </p>
          </div>
        </div>
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (through) lock.mutate(through);
          }}
        >
          <Field label="Lock through">
            <input type="date" className={`${inputClass} w-48`} value={through} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setThrough(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy || !through}><Lock size={14} /> Lock books</Button>
        </form>
      </Section>

      <Section title={`Still open on or before ${shortDate(through)}`} description={checklist.data ? (open ? `${open} thing${open === 1 ? '' : 's'} to look at before you lock.` : 'Nothing is waiting.') : undefined}>
        {checklist.isLoading ? (
          <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Checking…</p>
        ) : checklist.isError ? (
          <p className="text-caption text-error-fg">{errorText(checklist.error)}</p>
        ) : (
          <ul className="space-y-1.5">
            {(checklist.data?.items ?? []).map((item) => (
              <li key={item.key} className="flex items-center justify-between text-body">
                <span className="flex items-center gap-2 text-ink-700">
                  {item.count === 0 ? <CheckCircle size={14} className="text-success-fg" /> : <Circle size={14} className="text-pending-fg" />}
                  {item.label}
                </span>
                {item.count > 0 ? (
                  <Link href={item.href} className="font-mono text-caption font-medium text-pending-fg hover:underline">{item.count} to look at →</Link>
                ) : (
                  <span className="text-caption text-ink-400">none</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Year-end close"
        description="Moves the year's income and expense into Retained Earnings with one entry dated 31 March, then locks the year. Its P&L still shows what happened in it. Reopening reverses the entry and lifts the lock."
      >
        <ul className="divide-y divide-line-100">
          {years.map((fy) => {
            const run = runFor(fy);
            const closed = run?.status === 'closed';
            return (
              <li key={fy} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-body font-medium text-ink-900">FY {fy}</p>
                  <p className="text-caption text-ink-500">
                    {closed
                      ? <>Closed: {run!.netIncomePaise >= 0 ? 'profit' : 'loss'} of <span className="font-mono">{formatPaise(Math.abs(run!.netIncomePaise))}</span> to retained earnings</>
                      : run?.status === 'reopened' ? 'Reopened' : 'Open'}
                  </p>
                </div>
                {closed ? (
                  <Button variant="secondary" disabled={busy} onClick={() => setPending({ kind: 'reopen', fy })}>Reopen FY {fy}</Button>
                ) : (
                  <Button disabled={busy} onClick={() => setPending({ kind: 'close', fy })}>Close FY {fy}</Button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {!!s?.history.length && (
        <Section title="Lock history">
          <ul className="space-y-1 text-caption text-ink-600">
            {[...s.history].reverse().slice(0, 10).map((h, i) => (
              <li key={i}>
                {new Date(h.changedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}: {h.lockedThrough ? `locked through ${shortDate(h.lockedThrough)}` : 'unlocked'}
                {h.reason ? ` · ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
