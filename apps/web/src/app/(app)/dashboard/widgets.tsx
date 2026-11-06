'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Clock3, PiggyBank, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { Section, StatusChip } from '@/components/page/page-shell';
import { VOUCHER_TYPE_LABELS } from '@/components/accountant/journal-types';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { cn, formatRupeesCompact } from '@/lib/utils';
import { recentFinancialYears } from '@/lib/financial-year';
import { usePipeline } from '@/components/documents/library';
import { DonutChart, LineAreaChart, OTHER, PairedBarChart, RING, SERIES, SplitBar, type Slice } from './charts';

// ── Shared ─────────────────────────────────────────────────────────────────

/** GET /sales/ar-ageing and GET /purchase/ap-ageing: amounts owed, in paise, by how late. */
export interface AgeingSummary {
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
}

export const overdueOf = (a?: AgeingSummary) =>
  (a?.days1_30 ?? 0) + (a?.days31_60 ?? 0) + (a?.days61_90 ?? 0) + (a?.over90 ?? 0);

export const useArAgeing = (enabled: boolean) =>
  useQuery({ queryKey: ['sales', 'ar-ageing'], queryFn: () => api.get<AgeingSummary>('/sales/ar-ageing'), enabled });
export const useApAgeing = (enabled: boolean) =>
  useQuery({ queryKey: ['purchase', 'ap-ageing'], queryFn: () => api.get<AgeingSummary>('/purchase/ap-ageing'), enabled });

/** Rupees in mono with tabular figures; the paise smaller, so the rupees read first. */
export function Money({ paise, className }: { paise: number; className?: string }) {
  const text = formatPaise(paise);
  const dot = text.lastIndexOf('.');
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {dot === -1 ? text : text.slice(0, dot)}
      {dot !== -1 && <span className="text-[0.62em] opacity-60">{text.slice(dot)}</span>}
    </span>
  );
}

const cardLink = 'text-caption font-medium text-brand-700 hover:underline';

function NewLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium text-brand-700 hover:bg-honey-50" aria-label={label}>
      <Plus size={14} /> New
    </Link>
  );
}

/** This fiscal year or the one before: every figure on these cards is asked for by year. */
const YEARS = recentFinancialYears(2);
function useYear() {
  return useState(YEARS[0]);
}
function YearSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-line-200 bg-surface-card px-2 text-caption text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-600/40"
    >
      <option value={YEARS[0]}>This fiscal year</option>
      <option value={YEARS[1]}>Last fiscal year ({YEARS[1]})</option>
    </select>
  );
}

/** The twelve months of a financial year, April to March, as YYYY-MM. */
function fyMonths(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = i < 9 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}
// Spelled out rather than from toLocaleDateString, which now shortens September to "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const ddmmyyyy = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-ink-500">{children}</p>;
}

// ── Total receivables / payables ─────────────────────────────────────────────

/** What customers owe, or what you owe vendors: the total, split into not yet due and overdue. */
export function OwedCard({ kind, data, loading }: { kind: 'receivables' | 'payables'; data?: AgeingSummary; loading: boolean }) {
  const r = kind === 'receivables';
  const overdue = overdueOf(data);
  const current = data?.current ?? 0;
  const total = data?.total ?? 0;
  return (
    <Section
      title={r ? 'Outstanding Invoices' : 'Upcoming Payments'}
      actions={<NewLink href={r ? '/sales/invoices/new' : '/purchases/bills/new'} label={r ? 'New invoice' : 'New bill'} />}
      className="h-full"
    >
      <p className="text-caption text-ink-500">{r ? 'Total unpaid invoices' : 'Total unpaid bills'}</p>
      <p className="mt-0.5 text-h2 text-ink-900">{loading ? <span className="font-mono text-ink-400">--</span> : <Money paise={total} />}</p>
      <div className="mt-3">
        <SplitBar
          parts={[{ paise: current, color: SERIES.current }, { paise: overdue, color: SERIES.overdue }]}
          ariaLabel={`Current ${formatPaise(current)}, overdue ${formatPaise(overdue)}`}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-caption text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: SERIES.current }} /> Current
          </p>
          {loading ? <span className="font-mono text-ink-400">--</span> : <Money paise={current} className="text-body-lg text-ink-900" />}
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-caption text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: SERIES.overdue }} /> Overdue
          </p>
          {loading ? <span className="font-mono text-ink-400">--</span> : <Money paise={overdue} className={cn('text-body-lg', overdue > 0 ? 'text-error-fg' : 'text-ink-900')} />}
        </div>
      </div>
      <div className="mt-4 border-t border-line-100 pt-3">
        <Link href={r ? '/sales/invoices' : '/purchases/bills'} className={cardLink}>
          {r ? 'See unpaid invoices' : 'See unpaid bills'}
        </Link>
      </div>
    </Section>
  );
}

