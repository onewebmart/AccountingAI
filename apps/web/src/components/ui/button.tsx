import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-body font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primary: emerald. One primary per view.
        primary:
          'bg-brand-600 text-white shadow-e1 hover:bg-brand-700 hover:shadow-e2 active:bg-brand-800 rounded-md min-h-[44px] px-4',
        // Secondary — white with border
        secondary:
          'bg-surface-card border border-line-200 text-navy-900 hover:border-ink-300 hover:bg-honey-50 rounded-md min-h-[44px] px-4',
        // Ghost — transparent, low emphasis
        ghost:
          'text-ink-700 hover:bg-honey-50 hover:text-navy-900 rounded-md min-h-[44px] px-4',
        // Destructive: red, never orange
        destructive:
          'bg-[#DC2626] text-white hover:bg-[#B91C1C] rounded-md min-h-[44px] px-4',
        // Link
        link: 'text-brand-700 underline-offset-4 hover:text-brand-800 hover:underline p-0',
      },
      size: {
        sm: 'h-9 px-3 text-caption',
        default: 'h-11 px-4',
        lg: 'h-12 px-6 text-body-lg',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
