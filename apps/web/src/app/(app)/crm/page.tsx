'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Bot,
  ChevronRight,
  FileText,
  IndianRupee,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/use-workspace';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CountUp, FadeIn, HoverLift, Stagger, StaggerItem } from '@/components/motion/primitives';

interface DashboardSummary {
  clients: { total: number; addedThisMonth: number };
  deadlines: {
    pending: number;
    urgent: number;
    overdue: number;
    upcoming: {
      complianceType: string;
      periodLabel: string;
      dueDate: string;
      daysLeft: number;
      clientsPending: number;
    }[];
  };
  fees: {
    billedPaise: number;
    collectedPaise: number;
    outstandingPaise: number;
    clientsOverdue: number;
  };
  documents: { openRequests: number; itemsOutstanding: number; awaitingVerification: number };
  leads: { active: number; pipelineValuePaise: number; won: number; lost: number };
  agent: {
    inboundTotal: number;
    autoRepliedTotal: number;
    autoResolveRate: number;
    escalatedOpen: number;
    messagesSent: number;
  };
  recentActivity: { clientName: string; summary: string; at: string }[];
}

/** Money is integer paise everywhere; only display divides by 100. */
function formatPaise(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'pending' | 'bad';
  icon: React.ReactNode;
  href: string;
}) {
  const toneClass = {
    neutral: 'text-ink-900',
    good: 'text-[#1E7B34]',
    pending: 'text-pending-fg',
    bad: 'text-[#C92A2A]',
  }[tone];

  return (
    <HoverLift className="h-full">
      <Link
        href={href}
        className="group block h-full rounded-xl border border-line-200 bg-surface-card p-4 transition-colors hover:border-saffron-600"
      >
        <div className="flex items-center gap-2 text-ink-500">
          {icon}
          <span className="text-xs">{label}</span>
          <ChevronRight
            size={14}
            className="ml-auto text-ink-400 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        <p className={cn('mt-2 font-mono text-2xl font-bold', toneClass)}>{value}</p>
        {sub ? <p className="mt-0.5 text-xs text-ink-500">{sub}</p> : null}
      </Link>
    </HoverLift>
  );
}

/**
 * Shown when the org has not turned practice management on yet.
 *
 * The CRM is firm-scoped, so without a Firm these screens have nothing to read.
 * Rather than a dead end, this offers the one action that makes them work.
 */
