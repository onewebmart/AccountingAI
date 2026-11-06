import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Pieces every landing section shares: the page gutter, the buttons, the
 * logo and the money format.
 *
 * Buttons are styled here rather than through <Button> so the landing page
 * does not depend on that component's variants while the app is being
 * rebranded; the colours are the same tokens.
 */

/** 16px gutters on phones, 24px on tablets, 32px on desktop; 1200px wide at most. */
export const container = 'mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8';

/** Section rhythm: 64px on phones, 96px from tablets up. */
export const sectionY = 'py-16 sm:py-24';

/** Sentence-sized section headings, smaller than the hero's. */
export const h2Class =
  'font-heading text-[2rem] font-extrabold leading-[1.15] tracking-[-0.02em] text-navy-900 sm:text-[2.5rem] lg:text-[2.75rem]';

type ButtonVariant = 'primary' | 'outline' | 'outlineOnDark';
type ButtonSize = 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[color,background-color,border-color,box-shadow] duration-200';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-e1 hover:bg-brand-700 hover:shadow-e2',
  outline: 'border border-line-200 bg-surface-card text-navy-900 hover:border-navy-300 hover:bg-navy-50',
  outlineOnDark: 'border border-white/25 text-white hover:border-white/50 hover:bg-white/10',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-body',
  lg: 'h-12 px-6 text-body-lg',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
  onClick,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/** The mark: a rising line on an emerald tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-600', className)}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <path d="M4.5 16.5 9.5 11.5l3.2 3.2 6.3-7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19" cy="7.7" r="1.7" fill="#fff" />
      </svg>
    </span>
  );
}

export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span
        className={cn(
          'font-heading text-[1.1875rem] font-extrabold tracking-[-0.02em]',
          tone === 'dark' ? 'text-navy-900' : 'text-white',
        )}
      >
        <span className={tone === 'dark' ? 'text-brand-700' : 'text-brand-400'}>Ai</span>Books
      </span>
    </span>
  );
}

/** ₹4,52,300: whole rupees from integer paise, Indian digit grouping. */
export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

/** ₹4.5L, ₹90K: short enough for an axis. */
export function axisRupees(paise: number): string {
  const r = paise / 100;
  const t = (n: number) => String(Number(n.toFixed(1)));
  if (r >= 1e7) return `₹${t(r / 1e7)}Cr`;
  if (r >= 1e5) return `₹${t(r / 1e5)}L`;
  if (r >= 1e3) return `₹${t(r / 1e3)}K`;
  return `₹${Math.round(r)}`;
}

/** A small uppercase label above a section heading. */
export function Eyebrow({ children, tone = 'light' }: { children: React.ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <p
      className={cn(
        'text-caption font-semibold uppercase tracking-[0.14em]',
        tone === 'light' ? 'text-brand-700' : 'text-brand-400',
      )}
    >
      {children}
    </p>
  );
}

/** Marks a mock as illustrative, so nobody reads sample figures as anyone's books. */
export function SampleChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line-200 bg-surface-sink px-2.5 py-0.5 text-caption font-medium text-ink-600',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ink-400" aria-hidden />
      Sample data
    </span>
  );
}

export type TxnStatus = 'Paid' | 'Pending' | 'Overdue';

const STATUS_CLASS: Record<TxnStatus, string> = {
  Paid: 'bg-success-bg text-success-fg ring-success-fg/20',
  Pending: 'bg-pending-bg text-pending-fg ring-pending-fg/20',
  Overdue: 'bg-error-bg text-error-fg ring-error-fg/20',
};

const STATUS_DOT: Record<TxnStatus, string> = {
  Paid: 'bg-success-fg',
  Pending: 'bg-pending-fg',
  Overdue: 'bg-error-fg',
};

export function StatusChip({ status }: { status: TxnStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold ring-1 ring-inset',
        STATUS_CLASS[status],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
      {status}
    </span>
  );
}
