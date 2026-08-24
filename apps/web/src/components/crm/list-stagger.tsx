'use client';

import { motion, useReducedMotion } from 'motion/react';

/**
 * Staggers list rows in as data arrives.
 *
 * Capped at the first twelve rows: past that the delay would be longer than
 * anyone waits, and a row that appears a second after its neighbours reads as
 * a bug rather than a flourish.
 */
export function ListStagger({
  children,
  index,
  className,
}: {
  children: React.ReactNode;
  index: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: Math.min(index, 12) * 0.035,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
