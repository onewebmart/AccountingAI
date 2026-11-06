'use client';

import {
  BarChart3,
  Building2,
  FileCheck2,
  FolderOpen,
  LayoutDashboard,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { CountUp } from '@/components/motion/primitives';
import { Reveal } from './reveal';
import { cn } from '@/lib/utils';
import { KPI, TRANSACTIONS, type Txn } from './sample-data';
import { CashFlowLine, EXPENSES, REVENUE, RevenueExpenseBars } from './showcase-charts';
import { Eyebrow, LogoMark, SampleChip, StatusChip, container, h2Class, rupees, sectionY } from './shared';

const SIDEBAR: Array<{ icon: LucideIcon; label: string }> = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: Sparkles, label: 'Review queue' },
  { icon: ReceiptText, label: 'Sales' },
  { icon: ShoppingCart, label: 'Purchases' },
  { icon: Building2, label: 'Banking' },
  { icon: FileCheck2, label: 'GST' },
  { icon: BarChart3, label: 'Reports' },
  { icon: FolderOpen, label: 'Documents' },
];

function Kpi({
  label,
  paise,
  icon: Icon,
  tile,
  children,
}: {
  label: string;
  paise: number;
  icon: LucideIcon;
  tile: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line-200 bg-surface-card p-5 shadow-e1">
      <div className="flex items-start justify-between gap-3">
        <p className="text-label text-ink-500">{label}</p>
        <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tile)}>
          <Icon size={18} aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-mono text-h2 text-ink-900">
        <CountUp to={Math.round(paise / 100)} prefix="₹" durationMs={1400} />
      </p>
      <div className="mt-2 text-caption">{children}</div>
    </div>
  );
}

