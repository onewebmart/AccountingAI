'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Repeat, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { Field, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { errorText, shortDate } from './purchase-data';
import { termsLabel } from '@/components/parties/party-profile';
import { ModuleGuide } from '@/components/guide/module-guide';
import type { GuideKey } from '@/components/guide/keys';
import type { Frequency as ScheduleFrequency } from '@/lib/schedule';

/** Every schedule the server runs (automation/schedule.ts); the bill form offers the monthly ones. */
export type Frequency = ScheduleFrequency;

/** GET /recurring — every schedule; the purchase pages show bills and expenses. */
export interface Template {
  _id: string;
  kind: 'bill' | 'invoice' | 'journal' | 'expense';
  name: string;
  partyId: string | null;
  partyName: string | null;
  frequency: Frequency;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string | null;
  dueInDays: number;
  totalPaise: number;
  isReverseCharge: boolean;
  expense: {
    expenseAccountId: string;
    paidThroughAccountId: string;
    taxablePaise: number;
    gstRatePct: number;
    claimable: boolean;
    /** Itemized: each drafted expense split across these. */
    lines?: Array<{ expenseAccountId: string; amountPaise: number; gstRatePct: number; description: string | null }>;
    customerId?: string | null;
    customerName?: string | null;
    billable?: boolean;
  } | null;
  status: 'active' | 'paused' | 'ended';
  draftedCount: number;
  lastDraftedOn: string | null;
  lastError: string | null;
  /** Bills set up from lines: each drafted as a typed bill is. */
  billFromLines?: boolean;
  lineItems?: Array<{ description: string; customerId?: string | null; billable?: boolean }>;
  discount?: { percent: number | null; amountPaise: number } | null;
  discountLevel?: 'transaction' | 'line' | null;
  adjustment?: { label: string; paise: number } | null;
  paymentTerms?: string | null;
  referenceNumber?: string | null;
}

/** A recurring bill's lines, discount and adjustment, in a few words. */
function billWords(t: Template): string {
  const lines = t.lineItems ?? [];
  const parts = [
    lines.length > 1 ? `${lines.length} lines` : null,
    t.discount && t.discount.amountPaise > 0 ? (t.discountLevel === 'line' ? `discount on lines ${formatPaise(t.discount.amountPaise)}` : t.discount.percent ? `discount ${t.discount.percent}%` : `discount ${formatPaise(t.discount.amountPaise)}`) : null,
    t.adjustment && t.adjustment.paise ? `${t.adjustment.label.toLowerCase()} ${t.adjustment.paise < 0 ? '−' : '+'}${formatPaise(Math.abs(t.adjustment.paise))}` : null,
    lines.some((l) => l.billable) ? 'billable' : null,
  ].filter(Boolean);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Every week',
  fortnightly: 'Every 2 weeks',
  monthly: 'Every month',
  bimonthly: 'Every 2 months',
  quarterly: 'Every quarter',
  half_yearly: 'Every 6 months',
  yearly: 'Every year',
};

