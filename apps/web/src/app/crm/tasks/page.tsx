'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TaskPriority, TaskStatus } from '@ai-accounting/shared';
import { CheckSquare, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Client } from '@/lib/crm-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Task {
  _id: string;
  title: string;
  description?: string;
  clientName?: string;
  clientOrgId?: string;
  assigneeName?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
}

interface Summary {
  open: number;
  overdue: number;
  dueToday: number;
  completedThisWeek: number;
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: TaskStatus.TODO, label: 'To do' },
  { status: TaskStatus.IN_PROGRESS, label: 'In progress' },
  { status: TaskStatus.BLOCKED, label: 'Blocked' },
  { status: TaskStatus.DONE, label: 'Done' },
];

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: 'bg-surface-sink text-ink-500',
  [TaskPriority.NORMAL]: 'bg-surface-sink text-ink-700',
  [TaskPriority.HIGH]: 'bg-pending-bg text-pending-fg',
  [TaskPriority.URGENT]: 'bg-[#C92A2A]/10 text-[#C92A2A]',
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: 'Low',
  [TaskPriority.NORMAL]: 'Normal',
  [TaskPriority.HIGH]: 'High',
  [TaskPriority.URGENT]: 'Urgent',
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function isOverdue(dueDate?: string, status?: TaskStatus): boolean {
  if (!dueDate || status === TaskStatus.DONE) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function TaskCard({
  task,
  onMove,
  onDelete,
  busy,
}: {
  task: Task;
  onMove: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <li
      className={cn(
        'group rounded-xl border border-line-200 bg-surface-card p-3 transition-opacity',
        busy && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            'text-sm font-medium text-ink-900',
            task.status === TaskStatus.DONE && 'text-ink-400 line-through',
          )}
        >
          {task.title}
        </p>
        <button
          type="button"
          onClick={() => onDelete(task._id)}
          aria-label="Delete task"
          className="shrink-0 rounded p-0.5 text-ink-400 opacity-0 transition-opacity hover:text-[#C92A2A] group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {task.description ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-500">{task.description}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
            PRIORITY_STYLES[task.priority],
          )}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.clientName ? (
          <span className="rounded-md bg-surface-sink px-1.5 py-0.5 text-[10px] text-ink-700">
            {task.clientName}
          </span>
        ) : null}
        {task.assigneeName ? (
          <span className="text-[10px] text-ink-500">{task.assigneeName}</span>
        ) : null}
        {task.dueDate ? (
          <span
            className={cn(
              'ml-auto font-mono text-[10px]',
              overdue ? 'font-semibold text-[#C92A2A]' : 'text-ink-400',
            )}
          >
            {formatDate(task.dueDate)}
          </span>
        ) : null}
      </div>

      <Select value={task.status} onValueChange={(v) => onMove(task._id, v as TaskStatus)}>
        <SelectTrigger className="mt-2 h-7 border-line-200 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLUMNS.map((c) => (
            <SelectItem key={c.status} value={c.status}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  );
}

function NewTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  submitting: boolean;
  error: Error | null;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientOrgId, setClientOrgId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.NORMAL);
  const [dueDate, setDueDate] = useState('');

  const { data: clients } = useQuery<Client[]>({
    queryKey: ['firm', 'clients'],
    queryFn: () => api.get<Client[]>('/firm/clients'),
    enabled: open,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { title: title.trim(), priority };
    if (description.trim()) payload.description = description.trim();
    if (clientOrgId) payload.clientOrgId = clientOrgId;
    if (assigneeName.trim()) payload.assigneeName = assigneeName.trim();
    if (dueDate) payload.dueDate = dueDate;
    onSubmit(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Add task</DialogTitle>
          <DialogDescription>
            For work that is not already tracked as a deadline or a document request.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">
              Task <span className="text-[#C92A2A]">*</span>
            </Label>
            <Input
              id="task-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Chase Mehta for the bank statement"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-desc">Notes</Label>
            <textarea
              id="task-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-line-200 bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none focus:border-saffron-600"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-client">Client (optional)</Label>
              <Select value={clientOrgId || undefined} onValueChange={setClientOrgId}>
                <SelectTrigger id="task-client">
                  <SelectValue placeholder="No client" />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TaskPriority).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-assignee">Assign to</Label>
              <Input
                id="task-assignee"
                value={assigneeName}
                onChange={(e) => setAssigneeName(e.target.value)}
                placeholder="Priya"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? 'Adding…' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['crm', 'tasks'],
    queryFn: () => api.get<Task[]>('/crm/tasks'),
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['crm', 'tasks', 'summary'],
    queryFn: () => api.get<Summary>('/crm/tasks/summary'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'tasks'] });
  };

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/crm/tasks', payload),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
    },
  });

  /**
   * Moving a card is optimistic: the column changes immediately and rolls back
   * if the server disagrees. Dragging a task and watching it sit still for
   * 300ms is the difference between a board that feels alive and one that
   * feels broken.
   */
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      api.post(`/crm/tasks/${id}/status`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const previous = queryClient.getQueryData<Task[]>(['crm', 'tasks']);

      queryClient.setQueryData<Task[]>(['crm', 'tasks'], (old) =>
        (old ?? []).map((t) => (t._id === id ? { ...t, status } : t)),
      );

      setPending((s) => new Set(s).add(id));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['crm', 'tasks'], context.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      setPending((s) => {
        const next = new Set(s);
        next.delete(vars.id);
        return next;
      });
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/tasks/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const previous = queryClient.getQueryData<Task[]>(['crm', 'tasks']);
      queryClient.setQueryData<Task[]>(['crm', 'tasks'], (old) =>
        (old ?? []).filter((t) => t._id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['crm', 'tasks'], context.previous);
      }
    },
    onSettled: invalidate,
  });

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const c of COLUMNS) map.set(c.status, []);
    for (const t of tasks ?? []) map.get(t.status)?.push(t);
    return map;
  }, [tasks]);

  return (
    <div>
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-900">Tasks</h1>
            <p className="mt-1 text-sm text-ink-500">
              Your team&apos;s own work list. Deadlines and document chases already track
              themselves — this is for everything else.
            </p>
          </div>
          <Button className="gap-2" onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            Add task
          </Button>
        </div>
      </FadeIn>

      {summary ? (
        <Stagger className="mb-5 flex flex-wrap gap-3">
          {[
            { value: summary.open, label: 'Open', tone: 'text-ink-900' },
            { value: summary.dueToday, label: 'Due today', tone: 'text-pending-fg' },
            { value: summary.overdue, label: 'Overdue', tone: 'text-[#C92A2A]' },
            { value: summary.completedThisWeek, label: 'Done this week', tone: 'text-[#1E7B34]' },
          ].map((s) => (
            <StaggerItem key={s.label}>
              <div className="rounded-xl border border-line-200 bg-surface-card px-4 py-3">
                <p className={cn('font-mono text-xl font-bold', s.tone)}>{s.value}</p>
                <p className="text-xs text-ink-500">{s.label}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <div className="rounded-xl border border-line-200 bg-surface-card px-6 py-16 text-center">
          <CheckSquare size={32} className="mx-auto text-ink-400" />
          <p className="mt-3 font-heading text-lg font-semibold text-ink-900">No tasks yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Statutory deadlines and document chases run on their own. Add a task for the work
            that does not.
          </p>
          <Button className="mt-5 gap-2" onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            Add task
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const items = byStatus.get(column.status) ?? [];
            return (
              <section key={column.status}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="font-heading text-sm font-semibold text-ink-900">
                    {column.label}
                  </h2>
                  <span className="font-mono text-xs text-ink-400">{items.length}</span>
                </div>
                <ul className="space-y-2">
                  {items.map((task) => (
                    <TaskCard
                      key={task._id}
                      task={task}
                      busy={pending.has(task._id)}
                      onMove={(id, status) => move.mutate({ id, status })}
                      onDelete={(id) => remove.mutate(id)}
                    />
                  ))}
                  {items.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-line-200 px-3 py-8 text-center text-xs text-ink-400">
                      Nothing here
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {move.error ? (
        <p className="mt-4 rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
          Couldn&apos;t move that task — {(move.error as Error).message}
        </p>
      ) : null}

      <NewTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(payload) => create.mutate(payload)}
        submitting={create.isPending}
        error={create.error as Error | null}
      />
    </div>
  );
}
