'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronDown, ChevronRight, TrendingUp } from 'lucide-react';
import { QueryError } from '@/components/ui/query-error';
import { api } from '@/lib/api';
import { formatRupees, formatRupeesCompact } from '@/lib/utils';

// ── Shapes from GET /insights/forecast and /insights/projection (paise) ─────

interface ForecastItem {
  kind: string;
  direction: 'in' | 'out';
  label: string;
  date: string;
  amountPaise: number;
  note?: string;
}

interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  inflowPaise: number;
  outflowPaise: number;
  closingPaise: number;
  items: ForecastItem[];
}

interface CashForecast {
  asOf: string;
  openingCashPaise: number;
  weeks: ForecastWeek[];
  lowestPaise: number;
  lowestWeekStart: string;
  runRate: { weeklyInPaise: number; weeklyOutPaise: number; basedOnDays: number };
  doubtful: { count: number; amountPaise: number };
  assumptions: string[];
}

interface PlProjection {
  months: Array<{ period: string; revenuePaise: number; expensesPaise: number; netPaise: number; projected: boolean }>;
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** The balance week by week: a line, with zero marked when the line goes near it. */
function BalanceChart({ forecast }: { forecast: CashForecast }) {
  const W = 640;
  const H = 180;
  const PAD = { top: 12, bottom: 24, left: 8, right: 8 };
  const values = [forecast.openingCashPaise, ...forecast.weeks.map((w) => w.closingPaise)];
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values, 1);
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (values.length - 1);
  const y = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo || 1);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(values.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Forecast cash balance by week">
      <path d={area} className="fill-marigold-300/25" />
      {lo < 0 && <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="stroke-error-fg" strokeDasharray="4 4" strokeWidth={1} />}
      <path d={path} fill="none" className="stroke-marigold-400" strokeWidth={2.5} strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={3} className={v < 0 ? 'fill-error-fg' : 'fill-marigold-400'}>
          <title>{`${i === 0 ? 'Today' : `Week of ${shortDate(forecast.weeks[i - 1].weekStart)}`}: ${formatRupees(v)}`}</title>
        </circle>
      ))}
      {[0, Math.floor(values.length / 2), values.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'} className="fill-ink-500 text-[10px]">
          {i === 0 ? 'Today' : shortDate(forecast.weeks[i - 1].weekEnd)}
        </text>
      ))}
    </svg>
  );
}

/**
 * Where cash is heading over the next 13 weeks, from what the books already
 * know. Amber, because it is a projection: nothing here has happened yet.
 */
