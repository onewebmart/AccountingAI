'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Plus, Repeat, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError, TableError } from '@/components/ui/query-error';
import { api, ApiError } from '@/lib/api';
import { GST_RATES, GstRate, rupeesToPaise, splitGst } from '@/lib/gst';
import { formatRupees } from '@/lib/utils';

// ── Shapes ──────────────────────────────────────────────────────────────────

type Kind = 'bill' | 'invoice';
type Frequency = 'monthly' | 'quarterly' | 'yearly';

interface Template {
  _id: string;
  kind: Kind | 'journal';
  name: string;
  partyName: string | null;
  frequency: Frequency;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string | null;
  dueInDays: number;
  totalPaise: number;
  isReverseCharge: boolean;
  status: 'active' | 'paused' | 'ended';
  draftedCount: number;
  lastDraftedOn: string | null;
  lastError: string | null;
}

interface Party {
  _id: string;
  name: string;
  gstin: string | null;
}

interface ReminderSettings {
  enabled: boolean;
  channel: 'auto' | 'email' | 'whatsapp';
  provider: string;
  ladder: Array<{ rung: string; daysFromDue: number }>;
}

interface Reminder {
  _id: string;
  invoiceNumber: string;
  customerName: string;
  rung: string;
  automatic: boolean;
  channel: 'email' | 'whatsapp';
  to: string;
  subject: string | null;
  outstandingPaise: number;
  status: 'queued' | 'sent' | 'failed';
  isMock: boolean;
  error: string | null;
  createdAt: string;
}

const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Every month', quarterly: 'Every quarter', yearly: 'Every year' };

const RUNG_LABEL: Record<string, string> = {
  before_due: '3 days before due',
  on_due: 'On the due date',
  late_7: '7 days late',
  late_15: '15 days late',
  late_30: '30 days late',
  manual: 'Sent by hand',
};

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : err instanceof Error && err.message ? err.message : fallback;
}