function Change({ value, good }: { value: number; good: boolean }) {
  return (
    <p>
      <span className={cn('font-semibold', good ? 'text-success-fg' : 'text-ink-600')}>▲ {value}%</span>{' '}
      <span className="text-ink-500">vs September</span>
    </p>
  );
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-600">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Card({ title, sub, aside, children, className }: { title: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl border border-line-200 bg-surface-card p-5 shadow-e1', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h4 className="font-heading text-body-lg font-bold text-navy-900">{title}</h4>
          {sub && <p className="text-caption text-ink-500">{sub}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

const KIND_LABEL: Record<Txn['kind'], string> = {
  Invoice: 'Invoice',
  Bill: 'Bill',
  'Payment received': 'Payment in',
  'Payment made': 'Payment out',
};

function Transactions() {
  return (
    <>
      {/* Tablet and up: a table. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[560px] text-body">
          <thead>
            <tr className="border-b border-line-200 text-left text-caption text-ink-500">
              <th scope="col" className="py-2.5 pr-4 font-medium">Date</th>
              <th scope="col" className="py-2.5 pr-4 font-medium">Transaction</th>
              <th scope="col" className="py-2.5 pr-4 font-medium">Type</th>
              <th scope="col" className="py-2.5 pr-4 text-right font-medium">Amount</th>
              <th scope="col" className="py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {TRANSACTIONS.map((t) => (
              <tr key={t.number} className="border-b border-line-100 transition-colors last:border-0 hover:bg-surface-page">
                <td className="whitespace-nowrap py-3 pr-4 text-ink-500">{t.date}</td>
                <td className="py-3 pr-4">
                  <span className="block font-medium text-ink-900">{t.party}</span>
                  <span className="font-mono text-caption font-medium text-ink-500">{t.number}</span>
                </td>
                <td className="whitespace-nowrap py-3 pr-4 text-ink-600">{KIND_LABEL[t.kind]}</td>
                <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-ink-900">{rupees(t.amount)}</td>
                <td className="py-3">
                  <StatusChip status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: the same rows as a list, so nothing scrolls sideways. */}
      <ul className="divide-y divide-line-100 sm:hidden">
        {TRANSACTIONS.map((t) => (
          <li key={t.number} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-body font-medium text-ink-900">{t.party}</p>
              <p className="text-caption text-ink-500">
                {KIND_LABEL[t.kind]} · <span className="font-mono font-medium">{t.number}</span> · {t.date}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-mono text-body text-ink-900">{rupees(t.amount)}</span>
              <StatusChip status={t.status} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The dashboard, as a realistic mock on sample figures, labelled as such. */
export function Showcase() {
  const outstanding = KPI.overdue + KPI.pending;
  const overdueShare = (KPI.overdue / outstanding) * 100;

  return (
    <section id="dashboard" aria-labelledby="dashboard-title" className={cn('scroll-mt-16 bg-surface-page', sectionY)}>
      <div className={container}>
        <Reveal className="max-w-3xl">
          <Eyebrow>Dashboard</Eyebrow>
          <h2 id="dashboard-title" className={cn(h2Class, 'mt-3')}>
            Your whole business at a glance
          </h2>
          <p className="mt-4 text-body-lg text-ink-500">
            Revenue, expenses, cash and what customers owe you, on one screen and up to date as soon
            as an entry posts.
          </p>
        </Reveal>

        <Reveal className="mt-12">
          <figure
            aria-label="A sample AiBooks dashboard with illustrative figures"
            className="overflow-hidden rounded-2xl border border-line-200 bg-surface-card shadow-e3"
          >
            <div className="flex">
              {/* The app's navy sidebar, collapsed to its icons, from lg up. */}
              <div aria-hidden className="hidden w-16 shrink-0 flex-col items-center bg-navy-950 py-5 lg:flex">
                <LogoMark />
                <ul className="mt-6 space-y-1">
                  {SIDEBAR.map(({ icon: Icon, label }, i) => (
                    <li
                      key={label}
                      title={label}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-[10px]',
                        i === 0 ? 'sidebar-active' : 'text-navy-300',
                      )}
                    >
                      <Icon size={18} />
                    </li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0 flex-1 bg-surface-page p-4 sm:p-6 lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-heading text-h2 text-navy-900 sm:text-h1">Business Overview</h3>
                    <p className="mt-1 text-body text-ink-500">Welcome back! Here&apos;s what&apos;s happening with your business.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SampleChip />
                    <span className="inline-flex h-8 items-center rounded-lg border border-line-200 bg-surface-card px-3 text-caption font-medium text-ink-700">
                      October
                    </span>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Kpi label="Total Revenue" paise={KPI.revenue} icon={TrendingUp} tile="bg-success-bg text-success-fg">
                    <Change value={KPI.revenueChange} good />
                  </Kpi>
                  <Kpi label="Total Expenses" paise={KPI.expenses} icon={TrendingDown} tile="bg-expense-bg text-expense-fg">
                    <Change value={KPI.expensesChange} good={false} />
                  </Kpi>
                  <Kpi label="Net Profit" paise={KPI.profit} icon={Wallet} tile="bg-brand-50 text-brand-700">
                    <Change value={KPI.profitChange} good />
                  </Kpi>
                  <Kpi label="Outstanding Payments" paise={outstanding} icon={ReceiptText} tile="bg-navy-50 text-navy-700">
                    <div
                      className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full"
                      role="img"
                      aria-label={`Overdue ${rupees(KPI.overdue)}, pending ${rupees(KPI.pending)}`}
                    >
                      <span className="h-full rounded-l-full bg-error-fg" style={{ width: `${overdueShare}%` }} />
                      <span className="h-full flex-1 rounded-r-full bg-marigold-400" />
                    </div>
                    <p className="mt-2 flex flex-wrap justify-between gap-x-3">
                      <span className="font-semibold text-error-fg">Overdue {rupees(KPI.overdue)}</span>
                      <span className="font-semibold text-pending-fg">Pending {rupees(KPI.pending)}</span>
                    </p>
                  </Kpi>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <Card
                    title="Revenue vs Expenses"
                    sub="Last 6 months"
                    aside={<Legend items={[{ color: REVENUE, label: 'Revenue' }, { color: EXPENSES, label: 'Expenses' }]} />}
                  >
                    <RevenueExpenseBars height={256} />
                  </Card>
                  <Card title="Cash Flow Overview" sub="Closing bank and cash balance, last 6 months">
                    <CashFlowLine height={200} />
                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line-100 pt-3 text-caption">
                      <div>
                        <dt className="text-ink-500">Cash in, Oct</dt>
                        <dd className="mt-0.5 font-mono text-body text-ink-900">{rupees(KPI.cashIn)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Cash out, Oct</dt>
                        <dd className="mt-0.5 font-mono text-body text-ink-900">{rupees(KPI.cashOut)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Net change</dt>
                        <dd className="mt-0.5 font-mono text-body text-success-fg">+{rupees(KPI.cashIn - KPI.cashOut)}</dd>
                      </div>
                    </dl>
                  </Card>
                </div>

                <Card title="Recent Transactions" sub="Invoices, bills and payments" className="mt-4">
                  <Transactions />
                </Card>
              </div>
            </div>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
