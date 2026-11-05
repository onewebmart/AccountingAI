'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { DetailGrid, EmptyState, PageHeader, Section, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { Notice, errorText, shortDate } from '@/components/accountant/common';
import { PROJECT_STATUS, hoursText, useProjectList, type ProjectStatus, type TimeEntry } from '@/components/time/types';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Unbilled { lines: Array<{ description: string; hours: number; ratePaise: number; amountPaise: number; entries: number }>; unpriced: number }
interface Drafted { invoiceId: string; hours: number; lines: number; wording: string | null }

const STATUS_DONE: Record<ProjectStatus, string> = { active: 'Project reopened', on_hold: 'Project put on hold', completed: 'Project marked completed' };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const list = useProjectList();
  const project = (list.data ?? []).find((p) => p.id === id);
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [wording, setWording] = useState<string | null>(null);

  const unbilled = useQuery({ queryKey: ['projects', id, 'unbilled'], queryFn: () => api.get<Unbilled>(`/projects/${id}/unbilled`), enabled: !!project?.customerId });
  const entries = useQuery({ queryKey: ['projects', id, 'time'], queryFn: () => api.get<TimeEntry[]>(`/projects/time/entries?projectId=${id}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['projects'] });

  const bill = useMutation({
    mutationFn: () => api.post<Drafted>(`/projects/${id}/invoice`, {}),
    onSuccess: (r) => {
      refresh();
      setDrafted(r);
      setWording(r.wording);
      notify(`Invoice drafted: ${r.hours} hours on ${r.lines} line${r.lines === 1 ? '' : 's'}`);
    },
    onError: (err) => notify(errorText(err, "Couldn't draft the invoice."), 'error'),
  });
  const status = useMutation({
    mutationFn: (s: ProjectStatus) => api.post(`/projects/${id}/status`, { status: s }),
    onSuccess: (_r, s) => {
      refresh();
      notify(STATUS_DONE[s]);
    },
    onError: (err) => notify(errorText(err, "Couldn't change the project."), 'error'),
  });
  // The lines are worded in a background job: check back until it has.
  const poll = useQuery({
    queryKey: ['projects', 'wording', wording],
    queryFn: () => api.get<{ status: string; reason: string | null }>(`/projects/time/wording/${wording}`),
    enabled: !!wording,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') setWording(null);
  }, [poll.data]);

  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isLoading) return <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading the project…</p>;
  if (!project) return <EmptyState title="No such project" action={<Button asChild><Link href="/time/projects">Projects</Link></Button>} />;

  const p = project;
  const total = (unbilled.data?.lines ?? []).reduce((s, l) => s + l.amountPaise, 0);
  const time = entries.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title={p.name}
        back={{ href: '/time/projects', label: 'Projects' }}
        meta={<StatusChip tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</StatusChip>}
        subtitle={`${p.customerName ?? 'Internal work'} · ${p.billing === 'time' ? `by the hour${p.ratePaise ? ` at ${formatPaise(p.ratePaise)}` : ''}` : 'fixed fee'}`}
        actions={
          <>
            <Button variant="secondary" asChild><Link href={`/time/projects/${id}/edit`}><Pencil size={13} /> Edit</Link></Button>
            {p.status !== 'active' && <Button variant="secondary" disabled={status.isPending} onClick={() => status.mutate('active')}>Reopen</Button>}
            {p.status === 'active' && <Button variant="secondary" disabled={status.isPending} onClick={() => status.mutate('on_hold')}>Put on hold</Button>}
            {p.status !== 'completed' && <Button variant="secondary" disabled={status.isPending} onClick={() => status.mutate('completed')}>Mark completed</Button>}
          </>
        }
      />

      {p.alerts.map((a) => <Notice key={a.text} tone="pending">{a.level === 'over' ? 'Over budget: ' : ''}{a.text}</Notice>)}

      <Section>
        <DetailGrid
          items={[
            ['Income', <span key="i" className="font-mono">{formatPaise(p.incomePaise)}</span>],
            ['Costs', <span key="c" className="font-mono">{formatPaise(p.costPaise)}</span>],
            ['Profit', <span key="p" className="font-mono">{formatPaise(p.profitPaise)}</span>],
            ['Hours logged', <span key="h" className="font-mono">{hoursText(p.hours)}</span>],
            ['Unbilled', <span key="u" className="font-mono">{p.unbilledPaise ? `${formatPaise(p.unbilledPaise)} · ${hoursText(p.unbilledHours)}` : '—'}</span>],
            [p.billing === 'fixed' ? 'Fee' : 'Budget cap', p.budgetPaise == null ? '—' : <span key="b" className="font-mono">{formatPaise(p.budgetPaise)}</span>],
            ['Budgeted hours', p.budgetHours == null ? '—' : <span key="bh" className="font-mono">{hoursText(p.budgetHours)}</span>],
            ['Code', p.code ? <span key="code" className="font-mono">{p.code}</span> : '—'],
            ['Dates', p.startDate || p.endDate ? `${shortDate(p.startDate)} to ${shortDate(p.endDate)}` : '—'],
          ]}
        />
        {p.notes && <p className="mt-4 whitespace-pre-line text-body text-ink-700">{p.notes}</p>}
      </Section>

      {p.customerId && (
        <Section
          title="Unbilled time"
          description="Billable time not yet on an invoice, a line per task and rate."
          actions={
            <Button disabled={!unbilled.data?.lines.length || bill.isPending} onClick={() => bill.mutate()}>
              {bill.isPending ? 'Drafting…' : 'Draft invoice from time'}
            </Button>
          }
        >
          {unbilled.isError && <Notice tone="error">{errorText(unbilled.error)}</Notice>}
          {unbilled.data?.lines.length ? (
            <TableCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className={th}>Line</th>
                    <th className={`${th} text-right`}>Hours × rate</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {unbilled.data.lines.map((l) => (
                    <tr key={l.description} className="border-b border-line-100 last:border-0">
                      <td className={td}>{l.description}</td>
                      <td className={tdMoney}>{hoursText(l.hours)} × {formatPaise(l.ratePaise)}</td>
                      <td className={tdMoney}>{formatPaise(l.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-200 bg-surface-sink">
                    <td className={`${td} font-medium`} colSpan={2}>Before GST</td>
                    <td className={`${tdMoney} font-medium`}>{formatPaise(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableCard>
          ) : (
            !unbilled.isLoading && <p className="text-body text-ink-500">No billable time waiting.</p>
          )}
          {!!unbilled.data?.unpriced && (
            <p className="mt-2 text-caption text-pending-fg">{unbilled.data.unpriced} entr{unbilled.data.unpriced === 1 ? 'y has' : 'ies have'} no rate: give the project a rate per hour.</p>
          )}
          {drafted && (
            <p className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-caption text-pending-fg">
              {wording ? (
                <><Loader2 size={12} className="animate-spin" /> AI is wording the lines from the time notes…</>
              ) : poll.data?.status === 'done' ? (
                <><Sparkles size={12} /> {poll.data.reason}</>
              ) : (
                'A draft: check it, then post it.'
              )}
              <Link className="ml-1 font-medium underline" href={`/sales/invoices/${drafted.invoiceId}`}>Open the draft invoice</Link>
            </p>
          )}
        </Section>
      )}

      <Section
        title="Time"
        actions={p.status !== 'completed' ? <Button variant="secondary" size="sm" asChild><Link href={`/time/timesheet?projectId=${id}`}>Log time</Link></Button> : undefined}
      >
        {entries.isError && <Notice tone="error">{errorText(entries.error)}</Notice>}
        {time.length === 0 ? (
          !entries.isLoading && <p className="text-body text-ink-500">No time logged yet.</p>
        ) : (
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Date</th>
                  <th className={th}>Person</th>
                  <th className={th}>Task</th>
                  <th className={`${th} text-right`}>Hours</th>
                  <th className={th}>Billing</th>
                </tr>
              </thead>
              <tbody>
                {time.map((e) => (
                  <tr key={e.id} className="border-b border-line-100 last:border-0">
                    <td className={`${td} whitespace-nowrap`}>{shortDate(e.date)}</td>
                    <td className={td}>{e.userName}</td>
                    <td className={td}>{e.task}{e.notes ? <span className="text-caption text-ink-500"> · {e.notes}</span> : null}</td>
                    <td className={tdMoney}>{hoursText(e.hours)}</td>
                    <td className={td}>
                      {!e.billable ? <span className="text-caption text-ink-500">Not billable</span>
                        : e.status === 'billed' ? <StatusChip tone="success">Invoiced</StatusChip>
                          : e.status === 'billing' ? <StatusChip tone="pending">On a draft</StatusChip>
                            : <span className="text-caption text-ink-600">Unbilled</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-200 bg-surface-sink">
                  <td className={`${td} font-medium`} colSpan={3}>Total</td>
                  <td className={`${tdMoney} font-medium`}>{hoursText(time.reduce((s, e) => s + e.hours, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableCard>
        )}
      </Section>
    </div>
  );
}
