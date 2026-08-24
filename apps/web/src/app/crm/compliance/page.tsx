'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ComplianceStatus, ComplianceType } from '@ai-accounting/shared';
import { Bell, CalendarClock, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FadeIn } from '@/components/motion/primitives';

interface DeadlineClient {
  itemId: string;
  clientOrgId: string;
  clientName: string;
  status: ComplianceStatus;
}

interface DeadlineGroup {
  complianceType: ComplianceType;
  label: string;
  authority: string;
  periodKey: string;
  periodLabel: string;
  dueDate: string;
  daysLeft: number;
  pendingCount: number;
  filedCount: number;
  clients: DeadlineClient[];
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Amber = pending/urgent, cool red = overdue, green = done. Never orange for errors. */
function UrgencyPill({ daysLeft }: { daysLeft: number }) {
  if (daysLeft < 0) {
    return (
      <span className="rounded-full bg-[#C92A2A]/10 px-2 py-0.5 text-[11px] font-semibold text-[#C92A2A]">
        {Math.abs(daysLeft)} days overdue
      </span>
    );
  }
  if (daysLeft === 0) {
    return (
      <span className="rounded-full bg-[#C92A2A]/10 px-2 py-0.5 text-[11px] font-semibold text-[#C92A2A]">
        Due today
      </span>
    );
  }
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
        daysLeft <= 7 ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-500',
      )}
    >
      {daysLeft} days left
    </span>
  );
}

function DeadlineCard({
  group,
  onFile,
  filing,
}: {
  group: DeadlineGroup;
  onFile: (itemId: string) => void;
  filing: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.clients : group.clients.slice(0, 3);
  const hidden = group.clients.length - shown.length;

  return (
    <li className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading font-semibold text-ink-900">
            {group.label} — {group.periodLabel}
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            {group.pendingCount} pending
            {group.filedCount > 0 ? ` · ${group.filedCount} filed` : ''} · {group.authority}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-medium text-ink-900">{formatDate(group.dueDate)}</p>
          <div className="mt-1">
            <UrgencyPill daysLeft={group.daysLeft} />
          </div>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <li key={c.itemId}>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs',
                c.status === ComplianceStatus.FILED
                  ? 'border-[#1E7B34]/20 bg-[#E6F4EA] text-[#1E7B34]'
                  : 'border-line-200 bg-surface-sink text-ink-700',
              )}
            >
              {c.status === ComplianceStatus.FILED ? <CheckCircle2 size={12} /> : null}
              {c.clientName}
              {c.status !== ComplianceStatus.FILED ? (
                <button
                  type="button"
                  onClick={() => onFile(c.itemId)}
                  disabled={filing === c.itemId}
                  className="ml-1 rounded px-1 text-[11px] font-semibold text-saffron-700 hover:underline disabled:opacity-50"
                >
                  {filing === c.itemId ? '…' : 'Mark filed'}
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {hidden > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-500 hover:text-ink-700"
            >
              +{hidden} more
            </button>
          </li>
        ) : null}
      </ul>
    </li>
  );
}

function DeadlineList({
  groups,
  isLoading,
  emptyTitle,
  emptyBody,
  onFile,
  filing,
}: {
  groups: DeadlineGroup[];
  isLoading: boolean;
  emptyTitle: string;
  emptyBody: string;
  onFile: (itemId: string) => void;
  filing: string | null;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-line-200 bg-surface-card px-6 py-14 text-center">
        <CalendarClock size={28} className="mx-auto text-ink-400" />
        <p className="mt-3 font-heading text-lg font-semibold text-ink-900">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">{emptyBody}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <DeadlineCard
          key={`${g.complianceType}-${g.periodKey}`}
          group={g}
          onFile={onFile}
          filing={filing}
        />
      ))}
    </ul>
  );
}