function dayLabel(day: number): string {
  if (day === 31) return 'last day';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

// ── New template ────────────────────────────────────────────────────────────

function NewTemplateModal({ kind, onClose, onCreated }: { kind: Kind; onClose: () => void; onCreated: (name: string) => void }) {
  const parties = useQuery<Party[]>({
    queryKey: kind === 'bill' ? ['purchase', 'vendors'] : ['sales', 'customers'],
    queryFn: () => api.get<Party[]>(kind === 'bill' ? '/purchase/vendors' : '/sales/customers'),
  });
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    name: '',
    partyId: '',
    taxableRupees: '',
    rate: 18 as GstRate,
    interState: false,
    frequency: 'monthly' as Frequency,
    dayOfMonth: '1',
    startDate: today,
    endDate: '',
    dueInDays: '15',
    hsnSac: '',
    isReverseCharge: false,
  });
  const [error, setError] = useState<string | null>(null);
  const taxablePaise = rupeesToPaise(form.taxableRupees) ?? 0;
  const amounts = splitGst(taxablePaise, form.rate, form.interState);

  const mutation = useMutation({
    mutationFn: (body: unknown) => api.post(kind === 'bill' ? '/recurring/bills' : '/recurring/invoices', body),
    onSuccess: () => onCreated(form.name.trim()),
    onError: (err) => setError(message(err, "Couldn't save it. Try again.")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const day = Number(form.dayOfMonth);
    const due = Number(form.dueInDays);
    if (!form.name.trim()) return setError('Give it a name, like "Office rent".');
    if (!form.partyId) return setError(kind === 'bill' ? 'Choose the vendor.' : 'Choose the customer.');
    if (taxablePaise <= 0) return setError('Enter the amount before tax.');
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError('The day must be 1 to 31.');
    if (!Number.isInteger(due) || due < 0 || due > 365) return setError('Due in must be 0 to 365 days.');
    if (form.endDate && form.endDate < form.startDate) return setError('The end date is before the start date.');
    setError(null);
    mutation.mutate({
      name: form.name.trim(),
      partyId: form.partyId,
      frequency: form.frequency,
      dayOfMonth: day,
      startDate: form.startDate,
      endDate: form.endDate || null,
      dueInDays: due,
      amountsPaise: amounts,
      lineItems: [
        {
          description: form.name.trim(),
          hsnSac: form.hsnSac.trim() || null,
          qty: 1,
          ratePaise: amounts.taxableValue,
          amountPaise: amounts.taxableValue,
          taxRatePct: form.rate,
        },
      ],
      ...(kind === 'bill' ? { isReverseCharge: form.isReverseCharge } : {}),
    });
  };

  const field =
    'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const label = 'text-caption font-medium text-ink-700 block mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line-200 bg-surface-card p-6 shadow-xl">
        <h2 className="text-h3 font-display text-ink-900 mb-1">{kind === 'bill' ? 'New recurring bill' : 'New recurring invoice'}</h2>
        <p className="text-caption text-ink-500 mb-5">
          Each one is drafted on its date for you to check and post. Nothing posts on its own.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={label}>Name</label>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={kind === 'bill' ? 'e.g. Office rent' : 'e.g. Monthly retainer'} />
          </div>
          <div>
            <label className={label}>{kind === 'bill' ? 'Vendor' : 'Customer'}</label>
            <select className={field} value={form.partyId} onChange={(e) => setForm((f) => ({ ...f, partyId: e.target.value }))}>
              <option value="">{parties.isLoading ? 'Loading…' : kind === 'bill' ? 'Choose a vendor…' : 'Choose a customer…'}</option>
              {(parties.data ?? []).map((p) => (
                <option key={p._id} value={p._id}>{p.name}{p.gstin ? ` · ${p.gstin}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Amount before tax (₹)</label>
              <input className={`${field} font-mono`} inputMode="decimal" value={form.taxableRupees}
                onChange={(e) => setForm((f) => ({ ...f, taxableRupees: e.target.value }))} placeholder="50000" />
            </div>
            <div>
              <label className={label}>GST rate</label>
              <select className={field} value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) as GstRate }))}>
                {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-body text-ink-700">
            <input type="checkbox" checked={form.interState} onChange={(e) => setForm((f) => ({ ...f, interState: e.target.checked }))} />
            Inter-state (IGST)
          </label>
          {kind === 'bill' && (
            <label className="flex items-center gap-2 text-body text-ink-700">
              <input type="checkbox" checked={form.isReverseCharge}
                onChange={(e) => setForm((f) => ({ ...f, isReverseCharge: e.target.checked }))} />
              Reverse charge: we pay the GST
            </label>
          )}
          <p className="text-caption text-ink-500">
            Total each time: <span className="font-mono font-medium text-ink-900">{formatRupees(amounts.total)}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>How often</label>
              <select className={field} value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency }))}>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="yearly">Every year</option>
              </select>
            </div>
            <div>
              <label className={label}>On day</label>
              <input className={`${field} font-mono`} inputMode="numeric" value={form.dayOfMonth}
                onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value.replace(/\D/g, '').slice(0, 2) }))} />
              <p className="mt-1 text-caption text-ink-500">31 means the last day of each month.</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Starts</label>
              <input type="date" className={field} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Ends <span className="text-ink-400">(optional)</span></label>
              <input type="date" className={field} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Due in (days)</label>
              <input className={`${field} font-mono`} inputMode="numeric" value={form.dueInDays}
                onChange={(e) => setForm((f) => ({ ...f, dueInDays: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
            </div>
          </div>
          <div>
            <label className={label}>HSN/SAC <span className="text-ink-400">(optional)</span></label>
            <input className={`${field} font-mono`} inputMode="numeric" value={form.hsnSac}
              onChange={(e) => setForm((f) => ({ ...f, hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) }))} placeholder="e.g. 997212" />
          </div>
          {error && <p className="text-caption text-error-fg">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save schedule'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

/**
 * Money in and out on a schedule: bills and invoices that repeat, and the
 * reminders that chase customers for what they owe.
 */
export default function RecurringPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<Kind | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const show = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), error ? 6000 : 3500);
  };

  const templates = useQuery<Template[]>({ queryKey: ['recurring'], queryFn: () => api.get<Template[]>('/recurring') });
  const settings = useQuery<ReminderSettings>({
    queryKey: ['reminders', 'settings'],
    queryFn: () => api.get<ReminderSettings>('/reminders/settings'),
  });
  const reminders = useQuery<Reminder[]>({ queryKey: ['reminders', 'list'], queryFn: () => api.get<Reminder[]>('/reminders') });

  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'end' }) => api.post(`/recurring/${id}/${action}`),
    onSuccess: (_d, { action }) => {
      show(action === 'pause' ? 'Schedule paused' : action === 'resume' ? 'Schedule resumed' : 'Schedule ended');
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
    onError: (err) => show(message(err, "Couldn't change the schedule"), true),
  });

  const runRecurring = useMutation({
    mutationFn: () =>
      api.post<{ drafted: Array<{ kind: Kind }>; failed: Array<{ name: string; error: string }> }>('/recurring-run'),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      if (run.failed.length) show(`${run.failed[0].name}: ${run.failed[0].error}`, true);
      else show(run.drafted.length ? `Drafted ${run.drafted.length} — post them from Purchase and Sales` : 'Nothing is due yet');
    },
    onError: (err) => show(message(err, "Couldn't draft what's due"), true),
  });

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<Pick<ReminderSettings, 'enabled' | 'channel'>>) => api.patch('/reminders/settings', patch),
    onSuccess: (_d, patch) => {
      if (patch.enabled !== undefined) show(patch.enabled ? 'Reminders turned on' : 'Reminders turned off');
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (err) => show(message(err, "Couldn't save the reminder settings"), true),
  });

  const runReminders = useMutation({
    mutationFn: () => api.post<{ queued: number; noContact: Array<{ customerName: string }> }>('/reminders/run'),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
      const missing = run.noContact.length ? ` · ${run.noContact.length} customer${run.noContact.length === 1 ? ' has' : 's have'} no email or phone` : '';
      show(`${run.queued ? `Sent ${run.queued} reminder${run.queued === 1 ? '' : 's'}` : 'No reminders due today'}${missing}`);
    },
    onError: (err) => show(message(err, "Couldn't send today's reminders"), true),
  });

  const rows = templates.data ?? [];
  const s = settings.data;

  return (
    <div className="space-y-8 max-w-[1100px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Recurring &amp; reminders</h1>
          <p className="text-body text-ink-500 mt-1">
            Bills and invoices that repeat, drafted on their dates, and reminders that chase what customers owe.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setCreating('bill')} className="flex items-center gap-2">
            <Plus size={14} /> New recurring bill
          </Button>
          <Button onClick={() => setCreating('invoice')} className="flex items-center gap-2">
            <Plus size={14} /> New recurring invoice
          </Button>
        </div>
      </div>

      {/* Recurring */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-h3 font-display text-ink-900">Schedules</h2>
            <p className="text-caption text-ink-500">
              Drafted each morning at 6:30. Find the drafts on{' '}
              <Link href="/purchase" className="text-brand-600 hover:underline">Purchase</Link> and{' '}
              <Link href="/sales" className="text-brand-600 hover:underline">Sales</Link>, ready to post.
            </p>
          </div>
          <Button variant="secondary" disabled={runRecurring.isPending} onClick={() => runRecurring.mutate()}
            className="flex items-center gap-2">
            <Repeat size={14} /> {runRecurring.isPending ? 'Drafting…' : "Draft what's due"}
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line-200 bg-surface-card">
          <table className="w-full text-body">
            <thead className="bg-surface-sink">
              <tr>
                {['Name', 'Party', 'Amount', 'Schedule', 'Next draft', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-caption font-medium text-ink-500 whitespace-nowrap ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-100">
              {templates.isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : templates.isError ? (
                <TableError error={templates.error} colSpan={7} onRetry={() => void templates.refetch()} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-caption text-ink-400">
                    Nothing repeats yet. Add rent, a subscription or a retainer, and it drafts itself each period.
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t._id} className={t.status === 'ended' ? 'opacity-60' : ''}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{t.name}</p>
                      <p className="text-caption text-ink-500">
                        {t.kind === 'bill' ? 'Bill' : t.kind === 'invoice' ? 'Invoice' : 'Journal'}
                        {t.isReverseCharge ? ' · reverse charge' : ''} · {t.draftedCount} drafted
                      </p>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{t.partyName ?? <span className="text-ink-400">To the review queue</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink-900">{formatRupees(t.totalPaise)}</td>
                    <td className="px-4 py-3 text-caption text-ink-700 whitespace-nowrap">
                      {FREQUENCY_LABEL[t.frequency]}, {dayLabel(t.dayOfMonth)}
                      <br />
                      <span className="text-ink-500">due in {t.dueInDays} days{t.endDate ? ` · until ${t.endDate}` : ''}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-caption text-ink-700">{t.nextRunDate ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${
                        t.status === 'active' ? 'bg-success-bg text-success-fg' : t.status === 'paused' ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-500'
                      }`}>
                        {t.status === 'active' ? 'Active' : t.status === 'paused' ? 'Paused' : 'Ended'}
                      </span>
                      {t.lastError && <p className="mt-1 max-w-[220px] text-caption text-error-fg">{t.lastError}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {t.status !== 'ended' && (
                        <div className="flex justify-end gap-1">
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
                            onClick={() => {
                              if (window.confirm(`End "${t.name}"? Drafts already made stay; no more are made.`)) {
                                setStatus.mutate({ id: t._id, action: 'end' });
                              }
                            }}
                            className="rounded p-1.5 text-ink-500 hover:bg-surface-sink hover:text-error-fg"
                            aria-label={`End ${t.name}`}
                            title="End"
                          >
                            <Square size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reminders */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-h3 font-display text-ink-900">Payment reminders</h2>
            <p className="text-caption text-ink-500">
              Customers with an open invoice hear from you 3 days before it is due, on the day, and 7, 15 and 30 days
              after. Each step goes once. You can also chase one invoice from Sales.
            </p>
          </div>
          <Button variant="secondary" disabled={!s?.enabled || runReminders.isPending} onClick={() => runReminders.mutate()}>
            {runReminders.isPending ? 'Sending…' : "Send today's reminders"}
          </Button>
        </div>

        {settings.isError ? (
          <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-line-200 bg-surface-card p-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 accent-saffron-600"
                checked={s?.enabled ?? false}
                disabled={!s || updateSettings.isPending}
                onChange={(e) => updateSettings.mutate({ enabled: e.target.checked })}
              />
              <span className="text-body font-medium text-ink-900">Send reminders automatically</span>
            </label>
            <label className="flex items-center gap-2 text-body text-ink-700">
              Send by
              <select
                className="rounded-md border border-line-200 bg-white px-2 py-1 text-body focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={s?.channel ?? 'auto'}
                disabled={!s || updateSettings.isPending}
                onChange={(e) => updateSettings.mutate({ channel: e.target.value as ReminderSettings['channel'] })}
              >
                <option value="auto">Email, or WhatsApp if no email</option>
                <option value="email">Email only</option>
                <option value="whatsapp">WhatsApp only</option>
              </select>
            </label>
            {s?.provider === 'mock' && (
              <p className="basis-full text-caption text-pending-fg">
                No WhatsApp or email service is connected yet, so reminders are written and logged here but do not leave.
              </p>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-line-200 bg-surface-card">
          <table className="w-full text-body">
            <thead className="bg-surface-sink">
              <tr>
                {['When', 'Customer', 'Invoice', 'Step', 'To', 'Owed', 'Status'].map((h) => (
                  <th key={h} className={`px-4 py-3 text-caption font-medium text-ink-500 whitespace-nowrap ${h === 'Owed' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-100">
              {reminders.isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : reminders.isError ? (
                <TableError error={reminders.error} colSpan={7} onRetry={() => void reminders.refetch()} />
              ) : (reminders.data ?? []).length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-caption text-ink-400">No reminders yet.</td></tr>
              ) : (
                (reminders.data ?? []).map((r) => (
                  <tr key={r._id} title={r.subject ?? undefined}>
                    <td className="px-4 py-3 font-mono text-caption text-ink-700 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-ink-900">{r.customerName}</td>
                    <td className="px-4 py-3 font-mono text-caption text-ink-700">{r.invoiceNumber}</td>
                    <td className="px-4 py-3 text-caption text-ink-700">{RUNG_LABEL[r.rung] ?? r.rung}</td>
                    <td className="px-4 py-3 text-caption text-ink-700">
                      {r.channel === 'email' ? 'Email' : 'WhatsApp'} · {r.to}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-ink-900">{formatRupees(r.outstandingPaise)}</td>
                    <td className="px-4 py-3 text-caption">
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
        </div>
      </section>

      {creating && (
        <NewTemplateModal
          kind={creating}
          onClose={() => setCreating(null)}
          onCreated={(name) => {
            setCreating(null);
            show(`${name} scheduled`);
            void queryClient.invalidateQueries({ queryKey: ['recurring'] });
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-md rounded-md border px-4 py-3 text-body font-medium shadow-lg ${
            toast.error ? 'bg-error-bg border-error-fg text-error-fg' : 'bg-success-bg border-success-fg text-success-fg'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
