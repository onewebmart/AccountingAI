'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfidenceFieldProps {
  label: string;
  value: string | null;
  confidence: number;
  /** When true, value is a currency amount (formats with ₹) */
  isCurrency?: boolean;
  /** Callback when amber dot is clicked — highlights source region */
  onHighlight?: () => void;
  className?: string;
}

const LOW_CONFIDENCE_THRESHOLD = 0.8;

function formatCurrency(paise: number): string {
  return `₹ ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ConfidenceField({
  label,
  value,
  confidence,
  isCurrency = false,
  onHighlight,
  className,
}: ConfidenceFieldProps) {
  const isLow = confidence < LOW_CONFIDENCE_THRESHOLD;
  const displayValue = value
    ? isCurrency
      ? formatCurrency(Number(value))
      : value
    : '—';

  return (
    <div className={cn('flex items-center justify-between gap-3 py-2 border-b border-line-200 last:border-0', className)}>
      <span className="text-caption text-ink-500 uppercase tracking-[0.04em] w-24 shrink-0">
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-body text-ink-900 flex-1',
          !value && 'text-ink-400 italic',
        )}
      >
        {displayValue}
      </span>
      <button
        type="button"
        onClick={isLow ? onHighlight : undefined}
        className={cn(
          'shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-colors',
          isLow
            ? 'text-marigold-400 cursor-pointer hover:bg-honey-100'
            : 'text-success-fg cursor-default',
        )}
        aria-label={isLow ? `Low confidence on ${label} — click to see source` : `High confidence on ${label}`}
        title={`Confidence: ${Math.round(confidence * 100)}%`}
      >
        {isLow ? (
          <span className="block w-2.5 h-2.5 rounded-full bg-marigold-400" aria-hidden="true" />
        ) : (
          <Check size={14} strokeWidth={2.5} />
        )}
      </button>
    </div>
  );
}
