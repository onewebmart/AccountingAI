import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primary — saffron. One primary per view.
        primary:
          'bg-saffron-600 text-white hover:bg-saffron-500 active:bg-saffron-700 rounded-md min-h-[44px] px-4',
        // Secondary — white with border
        secondary:
          'bg-surface-card border border-line-200 text-ink-900 hover:bg-honey-50 rounded-md min-h-[44px] px-4',
        // Ghost — transparent, low emphasis
        ghost:
          'text-ink-700 hover:bg-honey-50 rounded-md min-h-[44px] px-4',
        // Destructive — cool red, never orange
        destructive:
          'bg-[#C92A2A] text-white hover:bg-[#a82323] rounded-md min-h-[44px] px-4',
        // Link
        link: 'text-saffron-600 underline-offset-4 hover:underline p-0',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        default: 'h-11 px-4',
        lg: 'h-12 px-6 text-base',
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
