'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, Download, Loader2, Mail, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/page/notifier';
import { api, ApiError, downloadFile } from '@/lib/api';
import { ReportTable, ReportTableView } from '@/components/reports/report-table-view';
import { FavouriteStar } from '@/components/reports/center/favourite-star';
import { FilterFields, PeriodFields, fieldClass, labelClass } from '@/components/reports/center/report-params';
import type { Definition } from '@/components/reports/center/types';
import { PERIODS, PERIOD_KEYS, defaultParams, toQuery } from '@/components/reports/center/types';

const message = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong. Try again.');
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIES = /^(Debits equal credits|Assets equal liabilities|Total assets equal|The closing figure equals)/;

/** Email this report as a PDF on a rhythm: the period moves with each run. */
function ScheduleSection({ reportKey, title, onDone }: { reportKey: string; title: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ period: 'last_month', frequency: 'monthly' as 'monthly' | 'weekly', day: '2', recipients: '' });
  const save = useMutation({
    mutationFn: () => api.post('/reports/schedules', { report: reportKey, period: form.period, frequency: form.frequency, day: Number(form.day), recipients: form.recipients.split(/[,\s;]+/).filter(Boolean) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'center'] });
      notify('Report email scheduled');
      onDone();
    },
  });
  return (
    <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <div>
        <h2 className="text-h3 font-display text-ink-900">Schedule {title}</h2>
        <p className="text-caption text-ink-500">Sent as a PDF from the books each time, covering the period as it stands on the day it goes.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className={labelClass}>Covering</label>
          <select className={`${fieldClass} w-full`} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
            {PERIODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Every</label>
          <div className="flex gap-2">
            <select className={fieldClass} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as 'monthly' | 'weekly', day: e.target.value === 'weekly' ? '1' : '2' })}>
              <option value="monthly">Month, on day</option>
              <option value="weekly">Week, on</option>
            </select>
            <select className={fieldClass} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>
              {form.frequency === 'monthly' ? Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>) : WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>To (up to ten addresses)</label>
          <input className={`${fieldClass} w-full`} placeholder="owner@business.in, ca@firm.in" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
        </div>
      </div>
      {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
      <div className="flex gap-2">
        <Button disabled={!form.recipients.trim() || save.isPending} onClick={() => save.mutate()}><Mail size={14} /> {save.isPending ? 'Scheduling…' : 'Schedule email'}</Button>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </section>
  );
}

