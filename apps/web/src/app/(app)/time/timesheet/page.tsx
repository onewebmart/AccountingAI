'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, Field, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ConfirmDialog, errorText, shortDate, todayIso } from '@/components/accountant/common';
import { hoursText, useProjectList, type Project, type TimeEntry } from '@/components/time/types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const small = 'h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

/** Log time: a form section on the page, as wide as the page. */
function LogTime({ projects, initialProjectId }: { projects: Project[]; initialProjectId: string }) {
  const qc = useQueryClient();
  const open = projects.filter((p) => p.status !== 'completed');
  const first = open.find((p) => p.id === initialProjectId);
  const [f, setF] = useState({ projectId: first?.id ?? '', date: todayIso(), hours: '', task: '', notes: '', billable: first ? first.billing === 'time' : true });
  const log = useMutation({
    mutationFn: () => api.post('/projects/time/entries', { projectId: f.projectId, date: f.date, hours: Number(f.hours), task: f.task.trim(), notes: f.notes.trim() || null, billable: f.billable }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setF({ ...f, hours: '', notes: '' });
      notify('Time logged');
    },
    onError: (err) => notify(errorText(err, "Couldn't log the time."), 'error'),
  });
  const hours = Number(f.hours);
  return (
    <Section title="Log time" description="Your own time. The invoice lines are worded from the notes.">
      <form
        className="grid items-end gap-4 md:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          log.mutate();
        }}
      >
        <Field label="Project" required className="md:col-span-2">
          <select
            className={inputClass}
            value={f.projectId}
            onChange={(e) => {
              const p = open.find((x) => x.id === e.target.value);
              setF({ ...f, projectId: e.target.value, billable: p ? p.billing === 'time' : f.billable });
            }}
          >
            <option value="">Choose a project…</option>
            {open.map((p) => <option key={p.id} value={p.id}>{p.name}{p.customerName ? ` · ${p.customerName}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className={inputClass} value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Hours" required>
          <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} placeholder="2.5" />
        </Field>
        <Field label="Task" required className="md:col-span-2">
          <input className={inputClass} value={f.task} maxLength={80} onChange={(e) => setF({ ...f, task: e.target.value })} placeholder="Design" />
        </Field>
        <Field label="Notes" className="md:col-span-4">
          <input className={inputClass} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What was done" />
        </Field>
        <label className="flex items-center gap-2 pb-2.5 text-body text-ink-900">
          <input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable
        </label>
        <Button type="submit" disabled={!f.projectId || !(hours > 0 && hours <= 24) || !f.task.trim() || log.isPending}>{log.isPending ? 'Saving…' : 'Log time'}</Button>
      </form>
    </Section>
  );
}

/** One of your own unbilled entries, changed in its row. */
function EditRow({ entry, onDone }: { entry: TimeEntry; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ date: entry.date, hours: String(entry.hours), task: entry.task, notes: entry.notes ?? '', billable: entry.billable });
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/time/entries/${entry.id}`, { date: f.date, hours: Number(f.hours), task: f.task.trim(), notes: f.notes.trim() || null, billable: f.billable }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      notify('Time entry saved');
      onDone();
    },
    onError: (err) => notify(errorText(err, "Couldn't save the time entry."), 'error'),
  });
  const hours = Number(f.hours);
  return (
    <tr className="border-b border-line-100 bg-honey-50/40 align-top">
      <td className={td}><input type="date" className={cell} value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value })} /></td>
      <td className={td}>{entry.userName}</td>
      <td className={td}>{entry.projectName}</td>
      <td className={td}>
        <input className={cell} value={f.task} maxLength={80} onChange={(e) => setF({ ...f, task: e.target.value })} aria-label="Task" />
        <input className={`${cell} mt-1`} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes" aria-label="Notes" />
      </td>
      <td className={td}><input className={`${cell} w-20 text-right font-mono`} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} aria-label="Hours" /></td>
      <td className={td}>
        <label className="flex items-center gap-1.5 text-caption"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable</label>
      </td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={!(hours > 0 && hours <= 24) || !f.task.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save entry'}</Button>
          <Button size="sm" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </td>
    </tr>
  );
}

