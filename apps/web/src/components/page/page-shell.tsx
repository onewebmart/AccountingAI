'use client';

import Link from 'next/link';
import { ChevronLeft, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The parts every page is built from, so lists, forms and records look and
 * behave the same everywhere: a header with the page's actions, a toolbar over
 * a table, a form in sections with its buttons in a bar that stays in view,
 * and an empty state that says what to do next. Forms are pages, not pop-ups.
 */

export function PageHeader({ title, subtitle, actions, back, meta }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** A link back to the list a form or record came from. */
  back?: { href: string; label: string };
  /** Beside the title: a status chip, a number. */
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-6 space-y-2">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-caption text-ink-500 hover:text-ink-900 hover:underline">
          <ChevronLeft size={13} /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h1 font-display text-ink-900">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mt-1 text-body text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Search and filters above a list. */
export function ListToolbar({ search, onSearch, placeholder = 'Search', filters, children }: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  /** Status chips, as [value, label] pairs. */
  filters?: { value: string; onChange: (v: string) => void; options: Array<[string, string]> };
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {onSearch && (
        <label className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="h-10 w-64 rounded-md border border-line-200 bg-white pl-8 pr-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
            placeholder={placeholder}
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
      )}
      {filters && (
        <div className="flex flex-wrap gap-1">
          {filters.options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => filters.onChange(value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-caption font-medium',
                filters.value === value ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600 hover:bg-surface-sink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** The frame of a list: a bordered, scrollable table. */
export function TableCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto rounded-xl border border-line-200 bg-surface-card', className)}>{children}</div>;
}

export const th = 'px-3 py-2.5 text-left text-caption font-medium text-ink-500 whitespace-nowrap';
export const td = 'px-3 py-2.5 text-body text-ink-900';
export const tdMoney = 'px-3 py-2.5 text-right font-mono tabular-nums text-body text-ink-900 whitespace-nowrap';
/** A clickable row that opens the record. */
export const rowLink = 'cursor-pointer border-b border-line-100 last:border-0 hover:bg-surface-sink';

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-200 bg-surface-card px-6 py-14 text-center">
      <p className="text-h3 font-display text-ink-900">{title}</p>
      {body && <p className="mt-1 max-w-md text-body text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * A form as a page: sections down the page, and the actions in a bar that
 * stays at the bottom of the screen. Submitting the form runs onSubmit.
 */
export function FormPage({ onSubmit, children, actions, error }: {
  onSubmit: () => void;
  children: React.ReactNode;
  /** The buttons: the primary action first, then Cancel. */
  actions: React.ReactNode;
  error?: React.ReactNode;
}) {
  return (
    <form
      className="pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-5">{children}</div>
      <div className="fixed bottom-0 left-[260px] right-0 z-30 border-t border-line-200 bg-surface-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-3 px-6 py-3">
          {actions}
          {error && <p className="text-caption text-error-fg">{error}</p>}
        </div>
      </div>
    </form>
  );
}

/** One part of a form or a record page. */
export function Section({ title, description, children, actions, className }: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-line-200 bg-surface-card p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-h3 font-display text-ink-900">{title}</h2>}
            {description && <p className="mt-0.5 text-caption text-ink-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A labelled field in a form grid. */
export function Field({ label, required, hint, children, className }: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-caption font-medium text-ink-700">
        {label}
        {required && <span className="text-error-fg"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-caption text-ink-500">{hint}</p>}
    </div>
  );
}

/** The input style shared by every form. */
export const inputClass = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40 disabled:bg-surface-sink';

/** Label and value pairs on a record page. */
export function DetailGrid({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-caption text-ink-500">{k}</dt>
          <dd className="text-body text-ink-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Status chips: amber waits or is AI's, green is done, grey is neither. */
export function StatusChip({ tone, children }: { tone: 'pending' | 'success' | 'neutral' | 'error'; children: React.ReactNode }) {
  const cls = {
    pending: 'bg-pending-bg text-pending-fg border-pending-fg/30',
    success: 'bg-success-bg text-success-fg border-success-fg/30',
    neutral: 'bg-surface-sink text-ink-600 border-line-200',
    error: 'bg-error-bg text-error-fg border-error-fg/30',
  }[tone];
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-medium', cls)}>{children}</span>;
}
