'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { api, ApiError } from '@/lib/api';
import { currentFinancialYear, recentFinancialYears } from '@/lib/financial-year';
import { formatRupees } from '@/lib/utils';

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

/** Last day of the month before `at`, e.g. 2026-09-30 in October. */
function lastMonthEnd(at = new Date()): string {
  return new Date(Date.UTC(at.getFullYear(), at.getMonth(), 0)).toISOString().slice(0, 10);
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/**
 * Closing the books: lock a period so nothing more posts into it, and close a
 * financial year into retained earnings. The checklist says what is still open
 * before you do; it does not stop you.
 */
export default function ClosingPage() {
  const queryClient = useQueryClient();
  const [through, setThrough] = useState(lastMonthEnd());
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const show = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), error ? 6000 : 3500);
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['closing'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
  };

  const statusQuery = useQuery<ClosingStatus>({
    queryKey: ['closing', 'status'],
    queryFn: () => api.get<ClosingStatus>('/closing'),
  });
  const checklistQuery = useQuery<Checklist>({
    queryKey: ['closing', 'checklist', through],
    queryFn: () => api.get<Checklist>(`/closing/checklist?through=${through}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(through),
  });

  const lock = useMutation({
    mutationFn: (lockedThrough: string | null) => api.post('/closing/lock', { lockedThrough }),
    onSuccess: (_d, lockedThrough) => {
      show(lockedThrough ? `Books locked through ${lockedThrough}` : 'Books unlocked');
      refresh();
    },
    onError: (err) => show(message(err, "Couldn't change the lock"), true),
  });
  const closeYear = useMutation({
    mutationFn: (fy: string) => api.post(`/closing/years/${fy}/close`),
    onSuccess: (_d, fy) => {
      show(`FY ${fy} closed and locked`);
      refresh();
    },
    onError: (err) => show(message(err, "Couldn't close the year"), true),
  });
  const reopenYear = useMutation({
    mutationFn: (fy: string) => api.post(`/closing/years/${fy}/reopen`),
    onSuccess: (_d, fy) => {
      show(`FY ${fy} reopened`);
      refresh();
    },
    onError: (err) => show(message(err, "Couldn't reopen the year"), true),
  });

  const status = statusQuery.data;
  const busy = lock.isPending || closeYear.isPending || reopenYear.isPending;
  // Past years only: the current one cannot be closed until it ends.
  const years = recentFinancialYears(4).filter((fy) => fy !== currentFinancialYear());
  const runFor = (fy: string) => status?.years.find((y) => y.financialYear === fy);

  if (statusQuery.isError) return <QueryError error={statusQuery.error} onRetry={() => void statusQuery.refetch()} />;

  return (
    <div className="space-y-6 max-w-[900px]">
      <div>
        <h1 className="text-h1 font-display text-ink-900">Close the books</h1>
        <p className="text-body text-ink-500 mt-1">
          Lock a period once its returns are filed, and close each year into retained earnings.
        </p>
      </div>

      {/* Lock */}
      <section className="rounded-lg border border-line-200 bg-surface-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {status?.lockedThrough ? <Lock size={20} className="text-ink-700" /> : <LockOpen size={20} className="text-ink-400" />}
            <div>
              <p className="text-body font-semibold text-ink-900">
                {status?.lockedThrough ? `Locked through ${status.lockedThrough}` : 'Nothing is locked'}
              </p>
              <p className="text-caption text-ink-500">
                {status?.lockedThrough
                  ? 'No entry dated on or before this can be posted — payments, notes and reversals included.'
                  : 'Entries can be posted on any date.'}
              </p>
            </div>
          </div>
          {status?.lockedThrough && (
            <Button variant="secondary" disabled={busy} onClick={() => lock.mutate(null)}>
              Unlock
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-line-100 pt-4">
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Lock through</span>
            <input
              type="date"
              value={through}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setThrough(e.target.value)}
              className="rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <Button disabled={busy || !through} onClick={() => lock.mutate(through)}>
            <Lock size={14} className="mr-1.5" /> Lock through {through}
          </Button>
        </div>

        {/* Checklist for the chosen date */}
        <div>
          <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-500">
            Still open on or before {through}
          </p>
          {checklistQuery.isLoading ? (
            <p className="text-caption text-ink-400">Checking…</p>
          ) : (
            <ul className="space-y-1.5">
              {(checklistQuery.data?.items ?? []).map((item) => (
                <li key={item.key} className="flex items-center justify-between text-body">
                  <span className="flex items-center gap-2 text-ink-700">
                    {item.count === 0 ? (
                      <CheckCircle size={14} className="text-success-fg" />
                    ) : (
                      <Circle size={14} className="text-pending-fg" />
                    )}
                    {item.label}
                  </span>
                  {item.count > 0 ? (
                    <Link href={item.href} className="font-mono text-caption font-medium text-pending-fg hover:underline">
                      {item.count} to look at →
                    </Link>
                  ) : (
                    <span className="text-caption text-ink-400">none</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Year-end */}
      <section className="rounded-lg border border-line-200 bg-surface-card p-5">
        <h2 className="text-body font-semibold text-ink-900">Year-end close</h2>
        <p className="text-caption text-ink-500 mt-0.5 mb-4">
          Moves the year&apos;s income and expense into Retained Earnings with one entry dated 31 March, then locks the
          year. Its P&amp;L still shows what happened in it. Reopening reverses the entry and lifts the lock.
        </p>
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
                      ? `Closed — ${run!.netIncomePaise >= 0 ? 'profit' : 'loss'} of ${formatRupees(Math.abs(run!.netIncomePaise))} to retained earnings`
                      : run?.status === 'reopened'
                        ? 'Reopened'
                        : 'Open'}
                  </p>
                </div>
                {closed ? (
                  <Button variant="secondary" disabled={busy} onClick={() => reopenYear.mutate(fy)}>
                    Reopen
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => closeYear.mutate(fy)}>
                    Close FY {fy}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-md rounded-md border px-4 py-3 text-body font-medium shadow-lg ${
            toast.error ? 'bg-error-bg border-error-fg text-error-fg' : 'bg-success-bg border-success-fg text-success-fg'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
