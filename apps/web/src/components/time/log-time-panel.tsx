'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, X } from 'lucide-react';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/page/page-shell';
import { SearchSelect } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { errorText } from '@/components/accountant/common';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { hhmm, todayIst, usePeople, type Project, type RunningTimer, type TimeEntry } from './types';

const OTHER = '__other__';

/** "1:30" → 1.5; "1.5" → 1.5; anything else → null. */
export function parseSpent(v: string): number | null {
  const s = v.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100;
  if (/^\d{1,2}(\.\d{1,2})?$/.test(s)) return Number(s);
  return null;
}

/** Minutes between two "HH:MM" times the same day, or null. */
function between(start: string, end: string): number | null {
  const at = (v: string) => (/^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);
  const a = at(start);
  const b = at(end);
  return a == null || b == null || b <= a ? null : b - a;
}

/** Can this person log and change other people's time? Projects are managed with MANAGE_SALES. */
export function useCanManageTime() {
  const { user } = useAuth();
  return !!user && hasPermission(user.role as UserRole, Permission.MANAGE_SALES);
}

/**
 * Log time, in a panel from the right: new, or an entry being changed.
 * Escape closes it; focus moves into it when it opens. Time spent is hours
 * and minutes, or a start and end time the server turns into hours.
 */
