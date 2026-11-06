'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarClock, Home, Loader2, Plus, Search, Share2, Star, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuideButton } from '@/components/guide/module-guide';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';
import { FavouriteStar } from '@/components/reports/center/favourite-star';
import type { CenterData, CenterReport, Schedule } from '@/components/reports/center/types';
import { lastVisited } from '@/components/reports/center/types';

type View = 'home' | 'favorites' | 'shared' | 'mine' | 'scheduled';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
const th = 'whitespace-nowrap px-3 py-2 text-caption font-medium uppercase tracking-wide text-ink-500';

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body transition-colors ${active ? 'bg-honey-100 font-medium text-ink-900' : 'text-ink-600 hover:bg-surface-sink hover:text-ink-900'}`}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="font-mono text-caption tabular-nums text-ink-400">{count}</span>}
    </button>
  );
}

function ReportRows({ reports }: { reports: CenterReport[] }) {
  return (
    <>
      {reports.map((r) => (
        <tr key={r.key} className="border-b border-line-100 last:border-0 hover:bg-surface-sink/50">
          <td className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="pt-0.5"><FavouriteStar report={r} /></span>
              <div className="min-w-0">
                <Link href={`/reports/view/${encodeURIComponent(r.key)}`} className="text-body font-medium text-ink-900 hover:text-brand-800 hover:underline">
                  {r.title}
                </Link>
                {r.custom && <span className="ml-2 rounded-full border border-line-200 px-1.5 py-0.5 text-[11px] text-ink-500">{r.shared ? 'Shared' : 'Only you'}</span>}
                <p className="mt-0.5 line-clamp-1 text-caption text-ink-500">{r.description}</p>
              </div>
            </div>
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 text-body text-ink-600">{r.categoryLabel}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-body text-ink-600">{r.createdBy}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-caption text-ink-500">{lastVisited(r.lastVisitedAt)}</td>
        </tr>
      ))}
    </>
  );
}

function ReportList({ reports, grouped, categories, empty }: { reports: CenterReport[]; grouped: boolean; categories: CenterData['categories']; empty: React.ReactNode }) {
  if (!reports.length) return <div className="rounded-xl border border-dashed border-line-200 bg-surface-card px-6 py-12 text-center text-body text-ink-500">{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line-200 bg-surface-sink text-left">
            <th className={th}>Report name</th>
            <th className={th}>Report category</th>
            <th className={th}>Created by</th>
            <th className={th}>Last visited</th>
          </tr>
        </thead>
        <tbody>
          {grouped
            ? categories.map((c) => {
                const list = reports.filter((r) => r.category === c.key);
                if (!list.length) return null;
                return (
                  <GroupRows key={c.key} label={c.label} count={list.length}>
                    <ReportRows reports={list} />
                  </GroupRows>
                );
              })
            : <ReportRows reports={reports} />}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-b border-line-200 bg-honey-50">
        <td colSpan={4} className="px-3 py-1.5 text-caption font-semibold uppercase tracking-wide text-ink-500">
          {label} <span className="font-mono font-normal tabular-nums text-ink-400">· {count}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

function ScheduledList({ reports }: { reports: CenterReport[] }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['reports', 'schedules'], queryFn: () => api.get<Schedule[]>('/reports/schedules') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'stop' | 'resume' | 'send' }) => api.post(`/reports/schedules/${id}/${action}`),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'center'] });
      notify(v.action === 'send' ? 'Report sent' : v.action === 'stop' ? 'Schedule stopped' : 'Schedule resumed');
    },
    onError: (e) => notify(message(e), 'error'),
  });
  if (list.isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading schedules…</p>;
  if (list.isError) return <p className="text-caption text-error-fg">{message(list.error)}</p>;
  const rows = list.data ?? [];
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-line-200 bg-surface-card px-6 py-12 text-center text-body text-ink-500">
        No report is emailed on a schedule yet. Open a report and choose <span className="font-medium text-ink-900">Schedule</span>.
      </div>
    );
  }
  const known = new Set(reports.map((r) => r.key));
  return (
    <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line-200 bg-surface-sink text-left">
            {['Report', 'Covering', 'Sent', 'To', 'Next', ''].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className={`border-b border-line-100 last:border-0 ${s.active ? '' : 'text-ink-400'}`}>
              <td className="px-3 py-2.5">
                {known.has(s.report) ? <Link href={`/reports/view/${encodeURIComponent(s.report)}`} className="text-body font-medium text-ink-900 hover:underline">{s.title}</Link> : <span className="text-body">{s.title}</span>}
                {s.lastError && <p className="text-caption text-error-fg">Last try failed: {s.lastError}</p>}
              </td>
              <td className="px-3 py-2.5 text-body text-ink-600">{s.periodLabel}</td>
              <td className="px-3 py-2.5 text-body text-ink-600">{s.frequency === 'monthly' ? `Monthly, on the ${s.day}` : `Every ${WEEKDAYS[s.day - 1]}`}</td>
              <td className="px-3 py-2.5 text-caption text-ink-600">{s.recipients.join(', ')}</td>
              <td className="px-3 py-2.5 font-mono text-caption tabular-nums text-ink-600">{s.active ? s.nextRunOn : 'Stopped'}{s.lastSentOn ? ` · last ${s.lastSentOn}` : ''}</td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex justify-end gap-3 text-caption">
                  <button className="text-ink-600 hover:text-ink-900 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ id: s.id, action: 'send' })}>Send now</button>
                  <button className="text-ink-600 hover:text-ink-900 hover:underline" disabled={act.isPending} onClick={() => act.mutate({ id: s.id, action: s.active ? 'stop' : 'resume' })}>{s.active ? 'Stop' : 'Resume'}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const view = (params.get('view') as View) || 'home';
  const category = params.get('category');
  const go = (next: { view?: View; category?: string | null }) => {
    const q = new URLSearchParams();
    if (next.view && next.view !== 'home') q.set('view', next.view);
    if (next.category) q.set('category', next.category);
    router.replace(`/reports${q.toString() ? `?${q}` : ''}`, { scroll: false });
  };
  const center = useQuery({ queryKey: ['reports', 'center'], queryFn: () => api.get<CenterData>('/reports/center') });
  const data = center.data;

  const shown = useMemo(() => {
    if (!data) return [];
    let list = data.reports;
    if (view === 'favorites') list = list.filter((r) => r.favourite);
    if (view === 'shared') list = list.filter((r) => r.custom && r.shared);
    if (view === 'mine') list = list.filter((r) => r.custom && r.mine);
    if (category) list = list.filter((r) => r.category === category);
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((r) => `${r.title} ${r.description} ${r.categoryLabel}`.toLowerCase().includes(s));
    return list;
  }, [data, view, category, search]);

  const titles: Record<View, string> = { home: 'All Reports', favorites: 'Favorites', shared: 'Shared Reports', mine: 'My Reports', scheduled: 'Scheduled Reports' };
  const heading = category ? data?.categories.find((c) => c.key === category)?.label ?? 'Reports' : titles[view];
  const scheduled = view === 'scheduled' && !category && !search.trim();
  const count = scheduled ? data?.counts.scheduled ?? 0 : shown.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 font-display text-navy-900">Reports Center</h1>
          <p className="mt-1 text-body text-ink-500">Every report reads only posted entries. Star the ones you use, and make your own from any of them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GuideButton guide="reports" />
          <label className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="h-10 w-72 rounded-md border border-line-200 bg-white pl-8 pr-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40"
              placeholder="Search reports"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search reports"
            />
          </label>
          <Button asChild>
            <Link href="/reports/new"><Plus size={15} /> Create New Report</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="w-full shrink-0 self-start rounded-xl border border-line-200 bg-surface-card p-2 lg:sticky lg:top-4 lg:w-64">
          <nav className="space-y-0.5" aria-label="Reports">
            <NavItem active={view === 'home' && !category} icon={<Home size={15} />} label="Home" onClick={() => go({})} />
            <NavItem active={view === 'favorites' && !category} icon={<Star size={15} />} label="Favorites" count={data?.counts.favourites} onClick={() => go({ view: 'favorites' })} />
            <NavItem active={view === 'shared' && !category} icon={<Share2 size={15} />} label="Shared Reports" count={data?.counts.shared} onClick={() => go({ view: 'shared' })} />
            <NavItem active={view === 'mine' && !category} icon={<UserRound size={15} />} label="My Reports" count={data?.counts.mine} onClick={() => go({ view: 'mine' })} />
            <NavItem active={view === 'scheduled' && !category} icon={<CalendarClock size={15} />} label="Scheduled Reports" count={data?.counts.scheduled} onClick={() => go({ view: 'scheduled' })} />
          </nav>
          <p className="mb-1 mt-4 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Report category</p>
          <nav className="space-y-0.5" aria-label="Report categories">
            {(data?.categories ?? []).filter((c) => c.count > 0).map((c) => (
              <NavItem
                key={c.key}
                active={category === c.key}
                icon={<span className={`h-1.5 w-1.5 rounded-full ${category === c.key ? 'bg-brand-600' : 'bg-line-200'}`} />}
                label={c.label}
                count={c.count}
                onClick={() => go({ category: c.key })}
              />
            ))}
          </nav>
          <div className="mt-4 border-t border-line-100 px-2.5 pt-3">
            <Link href="/reports/statements" className="flex items-center gap-2 text-caption text-ink-500 hover:text-ink-900 hover:underline">
              <BookOpen size={13} /> Statements with charts
            </Link>
          </div>
        </aside>

        <section className="min-w-0 flex-1 space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-h3 font-display text-ink-900">{search.trim() ? `Results for “${search.trim()}”` : heading}</h2>
            <span className="rounded-full bg-surface-sink px-2 py-0.5 font-mono text-caption tabular-nums text-ink-600">{count}</span>
          </div>
          {center.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading reports…</p>}
          {center.isError && <p className="text-caption text-error-fg">{message(center.error)}</p>}
          {data && scheduled && <ScheduledList reports={data.reports} />}
          {data && !scheduled && (
            <ReportList
              reports={shown}
              grouped={!category && !search.trim() && view === 'home'}
              categories={data.categories}
              empty={
                view === 'favorites' ? 'Star a report to keep it here.'
                : view === 'mine' ? <>You have not made a report yet. <Link href="/reports/new" className="font-medium text-brand-800 underline">Create New Report</Link>.</>
                : view === 'shared' ? 'No one has shared a report with the organisation yet.'
                : 'No report matches. Try another word.'
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default function ReportsCenterPage() {
  return (
    <Suspense>
      <ReportsCenter />
    </Suspense>
  );
}
