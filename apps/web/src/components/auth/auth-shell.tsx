'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { FinanceBackdrop } from '@/components/motion/finance-backdrop';
import { NoiseTexture } from '@/components/ui/noise-texture';

/**
 * The frame every auth screen sits in.
 *
 * Split rather than a card floating on an empty page: the left panel is the
 * only place before sign-in where the product can say what it is, and a lone
 * centred box on a blank field says nothing. On narrow screens the panel drops
 * away entirely — on a phone it would push the form below the fold, and the
 * form is the reason anyone is here.
 *
 * The three lines on the panel are claims the product can actually keep, which
 * is why they are specific. Vague reassurance ("secure", "powerful") reads as
 * filler precisely where trust is being asked for.
 */

const ASSURANCES = [
  'Every amount held in whole paise — no rounding drift.',
  'The AI proposes; a person posts. Never the other way round.',
  'Every change carries who, when, and what it was before.',
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <div className="grid min-h-screen bg-surface-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-roast-900 px-12 py-14 text-white lg:flex lg:flex-col">
        <FinanceBackdrop className="opacity-[0.55]" />
        <NoiseTexture
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          frequency={0.9}
          noiseOpacity={1}
        />

        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-saffron-600 font-heading text-caption font-bold text-white">
            CA
          </span>
          <span className="font-heading text-body-lg font-semibold">AiBooks</span>
        </Link>

        <div className="relative mt-auto max-w-md">
          <motion.p
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="font-heading text-display-lg text-white"
          >
            The month closes itself.
          </motion.p>
          <motion.p
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 text-body-lg leading-relaxed text-white/55"
          >
            Bookkeeping and practice management for Indian CA firms, in one place.
          </motion.p>

          <ul className="mt-10 space-y-3.5">
            {ASSURANCES.map((line, i) => (
              <motion.li
                key={line}
                initial={reduced ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.18 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className="flex gap-3 text-body text-white/70"
              >
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-marigold-400" />
                {line}
              </motion.li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ── Form ────────────────────────────────────────────────────── */}
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[420px]">
          {/* The mark repeats here for the mobile layout, where the panel is
              gone and the form would otherwise be unbranded. */}
          <Link href="/" className="mb-10 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-saffron-600 font-heading text-caption font-bold text-white">
              CA
            </span>
            <span className="font-heading text-body font-semibold text-ink-900">AiBooks</span>
          </Link>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="font-heading text-h1 text-ink-900">{title}</h1>
            <p className="mt-2 text-body text-ink-500">{subtitle}</p>

            <div className="mt-8">{children}</div>

            {footer ? <div className="mt-8 text-body text-ink-500">{footer}</div> : null}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