export default function CompliancePage() {
  const queryClient = useQueryClient();
  const [filing, setFiling] = useState<string | null>(null);

  const { data: groups, isLoading } = useQuery<DeadlineGroup[]>({
    queryKey: ['crm', 'compliance'],
    queryFn: () => api.get<DeadlineGroup[]>('/crm/compliance'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'compliance'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'messages'] });
  };

  const generate = useMutation({
    mutationFn: () => api.post('/crm/compliance/generate'),
    onSuccess: invalidate,
  });

  const runReminders = useMutation({
    mutationFn: () => api.post<{ remindersQueued: number; skippedNoContact: number }>(
      '/crm/compliance/run-reminders',
    ),
    onSuccess: invalidate,
  });

  const markFiled = useMutation({
    mutationFn: (itemId: string) => api.post(`/crm/compliance/items/${itemId}/file`),
    onSettled: () => {
      setFiling(null);
      invalidate();
    },
  });

  const onFile = (itemId: string) => {
    setFiling(itemId);
    markFiled.mutate(itemId);
  };

  const all = groups ?? [];
  const { urgent, upcoming, filed } = useMemo(() => {
    // A group is "filed" only when nothing is left pending on it.
    const done = all.filter((g) => g.pendingCount === 0 && g.filedCount > 0);
    const open = all.filter((g) => g.pendingCount > 0);
    return {
      urgent: open.filter((g) => g.daysLeft <= 7),
      upcoming: open.filter((g) => g.daysLeft > 7),
      filed: done,
    };
  }, [all]);

  return (
    <div>
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-900">Compliance</h1>
            <p className="mt-1 text-sm text-ink-500">
              GST, TDS, ITR and ROC deadlines, generated from each client&apos;s services.
              Clients are reminded 7, 3 and 1 days before.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              <RefreshCw size={16} />
              {generate.isPending ? 'Refreshing…' : 'Refresh calendar'}
            </Button>
            <Button
              className="gap-2"
              onClick={() => runReminders.mutate()}
              disabled={runReminders.isPending}
            >
              <Send size={16} />
              {runReminders.isPending ? 'Queueing…' : 'Send due reminders'}
            </Button>
          </div>
        </div>
      </FadeIn>

      {runReminders.isSuccess ? (
        <p className="mb-4 rounded-lg bg-[#E6F4EA] px-3 py-2 text-sm text-[#1E7B34]">
          Queued {runReminders.data.remindersQueued} reminder(s)
          {runReminders.data.skippedNoContact > 0
            ? ` · ${runReminders.data.skippedNoContact} client(s) skipped for missing contact details`
            : ''}
          . They appear in Settings → Outbox.
        </p>
      ) : null}
      {generate.isSuccess ? (
        <p className="mb-4 rounded-lg bg-surface-sink px-3 py-2 text-sm text-ink-700">
          Calendar up to date.
        </p>
      ) : null}
      {generate.error || runReminders.error ? (
        <p className="mb-4 rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
          {((generate.error ?? runReminders.error) as Error).message}
        </p>
      ) : null}

      <Tabs defaultValue="urgent">
        <TabsList className="mb-5">
          <TabsTrigger value="urgent" className="gap-2">
            <Bell size={14} />
            Urgent ({urgent.length})
          </TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="filed">Filed ({filed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="urgent">
          <DeadlineList
            groups={urgent}
            isLoading={isLoading}
            emptyTitle="Nothing urgent"
            emptyBody="No deadlines fall inside the next seven days. Check Upcoming for what's ahead."
            onFile={onFile}
            filing={filing}
          />
        </TabsContent>
        <TabsContent value="upcoming">
          <DeadlineList
            groups={upcoming}
            isLoading={isLoading}
            emptyTitle="No upcoming deadlines"
            emptyBody="Add clients and tick the services you handle for them, then refresh the calendar."
            onFile={onFile}
            filing={filing}
          />
        </TabsContent>
        <TabsContent value="filed">
          <DeadlineList
            groups={filed}
            isLoading={isLoading}
            emptyTitle="Nothing filed yet"
            emptyBody="Deadlines move here once every client on them is marked filed."
            onFile={onFile}
            filing={filing}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