export function LogTimePanel({ open, onClose, entry, projects, defaultProjectId, timer }: {
  open: boolean;
  onClose: () => void;
  /** The entry being changed; null for new time. */
  entry: TimeEntry | null;
  projects: Project[];
  defaultProjectId?: string;
  timer: RunningTimer | null | undefined;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-roast-900/25 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Escape in an open picker closes the picker, not the panel.
          onEscapeKeyDown={(e) => {
            if ((document.activeElement as HTMLElement | null)?.getAttribute('role') === 'combobox') e.preventDefault();
          }}
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-line-200 bg-surface-page shadow-e3 duration-200 focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right motion-reduce:animate-none"
        >
          {open && <PanelBody key={entry?.id ?? 'new'} entry={entry} projects={projects} defaultProjectId={defaultProjectId} timer={timer} onClose={onClose} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PanelBody({ entry, projects, defaultProjectId, timer, onClose }: { entry: TimeEntry | null; projects: Project[]; defaultProjectId?: string; timer: RunningTimer | null | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = useCanManageTime();
  const people = usePeople();
  const first = useRef<HTMLInputElement>(null);

  const open = projects.filter((p) => p.status !== 'completed' || p.id === entry?.projectId);
  const initialProject = open.find((p) => p.id === (entry?.projectId ?? defaultProjectId));
  const taskOf = (p: Project | undefined, id: string | null | undefined, name?: string) =>
    (p?.tasks ?? []).find((t) => t.id === id) ?? (name ? (p?.tasks ?? []).find((t) => t.name.toLowerCase() === name.trim().toLowerCase()) : undefined);
  const initialTask = taskOf(initialProject, entry?.taskId, entry?.task);

  const [f, setF] = useState(() => ({
    date: entry?.date ?? todayIst(),
    projectId: initialProject?.id ?? '',
    taskPick: initialTask ? initialTask.id : entry ? OTHER : (initialProject?.tasks?.length ? '' : OTHER),
    taskText: initialTask ? '' : entry?.task ?? '',
    spent: entry && !entry.startTime ? hhmm(entry.hours) : '',
    useClock: !!entry?.startTime,
    startTime: entry?.startTime ?? '',
    endTime: entry?.endTime ?? '',
    billable: entry ? entry.billable : initialTask ? initialTask.billable : initialProject ? initialProject.billing !== 'fixed' : true,
    userId: entry?.userId ?? user?.userId ?? '',
    notes: entry?.notes ?? '',
  }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const project = open.find((p) => p.id === f.projectId);
  const tasks = project?.tasks ?? [];
  const freeText = f.taskPick === OTHER || !tasks.length;
  const pickedTask = tasks.find((t) => t.id === f.taskPick);
  const minutes = f.useClock ? between(f.startTime, f.endTime) : null;
  const hours = f.useClock ? (minutes == null ? null : Math.round((minutes / 60) * 100) / 100) : parseSpent(f.spent);

  // Whose time: your own; a manager picks anyone on the project.
  const personOptions = useMemo(() => {
    const byId = new Map((people.data ?? []).map((p) => [p.userId, p]));
    const ids = new Set<string>([...(project?.members ?? []).map((m) => m.userId), ...(user ? [user.userId] : []), ...(entry ? [entry.userId] : [])]);
    return [...ids].map((id) => ({ value: id, label: byId.get(id)?.name ?? project?.members?.find((m) => m.userId === id)?.name ?? (id === entry?.userId ? entry.userName : id === user?.userId ? user.email : 'Someone'), detail: id === user?.userId ? 'you' : undefined }));
  }, [people.data, project, user, entry]);

  const pickProject = (id: string) => {
    const p = open.find((x) => x.id === id);
    const keep = taskOf(p, null, pickedTask?.name ?? f.taskText);
    setF({
      ...f, projectId: id,
      taskPick: keep ? keep.id : p?.tasks?.length ? (f.taskPick === OTHER && f.taskText ? OTHER : '') : OTHER,
      billable: keep ? keep.billable : p ? p.billing !== 'fixed' : f.billable,
      userId: canManage ? f.userId : user?.userId ?? f.userId,
    });
  };
  const pickTask = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    setF({ ...f, taskPick: id, billable: t ? t.billable : f.billable });
  };

  const taskBody = () => (freeText ? { taskId: null, task: f.taskText.trim() } : { taskId: f.taskPick });
  const valid = !!f.projectId && !!f.date && hours != null && hours > 0 && hours <= 24 && (freeText ? !!f.taskText.trim() : !!f.taskPick);
  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: ['projects'] });
    notify(message);
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const spent = f.useClock
        ? { startTime: f.startTime, endTime: f.endTime, ...(entry ? { hours: null, duration: null } : {}) }
        : /:/.test(f.spent) ? { duration: f.spent.trim(), ...(entry ? { startTime: null, endTime: null } : {}) } : { hours: hours!, ...(entry ? { startTime: null, endTime: null } : {}) };
      const body = {
        projectId: f.projectId, date: f.date, ...spent, ...taskBody(), billable: f.billable, notes: f.notes.trim() || null,
        ...(f.userId && f.userId !== (entry?.userId ?? user?.userId) ? { userId: f.userId } : {}),
      };
      return entry ? api.patch(`/projects/time/entries/${entry.id}`, body) : api.post('/projects/time/entries', body);
    },
    onMutate: () => setError(null),
    onSuccess: () => done(entry ? 'Time entry saved' : 'Time logged'),
    onError: (err) => setError(errorText(err, "Couldn't log the time.")),
  });
  const start = useMutation({
    mutationFn: () => api.post('/projects/time/timer/start', { projectId: f.projectId, ...taskBody(), billable: f.billable, notes: f.notes.trim() || null }),
    onMutate: () => setError(null),
    onSuccess: () => done('Timer started'),
    onError: (err) => setError(errorText(err, "Couldn't start the timer.")),
  });
  // The timer is your own time, today, and one at a time.
  const canTime = !entry && !!f.projectId && (freeText ? !!f.taskText.trim() : !!f.taskPick) && f.date === todayIst() && f.userId === user?.userId && !timer;

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <div className="flex items-start gap-3 border-b border-line-200 bg-surface-card px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-caption text-ink-500">Timesheet</p>
          <DialogPrimitive.Title className="font-display text-h3 text-ink-900">{entry ? 'Edit log entry' : 'New log entry'}</DialogPrimitive.Title>
        </div>
        <DialogPrimitive.Close
          aria-label="Close"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-surface-sink hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400"
        >
          <X size={18} aria-hidden />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
        <Field label="Date" required>
          <input ref={first} type="date" className={inputClass} value={f.date} max={todayIst()} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        </Field>
        <Field label="Project name" required>
          <SearchSelect
            value={f.projectId}
            onChange={pickProject}
            options={open.map((p) => ({ value: p.id, label: p.name, detail: p.code ?? undefined, keywords: `${p.customerName ?? ''} ${p.code ?? ''}` }))}
            placeholder="Choose a project"
            searchPlaceholder="Type a project, code or customer"
            aria-label="Project name"
          />
          {project?.customerName && <p className="mt-1 text-caption text-ink-500">{project.customerName}</p>}
        </Field>
        <Field label="Task name" required>
          {tasks.length > 0 && (
            <SearchSelect
              value={f.taskPick}
              onChange={pickTask}
              options={[...tasks.map((t) => ({ value: t.id, label: t.name, detail: t.billable ? undefined : 'not billable', keywords: t.description ?? '' })), { value: OTHER, label: 'Another task (type it)' }]}
              placeholder={project ? 'Choose a task' : 'Choose a project first'}
              searchPlaceholder="Type a task"
              disabled={!project}
              aria-label="Task name"
            />
          )}
          {freeText && (
            <input
              className={`${inputClass} ${tasks.length ? 'mt-2' : ''}`}
              value={f.taskText}
              maxLength={80}
              onChange={(e) => setF({ ...f, taskText: e.target.value })}
              placeholder="What the time was spent on, like Design"
              aria-label={tasks.length ? 'Another task' : 'Task name'}
            />
          )}
        </Field>

        {f.useClock ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time" required>
                <input type="time" className={`${inputClass} font-mono`} value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} aria-label="Start time" />
              </Field>
              <Field label="End time" required>
                <input type="time" className={`${inputClass} font-mono`} value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} aria-label="End time" />
              </Field>
            </div>
            <p className="mt-1 text-caption text-ink-500">
              {minutes != null ? <>Time spent: <span className="font-mono tabular-nums text-ink-900">{hhmm(minutes / 60)}</span></> : f.startTime && f.endTime ? <span className="text-error-fg">The end time is after the start time, the same day.</span> : 'The hours follow from the times.'}
              {' · '}
              <button type="button" className="font-medium text-saffron-600 hover:underline" onClick={() => setF({ ...f, useClock: false, spent: minutes != null ? hhmm(minutes / 60) : f.spent })}>Enter time spent instead</button>
            </p>
          </div>
        ) : (
          <Field label="Time spent" required hint={
            <>
              Hours and minutes, like <span className="font-mono">1:30</span>.{' '}
              <button type="button" className="font-medium text-saffron-600 hover:underline" onClick={() => setF({ ...f, useClock: true })}>Set start and end time instead</button>
            </>
          }>
            <input
              className={`${inputClass} font-mono md:max-w-[160px] ${f.spent && hours == null ? 'border-error-fg' : ''}`}
              inputMode="numeric"
              value={f.spent}
              onChange={(e) => setF({ ...f, spent: e.target.value })}
              placeholder="HH:MM"
              aria-label="Time spent"
            />
          </Field>
        )}

        <label className="flex items-center gap-2 text-body text-ink-900">
          <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable
          {pickedTask && <span className="text-caption text-ink-500">(the task starts {pickedTask.billable ? 'billable' : 'not billable'})</span>}
        </label>

        <Field label="User" required hint={canManage ? 'Whose time it is: anyone on the project.' : 'You log your own time. Someone who manages projects can log it for others.'}>
          <SearchSelect value={f.userId} onChange={(v) => setF({ ...f, userId: v })} options={personOptions} disabled={!canManage} placeholder="Choose a person" aria-label="User" />
        </Field>

        <Field label="Notes" hint="Invoice lines are worded from these.">
          <textarea className={`${inputClass} min-h-[90px]`} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What was done" />
        </Field>
        {timer && !entry && <p className="text-caption text-pending-fg">Your timer is running on {timer.projectName}: stop it before starting another.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-200 bg-surface-card px-5 py-3">
        <Button type="submit" disabled={!valid || save.isPending || start.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        {!entry && (
          <Button type="button" variant="secondary" disabled={!canTime || start.isPending || save.isPending} onClick={() => start.mutate()} title={f.date !== todayIst() ? 'The timer is for today' : undefined}>
            <Play size={13} /> {start.isPending ? 'Starting…' : 'Start timer'}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        {error && <p className="basis-full text-caption text-error-fg">{error}</p>}
      </div>
    </form>
  );
}
