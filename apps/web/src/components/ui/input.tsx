import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, label, helperText, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-label text-ink-700 uppercase tracking-[0.04em]"
          >
            {label}
          </label>
        )}
        <input
          id={inputId}
          type={type}
          className={cn(
            'flex h-11 w-full rounded-sm border border-line-200 bg-surface-card px-3 py-2',
            'text-body text-ink-900 placeholder:text-ink-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-1',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-[#C92A2A] focus-visible:ring-[#C92A2A]',
            // Money inputs right-align
            type === 'number' && 'text-right font-mono',
            className,
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-caption text-[#C92A2A]">{error}</p>}
        {helperText && !error && <p className="text-caption text-ink-500">{helperText}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { Input };
