'use client';

import { useRef } from 'react';
import { motion, useInView, useReducedMotion, type Variants } from 'motion/react';

/**
 * Scroll reveals for the landing page.
 *
 * Same idea as FadeIn / Stagger in components/motion/primitives, with one
 * difference: the starting state is identical on server and client. Those
 * primitives pick a different `initial` under reduced motion, which the
 * server cannot know, so the first client render does not match the HTML and
 * React logs a hydration error. Here reduced motion only makes the
 * transition instant: nothing travels, nothing fades, and the markup matches.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const INSTANT = { duration: 0 };

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={reduce ? INSTANT : { duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Reveals its <RevealItem> children one after another. */
export function RevealGroup({
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
    <motion.div ref={ref} className={className} variants={container} initial="hidden" animate={inView ? 'show' : 'hidden'}>
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();

  const item: Variants = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: reduce ? INSTANT : { duration: 0.45, ease: EASE } },
  };

  return (
    <motion.div variants={item} className={className}>
      {children}
    </motion.div>
  );
}