/** "Every month, 5th" or, by weeks, "Every week, Wednesdays": how a schedule repeats. */
export function scheduleLabel(t: Pick<Template, 'frequency' | 'dayOfMonth' | 'startDate'>): string {
  if (t.frequency === 'weekly' || t.frequency === 'fortnightly') {
    const day = new Date(`${t.startDate}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
    return `${FREQUENCY_LABEL[t.frequency]}, ${day}s`;
  }
  return `${FREQUENCY_LABEL[t.frequency] ?? t.frequency}, ${dayLabel(t.dayOfMonth)}`;
}

export function dayLabel(day: number): string {
  if (day === 31) return 'last day';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

export function useTemplates() {
  return useQuery({ queryKey: ['recurring'], queryFn: () => api.get<Template[]>('/recurring') });
}

/** Draft whatever is due now rather than waiting for the 6:30 morning run. Drafts only; nothing posts. */
export function DraftDueButton({ where }: { where: string }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post<{ drafted: Array<{ kind: string }>; failed: Array<{ name: string; error: string }> }>('/recurring-run'),
    onSuccess: (r) => {
      for (const key of ['recurring', 'purchase', 'sales', 'direct-expenses', 'month-end']) void qc.invalidateQueries({ queryKey: [key] });
      if (r.failed.length) notify(`${r.failed[0].name}: ${r.failed[0].error}`, 'error');
      else notify(r.drafted.length ? `Drafted ${r.drafted.length}: post them from ${where}` : 'Nothing is due yet', r.drafted.length ? 'success' : 'info');
    },
    onError: (e) => notify(errorText(e, "Couldn't draft what's due."), 'error'),
  });
  return (
    <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>
      <Repeat size={14} /> {run.isPending ? 'Drafting…' : "Draft what's due"}
    </Button>
  );
}

/** The schedules of one kind, with pause, resume and end. */
export function RecurringTable({ kind, empty, guide }: { kind: 'bill' | 'expense'; empty: string; guide?: GuideKey }) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'end' }) => api.post(`/recurring/${id}/${action}`),
    onSuccess: (_d, { action }) => {
      notify(action === 'pause' ? 'Schedule paused' : action === 'resume' ? 'Schedule resumed' : 'Schedule ended');
      void qc.invalidateQueries({ queryKey: ['recurring'] });
    },
    onError: (e) => notify(errorText(e, "Couldn't change the schedule."), 'error'),
  });
  const rows = (templates.data ?? []).filter((t) => t.kind === kind);

  return (
    <>
    <TableCard>
      <table className="w-full">
        <thead className="border-b border-line-200 bg-surface-sink">
          <tr>
            <th className={th}>{kind === 'expense' ? 'Profile name' : 'Name'}</th>
            <th className={th}>{kind === 'expense' ? 'Vendor / customer' : 'Vendor'}</th>
            <th className={`${th} text-right`}>Each time</th>
            <th className={th}>Schedule</th>
            <th className={th}>Next draft</th>
            <th className={th}>Status</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {templates.isLoading ? (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
          ) : templates.isError ? (
            <TableError error={templates.error} colSpan={7} onRetry={() => void templates.refetch()} />
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-caption text-ink-500">{empty}</td></tr>
          ) : (
            rows.map((t) => (
              <tr key={t._id} className={`border-b border-line-100 last:border-0 ${t.status === 'ended' ? 'opacity-60' : ''}`}>
                <td className={td}>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-caption text-ink-500">
                    {t.draftedCount} drafted{t.lastDraftedOn ? `, last ${shortDate(t.lastDraftedOn)}` : ''}
                    {t.isReverseCharge ? ' · reverse charge' : ''}
                    {kind === 'bill' ? billWords(t) : ''}
                    {t.expense?.claimable ? ' · GST claimed' : ''}
                    {t.expense?.lines && t.expense.lines.length > 1 ? ` · itemized, ${t.expense.lines.length} lines` : ''}
                  </p>
                </td>
                <td className={`${td} text-caption`}>
                  {t.partyName ?? <span className="text-ink-400">—</span>}
                  {t.expense?.customerName && (
                    <span className="block text-ink-500">For {t.expense.customerName}{t.expense.billable ? ' · billable' : ''}</span>
                  )}
                </td>
                <td className={tdMoney}>{formatPaise(t.totalPaise)}</td>
                <td className={`${td} text-caption`}>
                  {scheduleLabel(t)}
                  <span className="block text-ink-500">
                    {kind === 'bill' ? (t.paymentTerms ? termsLabel(t.paymentTerms) ?? t.paymentTerms : `due in ${t.dueInDays} days`) : `from ${shortDate(t.startDate)}`}
                    {t.endDate ? ` · until ${shortDate(t.endDate)}` : kind === 'expense' ? ' · never expires' : ''}
                  </span>
                </td>
                <td className={`${td} font-mono text-caption`}>{t.nextRunDate ? shortDate(t.nextRunDate) : '—'}</td>
                <td className={td}>
                  {t.status === 'active' ? <StatusChip tone="success">Active</StatusChip> : t.status === 'paused' ? <StatusChip tone="pending">Paused</StatusChip> : <StatusChip tone="neutral">Ended</StatusChip>}
                  {t.lastError && <p className="mt-1 max-w-[220px] text-caption text-error-fg">{t.lastError}</p>}
                </td>
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
    {/* Nothing repeats yet: show how a schedule works. */}
    {guide && templates.data && rows.length === 0 && <ModuleGuide guide={guide} className="mt-5" />}
    </>
  );
}

/** How often, on which day, from when, until when: the part of a schedule form every kind shares. */
export function ScheduleFields({
  value,
  onChange,
}: {
  value: { frequency: Frequency; dayOfMonth: string; startDate: string; endDate: string };
  onChange: (patch: Partial<{ frequency: Frequency; dayOfMonth: string; startDate: string; endDate: string }>) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Field label="How often">
        <select className={inputClass} value={value.frequency} onChange={(e) => onChange({ frequency: e.target.value as Frequency })}>
          <option value="monthly">Every month</option>
          <option value="quarterly">Every quarter</option>
          <option value="yearly">Every year</option>
        </select>
      </Field>
      <Field label="On day" hint="31 means the last day of the month.">
        <input className={`${inputClass} font-mono`} inputMode="numeric" value={value.dayOfMonth} onChange={(e) => onChange({ dayOfMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
      </Field>
      <Field label="Starts" required>
        <input type="date" className={inputClass} value={value.startDate} onChange={(e) => onChange({ startDate: e.target.value })} />
      </Field>
      <Field label="Ends" hint="Optional.">
        <input type="date" className={inputClass} value={value.endDate} min={value.startDate} onChange={(e) => onChange({ endDate: e.target.value })} />
      </Field>
    </div>
  );
}
