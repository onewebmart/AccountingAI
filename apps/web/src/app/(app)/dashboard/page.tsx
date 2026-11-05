'use client';

import { Children, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Inbox,
  ReceiptIndianRupee,
  Scale,
  Sparkles,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { NarrativeCard } from '@/components/reports/narrative-card';
import { PageHeader, Section, StatusChip } from '@/components/page/page-shell';
import { Button } from '@/components/ui/button';
import { cn, formatRupeesCompact } from '@/lib/utils';
import { formatPaise } from '@/lib/gst';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/use-workspace';
import { currentFinancialYear } from '@/lib/financial-year';
import {
  BankCashCard,
  CashFlowCard,
  IncomeExpenseCard,
  Money,
  OwedCard,
  ProjectsCard,
  TopExpensesCard,
  overdueOf,
  useApAgeing,
  useArAgeing,
} from './widgets';

// Ask your books used to be a block on this page; it is now the round button
// at the bottom right of every page (components/assistant/ask-assistant.tsx).

// ── API response types ──────────────────────────────────────────────────────

const FINANCIAL_YEAR = currentFinancialYear();

interface DashboardSummary {
  financialYear: string;
  period: string;
  incomeMTD: number;
  expensesMTD: number;
  cashOnHand: number;
  gstDue: number;
  gstInputCredit: number;
  gstOutputLiability: number;
}

interface ProposalListResponse {
  data?: { id: string }[];
  total?: number;
  // Some APIs return an array directly
}

interface DocumentListResponse {
  data?: { id: string }[];
  total?: number;
}

/** GET /insights — each insight is a headline plus a sentence explaining it. */
interface InsightsResponse {
  insights?: { headline: string; explanation?: string }[];
}

interface Forecast {
  weeks: Array<{ weekStart: string; closingPaise: number }>;
  lowestPaise: number;
  openingCashPaise: number;
}

const weekLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Resolve a list count whichever shape the API sent. */
function countOf(data: { data?: unknown[]; total?: number } | unknown[] | undefined): number {
  if (!data) return 0;
  if (Array.isArray(data)) return data.length;
  if (typeof data.total === 'number') return data.total;
  if (Array.isArray(data.data)) return data.data.length;
  return 0;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: workspace } = useWorkspace();
  const role = user?.role as UserRole | undefined;
  const can = (p: Permission) => !!role && hasPermission(role, p);
  const canSales = can(Permission.MANAGE_SALES);
  const canPurchase = can(Permission.MANAGE_PURCHASE);
  const canLedger = can(Permission.VIEW_JOURNAL);
  const [tab, setTab] = useState<'dashboard' | 'start'>('dashboard');

  const { data: plData, isLoading: plLoading } = useQuery({
    queryKey: ['reports', 'dashboard', FINANCIAL_YEAR],
    queryFn: () =>
      api.get<DashboardSummary>(`/reports/dashboard?financialYear=${FINANCIAL_YEAR}`),
  });

  const { data: proposalsData, isLoading: proposalsLoading } = useQuery({
    queryKey: ['proposals', 'proposed'],
    queryFn: () => api.get<ProposalListResponse | { id: string }[]>('/proposals?status=proposed'),
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['documents', 'uploaded'],
    queryFn: () => api.get<DocumentListResponse | { id: string }[]>('/documents'),
  });

  // Receivables and payables, asked only by roles the API lets read them.
  const ar = useArAgeing(canSales);
  const ap = useApAgeing(canPurchase);

  const { data: gstReconLines } = useQuery({
    queryKey: ['gst', 'recon-lines'],
    queryFn: () => api.get<{ reconStatus?: string }[]>('/gst/recon-lines'),
  });

  const pendingProposals = countOf(proposalsData);
  const uploadedDocs = countOf(docsData);
  const isLoadingAny = plLoading || proposalsLoading || docsLoading;

  /**
   * Ageing reports amounts, not counts, so this row states the amount overdue
   * rather than inventing a number of invoices from it.
   */
  const overduePaise = overdueOf(ar.data);

  // The API field is `reconStatus`, lowercase. Reading `status !== 'MATCHED'`
  // matched nothing, so this always showed zero mismatches. `pending` lines
  // have simply not been reconciled yet, so they are not counted either.
  const gstMismatches = (gstReconLines ?? []).filter((l) =>
    ['mismatched', 'missing_in_books', 'missing_in_2b'].includes(l.reconStatus ?? ''),
  ).length;

  /**
   * GSTR-3B for a month is due on the 20th of the next one. Computed rather
   * than stated, because a fixed "due in 6 days" is wrong on 364 days a year.
   */
  const gstDueLabel = (() => {
    const now = new Date();
    const due = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 20));
    const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
    const date = due.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
    return days <= 0 ? date : `${date} (${days} days)`;
  })();
  const gstDue = plData?.gstDue ?? 0;

  // ── Header ──
  const firstName = workspace?.user.name?.trim().split(/\s+/)[0];
  const title = firstName ? `Hello, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}` : 'Hello';

  // Brand-new books: nothing posted, nothing waiting. Say what to do first.
  const booksEmpty =
    !isLoadingAny &&
    !!plData &&
    pendingProposals === 0 &&
    uploadedDocs === 0 &&
    plData.incomeMTD === 0 &&
    plData.expensesMTD === 0 &&
    plData.cashOnHand === 0;

  // ── Needs your attention ──
  const attention: Attention[] = [
    {
      value: String(pendingProposals),
      label: pendingProposals === 1 ? 'entry to review' : 'entries to review',
      href: '/review',
      icon: ClipboardCheck,
      active: pendingProposals > 0,
    },
    {
      value: String(uploadedDocs),
      label: uploadedDocs === 1 ? 'document waiting' : 'documents waiting',
      href: '/inbox',
      icon: Inbox,
      active: uploadedDocs > 0,
    },
    {
      value: overduePaise > 0 ? formatRupeesCompact(overduePaise) : 'Nothing',
      label: 'overdue from customers',
      href: '/sales/invoices',
      icon: AlertTriangle,
      active: overduePaise > 0,
      tone: overduePaise > 0 ? 'error' : undefined,
    },
    {
      value: String(gstMismatches),
      label: gstMismatches === 1 ? 'GST mismatch' : 'GST mismatches',
      href: '/gst',
      icon: Scale,
      active: gstMismatches > 0,
    },
    {
      value: plLoading ? '--' : formatRupeesCompact(gstDue),
      label: `GST due, GSTR-3B by ${gstDueLabel}`,
      href: '/gst',
      icon: ReceiptIndianRupee,
      active: gstDue > 0,
    },
  ];
  const waiting = attention.filter((a) => a.active).length;

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title={title}
          subtitle={workspace?.org.name}
          actions={
            <Button variant="secondary" asChild>
              <Link href="/inbox">
                <Upload size={16} />
                Upload documents
              </Link>
            </Button>
          }
        />
        <div role="tablist" aria-label="Dashboard views" className="-mt-2 flex gap-6 border-b border-line-200">
          {([['dashboard', 'Dashboard'], ['start', 'Getting started']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px border-b-2 px-0.5 pb-2.5 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400',
                tab === key ? 'border-saffron-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'start' ? (
        <GettingStarted canSales={canSales} canPurchase={canPurchase} canLedger={canLedger} uploadedDocs={uploadedDocs} />
      ) : (
        <>
          {/* Needs your attention: the amber band, the human-in-the-loop queues first */}
          <section aria-labelledby="attention-title" className="rounded-xl border border-marigold-400/70 bg-honey-100/70 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="attention-title" className="text-label font-medium uppercase tracking-[0.04em] text-pending-fg">
                Needs your attention
              </h2>
              {!booksEmpty && !isLoadingAny && (
                <p className="text-caption text-pending-fg">
                  {waiting === 0 ? 'All clear for now' : `${waiting} ${waiting === 1 ? 'thing' : 'things'} waiting for you`}
                </p>
              )}
            </div>
            {booksEmpty ? (
              <div className="flex flex-col items-start gap-4 rounded-md border border-line-200 bg-surface-card p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display text-h3 text-ink-900">Nothing&apos;s waiting.</p>
                  <p className="mt-1 text-body text-ink-500">
                    Upload some documents to get started. The entries AI proposes wait in Review until you approve them.
                  </p>
                </div>
                <Button variant="primary" asChild>
                  <Link href="/inbox">
                    <Upload size={16} />
                    Upload documents
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {attention.map((item) => (
                  <AttentionTile key={item.label} item={item} />
                ))}
              </div>
            )}
          </section>

          <Row>
            {canSales && <OwedCard kind="receivables" data={ar.data} loading={ar.isLoading} />}
            {canPurchase && <OwedCard kind="payables" data={ap.data} loading={ap.isLoading} />}
          </Row>

          <CashFlowCard />

          <Row>
            <IncomeExpenseCard />
            <TopExpensesCard />
          </Row>

          <Row>
            <ProjectsCard />
            {canLedger && <BankCashCard />}
          </Row>

          <Row>
            <InsightsCard />
            <ForecastCard />
          </Row>

          {/* The month in words: the card styles itself; match the other cards' padding. */}
          <div className="[&>section]:p-5">
            <NarrativeCard />
          </div>
        </>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** Two cards side by side on desktop, stacked on narrow screens; one card takes the row. */
function Row({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  return <div className={cn('grid gap-5', items.length > 1 && 'lg:grid-cols-2')}>{items}</div>;
}

interface Attention {
  value: string;
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  tone?: 'error';
}

function AttentionTile({ item }: { item: Attention }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="group flex min-h-[72px] flex-col justify-between gap-1 rounded-md border border-line-200 bg-surface-card px-3 py-2.5 transition-colors hover:bg-honey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400"
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            item.active ? 'bg-honey-100 text-pending-fg' : 'bg-surface-sink text-ink-400',
          )}
        >
          <Icon size={14} />
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-body-lg font-medium tabular-nums',
            item.tone === 'error' ? 'text-error-fg' : item.active ? 'text-ink-900' : 'text-ink-500',
          )}
        >
          {item.value}
        </span>
        <ChevronRight size={14} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="text-caption text-ink-500">{item.label}</span>
    </Link>
  );
}

