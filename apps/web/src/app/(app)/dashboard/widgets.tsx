'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Section } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { cn, formatRupeesCompact } from '@/lib/utils';
import { recentFinancialYears } from '@/lib/financial-year';
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

const cardLink = 'text-caption font-medium text-brand-600 hover:underline';

function NewLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium text-brand-600 hover:bg-honey-50" aria-label={label}>
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
      className="h-8 rounded-md border border-line-200 bg-surface-card px-2 text-caption text-ink-700 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
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
      title={r ? 'Total receivables' : 'Total payables'}
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
      title="Cash flow"
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
    <Section title="Income and expense" actions={<YearSelect value={fy} onChange={setFy} label="Income and expense period" />} className="flex h-full flex-col">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-sink/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-caption text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: SERIES.income }} /> Total income
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
        <Muted>Income and expenses could not load. Refresh the page to try again.</Muted>
      ) : empty ? (
        <Muted>Nothing posted in this year yet. Raise an invoice or record a bill, approve it, and it shows here.</Muted>
      ) : (
        <PairedBarChart
          points={points}
          colors={[SERIES.income, SERIES.expenses]}
          names={['Income', 'Expenses']}
          ariaLabel={`Income and expenses by month, financial year ${fy}`}
        />
      )}
      <p className="mt-auto pt-3 text-caption text-ink-500">Income and expense values are before taxes.</p>
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
}

/** Active projects first: what is waiting to be billed and what each has made. */
export function ProjectsCard() {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const list = [...(q.data ?? [])].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.unbilledPaise - a.unbilledPaise).slice(0, 5);
  return (
    <Section title="Projects" actions={<Link href="/time/projects" className={cardLink}>See all projects</Link>} className="h-full">
      {q.isLoading ? (
        <Muted>Loading…</Muted>
      ) : q.isError ? (
        <Muted>Projects could not load. Refresh the page to try again.</Muted>
      ) : list.length === 0 ? (
        <Muted>
          No projects yet. <Link href="/time/projects" className="font-medium text-brand-600 hover:underline">Add a project</Link> to track hours, billing and profit.
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
          No bank or cash account yet. <Link href="/banking" className="font-medium text-brand-600 hover:underline">Add a bank account</Link> to see its balance here.
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
