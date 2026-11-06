'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatPaise } from '@/lib/gst';

/**
 * The dashboard's charts, in plain SVG.
 *
 * The web app carries no chart library (see report-chart.tsx for why), and
 * these are three small forms: a line over twelve months, paired bars over
 * twelve months, and a ring of a handful of parts. Values are integer paise
 * and become rupees only in the labels.
 *
 * Colours: revenue is emerald and expenses orange; the cash line is
 * emerald; the ring uses a fixed order of hues that stay apart for
 * colour-blind readers, and folds everything past five into a grey "Other".
 * Every chart names its values in text too (legend, totals, the line under
 * the pointer), so colour is never the only carrier.
 */

export const SERIES = {
  income: '#16A36A', // revenue: emerald
  expenses: '#EA580C', // expenses: orange
  cash: '#16A36A',
  overdue: '#DC2626', // error-fg: overdue is a status
  current: '#F59E0B', // not yet due: pending, amber
};

/** The ring's hues, in order. Grey is kept for "Other". */
export const RING = ['#142D4E', '#16A36A', '#2563EB', '#EA580C', '#8B5CF6'];
export const OTHER = '#94A3B8';

const GRID = '#E2E8F0'; // line-200
const AXIS_TEXT = '#64748B'; // ink-500

/** Width of an element, kept current as the layout changes. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** ₹12L, ₹1.5Cr, ₹40K: short enough for an axis. */
export function axisMoney(paise: number): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? '−' : '';
  const t = (n: number) => String(Number(n.toFixed(1)));
  if (r >= 1e7) return `${sign}₹${t(r / 1e7)}Cr`;
  if (r >= 1e5) return `${sign}₹${t(r / 1e5)}L`;
  if (r >= 1e3) return `${sign}₹${t(r / 1e3)}K`;
  return `${sign}₹${Math.round(r)}`;
}

/** Round steps covering [min, max], zero included. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const lo0 = Math.min(0, min);
  const hi0 = Math.max(0, max);
  const span = hi0 - lo0 || 100_00; // ₹100 when everything is zero
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step || step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

const M = { top: 12, right: 8, bottom: 26, left: 52 };

function Frame({ width, height, ticks, y, labels, x, children }: {
  width: number;
  height: number;
  ticks: number[];
  y: (v: number) => number;
  labels: string[];
  x: (i: number) => number;
  children: React.ReactNode;
}) {
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3 3'} />
          <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {axisMoney(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={l + i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
          {l}
        </text>
      ))}
      {children}
    </svg>
  );
}

/** A tooltip pinned over a point of the plot. */
function Tip({ left, top, width, children }: { left: number; top: number; width: number; children: React.ReactNode }) {
  // Kept inside the plot so the first and last months do not spill off the card.
  const x = Math.min(Math.max(left, 90), Math.max(90, width - 90));
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line-200 bg-surface-card px-2.5 py-1.5 text-caption text-ink-700 shadow-e2"
      style={{ left: x, top: Math.max(top - 8, 0) }}
    >
      {children}
    </div>
  );
}

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  label: string;
  /** Undefined for months still to come. */
  value?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Cash at the end of each month: a line over a soft area, a point per month. */
