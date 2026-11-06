'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, FileCheck2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MONTHS, KPI } from './sample-data';
import { SampleChip, rupees } from './shared';

const EASE = [0.22, 1, 0.36, 1] as const;
// Starting states match on server and client (the server cannot know the
// motion preference); reduced motion only makes the transition instant.
const INSTANT = { duration: 0 };

/** A small revenue area, drawn left to right by widening a clip. No text, so it can scale. */
function MiniArea({ reduce }: { reduce: boolean }) {
  const W = 320;
  const H = 92;
  const pad = 6;
  const values = MONTHS.map((m) => m.revenue);
  const max = Math.max(...values) * 1.08;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - (v / max) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" aria-hidden>
      <defs>
        <clipPath id="hero-reveal">
          <motion.rect
            x={0}
            y={-10}
            height={H + 20}
            initial={{ width: 0 }}
            animate={{ width: W + 10 }}
            transition={reduce ? INSTANT : { duration: 1.4, delay: 0.7, ease: EASE }}
          />
        </clipPath>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="#EEF2F6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <g clipPath="url(#hero-reveal)">
        <path d={area} fill="#16A36A" fillOpacity={0.1} />
        <path
          d={line}
          fill="none"
          stroke="#16A36A"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <motion.circle
        cx={lastX}
        cy={lastY}
        r={4}
        fill="#16A36A"
        stroke="#fff"
        strokeWidth={2}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? INSTANT : { duration: 0.3, delay: 2 }}
      />
    </svg>
  );
}

function Kpi({ label, value, delta, tone }: { label: string; value: number; delta: string; tone: 'up' | 'neutral' }) {
  return (
    <div className="min-w-0 rounded-xl border border-line-100 bg-surface-page px-2.5 py-3 sm:px-3">
      <p className="truncate text-caption text-ink-500">{label}</p>
      <p className="mt-1 font-mono text-[0.875rem] text-ink-900 sm:text-h3 lg:text-body-lg xl:text-h3">{rupees(value)}</p>
      <p className={cn('mt-0.5 text-caption font-medium', tone === 'up' ? 'text-success-fg' : 'text-ink-500')}>{delta}</p>
    </div>
  );
}

/**
 * The hero's product picture: a slice of the dashboard, and a bill the AI has
 * read, waiting on a person. A couple of seconds in, it is approved and turns
 * from amber (proposed) to green (posted). Under reduced motion it stays as
 * a still of the proposal, which is the point it makes anyway.
 */
export function HeroVisual() {
  const reduce = useReducedMotion() ?? false;
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const t = window.setTimeout(() => setPosted(true), 3200);
    return () => window.clearTimeout(t);
  }, [reduce]);

  return (
    <div
      role="img"
      aria-label="Illustration with sample figures: a dashboard card showing October revenue, expenses and net profit with a rising revenue line, and a bill read by AI waiting for a person to approve and post it."
      className="relative mx-auto w-full max-w-[560px] lg:ml-auto lg:mr-0"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? INSTANT : { duration: 0.7, delay: 0.25, ease: EASE }}
        className="rounded-2xl bg-surface-card p-4 shadow-e3 ring-1 ring-white/10 sm:p-6"
      >
        {/* The right of this row is left clear for the GSTR-3B chip that
            floats over the corner from lg up. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-heading text-body font-bold text-navy-900">Business Overview</p>
          <SampleChip />
        </div>
        <p className="text-caption text-ink-500">October · compared with September</p>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <Kpi label="Revenue" value={KPI.revenue} delta={`▲ ${KPI.revenueChange}%`} tone="up" />
          <Kpi label="Expenses" value={KPI.expenses} delta={`▲ ${KPI.expensesChange}%`} tone="neutral" />
          <Kpi label="Net profit" value={KPI.profit} delta={`▲ ${KPI.profitChange}%`} tone="up" />
        </div>

        <div className="mt-3 rounded-xl border border-line-100 px-3 pb-2 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-caption font-medium text-ink-600">Revenue, last 6 months</p>
            <p className="inline-flex items-center gap-0.5 text-caption font-semibold text-success-fg">
              <ArrowUpRight size={14} aria-hidden />
              {Math.round(((KPI.revenue - MONTHS[0].revenue) / MONTHS[0].revenue) * 100)}%
            </p>
          </div>
          <div className="mt-2">
            <MiniArea reduce={reduce} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-ink-400">
            {MONTHS.map((m) => (
              <span key={m.month}>{m.month}</span>
            ))}
          </div>
        </div>

        {/* From lg up the bill card overlaps this card's bottom-left corner;
            this row keeps that corner empty and puts the queue on the right. */}
        <div className="mt-4 hidden h-12 items-center justify-end lg:flex">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pending-bg px-3 py-1 text-caption font-semibold text-pending-fg ring-1 ring-inset ring-pending-fg/20">
            <span className="h-1.5 w-1.5 rounded-full bg-marigold-400" />
            {posted ? '2' : '3'} entries to review
          </span>
        </div>
      </motion.div>

      {/* The bill the AI read: below the card on smaller screens, overlapping
          its corner from lg up. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? INSTANT : { duration: 0.6, delay: 1.1, ease: EASE }}
        className="relative z-10 mt-3 lg:-ml-10 lg:-mt-16 lg:w-[290px] xl:-ml-12 xl:w-[310px]"
      >
        <div
          className={cn(
            'rounded-xl border-l-[3px] bg-surface-card p-4 shadow-e3 ring-1 ring-line-200 transition-[border-color] duration-500',
            posted ? 'border-l-success-fg' : 'border-l-marigold-400',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <AnimatePresence mode="wait" initial={false}>
              {posted ? (
                <motion.span
                  key="posted"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-semibold text-success-fg"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-success-fg" />
                  Posted to ledger
                </motion.span>
              ) : (
                <motion.span
                  key="proposed"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-semibold text-pending-fg"
                >
                  <Sparkles size={12} />
                  Proposed by AI
                </motion.span>
              )}
            </AnimatePresence>
            <span className="font-mono text-caption text-ink-500">{posted ? 'JV-0142' : 'bill.pdf'}</span>
          </div>

          <p className="mt-2 text-label font-semibold text-navy-900">Sharma Office Supplies</p>
          <dl className="mt-2 space-y-1 text-caption">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">Dr Office supplies</dt>
              <dd className="font-mono text-ink-900">{rupees(16_000_00)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">Dr Input CGST + SGST</dt>
              <dd className="font-mono text-ink-900">{rupees(2_880_00)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-line-100 pt-1">
              <dt className="text-ink-600">Cr Sharma Office Supplies</dt>
              <dd className="font-mono text-ink-900">{rupees(18_880_00)}</dd>
            </div>
          </dl>

          <div className="mt-3 flex h-8 items-center">
            {posted ? (
              <p className="text-caption text-ink-500">Approved by a person · balanced</p>
            ) : (
              <span className="inline-flex h-8 items-center rounded-lg bg-brand-600 px-3 text-caption font-semibold text-white">
                Approve &amp; post
              </span>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? INSTANT : { duration: 0.5, delay: 1.5, ease: EASE }}
        className="absolute -right-4 -top-6 hidden items-center gap-2 rounded-xl bg-surface-card px-3 py-2 shadow-e3 ring-1 ring-line-200 lg:flex"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <FileCheck2 size={16} aria-hidden />
        </span>
        <span className="text-caption leading-tight">
          <span className="block font-semibold text-navy-900">GSTR-3B ready</span>
          <span className="text-ink-500">Prepared from your books</span>
        </span>
      </motion.div>
    </div>
  );
}
