'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Plus, Repeat, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError, TableError } from '@/components/ui/query-error';
import { PageHeader, TableCard, EmptyState, Section, StatusChip, th, td, tdMoney } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, shortDate } from '@/components/sales/sales-data';

type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'bimonthly' | 'quarterly' | 'half_yearly' | 'yearly';

interface Template {
  _id: string;
  kind: 'bill' | 'invoice' | 'journal';
  name: string;
  partyName: string | null;
  frequency: Frequency;
  dayOfMonth: number;
  endDate: string | null;
  nextRunDate: string | null;
  dueInDays: number;
  totalPaise: number;
  status: 'active' | 'paused' | 'ended';
  draftedCount: number;
  lastDraftedOn: string | null;
  lastError: string | null;
  startDate?: string;
  subject?: string | null;
  referenceNumber?: string | null;
  salespersonName?: string | null;
}

interface ReminderSettings {
  enabled: boolean;
  channel: 'auto' | 'email' | 'whatsapp';
  provider: string;
}

interface Reminder {
  _id: string;
  invoiceNumber: string;
  customerName: string;
  rung: string;
  channel: 'email' | 'whatsapp';
  to: string;
  subject: string | null;
  outstandingPaise: number;
  status: 'queued' | 'sent' | 'failed';
  isMock: boolean;
  error: string | null;
  createdAt: string;
}

const FREQUENCY: Record<Frequency, string> = {
  weekly: 'Every week',
  fortnightly: 'Every 2 weeks',
  monthly: 'Every month',
  bimonthly: 'Every 2 months',
  quarterly: 'Every quarter',
  half_yearly: 'Every 6 months',
  yearly: 'Every year',
};
/** Weekly ones repeat on a weekday, not a day of the month. */
const weekday = (date: string | null | undefined) => (date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) : '');
const RUNG: Record<string, string> = {
  before_due: '3 days before due',
  on_due: 'On the due date',
  late_7: '7 days late',
  late_15: '15 days late',
  late_30: '30 days late',
  manual: 'Sent by hand',
};

