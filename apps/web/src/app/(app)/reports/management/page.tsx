'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Download, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError, downloadFile } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { ReportTable, ReportTableView } from '@/components/reports/report-table-view';
import { AskBox } from '@/components/reports/ask-box';
import { NarrativeCard } from '@/components/reports/narrative-card';

type Tab = 'reports' | 'budgets' | 'schedules';
interface CatalogEntry { key: string; title: string; params: 'range' | 'today' | 'year'; group: string }
interface BudgetRow { accountId: string; name: string; code: string; type: 'INCOME' | 'EXPENSE'; monthsPaise: number[] }
interface Budgets { financialYear: string; months: string[]; rows: BudgetRow[] }
interface Schedule { id: string; report: string; title: string; period: string; periodLabel: string; frequency: 'monthly' | 'weekly'; day: number; recipients: string[]; nextRunOn: string; lastSentOn: string | null; lastError: string | null; active: boolean }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const field = 'rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const label = 'mb-1 block text-caption font-medium text-ink-700';
const nowMonth = () => new Date().toISOString().slice(0, 7);
const fyOf = (m: string) => {
  const y = Number(m.slice(0, 4));
  const start = Number(m.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const fyStart = (m: string) => `${fyOf(m).slice(0, 4)}-04`;
const fyName = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
const thisFyStart = () => Number(fyOf(nowMonth()).slice(0, 4));
const recentYears = () => [0, 1, 2].map((n) => fyName(thisFyStart() - n));
/** Next year too, for budgeting ahead. */
const nextYear = () => fyName(thisFyStart() + 1);
const MONTH_NAMES = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PERIODS = [['last_month', 'Last month'], ['this_month', 'This month so far'], ['last_quarter', 'Last quarter'], ['this_fy', 'This financial year so far'], ['last_fy', 'Last financial year']] as const;

function ScheduleForm({ report, catalog, onDone, onCancel }: { report: string; catalog: CatalogEntry[]; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ report, period: 'last_month', frequency: 'monthly' as 'monthly' | 'weekly', day: '2', recipients: '' });
  const save = useMutation({
    mutationFn: () => api.post('/reports/schedules', { report: form.report, period: form.period, frequency: form.frequency, day: Number(form.day), recipients: form.recipients.split(/[,\s;]+/).filter(Boolean) }),
    onSuccess: onDone,
  });
  return (
    <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="text-h3 font-display text-ink-900">Email a report on a schedule</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className={label}>Report</label><select className={`${field} w-full`} value={form.report} onChange={(e) => setForm({ ...form, report: e.target.value })}>{catalog.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}</select></div>
        <div><label className={label}>Covering</label><select className={`${field} w-full`} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>{PERIODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div>
          <label className={label}>Every</label>
          <div className="flex gap-2">
            <select className={field} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as 'monthly' | 'weekly', day: e.target.value === 'weekly' ? '1' : '2' })}><option value="monthly">Month, on day</option><option value="weekly">Week, on</option></select>
            {form.frequency === 'monthly'
              ? <select className={field} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
              : <select className={field} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>}
          </div>
        </div>
        <div><label className={label}>To (up to ten addresses)</label><input className={`${field} w-full`} placeholder="owner@business.in, ca@firm.in" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} /></div>
      </div>
      {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
      <div className="flex gap-2">
        <Button disabled={!form.recipients.trim() || save.isPending} onClick={() => save.mutate()}><Mail size={14} /> {save.isPending ? 'Saving…' : 'Schedule email'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-caption text-ink-500">Sent as a PDF from the books each time, covering the period as it stands on the day it goes.</p>
    </section>
  );
}

