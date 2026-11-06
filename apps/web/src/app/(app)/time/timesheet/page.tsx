'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { SearchSelect } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { ConfirmDialog, errorText, shortDate } from '@/components/accountant/common';
import { LogTimePanel, useCanManageTime } from '@/components/time/log-time-panel';
import { TimerChip } from '@/components/time/timer-chip';
import { fetchTime, hhmm, todayIst, usePeople, useProjectList, useTimer, type TimeEntry } from '@/components/time/types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

type Period = 'all' | 'today' | 'this_week' | 'this_month' | 'range';
const PERIODS: Array<[Period, string]> = [['all', 'All'], ['today', 'Today'], ['this_week', 'This week'], ['this_month', 'This month'], ['range', 'Date range']];
const BILLING: Array<[string, string]> = [['', 'Any billing'], ['billable', 'Billable'], ['unbilled', 'Unbilled'], ['billed', 'Invoiced'], ['non_billable', 'Not billable']];
const small = 'h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40';
const monthAgo = () => new Date(Date.now() + 330 * 60_000 - 30 * 86_400_000).toISOString().slice(0, 10);

/** Whether typing is going into a field, so a shortcut key is just a letter. */
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.getAttribute('role') === 'combobox');

function Timesheet() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = useCanManageTime();
  const projects = useProjectList();
  const people = usePeople();
  const timer = useTimer();

  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayIst());
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [userId, setUserId] = useState('');
  const [billing, setBilling] = useState('');
  const [panel, setPanel] = useState<{ entry: TimeEntry | null } | null>(params.get('log') ? { entry: null } : null);
  const [removing, setRemoving] = useState<TimeEntry | null>(null);

  // c then t opens New log entry, as in Zoho.
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === 'c') armed = Date.now();
      else if (e.key === 't' && Date.now() - armed < 1200) {
        armed = 0;
        e.preventDefault();
        setPanel({ entry: null });
      } else armed = 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const query = new URLSearchParams();
  if (period === 'range') {
    if (from) query.set('from', from);
    if (to) query.set('to', to);
  } else query.set('period', period);
  if (customerId) query.set('customerId', customerId);
  if (projectId) query.set('projectId', projectId);
  if (userId) query.set('userId', userId);
  if (billing) query.set('billing', billing);
  const qs = query.toString();
  const entries = useQuery({ queryKey: ['projects', 'time', 'sheet', qs], queryFn: () => fetchTime(qs) });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/time/entries/${id}`),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      notify('Time entry removed');
    },
    onError: (err) => {
      setRemoving(null);
      notify(errorText(err, "Couldn't remove the time entry."), 'error');
    },
  });

  const list = projects.data ?? [];
  const customers = useMemo(
    () => [...new Map(list.filter((p) => p.customerId).map((p) => [p.customerId!, p.customerName ?? 'Customer'])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [list],
  );
  const projectOptions = list.filter((p) => !customerId || p.customerId === customerId).map((p) => ({ value: p.id, label: p.name, detail: p.code ?? undefined, keywords: p.customerName ?? '' }));
  const rows = entries.data?.entries ?? [];
  const totals = entries.data?.totals;
  const editable = (e: TimeEntry) => e.status === 'unbilled' && (canManage || e.userId === user?.userId);
  const filtered = !!(customerId || projectId || userId || billing || period !== 'all');

  return (
    <div className="space-y-4">
      {removing && (
        <ConfirmDialog
          title="Remove time entry"
          confirmLabel="Remove entry"
          destructive
          busy={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
          body={<p>Remove {hhmm(removing.hours)} by {removing.userName} on {removing.projectName}, {shortDate(removing.date)}? The audit trail keeps a record of it.</p>}
        />
      )}
      <LogTimePanel
        open={!!panel}
        onClose={() => setPanel(null)}
        entry={panel?.entry ?? null}
        projects={list}
        defaultProjectId={projectId || undefined}
        timer={timer.data}
      />
      <PageHeader
        guide="timesheet"
        title="Timesheet"
        meta={<TimerChip />}
        subtitle="Everyone's time on projects. Unbilled time can be changed by the person whose time it is, or by someone who manages projects."
        actions={
          <>
            <Button variant="secondary" asChild><Link href="/time/projects">Projects</Link></Button>
            <Button onClick={() => setPanel({ entry: null })} title="Shortcut: c then t"><Plus size={14} /> Log time</Button>
          </>
        }
      />

      <div>
        <ListToolbar filters={{ value: period, onChange: (v) => setPeriod(v as Period), options: PERIODS }}>
          {period === 'range' && (
            <>
              <label className="flex items-center gap-1.5 text-caption text-ink-500">From <input type="date" className={small} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="flex items-center gap-1.5 text-caption text-ink-500">To <input type="date" className={small} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          )}
        </ListToolbar>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-caption font-medium text-ink-500">View by</span>
          <SearchSelect
            className="w-52"
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              if (v && projectId && list.find((p) => p.id === projectId)?.customerId !== v) setProjectId('');
            }}
            options={customers.map(([id, name]) => ({ value: id, label: name }))}
            noneLabel="All customers"
            searchPlaceholder="Type a customer"
            aria-label="Customer"
          />
          <SearchSelect className="w-56" value={projectId} onChange={setProjectId} options={projectOptions} noneLabel="All projects" searchPlaceholder="Type a project" aria-label="Project" />
          <SearchSelect
            className="w-48"
            value={userId}
            onChange={setUserId}
            options={(people.data ?? []).map((p) => ({ value: p.userId, label: p.userId === user?.userId ? `${p.name} (you)` : p.name, keywords: p.email }))}
            noneLabel="Everyone"
            searchPlaceholder="Type a name"
            aria-label="User"
          />
          <select className={small} value={billing} onChange={(e) => setBilling(e.target.value)} aria-label="Billing">
            {BILLING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {totals && (
            <p className="ml-auto font-mono text-body tabular-nums text-ink-700">
              {hhmm(totals.hours)} logged · {hhmm(totals.billableHours)} billable · {totals.unbilledPaise == null ? hhmm(totals.unbilledHours) : formatPaise(totals.unbilledPaise)} unbilled
            </p>
          )}
        </div>

        {entries.isError && <QueryError error={entries.error} onRetry={() => void entries.refetch()} />}
        {entries.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading time…</p>
        ) : rows.length === 0 && !entries.isError ? (
          <EmptyState
            guide={!filtered ? 'timesheet' : undefined}
            title={filtered ? 'No time matches' : 'No time logged yet'}
            body={filtered ? 'Change the period or the filters.' : 'Log time to a project, or start a timer.'}
            action={<Button onClick={() => setPanel({ entry: null })}>Log time</Button>}
          />
        ) : (
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>User</th>
                  <th className={th}>Project</th>
                  <th className={th}>Task</th>
                  <th className={`${th} text-right`}>Time</th>
                  <th className={th}>Billing</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-line-100 last:border-0 align-top">
                    <td className={`${td} whitespace-nowrap`}>{shortDate(e.date)}</td>
                    <td className={td}>
                      {e.userName}
                      {e.loggedBy && e.loggedBy !== e.userId && <p className="text-caption text-ink-500">logged for them</p>}
                    </td>
                    <td className={td}>
                      <Link href={`/time/projects/${e.projectId}`} className="hover:underline">{e.projectName}</Link>
                      {e.customerName && <p className="text-caption text-ink-500">{e.customerName}</p>}
                    </td>
                    <td className={td}>
                      {e.task}
                      {e.notes && <p className="text-caption text-ink-500">{e.notes}</p>}
                    </td>
                    <td className={tdMoney}>
                      {hhmm(e.hours)}
                      {e.startTime && e.endTime && <p className="text-caption text-ink-500">{e.startTime}–{e.endTime}</p>}
                    </td>
                    <td className={td}>
                      {!e.billable ? <span className="text-caption text-ink-500">Not billable</span>
                        : e.status === 'billed' ? <StatusChip tone="success">Invoiced</StatusChip>
                          : e.status === 'billing' ? <StatusChip tone="pending">On a draft</StatusChip>
                            : <span className="text-caption text-ink-600">Unbilled</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right text-caption`}>
                      {editable(e) && (
                        <span className="flex justify-end gap-3">
                          <button type="button" className="font-medium text-ink-600 hover:text-ink-900 hover:underline" onClick={() => setPanel({ entry: e })}>Edit</button>
                          <button type="button" className="font-medium text-ink-500 hover:text-error-fg" onClick={() => setRemoving(e)}>Remove</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.data?.truncated && <p className="border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">The latest 500 of {totals?.entries} entries; the totals cover them all. Narrow the period to see the rest.</p>}
          </TableCard>
        )}
      </div>
    </div>
  );
}

export default function TimesheetPage() {
  return (
    <Suspense>
      <Timesheet />
    </Suspense>
  );
}
