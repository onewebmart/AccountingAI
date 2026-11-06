'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { MONTHS } from './sample-data';
import { axisRupees, rupees } from './shared';

/**
 * The showcase's two charts, in plain SVG drawn at the container's real
 * width so axis text stays crisp at every size. Bars grow from the baseline
 * and the cash line draws itself in when the chart scrolls into view; under
 * reduced motion both are simply there.
 *
 * Marks follow the house chart spec: bars at most 24px with a 4px rounded
 * end and a square base, 2px lines, 8px end-dots with a white ring, hairline
 * solid gridlines, and text in ink tokens rather than series colours.
 */

export const REVENUE = '#16A36A'; // brand-600
export const EXPENSES = '#EA580C'; // expense
const CASH = '#264563'; // navy-700
const GRID = '#EEF2F6'; // line-100
const AXIS = '#64748B'; // ink-500
const EASE = [0.22, 1, 0.36, 1] as const;

const M = { top: 12, right: 8, bottom: 28, left: 48 };

function useWidth<T extends HTMLElement>() {
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

/** A bar whose top is rounded and whose base sits square on the baseline. */
function barPath(x: number, w: number, base: number, top: number, r = 4): string {
  const h = base - top;
  if (h < 0.5) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${base} V${top + rr} Q${x} ${top} ${x + rr} ${top} H${x + w - rr} Q${x + w} ${top} ${x + w} ${top + rr} V${base} Z`;
}

function Axes({ width, height, ticks, y, x }: { width: number; height: number; ticks: number[]; y: (v: number) => number; x: (i: number) => number }) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#E2E8F0' : GRID} strokeWidth={1} />
          <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t === 0 ? '₹0' : axisRupees(t)}
          </text>
        </g>
      ))}
      {MONTHS.map((m, i) => (
        <text key={m.month} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={AXIS}>
          {m.month}
        </text>
      ))}
    </>
  );
}

function Tip({ left, top, width, children }: { left: number; top: number; width: number; children: React.ReactNode }) {
  // Clamped so the first and last months do not push the tooltip off the card.
  const x = Math.min(Math.max(left, 84), Math.max(84, width - 84));
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line-200 bg-surface-card px-3 py-2 text-caption text-ink-700 shadow-e2"
      style={{ left: x, top: Math.max(top - 8, 0) }}
    >
      {children}
    </div>
  );
}

/** Revenue and expenses side by side for each month. */
export function RevenueExpenseBars({ height = 240 }: { height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  const ticks = [0, 1, 2, 3, 4, 5].map((n) => n * 1_00_000_00);
  const hi = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - M.left - M.right);
  const band = innerW / MONTHS.length;
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + (1 - v / hi) * (height - M.top - M.bottom);
  const gap = 2;
  const barW = Math.max(4, Math.min(24, (band * 0.62 - gap) / 2));
  const base = y(0);
  const shown = hover === null ? null : MONTHS[hover];
  const grown = reduce || inView;

  return (
    <div
      ref={ref}
      className="relative"
      role="img"
      aria-label={`Revenue and expenses by month, sample data: ${MONTHS.map((m) => `${m.month} revenue ${rupees(m.revenue)}, expenses ${rupees(m.expenses)}`).join('; ')}.`}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 ? (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <Axes width={width} height={height} ticks={ticks} y={y} x={x} />
          {MONTHS.map((m, i) => (
            <g key={m.month} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: 'opacity 150ms' }}>
              {(
                [
                  [m.revenue, REVENUE, x(i) - gap / 2 - barW],
                  [m.expenses, EXPENSES, x(i) + gap / 2],
                ] as const
              ).map(([v, color, left], j) => (
                <motion.path
                  key={color}
                  d={barPath(left, barW, base, y(v))}
                  fill={color}
                  style={{ originY: 1 }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: grown ? 1 : 0 }}
                  transition={{ duration: 0.7, delay: 0.1 + i * 0.08 + j * 0.04, ease: EASE }}
                />
              ))}
            </g>
          ))}
          {MONTHS.map((m, i) => (
            <rect
              key={m.month}
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={height - M.top - M.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {shown && width > 0 && (
        <Tip left={x(hover!)} top={y(Math.max(shown.revenue, shown.expenses))} width={width}>
          <p className="mb-1 font-semibold text-ink-900">{shown.month}</p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: REVENUE }} /> Revenue
            <span className="ml-auto pl-4 font-mono text-ink-900">{rupees(shown.revenue)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: EXPENSES }} /> Expenses
            <span className="ml-auto pl-4 font-mono text-ink-900">{rupees(shown.expenses)}</span>
          </p>
        </Tip>
      )}
    </div>
  );
}

/** Closing cash balance by month: a line over a faint area, drawn in on view. */
export function CashFlowLine({ height = 240 }: { height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  const ticks = [0, 2.5, 5, 7.5, 10].map((n) => n * 1_00_000_00);
  const hi = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - M.left - M.right);
  const band = innerW / MONTHS.length;
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + (1 - v / hi) * (height - M.top - M.bottom);
  const base = y(0);
  const line = MONTHS.map((m, i) => `${i ? 'L' : 'M'}${x(i)} ${y(m.cash)}`).join(' ');
  const area = `${line} L${x(MONTHS.length - 1)} ${base} L${x(0)} ${base} Z`;
  const drawn = reduce || inView;
  const shown = hover === null ? null : MONTHS[hover];
  const lastI = MONTHS.length - 1;

  return (
    <div
      ref={ref}
      className="relative"
      role="img"
      aria-label={`Closing cash balance by month, sample data: ${MONTHS.map((m) => `${m.month} ${rupees(m.cash)}`).join(', ')}.`}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 ? (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <Axes width={width} height={height} ticks={ticks} y={y} x={x} />
          <motion.path
            d={area}
            fill={CASH}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: drawn ? 0.1 : 0 }}
            transition={{ duration: 0.8, delay: 0.9 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke={CASH}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: drawn ? 1 : 0 }}
            transition={{ duration: 1.3, delay: 0.15, ease: [0.65, 0, 0.35, 1] }}
          />
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={base} stroke="#CBD5E1" strokeWidth={1} />
          )}
          {MONTHS.map((m, i) => (
            <motion.circle
              key={m.month}
              cx={x(i)}
              cy={y(m.cash)}
              r={i === lastI || hover === i ? 5 : 4}
              fill={i === lastI || hover === i ? CASH : '#FFFFFF'}
              stroke={i === lastI || hover === i ? '#FFFFFF' : CASH}
              strokeWidth={2}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: drawn ? 1 : 0 }}
              transition={{ duration: 0.25, delay: 0.3 + i * 0.19 }}
            />
          ))}
          {MONTHS.map((m, i) => (
            <rect
              key={m.month}
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={height - M.top - M.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {shown && width > 0 && (
        <Tip left={x(hover!)} top={y(shown.cash)} width={width}>
          <span className="text-ink-500">{shown.month} closing · </span>
          <span className="font-mono text-ink-900">{rupees(shown.cash)}</span>
        </Tip>
      )}
    </div>
  );
}