export function LineAreaChart({ points, height = 220, ariaLabel }: { points: MonthPoint[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const known = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== undefined) as Array<MonthPoint & { i: number; value: number }>;
  const ticks = niceTicks(Math.min(...known.map((p) => p.value), 0), Math.max(...known.map((p) => p.value), 0));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - M.left - M.right);
  const band = innerW / Math.max(points.length, 1);
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * (height - M.top - M.bottom);
  const base = y(Math.max(lo, 0));
  const line = known.map((p, n) => `${n ? 'L' : 'M'}${x(p.i)} ${y(p.value)}`).join(' ');
  const area = known.length ? `${line} L${x(known[known.length - 1].i)} ${base} L${x(known[0].i)} ${base} Z` : '';
  const shown = hover === null ? null : points[hover];

  return (
    <div ref={ref} className="relative" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <Frame width={width} height={height} ticks={ticks} y={y} x={x} labels={points.map((p) => p.label)}>
          <defs>
            <linearGradient id="cash-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SERIES.cash} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SERIES.cash} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#cash-area)" />}
          {line && <path d={line} fill="none" stroke={SERIES.cash} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={height - M.bottom} stroke="#CBD5E1" strokeWidth={1} />}
          {known.map((p) => (
            <circle key={p.month} cx={x(p.i)} cy={y(p.value)} r={hover === p.i ? 5 : 4} fill={hover === p.i ? SERIES.cash : '#FFFFFF'} stroke={SERIES.cash} strokeWidth={2} />
          ))}
          {points.map((p, i) => (
            <rect key={p.month} x={M.left + band * i} y={M.top} width={band} height={height - M.top - M.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </Frame>
      )}
      {shown && width > 0 && (
        <Tip left={x(hover!)} top={shown.value !== undefined ? y(shown.value) : M.top + 16} width={width}>
          <span className="text-ink-500">{monthYear(shown.month)} · </span>
          {shown.value !== undefined ? <span className="font-mono tabular-nums text-ink-900">{formatPaise(shown.value)}</span> : 'still to come'}
        </Tip>
      )}
      {width === 0 && <div style={{ height }} />}
    </div>
  );
}

/** A bar whose far end is rounded and whose base sits square on the baseline. */
function barPath(x: number, w: number, from: number, to: number, r = 4): string {
  const h = Math.abs(to - from);
  const rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (to < from) {
    // Upward: round the top.
    return `M${x} ${from} V${to + rr} Q${x} ${to} ${x + rr} ${to} H${x + w - rr} Q${x + w} ${to} ${x + w} ${to + rr} V${from} Z`;
  }
  return `M${x} ${from} V${to - rr} Q${x} ${to} ${x + rr} ${to} H${x + w - rr} Q${x + w} ${to} ${x + w} ${to - rr} V${from} Z`;
}

export interface PairPoint {
  month: string;
  label: string;
  a: number;
  b: number;
}

/** Two series side by side for each month: income and expenses. */
export function PairedBarChart({ points, colors, names, height = 220, ariaLabel }: {
  points: PairPoint[];
  colors: [string, string];
  names: [string, string];
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = points.flatMap((p) => [p.a, p.b]);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - M.left - M.right);
  const band = innerW / Math.max(points.length, 1);
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * (height - M.top - M.bottom);
  const gap = 2;
  const barW = Math.max(2, Math.min(18, (band * 0.72 - gap) / 2));
  const zero = y(0);
  const shown = hover === null ? null : points[hover];

  return (
    <div ref={ref} className="relative" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <Frame width={width} height={height} ticks={ticks} y={y} x={x} labels={points.map((p) => p.label)}>
          {points.map((p, i) => (
            <g key={p.month} opacity={hover === null || hover === i ? 1 : 0.45}>
              <path d={barPath(x(i) - gap / 2 - barW, barW, zero, y(p.a))} fill={colors[0]} />
              <path d={barPath(x(i) + gap / 2, barW, zero, y(p.b))} fill={colors[1]} />
            </g>
          ))}
          {points.map((p, i) => (
            <rect key={p.month} x={M.left + band * i} y={M.top} width={band} height={height - M.top - M.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </Frame>
      )}
      {shown && width > 0 && (
        <Tip left={x(hover!)} top={y(Math.max(shown.a, shown.b, 0))} width={width}>
          <p className="mb-0.5 font-medium text-ink-900">{monthYear(shown.month)}</p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: colors[0] }} /> {names[0]}
            <span className="ml-auto pl-3 font-mono tabular-nums text-ink-900">{formatPaise(shown.a)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: colors[1] }} /> {names[1]}
            <span className="ml-auto pl-3 font-mono tabular-nums text-ink-900">{formatPaise(shown.b)}</span>
          </p>
        </Tip>
      )}
      {width === 0 && <div style={{ height }} />}
    </div>
  );
}

export interface Slice {
  label: string;
  paise: number;
  color: string;
}

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const end = Math.min(a1, a0 + Math.PI * 2 - 0.0001);
  const p = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = end - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, end);
  const [x2, y2] = p(r0, end);
  const [x3, y3] = p(r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

/** Parts of one whole, as a ring with a legend that names each part, its amount and its share. */
export function DonutChart({ slices, centre, ariaLabel }: { slices: Slice[]; centre: { value: string; label: string }; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.paise, 0) || 1;
  const size = 184;
  const c = size / 2;
  let angle = 0;
  const arcs = slices.map((s) => {
    const a0 = angle;
    angle += (s.paise / total) * Math.PI * 2;
    return { ...s, a0, a1: angle };
  });

  return (
    <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-4" role="img" aria-label={ariaLabel}>
      <div className="relative mx-auto shrink-0 sm:mx-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden>
          {arcs.map((a, i) => (
            <path
              key={a.label}
              d={arcPath(c, c, c - 26, hover === i ? c : c - 3, a.a0, a.a1)}
              fill={a.color}
              stroke="#FFFFFF"
              strokeWidth={2}
              opacity={hover === null || hover === i ? 1 : 0.45}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-body font-medium tabular-nums text-ink-900">{hover === null ? centre.value : `${Math.round((slices[hover].paise / total) * 100)}%`}</span>
          <span className="max-w-[96px] truncate text-caption text-ink-500">{hover === null ? centre.label : slices[hover].label}</span>
        </div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={cn('flex items-center gap-2 rounded-sm px-1.5 py-1 text-caption transition-colors', hover === i && 'bg-surface-sink')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 break-words leading-snug text-ink-700">{s.label}</span>
            <span className="font-mono tabular-nums text-ink-900">{formatPaise(s.paise)}</span>
            <span className="w-9 text-right font-mono tabular-nums text-ink-500">{Math.round((s.paise / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One whole split in two, as a thin bar: current against overdue. */
export function SplitBar({ parts, ariaLabel }: { parts: Array<{ paise: number; color: string }>; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.paise), 0);
  return (
    <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-surface-sink" role="img" aria-label={ariaLabel}>
      {total > 0 &&
        parts
          .filter((p) => p.paise > 0)
          .map((p, i) => <span key={i} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.paise / total) * 100}%`, background: p.color }} />)}
    </div>
  );
}