/** What I noticed: the AI's observations on the year, labelled as AI. */
function InsightsCard() {
  const { data } = useQuery({
    queryKey: ['insights', FINANCIAL_YEAR],
    queryFn: () => api.get<InsightsResponse>(`/insights?financialYear=${FINANCIAL_YEAR}`),
  });
  // These used to read `i.text`, a field the API never sends, so every bullet
  // rendered as an empty "•".
  const items = data && Array.isArray(data.insights) && data.insights.length > 0 ? data.insights.slice(0, 4) : null;
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          What I noticed
          <StatusChip tone="pending">
            <Sparkles size={11} className="mr-1" /> AI
          </StatusChip>
        </span>
      }
      actions={
        <Link href="/insights" className="text-caption font-medium text-brand-600 hover:underline">
          See all insights
        </Link>
      }
      className="flex h-full flex-col"
    >
      {items ? (
        <ul className="space-y-3">
          {items.map((i, n) => (
            <li key={n} className="flex gap-2.5">
              <span aria-hidden className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-marigold-400" />
              <p className="text-body text-ink-700">
                <span className="font-medium text-ink-900">{i.headline}</span>
                {i.explanation && <span className="text-ink-600"> — {i.explanation}</span>}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-500">
          Nothing to flag yet. Observations appear once entries are posted to the ledger.{' '}
          <Link href="/review" className="font-medium text-brand-600 hover:underline">Go to Review</Link>
        </p>
      )}
      <p className="mt-auto pt-4 text-caption text-ink-400">AI suggestion — review before acting.</p>
    </Section>
  );
}

/** Where cash is heading: the closing balance week by week. The full view is on Insights. */
function ForecastCard() {
  const { data, isLoading, isError } = useQuery<Forecast>({
    queryKey: ['insights', 'forecast'],
    queryFn: () => api.get('/insights/forecast'),
  });
  const [hover, setHover] = useState<number | null>(null);
  const weeks = data?.weeks ?? [];
  const link = (
    <Link href="/insights#forecast" className="text-caption font-medium text-brand-600 hover:underline">
      See the forecast
    </Link>
  );

  if (isLoading || isError || weeks.length === 0) {
    return (
      <Section title="Cash forecast" actions={link} className="h-full">
        <p className="text-body text-ink-500">
          {isLoading
            ? 'Loading…'
            : isError
              ? 'The forecast could not load. Refresh the page to try again.'
              : 'Not enough history yet. Post bank entries and record invoices and bills with due dates, and the forecast appears here.'}
        </p>
      </Section>
    );
  }

  const end = weeks[weeks.length - 1].closingPaise;
  const short = weeks.find((w) => w.closingPaise < 0);
  const values = weeks.map((w) => w.closingPaise);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const zero = (-min / range) * 100; // the baseline, in % from the bottom
  const shown = hover === null ? null : weeks[hover];

  return (
    <Section
      title="Cash forecast"
      description={`The next ${weeks.length} weeks, from invoices and bills due`}
      actions={link}
      className="flex h-full flex-col"
    >
      <p className="text-caption text-ink-500">Cash in {weeks.length} weeks</p>
      <p className={cn('text-h2', end < 0 ? 'text-error-fg' : 'text-pending-fg')}>
        <Money paise={end} />
      </p>
      <p className={cn('mt-1 text-caption', short ? 'text-error-fg' : 'text-ink-500')}>
        {short ? `Runs short in the week of ${weekLabel(short.weekStart)}` : `Lowest point ${formatRupeesCompact(data?.lowestPaise ?? 0)}`}
      </p>

      {/* Closing cash each week: one series, so no legend; the line below names the bar under the pointer. */}
      <div className="mt-auto pt-4">
        <div className="relative flex h-16 gap-[2px]" role="img" aria-label={`Closing cash for each of the next ${weeks.length} weeks`} onMouseLeave={() => setHover(null)}>
          <span aria-hidden className="absolute inset-x-0 border-t border-line-200" style={{ bottom: `${zero}%` }} />
          {weeks.map((w, i) => {
            const h = (Math.abs(w.closingPaise) / range) * 100;
            const negative = w.closingPaise < 0;
            return (
              <span key={w.weekStart} className="relative flex-1" onMouseEnter={() => setHover(i)}>
                <span
                  className={cn(
                    'absolute inset-x-0',
                    negative ? 'rounded-b-[4px] bg-error-fg' : 'rounded-t-[4px]',
                    !negative && (hover === i ? 'bg-pending-fg' : 'bg-marigold-400'),
                    negative && hover === i && 'opacity-80',
                  )}
                  style={negative ? { top: `${100 - zero}%`, height: `${Math.max(h, 2)}%` } : { bottom: `${zero}%`, height: `${Math.max(h, 2)}%` }}
                />
              </span>
            );
          })}
        </div>
        <p className="mt-2 h-4 text-caption text-ink-500">
          {shown ? (
            <>
              Week of {weekLabel(shown.weekStart)} · <span className="font-mono tabular-nums text-ink-900">{formatPaise(shown.closingPaise)}</span>
            </>
          ) : (
            <>
              {weekLabel(weeks[0].weekStart)} to {weekLabel(weeks[weeks.length - 1].weekStart)}
            </>
          )}
        </p>
      </div>
    </Section>
  );
}

// ── Getting started ─────────────────────────────────────────────────────────

interface Step {
  title: string;
  body: string;
  href: string;
  action: string;
  /** Undefined while the figure that proves it is still loading. */
  done: boolean | undefined;
}

/**
 * The first things to set up, each ticked from the books themselves rather
 * than from a flag someone has to remember to set.
 */
function GettingStarted({ canSales, canPurchase, canLedger, uploadedDocs }: {
  canSales: boolean;
  canPurchase: boolean;
  canLedger: boolean;
  uploadedDocs: number;
}) {
  const { data: workspace } = useWorkspace();
  const banks = useQuery({ queryKey: ['banking', 'accounts'], queryFn: () => api.get<unknown[]>('/banking/accounts'), enabled: canLedger });
  const pl = useQuery({
    queryKey: ['dashboard', 'profit-loss', FINANCIAL_YEAR],
    queryFn: () => api.get<{ totalRevenuePaise: number; totalExpensesPaise: number }>(`/reports/profit-loss?financialYear=${FINANCIAL_YEAR}`),
  });

  const steps: Step[] = [
    {
      title: 'Add your business details',
      body: 'Your GSTIN, address and invoice settings, so invoices and returns carry the right details.',
      href: '/settings',
      action: 'Open settings',
      done: workspace ? !!workspace.org.gstin : undefined,
    },
  ];
  if (canLedger) {
    steps.push({
      title: 'Add your bank account',
      body: 'Import statements and match them to your entries.',
      href: '/banking',
      action: 'Add a bank account',
      done: banks.data ? banks.data.length > 0 : undefined,
    });
  }
  steps.push({
    title: 'Upload a bill or receipt',
    body: 'AI reads it and proposes the entry. Nothing posts until you approve it in Review.',
    href: '/inbox',
    action: 'Upload documents',
    done: uploadedDocs > 0,
  });
  if (canSales) {
    steps.push({
      title: 'Raise your first invoice',
      body: 'Add a customer and send them an invoice with GST worked out for you.',
      href: '/sales/invoices/new',
      action: 'New invoice',
      done: pl.data ? pl.data.totalRevenuePaise > 0 : undefined,
    });
  }
  if (canPurchase) {
    steps.push({
      title: 'Record a bill',
      body: 'Enter what you owe a vendor, so payables and input credit are right.',
      href: '/purchases/bills/new',
      action: 'New bill',
      done: pl.data ? pl.data.totalExpensesPaise > 0 : undefined,
    });
  }
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Section
      title="Set up your books"
      description={`${doneCount} of ${steps.length} done`}
    >
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-surface-sink" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <div className="h-full rounded-full bg-success-fg transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="divide-y divide-line-100">
        {steps.map((s) => (
          <li key={s.title} className="flex flex-wrap items-center gap-4 py-3.5">
            {s.done ? (
              <CheckCircle2 size={22} className="shrink-0 text-success-fg" aria-label="Done" />
            ) : (
              <Circle size={22} className="shrink-0 text-ink-300" aria-label="Not done yet" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', s.done ? 'text-ink-500' : 'text-ink-900')}>{s.title}</p>
              <p className="text-caption text-ink-500">{s.body}</p>
            </div>
            {s.done ? (
              <StatusChip tone="success">Done</StatusChip>
            ) : (
              <Button variant="secondary" size="sm" asChild>
                <Link href={s.href}>{s.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}
