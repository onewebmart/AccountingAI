'use client';

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Ambient accounting motifs behind the landing page.
 *
 * Everything here is drawn from what the product actually deals in — a ledger
 * rule, a rupee, a balancing pair of columns, a cash-flow line, a stamped
 * approval. Held at 3–7% opacity so it reads as texture rather than clip art:
 * you should notice the page feels like a ledger before you notice why.
 *
 * Motion is slow (18–30s) and drifts rather than bounces. Anything faster
 * competes with the headline for attention, and on a page selling careful
 * bookkeeping, restless decoration undercuts the pitch.
 */

/** Ruled paper — the substrate every ledger has been written on. */
function LedgerRules() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id="ledger-rules" width="100%" height="34" patternUnits="userSpaceOnUse">
          <line x1="0" y1="33.5" x2="100%" y2="33.5" stroke="var(--ink-900)" strokeWidth="1" />
        </pattern>
        {/* Fades the rules out before they reach the copy, so text never sits
            on a hard line. */}
        <linearGradient id="ledger-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="35%" stopColor="white" stopOpacity="0.5" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="ledger-mask">
          <rect width="100%" height="100%" fill="url(#ledger-fade)" />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="url(#ledger-rules)"
        mask="url(#ledger-mask)"
        opacity="0.06"
      />
      {/* The red margin rule of an accounts book, on the left. */}
      <line
        x1="9%"
        y1="0"
        x2="9%"
        y2="100%"
        stroke="var(--error-fg)"
        strokeWidth="1"
        opacity="0.05"
      />
    </svg>
  );
}

/** A balancing pair of columns — debit and credit, always equal. */
function BalanceMotif({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 90" className={className} aria-hidden fill="none">
      <line x1="60" y1="10" x2="60" y2="80" stroke="currentColor" strokeWidth="1.5" />
      <line x1="18" y1="26" x2="102" y2="26" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 26 L6 52 h24 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M102 26 L90 52 h24 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M46 80 h28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="60" cy="26" r="3" fill="currentColor" />
    </svg>
  );
}

/** A month of cash flow, closing higher than it opened. */
function CashflowLine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 70" className={className} aria-hidden fill="none">
      <path
        d="M4 56 L32 44 L60 50 L88 28 L116 34 L144 16 L172 22 L196 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[
        [32, 44],
        [88, 28],
        [144, 16],
        [196, 6],
      ].map(([cx, cy]) => (
        <circle key={`${cx}`} cx={cx} cy={cy} r="2.5" fill="currentColor" />
      ))}
    </svg>
  );
}

/** A filed return, stamped. */
function StampedMotif({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 110" className={className} aria-hidden fill="none">
      <rect x="6" y="6" width="66" height="90" rx="4" stroke="currentColor" strokeWidth="1.5" />
      {[24, 34, 44, 54].map((y) => (
        <line key={y} x1="18" y1={y} x2={y === 54 ? 44 : 60} y2={y} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ))}
      <circle cx="58" cy="76" r="20" stroke="currentColor" strokeWidth="1.5" opacity="0.8" />
      <path d="M49 76 l6 6 l12 -13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Drifter {
  /** Where it sits, as CSS insets. */
  style: React.CSSProperties;
  className: string;
  /** Seconds for one full drift cycle. */
  duration: number;
  /** Pixels of vertical travel. */
  travel: number;
  node: (className: string) => React.ReactNode;
}

const DRIFTERS: Drifter[] = [
  {
    style: { top: '12%', left: '6%' },
    className: 'w-24 text-saffron-600/[0.10]',
    duration: 22,
    travel: 14,
    node: (c) => <BalanceMotif className={c} />,
  },
  {
    style: { top: '22%', right: '7%' },
    className: 'w-40 text-success-fg/[0.11]',
    duration: 26,
    travel: -18,
    node: (c) => <CashflowLine className={c} />,
  },
  {
    style: { bottom: '14%', left: '11%' },
    className: 'w-20 text-marigold-400/[0.14]',
    duration: 30,
    travel: -12,
    node: (c) => <StampedMotif className={c} />,
  },
];

/** The rupee, set large in the display face — the thing all of it is counting. */
const GLYPHS = [
  { char: '₹', style: { top: '38%', left: '3%' }, size: 'text-[7rem]', duration: 24, travel: 16 },
  { char: '₹', style: { top: '8%', right: '22%' }, size: 'text-[4rem]', duration: 19, travel: -10 },
  { char: '%', style: { bottom: '26%', right: '5%' }, size: 'text-[5.5rem]', duration: 28, travel: 12 },
];

export function FinanceBackdrop({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <LedgerRules />

      {DRIFTERS.map((d, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={d.style}
          animate={reduced ? undefined : { y: [0, d.travel, 0] }}
          transition={{ duration: d.duration, repeat: Infinity, ease: 'easeInOut' }}
        >
          {d.node(d.className)}
        </motion.div>
      ))}

      {GLYPHS.map((g, i) => (
        <motion.span
          key={i}
          className={cn(
            'absolute select-none font-heading font-bold leading-none text-ink-900/[0.045]',
            g.size,
          )}
          style={g.style}
          animate={reduced ? undefined : { y: [0, g.travel, 0] }}
          transition={{ duration: g.duration, repeat: Infinity, ease: 'easeInOut' }}
        >
          {g.char}
        </motion.span>
      ))}
    </div>
  );
}