function dayLabel(day: number): string {
  if (day === 31) return 'last day';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

/**
 * The reminders that chase customers for what they owe: 3 days before the
 * due date, on it, and 7, 15 and 30 days after. Each step goes once.
 */
function PaymentReminders() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['reminders', 'settings'], queryFn: () => api.get<ReminderSettings>('/reminders/settings') });
  const reminders = useQuery({ queryKey: ['reminders', 'list'], queryFn: () => api.get<Reminder[]>('/reminders') });
  const s = settings.data;

  const update = useMutation({
    mutationFn: (patch: Partial<Pick<ReminderSettings, 'enabled' | 'channel'>>) => api.patch('/reminders/settings', patch),
    onSuccess: (_d, patch) => {
      notify(patch.enabled !== undefined ? (patch.enabled ? 'Reminders turned on' : 'Reminders turned off') : 'Reminder settings saved');
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (e) => notify(errorText(e, "Couldn't save the reminder settings"), 'error'),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ queued: number; noContact: Array<{ customerName: string }> }>('/reminders/run'),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
      const missing = r.noContact.length ? ` · ${r.noContact.length} customer${r.noContact.length === 1 ? ' has' : 's have'} no email or phone` : '';
      notify(`${r.queued ? `Sent ${r.queued} reminder${r.queued === 1 ? '' : 's'}` : 'No reminders due today'}${missing}`, r.queued ? 'success' : 'info');
    },
    onError: (e) => notify(errorText(e, "Couldn't send today's reminders"), 'error'),
  });

  return (
    <div id="reminders">
      <Section
        title="Payment reminders"
        description="Customers with an open invoice hear from you 3 days before it is due, on the day, and 7, 15 and 30 days after. Each step goes once. You can also chase one invoice from its page."
        actions={<Button size="sm" variant="secondary" disabled={!s?.enabled || run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Sending…' : "Send today's reminders"}</Button>}
      >
        {settings.isError ? (
          <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <div className="mb-4 flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={s?.enabled ?? false} disabled={!s || update.isPending} onChange={(e) => update.mutate({ enabled: e.target.checked })} />
              <span className="text-body font-medium text-ink-900">Send reminders automatically</span>
            </label>
            <label className="flex items-center gap-2 text-body text-ink-700">
              Send by
              <select
                className="rounded-md border border-line-200 bg-white px-2 py-1 text-body focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
                value={s?.channel ?? 'auto'}
                disabled={!s || update.isPending}
                onChange={(e) => update.mutate({ channel: e.target.value as ReminderSettings['channel'] })}
              >
                <option value="auto">Email, or WhatsApp if no email</option>
                <option value="email">Email only</option>
                <option value="whatsapp">WhatsApp only</option>
              </select>
            </label>
            {s?.provider === 'mock' && (
              <p className="basis-full text-caption text-pending-fg">No WhatsApp or email service is connected yet, so reminders are written and logged here but do not leave.</p>
            )}
          </div>
        )}

        <TableCard className="border-line-100">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>When</th>
                <th className={th}>Customer</th>
                <th className={th}>Invoice</th>
                <th className={th}>Step</th>
                <th className={th}>To</th>
                <th className={`${th} text-right`}>Owed</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {reminders.isLoading ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : reminders.isError ? (
                <TableError error={reminders.error} colSpan={7} onRetry={() => void reminders.refetch()} />
              ) : (reminders.data ?? []).length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-caption text-ink-400">No reminders yet.</td></tr>
              ) : (
                (reminders.data ?? []).map((r) => (
                  <tr key={r._id} title={r.subject ?? undefined} className="border-b border-line-100 last:border-0">
                    <td className={`${td} whitespace-nowrap font-mono text-caption`}>{new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className={td}>{r.customerName}</td>
                    <td className={`${td} font-mono text-caption`}>{r.invoiceNumber}</td>
                    <td className={`${td} text-caption`}>{RUNG[r.rung] ?? r.rung}</td>
                    <td className={`${td} text-caption`}>{r.channel === 'email' ? 'Email' : 'WhatsApp'} · {r.to}</td>
                    <td className={tdMoney}>{formatPaise(r.outstandingPaise)}</td>
                    <td className={`${td} text-caption`}>
                      {r.status === 'sent' ? (
                        <span className="text-success-fg">{r.isMock ? 'Logged (not sent)' : 'Sent'}</span>
                      ) : r.status === 'failed' ? (
                        <span className="text-error-fg" title={r.error ?? undefined}>Failed</span>
                      ) : (
                        <span className="text-pending-fg">Queued</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableCard>
      </Section>
    </div>
  );
}

/** Invoices that repeat, drafted on their dates for a person to post, and the reminders that chase what is owed. */
export default function RecurringInvoicesPage() {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['recurring'], queryFn: () => api.get<Template[]>('/recurring') });
  const rows = (templates.data ?? []).filter((t) => t.kind === 'invoice');

  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'end' }) => api.post(`/recurring/${id}/${action}`),
    onSuccess: (_d, { action }) => {
      notify(action === 'pause' ? 'Schedule paused' : action === 'resume' ? 'Schedule resumed' : 'Schedule ended', action === 'resume' ? 'success' : 'info');
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
    onError: (e) => notify(errorText(e, "Couldn't change the schedule"), 'error'),
  });

  const runDue = useMutation({
    mutationFn: () => api.post<{ drafted: Array<{ kind: string }>; failed: Array<{ name: string; error: string }> }>('/recurring-run'),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase'] });
      const invoices = run.drafted.filter((d) => d.kind === 'invoice').length;
      if (run.failed.length) notify(`${run.failed[0].name}: ${run.failed[0].error}`, 'error');
      else if (run.drafted.length) notify(`Drafted ${run.drafted.length}${invoices && invoices < run.drafted.length ? `, ${invoices} of them invoices` : ''}: post them from Invoices`);
      else notify('Nothing is due yet', 'info');
    },
    onError: (e) => notify(errorText(e, "Couldn't draft what's due"), 'error'),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        guide="recurringInvoices"
        title="Recurring invoices"
        subtitle={<>Retainers, rent and subscriptions, drafted each morning at 6:30 for you to check and post on <Link href="/sales/invoices" className="underline">Invoices</Link>. Nothing posts on its own.</>}
        actions={
          <>
            <Button variant="secondary" disabled={runDue.isPending} onClick={() => runDue.mutate()}>
              <Repeat size={14} /> {runDue.isPending ? 'Drafting…' : "Draft what's due"}
            </Button>
            <Button asChild><Link href="/sales/recurring-invoices/new"><Plus size={14} /> New recurring invoice</Link></Button>
          </>
        }
      />

      {!templates.isLoading && !templates.isError && rows.length === 0 ? (
        <EmptyState
          guide="recurringInvoices"
          title="Nothing repeats yet"
          body="Add a retainer or a subscription, and it drafts itself each period."
          action={<Button asChild><Link href="/sales/recurring-invoices/new"><Plus size={14} /> New recurring invoice</Link></Button>}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Name</th>
                <th className={th}>Customer</th>
                <th className={th}>Schedule</th>
                <th className={th}>Next draft</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Each time</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {templates.isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : templates.isError ? (
                <TableError error={templates.error} colSpan={7} onRetry={() => void templates.refetch()} />
              ) : (
                rows.map((t) => (
                  <tr key={t._id} className={`border-b border-line-100 align-top last:border-0 ${t.status === 'ended' ? 'opacity-60' : ''}`}>
                    <td className={td}>
                      <p className="font-medium">{t.name}</p>
                      {t.subject && <p className="text-caption text-ink-600">{t.subject}</p>}
                      <p className="text-caption text-ink-500">{t.draftedCount} drafted{t.lastDraftedOn ? `, last on ${shortDate(t.lastDraftedOn)}` : ''}{t.referenceNumber ? ` · order ${t.referenceNumber}` : ''}</p>
                    </td>
                    <td className={td}>{t.partyName ?? '—'}</td>
                    <td className={`${td} whitespace-nowrap text-caption`}>
                      {FREQUENCY[t.frequency] ?? t.frequency}, {t.frequency === 'weekly' || t.frequency === 'fortnightly' ? `on ${weekday(t.nextRunDate ?? t.startDate)}` : dayLabel(t.dayOfMonth)}
                      <br />
                      <span className="text-ink-500">due in {t.dueInDays} days{t.endDate ? ` · until ${shortDate(t.endDate)}` : ''}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap font-mono text-caption`}>{t.nextRunDate ?? '—'}</td>
                    <td className={td}>
                      <StatusChip tone={t.status === 'active' ? 'success' : t.status === 'paused' ? 'pending' : 'neutral'}>
                        {t.status === 'active' ? 'Active' : t.status === 'paused' ? 'Paused' : 'Ended'}
                      </StatusChip>
                      {t.lastError && <p className="mt-1 max-w-[220px] text-caption text-error-fg">{t.lastError}</p>}
                    </td>
                    <td className={tdMoney}>{formatPaise(t.totalPaise)}</td>
                    <td className={`${td} text-right`}>
                      {t.status !== 'ended' && (
                        <span className="inline-flex gap-1">
                          <button
                            type="button"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: t._id, action: t.status === 'active' ? 'pause' : 'resume' })}
                            className="rounded p-1.5 text-ink-500 hover:bg-surface-sink hover:text-ink-900"
                            aria-label={t.status === 'active' ? `Pause ${t.name}` : `Resume ${t.name}`}
                            title={t.status === 'active' ? 'Pause' : 'Resume'}
                          >
                            {t.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
                          </button>
                          <button
                            type="button"
                            disabled={setStatus.isPending}
                            onClick={() => window.confirm(`End "${t.name}"? Drafts already made stay; no more are made.`) && setStatus.mutate({ id: t._id, action: 'end' })}
                            className="rounded p-1.5 text-ink-500 hover:bg-surface-sink hover:text-error-fg"
                            aria-label={`End ${t.name}`}
                            title="End"
                          >
                            <Square size={15} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableCard>
      )}

      <PaymentReminders />
    </div>
  );
}
