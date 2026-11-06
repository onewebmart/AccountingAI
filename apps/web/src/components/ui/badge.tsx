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
        pending: 'bg-[#FFFBEB] text-[#945800]',        // Amber — awaiting review
        posted: 'bg-[#F0FDF4] text-[#15803D]',         // Green — confirmed
        overdue: 'bg-[#FEF2F2] text-[#DC2626]',        // Red — danger
        matched: 'bg-[#F0FDF4] text-[#15803D]',        // Green
        attention: 'bg-[#FEF2F2] text-[#DC2626]',      // Red
        draft: 'bg-surface-sink text-ink-400',          // Muted
        info: 'bg-[#EFF6FF] text-[#3B5BC0]',           // Info
        duplicate: 'bg-[#FEF2F2] text-[#DC2626]',      // Red
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