function Timesheet() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const projects = useProjectList();
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [person, setPerson] = useState('');
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayIso());
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TimeEntry | null>(null);

  const query = new URLSearchParams();
  if (projectId) query.set('projectId', projectId);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const entries = useQuery({
    queryKey: ['projects', 'time', 'all', projectId, from, to],
    queryFn: () => api.get<TimeEntry[]>(`/projects/time/entries?${query.toString()}`),
  });
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

  const all = entries.data ?? [];
  const people = [...new Map(all.map((e) => [e.userId, e.userName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = all.filter((e) => !person || e.userId === person);
  const sum = (xs: TimeEntry[]) => xs.reduce((s, e) => s + e.hours, 0);
  const billable = rows.filter((e) => e.billable);
  const unbilled = billable.filter((e) => e.status === 'unbilled');
  const mine = (e: TimeEntry) => !!user && e.userId === user.userId && e.status === 'unbilled';

  return (
    <div className="space-y-5">
      {removing && (
        <ConfirmDialog
          title="Remove time entry"
          confirmLabel="Remove entry"
          destructive
          busy={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
          body={<p>Remove {hoursText(removing.hours)} on {removing.projectName}, {shortDate(removing.date)}? The audit trail keeps a record of it.</p>}
        />
      )}
      <PageHeader
        guide="timesheet"
        title="Timesheet"
        subtitle="Everyone's time on projects. Your own entries can be changed or removed until they are on an invoice."
        actions={<Button variant="secondary" asChild><Link href="/time/projects">Projects</Link></Button>}
      />

      {projects.data && <LogTime key={params.get('projectId') ?? ''} projects={projects.data} initialProjectId={params.get('projectId') ?? ''} />}

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={small} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={small} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-caption text-ink-500">From <input type="date" className={small} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-caption text-ink-500">To <input type="date" className={small} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <p className="ml-auto font-mono text-body tabular-nums text-ink-700">
            {hoursText(sum(rows))} logged · {hoursText(sum(billable))} billable · {hoursText(sum(unbilled))} unbilled
          </p>
        </div>

        {entries.isError && <QueryError error={entries.error} onRetry={() => void entries.refetch()} />}
        {entries.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading time…</p>
        ) : rows.length === 0 && !entries.isError ? (
          <EmptyState guide={!projectId && !person ? 'timesheet' : undefined} title="No time in this range" body="Change the filters, or log time above." />
        ) : (
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>Person</th>
                  <th className={th}>Project</th>
                  <th className={th}>Task</th>
                  <th className={`${th} text-right`}>Hours</th>
                  <th className={th}>Billing</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) =>
                  editing === e.id ? (
                    <EditRow key={e.id} entry={e} onDone={() => setEditing(null)} />
                  ) : (
                    <tr key={e.id} className="border-b border-line-100 last:border-0">
                      <td className={`${td} whitespace-nowrap`}>{shortDate(e.date)}</td>
                      <td className={td}>{e.userName}</td>
                      <td className={td}><Link href={`/time/projects/${e.projectId}`} className="hover:underline">{e.projectName}</Link></td>
                      <td className={td}>{e.task}{e.notes ? <span className="text-caption text-ink-500"> · {e.notes}</span> : null}</td>
                      <td className={tdMoney}>{hoursText(e.hours)}</td>
                      <td className={td}>
                        {!e.billable ? <span className="text-caption text-ink-500">Not billable</span>
                          : e.status === 'billed' ? <StatusChip tone="success">Invoiced</StatusChip>
                            : e.status === 'billing' ? <StatusChip tone="pending">On a draft</StatusChip>
                              : <span className="text-caption text-ink-600">Unbilled</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right text-caption`}>
                        {mine(e) && (
                          <span className="flex justify-end gap-3">
                            <button type="button" className="font-medium text-ink-600 hover:text-ink-900 hover:underline" onClick={() => setEditing(e.id)}>Edit</button>
                            <button type="button" className="font-medium text-ink-500 hover:text-error-fg" onClick={() => setRemoving(e)}>Remove</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {all.length >= 500 && <p className="border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">The latest 500 entries: narrow the dates to see the rest.</p>}
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