function PracticeSetup() {
  const { data: workspace } = useWorkspace();
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  const enable = useMutation({
    mutationFn: (firmName: string) =>
      api.post<{ firm: { name: string }; reauthRequired: boolean }>('/workspace/practice', {
        firmName,
      }),
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <div className="rounded-xl border border-line-200 bg-surface-card px-6 py-14 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E6F4EA] text-[#1E7B34]">
          <Users size={26} />
        </span>
        <p className="mt-4 font-heading text-lg font-semibold text-ink-900">Practice created</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-500">
          Your access level is part of your sign-in, so you need to sign in again before the
          practice screens will open.
        </p>
        <Button className="mt-6" onClick={() => { window.location.href = '/auth/login'; }}>
          Sign in again
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line-200 bg-surface-card px-6 py-14 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-honey-100 text-saffron-700">
        <Users size={26} />
      </span>
      <p className="mt-4 font-heading text-lg font-semibold text-ink-900">
        Turn on practice management
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-500">
        Track a client book, chase statutory deadlines and documents automatically, qualify
        enquiries, and bill your fees — alongside the books you already keep here.
      </p>

      <form
        className="mx-auto mt-6 flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          enable.mutate(name.trim() || (workspace?.org.name ?? ''));
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={workspace?.org.name ?? 'Your practice name'}
          aria-label="Practice name"
        />
        <Button type="submit" disabled={enable.isPending}>
          {enable.isPending ? 'Setting up…' : 'Set up'}
        </Button>
      </form>

      {enable.error ? (
        <p className="mt-3 text-sm text-[#C92A2A]">{(enable.error as Error).message}</p>
      ) : null}
    </div>
  );
}

export default function CrmDashboardPage() {
  const { data: workspace, isLoading: workspaceLoading } = useWorkspace();
  const { data, isLoading, error } = useQuery<DashboardSummary>({
    queryKey: ['crm', 'dashboard'],
    queryFn: () => api.get<DashboardSummary>('/crm/dashboard'),
    refetchInterval: 30_000,
  });

  if (workspaceLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!workspace?.firm) {
    return (
      <div>
        <FadeIn>
          <div className="mb-6">
            <h1 className="font-heading text-2xl font-bold text-ink-900">Practice</h1>
            <p className="mt-1 text-sm text-ink-500">
              The CA-firm side of the product.
            </p>
          </div>
        </FadeIn>
        <PracticeSetup />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-6 h-9 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-[#C92A2A]/30 bg-[#C92A2A]/5 p-6">
        <p className="font-medium text-[#C92A2A]">Couldn&apos;t load the dashboard</p>
        <p className="mt-1 text-sm text-ink-500">{(error as Error)?.message}</p>
      </div>
    );
  }

  return (
    <div>
      <FadeIn>
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold text-ink-900">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">Where your practice stands today.</p>
        </div>
      </FadeIn>

      <Stagger className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <StatTile
            href="/crm/clients"
            icon={<Users size={15} />}
            label="Clients"
            value={String(data.clients.total)}
            sub={
              data.clients.addedThisMonth > 0
                ? `+${data.clients.addedThisMonth} this month`
                : 'No new clients this month'
            }
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            href="/crm/compliance"
            icon={<Bell size={15} />}
            label="Pending deadlines"
            value={String(data.deadlines.pending)}
            tone={data.deadlines.overdue > 0 ? 'bad' : data.deadlines.urgent > 0 ? 'pending' : 'neutral'}
            sub={
              data.deadlines.overdue > 0
                ? `${data.deadlines.overdue} overdue · ${data.deadlines.urgent} within 7 days`
                : data.deadlines.urgent > 0
                  ? `${data.deadlines.urgent} within 7 days`
                  : 'Nothing urgent'
            }
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            href="/crm/invoices"
            icon={<IndianRupee size={15} />}
            label="Fees collected"
            value={formatPaise(data.fees.collectedPaise)}
            tone="good"
            sub={`of ${formatPaise(data.fees.billedPaise)} billed`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            href="/crm/invoices"
            icon={<AlertTriangle size={15} />}
            label="Outstanding"
            value={formatPaise(data.fees.outstandingPaise)}
            tone={data.fees.outstandingPaise > 0 ? 'pending' : 'neutral'}
            sub={
              data.fees.clientsOverdue > 0
                ? `${data.fees.clientsOverdue} client(s) overdue`
                : 'Nothing overdue'
            }
          />
        </StaggerItem>
      </Stagger>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Upcoming deadlines */}
        <section className="rounded-xl border border-line-200 bg-surface-card">
          <div className="flex items-center justify-between border-b border-line-200 px-4 py-3">
            <h2 className="font-heading text-sm font-semibold text-ink-900">
              Upcoming compliance deadlines
            </h2>
            <Link href="/crm/compliance" className="text-xs font-medium text-saffron-700 hover:underline">
              View all
            </Link>
          </div>

          {data.deadlines.upcoming.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-400">
              No deadlines ahead. Add clients and their services, then refresh the calendar.
            </p>
          ) : (
            <ul className="divide-y divide-line-200">
              {data.deadlines.upcoming.map((d) => (
                <li
                  key={`${d.complianceType}-${d.periodLabel}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {d.complianceType.replace(/_/g, '-')} · {d.periodLabel}
                    </p>
                    <p className="text-xs text-ink-500">{d.clientsPending} client(s) pending</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm text-ink-900">{formatDate(d.dueDate)}</p>
                    <p
                      className={cn(
                        'text-[11px] font-semibold',
                        d.daysLeft <= 7 ? 'text-pending-fg' : 'text-ink-400',
                      )}
                    >
                      {d.daysLeft} days left
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Right rail */}
        <div className="space-y-4">
          <section className="rounded-xl border border-line-200 bg-surface-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Bot size={15} className="text-saffron-600" />
              <h2 className="font-heading text-sm font-semibold text-ink-900">Agent activity</h2>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Questions handled</dt>
                <dd className="font-mono text-ink-900">{data.agent.autoRepliedTotal}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Auto-resolve rate</dt>
                <dd className="font-mono text-[#1E7B34]">{data.agent.autoResolveRate}%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Messages sent</dt>
                <dd className="font-mono text-ink-900">{data.agent.messagesSent}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Waiting on you</dt>
                <dd
                  className={cn(
                    'font-mono',
                    data.agent.escalatedOpen > 0 ? 'text-pending-fg' : 'text-ink-900',
                  )}
                >
                  {data.agent.escalatedOpen}
                </dd>
              </div>
            </dl>
            <Link
              href="/crm/agent"
              className="mt-3 block text-xs font-medium text-saffron-700 hover:underline"
            >
              Open conversations
            </Link>
          </section>

          <section className="rounded-xl border border-line-200 bg-surface-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp size={15} className="text-saffron-600" />
              <h2 className="font-heading text-sm font-semibold text-ink-900">Lead pipeline</h2>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-mono text-2xl font-bold text-ink-900">{data.leads.active}</p>
                <p className="text-xs text-ink-500">Active leads</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-bold text-saffron-700">
                  {formatPaise(data.leads.pipelineValuePaise)}
                </p>
                <p className="text-xs text-ink-500">Pipeline value</p>
              </div>
            </div>
            <Link
              href="/crm/leads"
              className="mt-3 block text-xs font-medium text-saffron-700 hover:underline"
            >
              Open pipeline
            </Link>
          </section>

          <section className="rounded-xl border border-line-200 bg-surface-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileText size={15} className="text-saffron-600" />
              <h2 className="font-heading text-sm font-semibold text-ink-900">Documents</h2>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Still missing</dt>
                <dd className="font-mono text-ink-900">{data.documents.itemsOutstanding}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Awaiting your check</dt>
                <dd
                  className={cn(
                    'font-mono',
                    data.documents.awaitingVerification > 0 ? 'text-pending-fg' : 'text-ink-900',
                  )}
                >
                  {data.documents.awaitingVerification}
                </dd>
              </div>
            </dl>
            <Link
              href="/crm/documents"
              className="mt-3 block text-xs font-medium text-saffron-700 hover:underline"
            >
              Open document hub
            </Link>
          </section>
        </div>
      </div>

      {/* Recent activity */}
      <section className="mt-4 rounded-xl border border-line-200 bg-surface-card">
        <div className="border-b border-line-200 px-4 py-3">
          <h2 className="font-heading text-sm font-semibold text-ink-900">Recent activity</h2>
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-400">
            Nothing yet — reminders and agent replies will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-line-200">
            {data.recentActivity.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">{a.clientName}</p>
                  <p className="text-xs text-ink-500">{a.summary}</p>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-ink-400">
                  {new Date(a.at).toLocaleString('en-IN')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
