'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle, Circle, Landmark, Loader2, Lock, LockOpen, Receipt, ShoppingCart, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { Field, PageHeader, Section, StatusChip, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ConfirmDialog, errorText, shortDate } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { currentFinancialYear, recentFinancialYears } from '@/lib/financial-year';
import { formatPaise } from '@/lib/gst';
import { cn } from '@/lib/utils';

type ModuleKey = 'sales' | 'purchases' | 'banking' | 'accountant';
interface ModuleLock { module: ModuleKey; label: string; lockedThrough: string | null; reason: string | null; changedAt: string | null }
interface ClosingStatus {
  lockedThrough: string | null;
  modules: ModuleLock[];
  history: Array<{ module: ModuleKey | null; lockedThrough: string | null; changedBy: string; changedAt: string; reason: string | null }>;
  years: Array<{ financialYear: string; status: 'closed' | 'reopened'; netIncomePaise: number; closedAt: string }>;
}
interface Checklist {
  through: string;
  ready: boolean;
  items: Array<{ key: string; label: string; count: number; href: string }>;
}
type Pending = { kind: 'unlock' } | { kind: 'close'; fy: string } | { kind: 'reopen'; fy: string };
type Panel = { module: ModuleLock; action: 'lock' | 'unlock' };

/** What each module's lock covers: the entries PostingService puts in it (apps/api/src/gl/module-locks.ts). */
const MODULES: Record<ModuleKey, { icon: typeof Receipt; covers: string }> = {
  sales: { icon: Receipt, covers: 'Invoices, credit notes, and customer payments, advances and refunds.' },
  purchases: { icon: ShoppingCart, covers: 'Bills, debit notes, vendor payments and advances, expenses and expense claims.' },
  banking: { icon: Landmark, covers: 'Transfers between bank and cash, confirmed bank matches, and other money in and out of the bank.' },
  accountant: { icon: BookOpen, covers: 'Manual journals, month-end adjustments, depreciation, revaluation and GST set-off.' },
};