// ── Cash flow ────────────────────────────────────────────────────────────────

interface CashFlow {
  openingCashPaise: number;
  cashInflowsPaise: number;
  cashOutflowsPaise: number;
  netCashFlowPaise: number;
  closingCashPaise: number;
}

/** Cash and bank at each month end across the year, and the year's movement beside it. */
export function CashFlowCard() {
  const [fy, setFy] = useYear();
  const months = fyMonths(fy);
  const now = thisMonth();
  const year = useQuery({
    queryKey: ['dashboard', 'cash-flow', fy],
    queryFn: () => api.get<CashFlow>(`/reports/cash-flow?financialYear=${fy}`),
  });
  // Each month's closing cash is a point; months still to come have none.
  const monthly = useQueries({
    queries: months.map((m) => ({
      queryKey: ['dashboard', 'cash-flow', fy, m],
      queryFn: () => api.get<CashFlow>(`/reports/cash-flow?financialYear=${fy}&period=${m}`),
      enabled: m <= now,
    })),
  });
  const points = months.map((m, i) => ({ month: m, label: shortMonth(m), value: m <= now ? monthly[i].data?.closingCashPaise : undefined }));
  const startYear = Number(fy.slice(0, 4));
  const fyEnd = new Date(startYear + 1, 2, 31);
  const asOf = new Date() < fyEnd ? new Date() : fyEnd;
  const y = year.data;

  const rows: Array<[string, number | undefined, string?]> = [
    [`Cash as on ${ddmmyyyy(new Date(startYear, 3, 1))}`, y?.openingCashPaise],
    ['Incoming', y?.cashInflowsPaise, '+'],
    ['Outgoing', y?.cashOutflowsPaise, '−'],
    [`Cash as on ${ddmmyyyy(asOf)}`, y?.closingCashPaise, '='],
  ];

  return (
    <Section
      title="Cash Flow Overview"
      description="Cash and bank at the end of each month"
      actions={<YearSelect value={fy} onChange={setFy} label="Cash flow period" />}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          {year.isError ? (
            <Muted>The cash flow could not load. Refresh the page to try again.</Muted>
          ) : (
            <LineAreaChart points={points} ariaLabel={`Cash and bank at each month end, financial year ${fy}`} />
          )}
        </div>
        <dl className="flex flex-col justify-center gap-4 border-line-200 md:border-l md:pl-6">
          {rows.map(([label, v, sign], i) => (
            <div key={label} className={cn(i === rows.length - 1 && 'border-t border-line-200 pt-3')}>
              <dt className="flex items-center justify-between text-caption text-ink-500">
                <span>{label}</span>
                {sign && <span className="font-mono text-ink-400">({sign})</span>}
              </dt>
              <dd className={cn('text-right', i === rows.length - 1 ? 'text-body-lg font-medium' : 'text-body', v !== undefined && v < 0 ? 'text-error-fg' : 'text-ink-900')}>
                {v === undefined ? <span className="font-mono text-ink-400">--</span> : <Money paise={v} />}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

// ── Income and expense ───────────────────────────────────────────────────────

interface ReportTable {
  rows: Array<{ cells: Array<string | number | null>; style?: string; indent?: number }>;
}

/** Monthly income against expenses, from the Profit and loss by month report in one call. */
export function IncomeExpenseCard() {
  const [fy, setFy] = useYear();
  const months = fyMonths(fy);
  const pl = useQuery({
    queryKey: ['dashboard', 'pl-monthly', fy],
    queryFn: () => api.get<ReportTable>(`/reports/run/pl_monthly?from=${months[0]}&to=${months[11]}`),
  });
  // The report's own total rows: "Total income" and "Total expenses", one cell per month then the year.
  const row = (name: string) => pl.data?.rows.find((r) => r.style === 'total' && !r.indent && r.cells[0] === name)?.cells.slice(1) ?? [];
  const income = row('Total income');
  const expenses = row('Total expenses');
  const num = (v: string | number | null | undefined) => (typeof v === 'number' ? v : 0);
  const points = months.map((m, i) => ({ month: m, label: shortMonth(m), a: num(income[i]), b: num(expenses[i]) }));
  const totalIncome = num(income[12]);
  const totalExpenses = num(expenses[12]);
  const empty = !pl.isLoading && points.every((p) => p.a === 0 && p.b === 0);

  return (
    <Section title="Revenue vs Expenses" actions={<YearSelect value={fy} onChange={setFy} label="Revenue and expenses period" />} className="flex h-full flex-col">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-sink/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-caption text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: SERIES.income }} /> Total revenue
          </p>
          {pl.isLoading ? <span className="font-mono text-ink-400">--</span> : <Money paise={totalIncome} className="text-body-lg text-ink-900" />}
        </div>
        <div className="rounded-md bg-surface-sink/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-caption text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: SERIES.expenses }} /> Total expenses
          </p>
          {pl.isLoading ? <span className="font-mono text-ink-400">--</span> : <Money paise={totalExpenses} className="text-body-lg text-ink-900" />}
        </div>
      </div>
      {pl.isLoading ? (
        <Muted>Loading…</Muted>
      ) : pl.isError ? (
        <Muted>Revenue and expenses could not load. Refresh the page to try again.</Muted>
      ) : empty ? (
        <Muted>Nothing posted in this year yet. Raise an invoice or record a bill, approve it, and it shows here.</Muted>
      ) : (
        <PairedBarChart
          points={points}
          colors={[SERIES.income, SERIES.expenses]}
          names={['Revenue', 'Expenses']}
          ariaLabel={`Revenue and expenses by month, financial year ${fy}`}
        />
      )}
      <p className="mt-auto pt-3 text-caption text-ink-500">Revenue and expense values are before taxes.</p>
    </Section>
  );
}

// ── Top expenses ─────────────────────────────────────────────────────────────

interface ProfitLoss {
  expenseLines: Array<{ accountDescription: string; netPaise: number }>;
  totalExpensesPaise: number;
}

/** The year's largest expense accounts; past five, the rest fold into Other. */
export function TopExpensesCard() {
  const [fy, setFy] = useYear();
  const pl = useQuery({
    queryKey: ['dashboard', 'profit-loss', fy],
    queryFn: () => api.get<ProfitLoss>(`/reports/profit-loss?financialYear=${fy}`),
  });
  const lines = (pl.data?.expenseLines ?? []).filter((l) => l.netPaise > 0).sort((a, b) => b.netPaise - a.netPaise);
  const top = lines.length > RING.length + 1 ? lines.slice(0, RING.length) : lines.slice(0, RING.length + 1);
  const rest = lines.slice(top.length).reduce((s, l) => s + l.netPaise, 0);
  const slices: Slice[] = top.map((l, i) => ({ label: l.accountDescription, paise: l.netPaise, color: RING[i] ?? OTHER }));
  if (rest > 0) slices.push({ label: 'Other', paise: rest, color: OTHER });
  const total = slices.reduce((s, x) => s + x.paise, 0);

  return (
    <Section title="Top expenses" actions={<YearSelect value={fy} onChange={setFy} label="Top expenses period" />} className="flex h-full flex-col">
      {pl.isLoading ? (
        <Muted>Loading…</Muted>
      ) : pl.isError ? (
        <Muted>Expenses could not load. Refresh the page to try again.</Muted>
      ) : slices.length === 0 ? (
        <Muted>No expenses posted in this year yet. Record a bill or an expense and the biggest ones show here.</Muted>
      ) : (
        <div className="flex flex-1 items-center">
          <DonutChart slices={slices} centre={{ value: formatRupeesCompact(total), label: 'Total' }} ariaLabel={`Largest expense accounts, financial year ${fy}`} />
        </div>
      )}
      <div className="mt-auto pt-3">
        <Link href="/reports/management?report=expenses" className={cardLink}>See expenses by category</Link>
      </div>
    </Section>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  status: string;
  customerName?: string | null;
  unbilledHours: number;
  unbilledPaise: number;
  profitPaise: number;
  /** Added to the dashboard watchlist on the project's form or page. */
  watchlist?: boolean;
}

/** Watchlisted projects first, then active ones: what is waiting to be billed and what each has made. */
export function ProjectsCard() {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const list = [...(q.data ?? [])]
    .sort((a, b) => Number(!!b.watchlist) - Number(!!a.watchlist) || Number(b.status === 'active') - Number(a.status === 'active') || b.unbilledPaise - a.unbilledPaise)
    .slice(0, 5);
  return (
    <Section title="Projects" actions={<Link href="/time/projects" className={cardLink}>See all projects</Link>} className="h-full">
      {q.isLoading ? (
        <Muted>Loading…</Muted>
      ) : q.isError ? (
        <Muted>Projects could not load. Refresh the page to try again.</Muted>
      ) : list.length === 0 ? (
        <Muted>
          No projects yet. <Link href="/time/projects" className="font-medium text-brand-700 hover:underline">Add a project</Link> to track hours, billing and profit.
        </Muted>
      ) : (
        <div className="text-body">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 border-b border-line-200 pb-2 text-caption font-medium text-ink-500">
            <span>Project</span>
            <span className="text-right">Unbilled</span>
            <span className="min-w-[96px] text-right">Profit</span>
          </div>
          <ul>
            {list.map((p) => (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-6 border-b border-line-100 py-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900" title={p.name}>{p.name}</p>
                  <p className="truncate text-caption text-ink-500">{p.customerName ?? 'No customer'}</p>
                </div>
                <div className="whitespace-nowrap text-right">
                  <Money paise={p.unbilledPaise} className="text-ink-900" />
                  <p className="font-mono text-caption tabular-nums text-ink-500">{p.unbilledHours} h</p>
                </div>
                <Money paise={p.profitPaise} className={cn('min-w-[96px] whitespace-nowrap text-right', p.profitPaise < 0 ? 'text-error-fg' : 'text-ink-900')} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ── Bank and cash ────────────────────────────────────────────────────────────

interface LedgerAccount {
  _id: string;
  name: string;
  code?: string;
  systemKey?: string;
  balancePaise: number;
}
interface BankAccount {
  _id: string;
  name: string;
  bankName?: string;
  accountNumber?: string;
}

/** The ledger balances of the bank and cash accounts, and the bank accounts that post to them. */
export function BankCashCard() {
  const ledger = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<LedgerAccount[]>('/gl/accounts') });
  const banks = useQuery({ queryKey: ['banking', 'accounts'], queryFn: () => api.get<BankAccount[]>('/banking/accounts') });
  const rows = (ledger.data ?? []).filter((a) => a.systemKey === 'BANK' || a.systemKey === 'CASH');
  const total = rows.reduce((s, a) => s + a.balancePaise, 0);
  return (
    <Section title="Bank and cash" description="Ledger balances today" actions={<Link href="/banking" className={cardLink}>Go to Banking</Link>} className="flex h-full flex-col">
      {ledger.isLoading ? (
        <Muted>Loading…</Muted>
      ) : ledger.isError ? (
        <Muted>Balances could not load. Refresh the page to try again.</Muted>
      ) : rows.length === 0 ? (
        <Muted>
          No bank or cash account yet. <Link href="/banking" className="font-medium text-brand-700 hover:underline">Add a bank account</Link> to see its balance here.
        </Muted>
      ) : (
        <>
          <ul className="divide-y divide-line-100">
            {rows.map((a) => (
              <li key={a._id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{a.name}</p>
                  {a.systemKey === 'BANK' && (banks.data?.length ?? 0) > 0 && (
                    <p className="truncate text-caption text-ink-500">
                      {banks.data!.map((b) => `${b.name}${b.accountNumber ? ` ··${b.accountNumber.slice(-4)}` : ''}`).join(', ')}
                    </p>
                  )}
                  {a.systemKey === 'CASH' && <p className="text-caption text-ink-500">Cash in hand</p>}
                </div>
                <Money paise={a.balancePaise} className={cn('whitespace-nowrap text-body', a.balancePaise < 0 ? 'text-error-fg' : 'text-ink-900')} />
              </li>
            ))}
          </ul>
          <div className="mt-auto flex items-center justify-between border-t border-line-200 pt-3">
            <span className="text-caption font-medium uppercase tracking-[0.04em] text-ink-500">Total</span>
            <Money paise={total} className={cn('text-body-lg font-medium', total < 0 ? 'text-error-fg' : 'text-ink-900')} />
          </div>
        </>
      )}
    </Section>
  );
}

// ── Documents: reading and entry ─────────────────────────────────────────────

function PipelineTile({ href, value, label, note, tone, live }: {
  href: string;
  value: number | null;
  label: string;
  note?: string | null;
  /** Amber waits or is being read, green is done, cool red is a problem. */
  tone: 'pending' | 'success' | 'error' | 'quiet';
  live?: boolean;
}) {
  const colour = value ? { pending: 'text-pending-fg', success: 'text-success-fg', error: 'text-error-fg', quiet: 'text-ink-900' }[tone] : 'text-ink-400';
  return (
    <Link
      href={href}
      className="group flex min-h-[88px] flex-col gap-1 rounded-md border border-line-200 bg-surface-card px-3 py-2.5 transition-colors hover:bg-honey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <span className="flex items-center gap-2 text-caption text-ink-500">
        {live && !!value && <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-marigold-400" />}
        {label}
      </span>
      {/* Size and colour on separate elements: cn() would read text-h2 as a colour and drop it. */}
      <span className="text-h2">
        <span className={cn('font-mono font-medium tabular-nums', colour)}>{value ?? '--'}</span>
      </span>
      {note && (
        <span className="truncate text-caption">
          <span className={tone === 'error' && value ? 'text-error-fg' : 'text-ink-500'} title={note}>{note}</span>
        </span>
      )}
    </Link>
  );
}

/**
 * The document pipeline: what is being read, what waits in Review, what the
 * AI could not read and why, and what became a record today and this week.
 */
export function DocumentsCard() {
  const q = usePipeline();
  const p = q.data;
  const reason = p?.couldNotRead.reasons[0]?.reason ?? null;
  return (
    <Section
      title="Documents"
      description="Reading and data entry"
      actions={<Link href="/documents" className={cardLink}>Go to Documents</Link>}
    >
      {q.isError ? (
        <Muted>The document counts could not load. Refresh the page to try again.</Muted>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <PipelineTile href="/inbox" value={p ? p.reading : null} label="Being read" note={p?.reading ? 'Reading in the background' : 'Nothing being read'} tone="pending" live />
            <PipelineTile href="/review" value={p ? p.readyForReview : null} label="Ready for review" note={p?.readyForReview ? 'Read by AI, waiting for you' : 'Nothing waiting'} tone="pending" />
            <PipelineTile href="/inbox?show=failed" value={p ? p.couldNotRead.count : null} label="Couldn't read" note={p?.couldNotRead.count ? reason : 'Every document was read'} tone="error" />
            <PipelineTile
              href="/documents"
              value={p ? p.entered.today : null}
              label="Entered today"
              note={p ? `${p.entered.thisWeek} this week` : null}
              tone="success"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-100 pt-3">
            <Link href="/review" className={cardLink}>Review</Link>
            <Link href="/inbox?show=failed" className={cardLink}>Couldn&apos;t read</Link>
            <Link href="/documents?status=to-enter" className={cardLink}>Add to</Link>
            <span className="text-caption text-ink-400">AI reads; a person approves or enters each one. Nothing posts by itself.</span>
          </div>
        </>
      )}
    </Section>
  );
}

// ── Account watchlist ────────────────────────────────────────────────────────

interface WatchedAccount {
  _id: string;
  name: string;
  code?: string;
  isGroup?: boolean;
  watchlist?: boolean;
  balancePaise: number;
}

/** Accounts ticked "Add to the watchlist on my dashboard" in the chart of accounts, with their balances. No card when none is. */
export function WatchlistCard() {
  const ledger = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<WatchedAccount[]>('/gl/accounts') });
  const rows = (ledger.data ?? []).filter((a) => a.watchlist);
  if (ledger.isLoading || ledger.isError || rows.length === 0) return null;
  return (
    <Section title="Account watchlist" description="Ledger balances today" actions={<Link href="/accountant/chart-of-accounts" className={cardLink}>Chart of accounts</Link>}>
      <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((a) => (
          <li key={a._id} className="flex items-baseline justify-between gap-3 border-b border-line-100 py-2.5">
            <Link href={`/accountant/chart-of-accounts/${a._id}/edit`} className="min-w-0 truncate font-medium text-ink-900 hover:underline">
              {a.name}
              {a.code && <span className="ml-2 font-mono text-caption text-ink-400">{a.code}</span>}
            </Link>
            <Money paise={a.balancePaise} className={cn('whitespace-nowrap text-body', a.balancePaise < 0 ? 'text-error-fg' : 'text-ink-900')} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── KPI cards ────────────────────────────────────────────────────────────────

interface YearPL {
  totalRevenuePaise: number;
  totalExpensesPaise: number;
  netIncomePaise: number;
}

const KPI_TONE = {
  revenue: { chip: 'bg-success-bg text-success-fg', value: 'text-success-fg' },
  expenses: { chip: 'bg-expense-bg text-expense-fg', value: 'text-expense-fg' },
  profit: { chip: 'bg-brand-50 text-brand-700', value: 'text-brand-700' },
  outstanding: { chip: 'bg-navy-50 text-navy-900', value: 'text-navy-900' },
} as const;

function Kpi({ label, href, icon, tone, paise, loading, negative, children }: {
  label: string;
  href: string;
  icon: React.ReactNode;
  tone: keyof typeof KPI_TONE;
  paise: number | undefined;
  loading: boolean;
  /** A loss: the figure turns red, whatever the card's colour. */
  negative?: boolean;
  children?: React.ReactNode;
}) {
  const t = KPI_TONE[tone];
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-line-200 bg-surface-card p-5 shadow-e1 transition-[box-shadow,border-color] duration-150 hover:border-ink-300 hover:shadow-e2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-500">{label}</p>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', t.chip)}>{icon}</span>
      </div>
      <p className={cn('mt-2 text-h2', negative ? 'text-error-fg' : t.value)}>
        {loading || paise === undefined ? <span className="font-mono text-ink-400">--</span> : <Money paise={paise} />}
      </p>
      <div className="mt-auto pt-2 text-caption text-ink-500">{children}</div>
    </Link>
  );
}

/**
 * The four figures at the top: the year's revenue, expenses and net profit
 * (the P&L's own totals), and what customers owe. Each card opens the page
 * the figure comes from.
 */
export function KpiRow({ canLedger, canSales, ar, arLoading }: { canLedger: boolean; canSales: boolean; ar?: AgeingSummary; arLoading: boolean }) {
  const fy = YEARS[0];
  // Same query as the top expenses card, so the P&L is asked for once.
  const pl = useQuery({
    queryKey: ['dashboard', 'profit-loss', fy],
    queryFn: () => api.get<YearPL>(`/reports/profit-loss?financialYear=${fy}`),
    enabled: canLedger,
  });
  if (!canLedger && !canSales) return null;
  const p = pl.data;
  const margin = p && p.totalRevenuePaise > 0 ? Math.round((p.netIncomePaise / p.totalRevenuePaise) * 100) : null;
  const overdue = overdueOf(ar);
  const notDue = ar?.current ?? 0;
  const year = <>This financial year <span className="font-mono font-medium">{fy}</span></>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {canLedger && (
        <>
          <Kpi label="Total Revenue" href="/reports/view/profit_and_loss" icon={<TrendingUp size={18} />} tone="revenue" paise={p?.totalRevenuePaise} loading={pl.isLoading}>{year}</Kpi>
          <Kpi label="Total Expenses" href="/reports/view/profit_and_loss" icon={<TrendingDown size={18} />} tone="expenses" paise={p?.totalExpensesPaise} loading={pl.isLoading}>{year}</Kpi>
          <Kpi label="Net Profit" href="/reports/view/profit_and_loss" icon={<PiggyBank size={18} />} tone="profit" paise={p?.netIncomePaise} loading={pl.isLoading} negative={(p?.netIncomePaise ?? 0) < 0}>
            {margin === null ? year : <>{margin < 0 ? 'Loss' : 'Margin'} <span className={cn('font-mono font-medium', margin < 0 ? 'text-error-fg' : 'text-brand-700')}>{margin}%</span> of revenue</>}
          </Kpi>
        </>
      )}
      {canSales && (
        <Kpi label="Outstanding Payments" href="/sales/invoices" icon={<Clock3 size={18} />} tone="outstanding" paise={ar?.total} loading={arLoading}>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span><span className="font-mono font-medium text-error-fg">{formatRupeesCompact(overdue)}</span> overdue</span>
            <span><span className="font-mono font-medium text-pending-fg">{formatRupeesCompact(notDue)}</span> not yet due</span>
          </span>
        </Kpi>
      )}
    </div>
  );
}

// ── Recent transactions ──────────────────────────────────────────────────────

interface RecentJournal {
  _id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  totalDebitPaise: number;
  status: string;
  reverses?: { id: string; voucherNumber: string } | null;
}

/** The latest vouchers posted to the ledger, newest first. */
export function RecentTransactionsCard() {
  const q = useQuery({
    queryKey: ['journals', 'recent'],
    queryFn: () => api.get<{ data: RecentJournal[] }>('/journals'),
  });
  const rows = (q.data?.data ?? []).slice(0, 6);
  return (
    <Section title="Recent Transactions" description="The latest vouchers posted to the ledger" actions={<Link href="/vouchers" className={cardLink}>See all vouchers</Link>}>
      {q.isLoading ? (
        <Muted>Loading…</Muted>
      ) : q.isError ? (
        <Muted>Recent transactions could not load. Refresh the page to try again.</Muted>
      ) : rows.length === 0 ? (
        <Muted>Nothing posted yet. Approve an entry in Review, or raise an invoice, and it shows here.</Muted>
      ) : (
        <div className="-mx-5 -mb-5 overflow-x-auto border-t border-line-100">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-sink">
                <th className="px-5 py-2.5 text-left text-caption font-semibold uppercase tracking-[0.04em] text-ink-500">Date</th>
                <th className="px-3 py-2.5 text-left text-caption font-semibold uppercase tracking-[0.04em] text-ink-500">Voucher</th>
                <th className="hidden px-3 py-2.5 text-left text-caption font-semibold uppercase tracking-[0.04em] text-ink-500 md:table-cell">Description</th>
                <th className="px-3 py-2.5 text-right text-caption font-semibold uppercase tracking-[0.04em] text-ink-500">Amount</th>
                <th className="hidden px-5 py-2.5 text-left text-caption font-semibold uppercase tracking-[0.04em] text-ink-500 sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j._id} className="border-t border-line-100 transition-colors hover:bg-navy-50">
                  <td className="whitespace-nowrap px-5 py-3 text-body text-ink-600">
                    {new Date(`${j.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <p className="font-mono text-body text-navy-900">{j.voucherNumber}</p>
                    <p className="text-caption text-ink-500">{VOUCHER_TYPE_LABELS[j.voucherType] ?? j.voucherType}</p>
                  </td>
                  <td className="hidden max-w-[22rem] truncate px-3 py-3 text-body text-ink-700 md:table-cell" title={j.description}>{j.description}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right"><Money paise={j.totalDebitPaise} className="text-body text-ink-900" /></td>
                  <td className="hidden px-5 py-3 sm:table-cell">
                    {j.status === 'reversed' ? <StatusChip tone="neutral">Reversed</StatusChip> : j.reverses ? <StatusChip tone="neutral">Reversal</StatusChip> : <StatusChip tone="success">Posted</StatusChip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