export default function ReportViewPage() {
  const { key: raw } = useParams<{ key: string }>();
  const key = decodeURIComponent(raw);
  const router = useRouter();
  const qc = useQueryClient();
  const def = useQuery({ queryKey: ['reports', 'definition', key], queryFn: () => api.get<Definition>(`/reports/definition/${encodeURIComponent(key)}`) });
  const d = def.data;
  const custom = d?.custom ?? null;

  // The period and filters, set once the definition is in. A custom report starts as it was saved.
  const [period, setPeriod] = useState<Record<string, string> | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [usingSaved, setUsingSaved] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  useEffect(() => {
    if (!d || period) return;
    setPeriod(defaultParams(d.params));
    if (custom) setFilters(Object.fromEntries(Object.entries(custom.params).filter(([k]) => !PERIOD_KEYS.includes(k))));
  }, [d, period, custom]);

  // Last visited: recorded once per opening.
  const visited = useRef(false);
  useEffect(() => {
    if (!d || visited.current) return;
    visited.current = true;
    api.post(`/reports/visits/${encodeURIComponent(key)}`).then(() => qc.invalidateQueries({ queryKey: ['reports', 'center'] })).catch(() => undefined);
  }, [d, key, qc]);

  const params = useMemo(() => {
    if (!d || !period) return null;
    const p = custom && usingSaved ? {} : period;
    return { ...p, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
  }, [d, period, filters, custom, usingSaved]);
  const missing = d?.filters.find((f) => f.required && !filters[f.key]);
  const query = params ? toQuery(params) : '';
  const valid = !!params && !missing && (!params.from || !params.to || params.from <= params.to);
  const table = useQuery({
    queryKey: ['reports', 'run', key, query],
    queryFn: () => api.get<ReportTable>(`/reports/run/${encodeURIComponent(key)}${query}`),
    enabled: valid,
  });

  const download = async (kind: 'pdf' | 'csv' | 'xlsx') => {
    try {
      await downloadFile(`/reports/run/${encodeURIComponent(key)}/${kind}${query}`, `${key.replace(/[._]/g, '-')}.${kind}`);
      notify(kind === 'pdf' ? 'Downloaded PDF' : kind === 'csv' ? 'Downloaded CSV' : 'Downloaded Excel');
    } catch (e) {
      notify(message(e), 'error');
    }
  };

  const remove = useMutation({
    mutationFn: () => api.delete(`/reports/custom/${custom!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'center'] });
      notify('Report deleted');
      router.push('/reports?view=mine');
    },
    onError: (e) => notify(message(e), 'error'),
  });

  if (def.isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Opening the report…</p>;
  if (def.isError || !d) {
    return (
      <div className="space-y-3">
        <Link href="/reports" className="inline-flex items-center gap-1 text-caption text-ink-500 hover:underline"><ChevronLeft size={13} /> Reports Center</Link>
        <p className="text-body text-error-fg">{message(def.error)}</p>
      </div>
    );
  }
  const ties = table.data?.notes.find((n) => TIES.test(n));
  const savedPeriod = custom?.period ? PERIODS.find(([v]) => v === custom.period)?.[1] : custom && Object.keys(custom.params).some((k) => PERIOD_KEYS.includes(k)) ? 'its saved months' : null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href={`/reports?category=${d.category}`} className="inline-flex items-center gap-1 text-caption text-ink-500 hover:text-ink-900 hover:underline">
          <ChevronLeft size={13} /> Reports Center · {d.categoryLabel}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FavouriteStar report={{ key: d.key, title: d.title, favourite: d.favourite }} size={18} />
              <h1 className="text-h1 font-display text-ink-900">{d.title}</h1>
              {ties && <span className="inline-flex items-center gap-1 rounded-full border border-success-fg/30 bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg"><CheckCircle2 size={12} /> Ties out ✓</span>}
            </div>
            <p className="mt-1 text-body text-ink-500">{d.description}</p>
            <p className="mt-0.5 text-caption text-ink-400">
              {d.createdBy === 'System Generated' ? 'System generated' : `Made by ${d.createdBy}`}
              {custom && (custom.kind === 'derived' ? ' · from an existing report' : ' · from a module')}
              {custom && (custom.shared ? ' · shared with the organisation' : ' · only you can see it')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!table.data} onClick={() => download('pdf')}><Download size={13} /> PDF</Button>
            <Button variant="secondary" size="sm" disabled={!table.data} onClick={() => download('csv')}><Download size={13} /> CSV</Button>
            <Button variant="secondary" size="sm" disabled={!table.data} onClick={() => download('xlsx')}><Download size={13} /> Excel</Button>
            <Button variant="secondary" size="sm" onClick={() => setScheduling((s) => !s)}><Mail size={13} /> Schedule</Button>
            {!custom && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/reports/new/from-existing?report=${encodeURIComponent(d.key)}`}><SlidersHorizontal size={13} /> Customize</Link>
              </Button>
            )}
            {custom?.mine && (
              <>
                <Button variant="secondary" size="sm" asChild><Link href={`/reports/custom/${custom.id}/edit`}><Pencil size={13} /> Edit report</Link></Button>
                <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete “${d.title}”? Its schedules stop sending.`)) remove.mutate(); }}><Trash2 size={13} /> Delete</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {scheduling && <ScheduleSection reportKey={d.key} title={d.title} onDone={() => setScheduling(false)} />}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line-200 bg-surface-card p-3">
        {custom && savedPeriod && (
          <div>
            <label className={labelClass}>Period</label>
            <select className={fieldClass} value={usingSaved ? 'saved' : 'choose'} onChange={(e) => setUsingSaved(e.target.value === 'saved')}>
              <option value="saved">As saved: {savedPeriod}</option>
              <option value="choose">Choose…</option>
            </select>
          </div>
        )}
        {period && (!custom || !savedPeriod || !usingSaved) && <PeriodFields kind={d.params} value={period} onChange={(v) => { setPeriod(v); setUsingSaved(false); }} />}
        <FilterFields filters={d.filters} value={filters} onChange={setFilters} />
        {table.isFetching && <span className="flex items-center gap-1 self-center text-caption text-ink-400"><Loader2 size={13} className="animate-spin" /> Reading the books…</span>}
      </div>

      {missing && <p className="text-body text-ink-600">Pick the {missing.label.toLowerCase()} to see this report.</p>}
      {params?.from && params?.to && params.from > params.to && <p className="text-caption text-error-fg">The From month comes after the To month.</p>}
      {table.isError && <p className="text-caption text-error-fg">{message(table.error)}</p>}
      {table.isLoading && valid && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the books…</p>}
      {table.data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-h2 font-display text-ink-900">{table.data.title}</h2>
            <p className="text-caption text-ink-500">{table.data.subtitle}</p>
          </div>
          {table.data.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-200 bg-surface-card px-6 py-12 text-center text-body text-ink-500">Nothing in this period. Post some entries to see reports.</div>
          ) : (
            <ReportTableView table={table.data} />
          )}
        </div>
      )}
    </div>
  );
}
