'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion, type Variants } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Motion primitives shared across the site.
 *
 * Every one of these honours prefers-reduced-motion: the element still appears,
 * it just arrives without travelling. Animation here is for orientation — it
 * shows where things came from — not decoration, so removing it must never
 * remove information.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts a block into place when it scrolls into view. */
export function FadeIn({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'span';
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  const Component = motion[as] as typeof motion.div;

  return (
    <Component
      ref={ref}
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: reduce ? 0.2 : 0.5, delay, ease: EASE }}
    >
      {children}
    </Component>
  );
}

/** Staggers its children in, one after another. */
export function Stagger({
  children,
  className,
  gap = 0.08,
}: {
  children: React.ReactNode;
  className?: string;
  gap?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : gap } },
  };

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={container}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
    >
      {children}
    </motion.div>
  );
}

/** A child of <Stagger>. */
export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  const item: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0.2 : 0.45, ease: EASE } },
  };

  return (
    <motion.div variants={item} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * Counts up to a number when it scrolls into view.
 *
 * Falls straight to the final value under reduced motion — a statistic that
 * never settles is worse than one that simply appears.
 */
export function CountUp({
  to,
  prefix = '',
  suffix = '',
  durationMs = 1200,
  decimals = 0,
  className,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  decimals?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setValue(to);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic, so it decelerates into the final figure.
      setValue(to * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, to, durationMs, reduce]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/** Lifts a card slightly on hover. Pointer-only, and off under reduced motion. */
export function HoverLift({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A slow saffron glow behind the hero. Purely atmospheric, so it is skipped
 * entirely under reduced motion rather than slowed down.
 */
export function AuroraBackdrop({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <div
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      >
        <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-saffron-600/20 blur-3xl" />
        <div className="absolute -right-24 top-32 h-80 w-80 rounded-full bg-marigold-400/15 blur-3xl" />
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <motion.div
        className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-saffron-600/20 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 24, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-24 top-32 h-80 w-80 rounded-full bg-marigold-400/15 blur-3xl"
        animate={{ x: [0, -32, 0], y: [0, -20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