const todayIso = () => new Date().toISOString().slice(0, 10);
/** Last day of the month before `at`, e.g. 2026-09-30 in October. */
function lastMonthEnd(at = new Date()): string {
  return new Date(Date.UTC(at.getFullYear(), at.getMonth(), 0)).toISOString().slice(0, 10);
}
const when = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Lock or unlock one module, in a panel at the right: the date, and why. */
function LockPanel({ panel, busy, onClose, onSubmit }: {
  panel: Panel;
  busy: boolean;
  onClose: () => void;
  onSubmit: (lockedThrough: string | null, reason: string) => void;
}) {
  const { module, action } = panel;
  const [date, setDate] = useState(module.lockedThrough ?? lastMonthEnd());
  const [reason, setReason] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [busy, onClose]);
  const locking = action === 'lock';
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/30" role="dialog" aria-modal="true" aria-label={`${locking ? 'Lock' : 'Unlock'} ${module.label}`} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="flex h-full w-full max-w-[440px] flex-col border-l border-line-200 bg-surface-card shadow-e2"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(locking ? date : null, reason.trim());
        }}
      >
        <div className="flex items-start justify-between border-b border-line-200 px-6 py-5">
          <div>
            <h2 className="text-h3 font-display text-ink-900">{locking ? (module.lockedThrough ? `Change the ${module.label} lock` : `Lock ${module.label}`) : `Unlock ${module.label}`}</h2>
            <p className="mt-1 text-caption text-ink-500">{MODULES[module.module].covers}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="-mr-2 p-1 text-ink-400 hover:text-ink-700" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {locking ? (
            <Field label="Lock date" required hint="Nothing in this module dated on or before it can be posted or reversed. Not later than today.">
              <input type="date" className={`${inputClass} max-w-[220px]`} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required autoFocus />
            </Field>
          ) : (
            <p className="text-body text-ink-700">
              {module.label} is locked through <strong>{shortDate(module.lockedThrough)}</strong>. Once unlocked, its entries can be posted and reversed on any date the whole-books lock allows.
            </p>
          )}
          <Field label="Reason" required hint="Kept in the lock history and the audit trail.">
            <textarea className={`${inputClass} min-h-[96px]`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={locking ? 'GSTR-1 for September filed' : 'A missed credit note for September'} required autoFocus={!locking} />
          </Field>
        </div>
        <div className="flex gap-3 border-t border-line-200 px-6 py-4">
          <Button type="submit" variant={locking ? 'primary' : 'destructive'} disabled={busy || !reason.trim() || (locking && !date)}>
            {busy ? 'Working…' : locking ? <><Lock size={14} /> Lock {module.label}</> : <><LockOpen size={14} /> Unlock {module.label}</>}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Lock Sales, Purchases, Banking and Accountant separately, lock the whole
 * books, and close each year into retained earnings. The checklist says what
 * is still open before you lock; it does not stop you.
 */
export default function TransactionLockingPage() {
  const qc = useQueryClient();
  const [through, setThrough] = useState(lastMonthEnd());
  const [pending, setPending] = useState<Pending | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
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

  const moduleLock = useMutation({
    mutationFn: (v: { module: ModuleKey; lockedThrough: string | null; reason: string }) =>
      api.post(`/closing/modules/${v.module}/lock`, { lockedThrough: v.lockedThrough, reason: v.reason }),
    onSuccess: (_d, v) => {
      const label = status.data?.modules?.find((m) => m.module === v.module)?.label ?? v.module;
      setPanel(null);
      notify(v.lockedThrough ? `${label} locked through ${shortDate(v.lockedThrough)}` : `${label} unlocked`);
      refresh();
    },
    onError: (err) => notify(errorText(err, "Couldn't change the lock."), 'error'),
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
  const moduleLabel = (m: ModuleKey | null) => (m ? s?.modules?.find((x) => x.module === m)?.label ?? m : 'Whole books');

  return (
    <div className="max-w-[1000px] space-y-5">
      {panel && (
        <LockPanel
          key={`${panel.module.module}-${panel.action}`}
          panel={panel}
          busy={moduleLock.isPending}
          onClose={() => setPanel(null)}
          onSubmit={(lockedThrough, reason) => moduleLock.mutate({ module: panel.module.module, lockedThrough, reason })}
        />
      )}
      {pending?.kind === 'unlock' && (
        <ConfirmDialog
          title="Unlock the books"
          confirmLabel="Unlock books"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => lock.mutate(null)}
          body={<p>Entries could then be posted on any date the module locks allow, including periods whose returns are filed. The change is kept in the lock history.</p>}
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
        guide="transactionLocking"
        title="Transaction locking"
        subtitle="Lock each module once its period is done: nothing in it dated on or before the lock date can be created, changed or reversed."
      />

      {status.isLoading || !s ? (
        <p className="flex items-center gap-2 py-6 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading the locks…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(s.modules ?? []).map((m) => {
            const { icon: Icon, covers } = MODULES[m.module];
            const locked = !!m.lockedThrough;
            return (
              <section key={m.module} className={cn('flex flex-col rounded-xl border bg-surface-card p-5', locked ? 'border-success-fg/30' : 'border-line-200')}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', locked ? 'bg-success-bg text-success-fg' : 'bg-surface-sink text-ink-500')}><Icon size={18} /></span>
                    <div>
                      <h2 className="text-h3 font-display text-ink-900">{m.label}</h2>
                      <p className="text-caption text-ink-500">{covers}</p>
                    </div>
                  </div>
                  {locked ? <Lock size={16} className="mt-1 shrink-0 text-success-fg" /> : <LockOpen size={16} className="mt-1 shrink-0 text-ink-400" />}
                </div>
                <div className="flex-1">
                  {locked ? (
                    <>
                      <p className="text-body font-medium text-ink-900">Transactions are locked through {shortDate(m.lockedThrough)}.</p>
                      {m.reason && <p className="mt-0.5 text-caption text-ink-500">{m.reason}{m.changedAt ? ` · ${when(m.changedAt)}` : ''}</p>}
                    </>
                  ) : (
                    <p className="text-body text-ink-600">You have not locked the transactions in this module.</p>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  {locked ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setPanel({ module: m, action: 'unlock' })}><LockOpen size={13} /> Unlock</Button>
                      <Button size="sm" variant="ghost" onClick={() => setPanel({ module: m, action: 'lock' })}>Change date</Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setPanel({ module: m, action: 'lock' })}><Lock size={13} /> Lock</Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Section
        title="Lock the whole books"
        description="One date for every module at once, on top of the module locks: an entry is refused when either covers it. Closing a year sets it too."
        actions={s?.lockedThrough ? <Button variant="secondary" disabled={busy} onClick={() => setPending({ kind: 'unlock' })}><LockOpen size={14} /> Unlock books</Button> : undefined}
      >
        <div className="mb-4 flex items-center gap-3">
          {s?.lockedThrough ? <Lock size={20} className="text-ink-700" /> : <LockOpen size={20} className="text-ink-400" />}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body font-semibold text-ink-900">{s?.lockedThrough ? `Locked through ${shortDate(s.lockedThrough)}` : 'The whole books are not locked'}</p>
            {s?.lockedThrough && <StatusChip tone="success">All modules</StatusChip>}
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
            <input type="date" className={`${inputClass} w-48`} value={through} max={todayIso()} onChange={(e) => setThrough(e.target.value)} />
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
        <Section title="Lock history" description="Every lock and unlock, newest first.">
          <ul className="divide-y divide-line-100 text-caption text-ink-600">
            {s.history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="w-36 shrink-0 text-ink-500">{when(h.changedAt)}</span>
                <span className="w-24 shrink-0 font-medium text-ink-900">{moduleLabel(h.module)}</span>
                <span>{h.lockedThrough ? `Locked through ${shortDate(h.lockedThrough)}` : 'Unlocked'}</span>
                {h.reason && <span className="text-ink-500">· {h.reason}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
