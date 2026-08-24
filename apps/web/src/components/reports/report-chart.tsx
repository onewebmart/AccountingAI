'use client';

import { cn } from '@/lib/utils';

/**
 * A bar chart in plain markup.
 *
 * No chart library: these are single-series comparisons of a handful of rows,
 * which markup and CSS already express — and a library would mean a second
 * theme to keep in step with the design system, plus weight on a page that is
 * mostly a table.
 */

export interface ChartRow {
  label: string;
  /** Integer paise, like everything else that carries money. */
  valuePaise: number;
}

function formatPaise(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? '-' : '';
  if (rupees >= 100_000) return `${sign}₹${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}k`;
  return `${sign}₹${rupees.toFixed(0)}`;
}

export function ReportBarChart({
  rows,
  title,
  tone = 'saffron',
  emptyMessage = 'Nothing to chart yet.',
}: {
  rows: ChartRow[];
  title: string;
  tone?: 'saffron' | 'green' | 'red';
  emptyMessage?: string;
}) {
  const meaningful = rows.filter((r) => r.valuePaise !== 0);

  if (meaningful.length === 0) {
    return (
      <div className="rounded-sm border border-line-200 bg-surface-card p-4">
        <h3 className="text-body font-medium text-ink-900">{title}</h3>
        <p className="mt-3 text-caption text-ink-400">{emptyMessage}</p>
      </div>
    );
  }

  // Scale to the largest magnitude so one big row does not flatten the rest.
  const max = Math.max(...meaningful.map((r) => Math.abs(r.valuePaise)));

  const barColor = {
    saffron: 'bg-saffron-600',
    green: 'bg-success-fg',
    red: 'bg-error-fg',
  }[tone];

  return (
    <div className="rounded-sm border border-line-200 bg-surface-card p-4">
      <h3 className="mb-3 text-body font-medium text-ink-900">{title}</h3>
      <ul className="space-y-2">
        {meaningful.slice(0, 10).map((row) => (
          <li key={row.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-caption text-ink-500" title={row.label}>
              {row.label}
            </span>
            <span className="h-5 flex-1 overflow-hidden rounded-sm bg-surface-sink">
              <span
                className={cn('block h-full rounded-sm transition-all', barColor)}
                style={{ width: `${Math.max(2, (Math.abs(row.valuePaise) / max) * 100)}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-caption text-ink-700">
              {formatPaise(row.valuePaise)}
            </span>
          </li>
        ))}
      </ul>
      {meaningful.length > 10 ? (
        <p className="mt-2 text-caption text-ink-400">
          Showing the 10 largest of {meaningful.length}.
        </p>
      ) : null}
    </div>
  );
}