export function CashForecastPanel() {
  const [open, setOpen] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const query = useQuery<CashForecast>({ queryKey: ['insights', 'forecast'], queryFn: () => api.get<CashForecast>('/insights/forecast') });

  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const f = query.data;
  if (!f) return <div className="h-64 animate-pulse rounded-lg bg-surface-sink" />;

  const end = f.weeks[f.weeks.length - 1];
  const shortfall = f.weeks.find((w) => w.closingPaise < 0);

  return (
    <section id="forecast" className="space-y-4 rounded-lg border border-line-200 bg-surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-h3 font-display text-ink-900">
            <TrendingUp size={18} className="text-marigold-400" /> Cash forecast
          </h2>
          <p className="text-caption text-ink-500">Next {f.weeks.length} weeks, from what the books already know. A projection, not a promise.</p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-caption text-ink-500">Cash today</p>
            <p className="font-mono text-body font-semibold text-ink-900">{formatRupees(f.openingCashPaise)}</p>
          </div>
          <div>
            <p className="text-caption text-ink-500">In {f.weeks.length} weeks</p>
            <p className={`font-mono text-body font-semibold ${end.closingPaise < 0 ? 'text-error-fg' : 'text-pending-fg'}`}>{formatRupees(end.closingPaise)}</p>
          </div>
          <div>
            <p className="text-caption text-ink-500">Lowest</p>
            <p className={`font-mono text-body font-semibold ${f.lowestPaise < 0 ? 'text-error-fg' : 'text-ink-900'}`}>{formatRupees(f.lowestPaise)}</p>
          </div>
        </div>
      </div>

      {shortfall && (
        <div className="flex items-center gap-3 rounded-md border border-error-fg/30 bg-error-bg px-4 py-3">
          <AlertCircle size={16} className="shrink-0 text-error-fg" />
          <p className="text-body text-ink-900">
            Cash runs short in the week of <span className="font-semibold">{shortDate(shortfall.weekStart)}</span>, by{' '}
            <span className="font-mono font-semibold">{formatRupees(-shortfall.closingPaise)}</span>. Chase what is owed, or move a
            payment.
          </p>
        </div>
      )}

      <BalanceChart forecast={f} />

      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-line-200">
              {['Week', 'Coming in', 'Going out', 'Cash at the end'].map((h, i) => (
                <th key={h} className={`px-3 py-2 text-caption font-medium text-ink-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-100">
            {f.weeks.map((w) => (
              <Fragment key={w.weekStart}>
                <tr className="cursor-pointer hover:bg-surface-sink/60" onClick={() => setOpen(open === w.weekStart ? null : w.weekStart)}>
                  <td className="px-3 py-2 text-ink-900">
                    <span className="inline-flex items-center gap-1">
                      {open === w.weekStart ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {shortDate(w.weekStart)} – {shortDate(w.weekEnd)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-success-fg">{w.inflowPaise ? formatRupeesCompact(w.inflowPaise) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-700">{w.outflowPaise ? formatRupeesCompact(w.outflowPaise) : '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono font-medium ${w.closingPaise < 0 ? 'text-error-fg' : 'text-ink-900'}`}>{formatRupees(w.closingPaise)}</td>
                </tr>
                {open === w.weekStart && (
                  <tr>
                    <td colSpan={4} className="bg-surface-sink/50 px-6 py-2">
                      <ul className="space-y-1">
                        {w.items.map((item, n) => (
                          <li key={n} className="flex items-baseline justify-between gap-4 text-caption">
                            <span className="text-ink-700">
                              <span className="font-mono text-ink-500">{shortDate(item.date)}</span> {item.label}
                              {item.note && <span className="text-ink-500"> — {item.note}</span>}
                            </span>
                            <span className={`font-mono ${item.direction === 'in' ? 'text-success-fg' : 'text-ink-700'}`}>
                              {item.direction === 'in' ? '+' : '−'}{formatRupees(item.amountPaise)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <button type="button" className="text-caption font-medium text-ink-500 hover:text-ink-900" onClick={() => setShowAssumptions((s) => !s)}>
          {showAssumptions ? 'Hide' : 'Show'} how this was worked out
        </button>
        {showAssumptions && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-caption text-ink-500">
            {f.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Six months as booked, and three ahead by their trend. */
export function PlOutlookPanel() {
  const query = useQuery<PlProjection>({ queryKey: ['insights', 'projection'], queryFn: () => api.get<PlProjection>('/insights/projection') });
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const months = query.data?.months ?? [];
  if (!query.data) return <div className="h-40 animate-pulse rounded-lg bg-surface-sink" />;
  if (!months.some((m) => m.projected)) return null;

  return (
    <section className="space-y-3 rounded-lg border border-line-200 bg-surface-card p-5">
      <div>
        <h2 className="text-h3 font-display text-ink-900">Profit outlook</h2>
        <p className="text-caption text-ink-500">The last six months as booked, and the next three if the trend holds.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-line-200">
              <th className="px-3 py-2 text-left text-caption font-medium text-ink-500" />
              {months.map((m) => (
                <th key={m.period} className={`px-3 py-2 text-right text-caption font-medium whitespace-nowrap ${m.projected ? 'text-pending-fg' : 'text-ink-500'}`}>
                  {monthLabel(m.period)}
                  {m.projected && <span className="block text-[10px] uppercase tracking-wide">projected</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-100">
            {(
              [
                ['Revenue', 'revenuePaise'],
                ['Expenses', 'expensesPaise'],
                ['Profit', 'netPaise'],
              ] as const
            ).map(([label, key]) => (
              <tr key={key}>
                <td className="px-3 py-2 text-ink-700">{label}</td>
                {months.map((m) => (
                  <td
                    key={m.period}
                    className={`px-3 py-2 text-right font-mono whitespace-nowrap ${m.projected ? 'bg-honey-50 text-pending-fg' : key === 'netPaise' && m[key] < 0 ? 'text-error-fg' : 'text-ink-900'}`}
                  >
                    {m[key] === 0 ? '—' : formatRupeesCompact(m[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
