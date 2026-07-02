import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Status chips — pill, radius full, label type.
 * Variants map to the design system semantic states.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium leading-[1.4] tracking-[0.04em] uppercase',
  {
    variants: {
      variant: {
        pending: 'bg-[#FFF4DC] text-[#945800]',        // Amber — awaiting review
        posted: 'bg-[#E6F6EE] text-[#1E7A47]',         // Green — confirmed
        overdue: 'bg-[#FBE9E9] text-[#C92A2A]',        // Red — danger
        matched: 'bg-[#E6F6EE] text-[#1E7A47]',        // Green
        attention: 'bg-[#FBE9E9] text-[#C92A2A]',      // Red
        draft: 'bg-surface-sink text-ink-400',          // Muted
        info: 'bg-[#E9EDFB] text-[#3B5BC0]',           // Info
        duplicate: 'bg-[#FBE9E9] text-[#C92A2A]',      // Red
      },
    },
    defaultVariants: {
      variant: 'draft',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
