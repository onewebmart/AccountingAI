'use client';

import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { CountUp } from '@/components/motion/primitives';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { HeroVisual } from './hero-visual';
import { ButtonLink, container } from './shared';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Rises into place on load; arrives already placed under reduced motion.
 *
 * The starting state is the same on server and client (the server cannot know
 * the reader's motion preference, and a different first render would not
 * hydrate); reduced motion only zeroes the transition.
 */
function Rise({
  delay,
  className,
  as = 'div',
  children,
}: {
  delay: number;
  className?: string;
  /** span inside headings, which take phrasing content only. */
  as?: 'div' | 'span';
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const Component = as === 'span' ? motion.span : motion.div;
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </Component>
  );
}

/** Figures that describe the product itself, not invented traction. */
const STATS: Array<{ value?: number; suffix?: string; text?: string; label: string }> = [
  { value: 89, label: 'reports, from Schedule III to ageing' },
  { value: 2, label: 'languages: English and Hindi' },
  { value: 100, suffix: '%', label: 'of AI entries approved by a person' },
  { text: 'GSTR-1 & 3B', label: 'prepared straight from your books' },
];

export function Hero() {
  const { user } = useAuth();

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden bg-navy-950 text-white">
      {/* A faint ledger grid, fading out from behind the product picture,
          and one soft emerald glow. Nothing louder than that. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 60% 70% at 72% 40%, #000 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 70% at 72% 40%, #000 20%, transparent 75%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 right-[-12%] h-[640px] w-[640px] rounded-full bg-brand-600/[0.12] blur-[120px]"
      />

      <div className={cn(container, 'relative pb-16 pt-12 sm:pb-20 sm:pt-16 lg:pb-24 lg:pt-20')}>
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          <div className="max-w-2xl">
            <Rise delay={0}>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-caption font-medium text-navy-100">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden />
                AI accounting for Indian SMEs and CA firms
              </p>
            </Rise>

            <h1
              id="hero-title"
              className="mt-6 font-heading text-display-lg font-extrabold text-white xl:text-[3.5rem]"
            >
              <Rise as="span" delay={0.08} className="block">
                Smart Accounting.
              </Rise>
              <Rise as="span" delay={0.18} className="block text-brand-400">
                Smarter Business Decisions.
              </Rise>
            </h1>

            <Rise delay={0.3}>
              <p className="mt-6 max-w-xl text-body-lg text-navy-200">
                Simplify accounting with AI-powered invoicing, GST management, expense tracking and
                real-time financial insights — all in one platform.
              </p>
            </Rise>

            <Rise delay={0.4}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                {user ? (
                  <ButtonLink href="/dashboard" size="lg">
                    Go to dashboard
                    <ArrowRight size={18} aria-hidden />
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/auth/signup" size="lg">
                    Get Started for Free
                    <ArrowRight size={18} aria-hidden />
                  </ButtonLink>
                )}
                <ButtonLink href="#features" variant="outlineOnDark" size="lg">
                  Explore Features
                </ButtonLink>
              </div>
              <p className="mt-4 text-caption text-navy-300">
                No card needed to sign up · Nothing posts to your books without your approval
              </p>
            </Rise>
          </div>

          <HeroVisual />
        </div>

        <dl className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10 lg:mt-24 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col-reverse bg-navy-950 px-4 py-5 sm:px-6">
              <dt className="mt-1 text-caption text-navy-200 sm:text-label sm:font-normal">{s.label}</dt>
              <dd className="font-heading text-h2 font-extrabold text-white sm:text-h1">
                {s.text ?? <CountUp to={s.value ?? 0} suffix={s.suffix} />}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