function ReportsTab({ catalog, onToast }: { catalog: CatalogEntry[]; onToast: (m: string) => void }) {
  const params = useSearchParams();
  const [key, setKey] = useState(params.get('report') ?? 'pl_monthly');
  const [from, setFrom] = useState(params.get('from') ?? fyStart(nowMonth()));
  const [to, setTo] = useState(params.get('to') ?? nowMonth());
  const [fy, setFy] = useState(fyOf(nowMonth()));
  const [scheduling, setScheduling] = useState(false);
  // An answer's "Open the report" link lands here with the report and its months.
  useEffect(() => {
    const r = params.get('report');
    if (!r) return;
    setKey(r);
    const f = params.get('from');
    const t = params.get('to');
    if (f && t) { setFrom(f); setTo(t); }
  }, [params]);
  const entry = catalog.find((c) => c.key === key) ?? catalog[0];
  const query = entry?.params === 'range' ? `from=${from}&to=${to}` : entry?.params === 'year' ? `financialYear=${fy}` : '';
  const q = useQuery({ queryKey: ['reports', 'run', key, query], queryFn: () => api.get<ReportTable>(`/reports/run/${key}${query ? `?${query}` : ''}`), enabled: !!entry && (entry.params !== 'range' || from <= to) });
  const groups = [...new Set(catalog.map((c) => c.group))];
  const download = async (kind: 'pdf' | 'csv') => {
    try {
      await downloadFile(`/reports/run/${key}/${kind}${query ? `?${query}` : ''}`, `${key.replace(/_/g, '-')}.${kind}`);
      onToast(kind === 'pdf' ? 'Downloaded PDF' : 'Downloaded CSV');
    } catch {
      onToast("Couldn't download: try again");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g} className="flex flex-wrap items-center gap-1.5">
            <span className="w-28 text-caption font-medium text-ink-500">{g}</span>
            {catalog.filter((c) => c.group === g).map((c) => (
              <button key={c.key} onClick={() => setKey(c.key)} className={`rounded-full border px-3 py-1 text-caption font-medium ${key === c.key ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600 hover:bg-surface-sink'}`}>{c.title}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {entry?.params === 'range' && (
          <>
            <div><label className={label}>From</label><input type="month" className={field} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
            <div><label className={label}>To</label><input type="month" className={field} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          </>
        )}
        {entry?.params === 'year' && (
          <div><label className={label}>Financial year</label><select className={field} value={fy} onChange={(e) => setFy(e.target.value)}>{recentYears().map((y) => <option key={y} value={y}>FY {y}</option>)}</select></div>
        )}
        {entry?.params === 'today' && <p className="text-caption text-ink-500">As the books stand today.</p>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => download('pdf')}><Download size={13} /> PDF</Button>
          <Button variant="secondary" size="sm" onClick={() => download('csv')}><Download size={13} /> CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => setScheduling(true)}><Mail size={13} /> Email on a schedule</Button>
        </div>
      </div>
      {scheduling && <ScheduleForm report={key} catalog={catalog} onCancel={() => setScheduling(false)} onDone={() => { setScheduling(false); onToast('Report email scheduled'); }} />}
      {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the books…</p>}
      {q.isError && <p className="text-caption text-error-fg">{message(q.error)}</p>}
      {q.data && (
        <div className="space-y-2">
          <div><h2 className="text-h2 font-display text-ink-900">{q.data.title}</h2><p className="text-caption text-ink-500">{q.data.subtitle}</p></div>
          <ReportTableView table={q.data} />
        </div>
      )}
    </div>
  );
}

function BudgetsTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [fy, setFy] = useState(fyOf(nowMonth()));
  const [grid, setGrid] = useState<Record<string, string[]>>({});
  const [change, setChange] = useState('0');
  const q = useQuery({ queryKey: ['reports', 'budgets', fy], queryFn: () => api.get<Budgets>(`/reports/budgets?financialYear=${fy}`) });
  useEffect(() => {
    if (q.data) setGrid(Object.fromEntries(q.data.rows.map((r) => [r.accountId, r.monthsPaise.map((v) => (v ? String(v / 100) : ''))])));
  }, [q.data]);
  const prevFy = `${Number(fy.slice(0, 4)) - 1}-${fy.slice(2, 4)}`;
  const fill = useMutation({
    mutationFn: () => api.post<{ rows: Array<{ accountId: string; monthsPaise: number[] }> }>('/reports/budgets/from-year', { financialYear: fy, fromYear: prevFy, changePct: Number(change) || 0 }),
    onSuccess: (r) => {
      setGrid((g) => ({ ...g, ...Object.fromEntries(r.rows.map((row) => [row.accountId, row.monthsPaise.map((v) => (v ? String(v / 100) : ''))])) }));
      onToast(`Filled from FY ${prevFy}: check it, then save`);
    },
  });
  const save = useMutation({
    mutationFn: () => {
      const rows = (q.data?.rows ?? []).map((r) => {
        const months = (grid[r.accountId] ?? []).map((v) => (v.trim() ? parseRupees(v) : 0));
        if (months.some((v) => v === null || (v as number) < 0)) throw new Error(`${r.name}: enter amounts in rupees, like 25,000.`);
        return { accountId: r.accountId, monthsPaise: months as number[] };
      });
      return api.put<{ saved: number }>('/reports/budgets', { financialYear: fy, rows });
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['reports'] }); onToast(r.saved ? 'Budgets saved' : 'Nothing changed'); },
  });
  const set = (id: string, i: number, v: string) => setGrid((g) => ({ ...g, [id]: (g[id] ?? Array(12).fill('')).map((x, n) => (n === i ? v : x)) }));
  const total = (id: string) => (grid[id] ?? []).reduce((s, v) => s + (parseRupees(v || '0') ?? 0), 0);
  const section = (type: 'INCOME' | 'EXPENSE') => (q.data?.rows ?? []).filter((r) => r.type === type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={label}>Financial year</label><select className={field} value={fy} onChange={(e) => setFy(e.target.value)}>{[nextYear(), ...recentYears()].map((y) => <option key={y} value={y}>FY {y}</option>)}</select></div>
        <div><label className={label}>From FY {prevFy}, changed by %</label><input className={`${field} w-24 font-mono`} inputMode="decimal" value={change} onChange={(e) => setChange(e.target.value)} /></div>
        <Button variant="secondary" disabled={fill.isPending} onClick={() => fill.mutate()}>Fill from last year</Button>
        <Button className="ml-auto" disabled={save.isPending || !q.data} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save budgets'}</Button>
      </div>
      {(save.isError || fill.isError) && <p className="text-caption text-error-fg">{message(save.error ?? fill.error)}</p>}
      {q.isLoading && <p className="text-caption text-ink-400">Loading…</p>}
      {q.data && (
        <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
          <table className="w-full text-caption">
            <thead><tr className="border-b border-line-200 bg-surface-sink"><th className="px-2 py-2 text-left font-medium text-ink-500">Account (₹)</th>{MONTH_NAMES.map((m) => <th key={m} className="px-1 py-2 text-right font-medium text-ink-500">{m}</th>)}<th className="px-2 py-2 text-right font-medium text-ink-500">Year</th></tr></thead>
            <tbody>
              {(['INCOME', 'EXPENSE'] as const).map((type) => [
                <tr key={type} className="bg-surface-sink/60"><td colSpan={14} className="px-2 py-1 uppercase tracking-wide text-ink-500">{type === 'INCOME' ? 'Income' : 'Expenses'}</td></tr>,
                ...section(type).map((r) => (
                  <tr key={r.accountId} className="border-b border-line-100">
                    <td className="whitespace-nowrap px-2 py-1 text-body text-ink-900">{r.name}</td>
                    {Array.from({ length: 12 }, (_, i) => (
                      <td key={i} className="px-0.5 py-1"><input className="w-20 rounded border border-line-200 px-1.5 py-1 text-right font-mono" inputMode="decimal" value={grid[r.accountId]?.[i] ?? ''} onChange={(e) => set(r.accountId, i, e.target.value)} /></td>
                    ))}
                    <td className="px-2 py-1 text-right font-mono text-ink-900">{(total(r.accountId) / 100).toLocaleString('en-IN')}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-ink-500">A plan, not an entry: budgets never touch the books. Compare them on the Reports tab under Budget against actual.</p>
    </div>
  );
}

function SchedulesTab({ catalog, onToast }: { catalog: CatalogEntry[]; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['reports', 'schedules'], queryFn: () => api.get<Schedule[]>('/reports/schedules') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'stop' | 'resume' | 'send' }) => api.post(`/reports/schedules/${id}/${action}`),
    onSuccess: (_r, v) => { refresh(); onToast(v.action === 'send' ? 'Report sent' : v.action === 'stop' ? 'Schedule stopped' : 'Schedule resumed'); },
  });
  return (
    <div className="space-y-4">
      {creating ? <ScheduleForm report="pl_monthly" catalog={catalog} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); onToast('Report email scheduled'); }} /> : <Button onClick={() => setCreating(true)}><Mail size={14} /> Schedule email</Button>}
      {act.isError && <p className="text-caption text-error-fg">{message(act.error)}</p>}
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s.id} className={`border-b border-line-100 last:border-0 ${s.active ? '' : 'text-ink-400'}`}>
                <td className="px-3 py-2">
                  <p className="text-body text-ink-900">{s.title} · {s.periodLabel}</p>
                  <p className="text-caption text-ink-500">{s.frequency === 'monthly' ? `Every month on the ${s.day}` : `Every ${WEEKDAYS[s.day - 1]}`} · to {s.recipients.join(', ')}</p>
                  {s.lastError && <p className="text-caption text-error-fg">Last try failed: {s.lastError}</p>}
                </td>
                <td className="px-3 py-2 text-caption text-ink-500">{s.active ? `Next ${s.nextRunOn}` : 'Stopped'}{s.lastSentOn ? ` · last sent ${s.lastSentOn}` : ''}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-3 text-caption">
                    <button className="text-ink-600 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ id: s.id, action: 'send' })}>Send now</button>
                    <button className="text-ink-600 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ id: s.id, action: s.active ? 'stop' : 'resume' })}>{s.active ? 'Stop' : 'Resume'}</button>
                  </div>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">No report emails scheduled.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagementReports() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('report') ? 'reports' : ((params.get('tab') as Tab) ?? 'reports'));
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  useEffect(() => {
    if (params.get('report')) setTab('reports');
  }, [params]);
  const catalog = useQuery({ queryKey: ['reports', 'catalog'], queryFn: () => api.get<CatalogEntry[]>('/reports/catalog') });
  const TABS: Array<{ id: Tab; label: string }> = [{ id: 'reports', label: 'Reports' }, { id: 'budgets', label: 'Budgets' }, { id: 'schedules', label: 'Scheduled emails' }];
  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="inline-flex items-center gap-1 text-caption text-ink-500 hover:underline"><ChevronLeft size={13} /> Reports</Link>
        <h1 className="text-h1 font-display text-ink-900">Management reports</h1>
        <p className="text-body text-ink-500">Sales, purchases, expenses and profit by month and by party, compared and budgeted, from posted entries only.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AskBox />
        <NarrativeCard />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line-200">
        {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-body font-medium ${tab === t.id ? 'border-b-2 border-saffron-600 text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>{t.label}</button>)}
      </div>
      {catalog.isError && <p className="text-caption text-error-fg">{message(catalog.error)}</p>}
      {tab === 'reports' && catalog.data && <ReportsTab catalog={catalog.data} onToast={showToast} />}
      {tab === 'budgets' && <BudgetsTab onToast={showToast} />}
      {tab === 'schedules' && catalog.data && <SchedulesTab catalog={catalog.data} onToast={showToast} />}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}

export default function ManagementReportsPage() {
  return (
    <Suspense>
      <ManagementReports />
    </Suspense>
  );
}
