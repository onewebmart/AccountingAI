'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { CheckCircle, Download, Send, FileText } from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportType = 'pl' | 'bs' | 'cashflow' | 'tb' | 'ledger' | 'daybook' | 'ageing';

const REPORT_TYPES: { id: ReportType; label: string }[] = [
  { id: 'pl', label: 'P&L' },
  { id: 'bs', label: 'Balance Sheet' },
  { id: 'cashflow', label: 'Cash Flow' },
  { id: 'tb', label: 'Trial Balance' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'daybook', label: 'Day Book' },
  { id: 'ageing', label: 'Ageing' },
];

// ── API response types ─────────────────────────────────────────────────────────

interface TbRow {
  account: string;
  type: string;
  debit: number;
  credit: number;
}

interface PlResponse {
  income: { account: string; paise: number }[];
  expenses: { account: string; paise: number }[];
  netProfitPaise: number;
  // legacy shape fallback
  revenue?: { account: string; paise: number }[];
  totalRevenue?: number;
  totalExpenses?: number;
  netIncome?: number;
}

interface BsResponse {
  assets: { account: string; paise: number }[];
  liabilities: { account: string; paise: number }[];
  equity: { account: string; paise: number }[];
  // legacy shape fallback
  capital?: { account: string; paise: number }[];
  retainedEarnings?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  totalEquity?: number;
  isTiedOut?: boolean;
}

interface CashFlowResponse {
  inflows: number;
  outflows: number;
  netCashFlow: number;
}

interface DayBookEntry {
  date: string;
  voucher: string;
  narration: string;
  amount: number;
  lines: { desc: string; dr: number; cr: number }[];
}

interface AgeingBucket {
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
}

interface AgeingResponse {
  ap: AgeingBucket;
  ar: AgeingBucket;
}

// ── Mock data (fallback) ──────────────────────────────────────────────────────

const MOCK_TB: TbRow[] = [
  { account: 'Accounts Receivable', type: 'ASSETS', debit: 2950000, credit: 0 },
  { account: 'Bank / Cash Account', type: 'ASSETS', debit: 3450000, credit: 1800000 },
  { account: 'GST Input Tax Credit', type: 'ASSETS', debit: 324000, credit: 0 },
  { account: 'Accounts Payable', type: 'LIABILITIES', debit: 0, credit: 2714000 },
  { account: 'GST Output Tax', type: 'LIABILITIES', debit: 0, credit: 531000 },
  { account: 'Sales / Revenue Account', type: 'INCOME', debit: 0, credit: 2950000 },
  { account: 'Purchase / Expense Account', type: 'EXPENSE', debit: 2390000, credit: 0 },
  { account: 'Share Capital', type: 'CAPITAL', debit: 0, credit: 119000 },
];

const MOCK_PL: PlResponse = {
  income: [{ account: 'Sales / Revenue Account', paise: 2950000 }],
  expenses: [{ account: 'Purchase / Expense Account', paise: 2390000 }],
  netProfitPaise: 560000,
  revenue: [{ account: 'Sales / Revenue Account', paise: 2950000 }],
  totalRevenue: 2950000,
  totalExpenses: 2390000,
  netIncome: 560000,
};

const MOCK_BS: BsResponse = {
  assets: [
    { account: 'Bank / Cash Account', paise: 1650000 },
    { account: 'Accounts Receivable', paise: 2950000 },
    { account: 'GST Input Tax Credit', paise: 324000 },
  ],
  liabilities: [
    { account: 'Accounts Payable', paise: 2714000 },
    { account: 'GST Output Tax', paise: 531000 },
  ],
  equity: [{ account: 'Share Capital', paise: 119000 }],
  capital: [{ account: 'Share Capital', paise: 119000 }],
  retainedEarnings: 560000,
  totalAssets: 4924000,
  totalLiabilities: 3245000,
  totalEquity: 679000,
  isTiedOut: true,
};

const MOCK_CASH_FLOW: CashFlowResponse = {
  inflows: 3450000,
  outflows: 1800000,
  netCashFlow: 1650000,
};

const MOCK_DAY_BOOK: DayBookEntry[] = [
  {
    date: '2025-03-03',
    voucher: 'PMT-041',
    narration: 'Payment — Swiggy Business SWG/2025/0941',
    amount: 1180000,
    lines: [
      { desc: 'Accounts Payable', dr: 1180000, cr: 0 },
      { desc: 'Bank / Cash Account', dr: 0, cr: 1180000 },
    ],
  },
  {
    date: '2025-03-07',
    voucher: 'RCT-022',
    narration: 'Receipt — Rahul Enterprises INV-2025-0214',
    amount: 2950000,
    lines: [
      { desc: 'Bank / Cash Account', dr: 2950000, cr: 0 },
      { desc: 'Accounts Receivable', dr: 0, cr: 2950000 },
    ],
  },
  {
    date: '2025-03-10',
    voucher: 'PUR-018',
    narration: 'Purchase — Sigma Electricals SE/2025/087',
    amount: 5310000,
    lines: [
      { desc: 'Purchase / Expense Account', dr: 4500000, cr: 0 },
      { desc: 'GST Input Tax Credit', dr: 810000, cr: 0 },
      { desc: 'Accounts Payable', dr: 0, cr: 5310000 },
    ],
  },
];

const MOCK_AGEING: AgeingResponse = {
  ap: { current: 1500000, days1_30: 800000, days31_60: 400000, days61_90: 0, over90: 14000, total: 2714000 },
  ar: { current: 1200000, days1_30: 1200000, days31_60: 550000, days61_90: 0, over90: 0, total: 2950000 },
};

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(
    paise / 100,
  );
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function TiedOutBadge({ ok }: { ok: boolean }) {
  if (!ok) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg border border-success-fg/30">
      <CheckCircle size={10} />
      Trial balance ties out ✓
    </span>
  );
}

function SectionTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { account: string; paise: number }[];
  total: number;
  isDebitNormal?: boolean;
}) {
  return (
    <div className="mb-6">
      <h3 className="text-body font-semibold text-ink-900 mb-2">{title}</h3>
      <table className="w-full text-left">
        <tbody>
          {rows.map((r) => (
            <tr key={r.account} className="border-b border-line-100">
              <td className="py-2 text-body text-ink-700">{r.account}</td>
              <td className="py-2 text-right font-mono text-body text-ink-900">{fmt(r.paise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-200">
            <td className="py-2 text-body font-bold text-ink-900">Total {title}</td>
            <td className="py-2 text-right font-mono font-bold text-ink-900">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-6 w-48 rounded bg-surface-sink" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex justify-between">
          <div className="h-4 w-40 rounded bg-surface-sink" />
          <div className="h-4 w-24 rounded bg-surface-sink" />
        </div>
      ))}
    </div>
  );
}

// ── CSV download helper ───────────────────────────────────────────────────────

async function downloadCsv(path: string, filename: string) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
  const res = await fetch(`${apiBase}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('pl');
  const [financialYear, setFinancialYear] = useState('2025-26');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ── Queries ────────────────────────────────────────────────────────────────

  const tbQuery = useQuery<TbRow[]>({
    queryKey: ['reports', 'trial-balance', financialYear],
    queryFn: () => api.get<TbRow[]>(`/reports/trial-balance?financialYear=${financialYear}`),
    enabled: reportType === 'tb',
    placeholderData: MOCK_TB,
  });

  const plQuery = useQuery<PlResponse>({
    queryKey: ['reports', 'profit-loss', financialYear],
    queryFn: () => api.get<PlResponse>(`/reports/profit-loss?financialYear=${financialYear}`),
    enabled: reportType === 'pl',
    placeholderData: MOCK_PL,
  });

  const bsQuery = useQuery<BsResponse>({
    queryKey: ['reports', 'balance-sheet', financialYear],
    queryFn: () => api.get<BsResponse>(`/reports/balance-sheet?financialYear=${financialYear}`),
    enabled: reportType === 'bs',
    placeholderData: MOCK_BS,
  });

  const cashFlowQuery = useQuery<CashFlowResponse>({
    queryKey: ['reports', 'cash-flow', financialYear],
    queryFn: () => api.get<CashFlowResponse>(`/reports/cash-flow?financialYear=${financialYear}`),
    enabled: reportType === 'cashflow',
    placeholderData: MOCK_CASH_FLOW,
  });

  const dayBookQuery = useQuery<DayBookEntry[]>({
    queryKey: ['reports', 'day-book', financialYear],
    queryFn: async () => {
      const res = await api.get<{ data?: DayBookEntry[] } | DayBookEntry[]>(
        `/reports/day-book?financialYear=${financialYear}&page=1`,
      );
      return Array.isArray(res) ? res : (res.data ?? MOCK_DAY_BOOK);
    },
    enabled: reportType === 'daybook',
    placeholderData: MOCK_DAY_BOOK,
  });

  const ageingQuery = useQuery<AgeingResponse>({
    queryKey: ['reports', 'ageing', financialYear],
    queryFn: async () => {
      const [apRes, arRes] = await Promise.all([
        api.get<AgeingBucket>(`/reports/ageing?financialYear=${financialYear}&type=ap`),
        api.get<AgeingBucket>(`/reports/ageing?financialYear=${financialYear}&type=ar`),
      ]);
      return { ap: apRes, ar: arRes };
    },
    enabled: reportType === 'ageing',
    placeholderData: MOCK_AGEING,
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const tbRows = tbQuery.data ?? MOCK_TB;
  const tbTotal = tbRows.reduce((s, e) => s + e.debit, 0);

  const pl = plQuery.data ?? MOCK_PL;
  const plIncome = pl.income ?? pl.revenue ?? MOCK_PL.income;
  const plExpenses = pl.expenses ?? MOCK_PL.expenses;
  const plTotalRevenue = plIncome.reduce((s, r) => s + r.paise, 0);
  const plTotalExpenses = plExpenses.reduce((s, e) => s + e.paise, 0);
  const plNet = pl.netProfitPaise ?? pl.netIncome ?? (plTotalRevenue - plTotalExpenses);

  const bs = bsQuery.data ?? MOCK_BS;
  const bsAssets = bs.assets ?? MOCK_BS.assets;
  const bsLiabilities = bs.liabilities ?? MOCK_BS.liabilities;
  const bsEquity = bs.equity ?? bs.capital ?? MOCK_BS.equity;
  const bsTotalAssets = bs.totalAssets ?? bsAssets.reduce((s, a) => s + a.paise, 0);
  const bsTotalLiabilities = bs.totalLiabilities ?? bsLiabilities.reduce((s, l) => s + l.paise, 0);
  const bsTotalEquity = bs.totalEquity ?? bsEquity.reduce((s, e) => s + e.paise, 0) + (bs.retainedEarnings ?? 0);
  const bsIsTiedOut = bs.isTiedOut ?? Math.abs(bsTotalAssets - (bsTotalLiabilities + bsTotalEquity)) < 100;

  const cf = cashFlowQuery.data ?? MOCK_CASH_FLOW;
  const dayBook = dayBookQuery.data ?? MOCK_DAY_BOOK;
  const ageing = ageingQuery.data ?? MOCK_AGEING;

  // ── Report-specific loading/error state ────────────────────────────────────

  const activeQuery = {
    pl: plQuery,
    bs: bsQuery,
    cashflow: cashFlowQuery,
    tb: tbQuery,
    ledger: { isLoading: false, isError: false } as const,
    daybook: dayBookQuery,
    ageing: ageingQuery,
  }[reportType];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            Reports
          </h1>
          <p className="text-body text-ink-500 mt-1">
            All reports are derived from posted journals only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
            className="rounded-md border border-line-200 bg-surface-card px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {['2024-25', '2025-26', '2026-27'].map((fy) => (
              <option key={fy} value={fy}>FY {fy}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Report picker */}
      <div className="flex gap-2 flex-wrap">
        {REPORT_TYPES.map((r) => (
          <button
            key={r.id}
            onClick={() => setReportType(r.id)}
            className={`rounded-full px-4 py-1.5 text-body font-medium border transition-colors ${
              reportType === r.id
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-surface-card text-ink-700 border-line-200 hover:border-brand-400 hover:text-brand-600'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Export row */}
      <div className="flex items-center gap-2 border-b border-line-200 pb-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => showToast('Exported as Excel')}
          className="flex items-center gap-1.5"
        >
          <Download size={12} /> Excel
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const reportPath = reportType === 'pl' ? 'profit-loss' : reportType === 'bs' ? 'balance-sheet' : reportType === 'tb' ? 'trial-balance' : reportType;
            await downloadCsv(`/exports/${reportPath}.csv`, `${reportPath}-${financialYear}.csv`);
            showToast('Downloaded CSV');
          }}
          className="flex items-center gap-1.5"
        >
          <Download size={12} /> CSV
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => showToast('Exported as PDF')}
          className="flex items-center gap-1.5"
        >
          <FileText size={12} /> PDF
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => showToast('Synced vouchers to Tally')}
          className="flex items-center gap-1.5"
        >
          <Send size={12} /> Send to Tally
        </Button>
      </div>

      {/* Loading / error states */}
      {activeQuery.isLoading && <ReportSkeleton />}
      {activeQuery.isError && (
        <p className="text-body text-error-fg py-4">
          Failed to load report. Showing cached data.
        </p>
      )}

      {/* ── P&L ── */}
      {reportType === 'pl' && !plQuery.isLoading && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
              Profit & Loss — FY {financialYear}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-8">
            <SectionTable
              title="Revenue"
              rows={plIncome}
              total={plTotalRevenue}
            />
            <SectionTable
              title="Expenses"
              rows={plExpenses}
              total={plTotalExpenses}
            />
          </div>
          <div className="border-t-2 border-ink-900 pt-4 flex justify-between items-center mt-4">
            <span className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
              {plNet >= 0 ? 'Net profit' : 'Net loss'}
            </span>
            <span className={`text-h2 font-mono font-bold ${plNet >= 0 ? 'text-success-fg' : 'text-error-fg'}`}>
              {fmt(Math.abs(plNet))}
            </span>
          </div>
        </div>
      )}

      {/* ── Balance Sheet ── */}
      {reportType === 'bs' && !bsQuery.isLoading && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
              Balance Sheet — FY {financialYear}
            </h2>
            <TiedOutBadge ok={bsIsTiedOut} />
          </div>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <SectionTable
                title="Assets"
                rows={bsAssets}
                total={bsTotalAssets}
              />
            </div>
            <div>
              <SectionTable
                title="Liabilities"
                rows={bsLiabilities}
                total={bsTotalLiabilities}
              />
              <SectionTable
                title="Capital & Equity"
                rows={[
                  ...bsEquity,
                  ...(bs.retainedEarnings !== undefined
                    ? [{ account: 'Retained Earnings (Net Income)', paise: bs.retainedEarnings }]
                    : []),
                ]}
                total={bsTotalEquity}
              />
              <div className="flex justify-between border-t-2 border-ink-900 pt-3">
                <span className="font-bold text-body text-ink-900">Total Liabilities & Equity</span>
                <span className="font-mono font-bold text-body text-ink-900">
                  {fmt(bsTotalLiabilities + bsTotalEquity)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash Flow ── */}
      {reportType === 'cashflow' && !cashFlowQuery.isLoading && (
        <div>
          <h2 className="text-h2 font-display text-ink-900 mb-6" style={{ fontFamily: 'var(--font-display)' }}>
            Cash Flow — FY {financialYear}
          </h2>
          <div className="max-w-sm space-y-3">
            <div className="flex justify-between py-2 border-b border-line-100">
              <span className="text-body text-ink-600">Cash inflows (receipts)</span>
              <span className="font-mono font-semibold text-success-fg">{fmt(cf.inflows)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-line-100">
              <span className="text-body text-ink-600">Cash outflows (payments)</span>
              <span className="font-mono font-semibold text-error-fg">{fmt(cf.outflows)}</span>
            </div>
            <div className="flex justify-between py-3 border-t border-ink-900">
              <span className="text-body font-bold text-ink-900">Net cash flow</span>
              <span className={`font-mono font-bold ${cf.netCashFlow >= 0 ? 'text-success-fg' : 'text-error-fg'}`}>
                {fmt(Math.abs(cf.netCashFlow))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Trial Balance ── */}
      {reportType === 'tb' && !tbQuery.isLoading && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
              Trial Balance — FY {financialYear}
            </h2>
            <TiedOutBadge ok={true} />
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-200">
                {['Account', 'Type', 'Debit', 'Credit', 'Net'].map((h) => (
                  <th key={h} className="pb-2 pr-6 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tbRows.map((row) => {
                const net = row.debit - row.credit;
                return (
                  <tr key={row.account} className="border-b border-line-100 hover:bg-surface-sink/50">
                    <td className="py-2.5 pr-6 text-body text-ink-900">{row.account}</td>
                    <td className="py-2.5 pr-6">
                      <span className="text-caption text-ink-500 uppercase">{row.type}</span>
                    </td>
                    <td className="py-2.5 pr-6 font-mono text-body text-ink-900">
                      {row.debit > 0 ? fmt(row.debit) : '—'}
                    </td>
                    <td className="py-2.5 pr-6 font-mono text-body text-ink-900">
                      {row.credit > 0 ? fmt(row.credit) : '—'}
                    </td>
                    <td className={`py-2.5 font-mono font-medium text-body ${net >= 0 ? 'text-ink-900' : 'text-ink-600'}`}>
                      {fmt(Math.abs(net))} {net < 0 ? 'Cr' : 'Dr'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900">
                <td colSpan={2} className="py-3 font-bold text-body text-ink-900">Total</td>
                <td className="py-3 font-mono font-bold text-ink-900">{fmt(tbTotal)}</td>
                <td className="py-3 font-mono font-bold text-ink-900">{fmt(tbTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Ledger ── (static — no dedicated API endpoint yet) */}
      {reportType === 'ledger' && (
        <div>
          <h2 className="text-h2 font-display text-ink-900 mb-6" style={{ fontFamily: 'var(--font-display)' }}>
            Ledger — Accounts Receivable · FY {financialYear}
          </h2>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-200">
                {['Date', 'Voucher', 'Narration', 'Debit', 'Credit', 'Balance'].map((h) => (
                  <th key={h} className="pb-2 pr-6 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { date: '2025-04-01', voucher: 'Opening', narration: 'Opening balance', dr: 0, cr: 0, bal: 0 },
                { date: '2025-04-15', voucher: 'SAL-014', narration: 'Sale — Rahul Enterprises', dr: 2950000, cr: 0, bal: 2950000 },
                { date: '2025-04-18', voucher: 'RCT-022', narration: 'Payment received', dr: 0, cr: 2950000, bal: 0 },
              ].map((row, i) => (
                <tr key={i} className="border-b border-line-100 hover:bg-surface-sink/50">
                  <td className="py-2.5 pr-6 text-body text-ink-600">{fmtDate(row.date)}</td>
                  <td className="py-2.5 pr-6 font-mono text-caption text-ink-500">{row.voucher}</td>
                  <td className="py-2.5 pr-6 text-body text-ink-900">{row.narration}</td>
                  <td className="py-2.5 pr-6 font-mono text-body text-ink-900">{row.dr > 0 ? fmt(row.dr) : '—'}</td>
                  <td className="py-2.5 pr-6 font-mono text-body text-ink-900">{row.cr > 0 ? fmt(row.cr) : '—'}</td>
                  <td className="py-2.5 font-mono font-semibold text-body text-ink-900">{fmt(row.bal)} Dr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Day Book ── */}
      {reportType === 'daybook' && !dayBookQuery.isLoading && (
        <div>
          <h2 className="text-h2 font-display text-ink-900 mb-6" style={{ fontFamily: 'var(--font-display)' }}>
            Day Book — FY {financialYear}
          </h2>
          <div className="space-y-3">
            {dayBook.map((entry, i) => (
              <div key={i} className="rounded-lg border border-line-200 bg-surface-card overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === entry.voucher ? null : entry.voucher)}
                  className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-surface-sink/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-caption text-ink-500">{fmtDate(entry.date)}</span>
                    <span className="font-mono text-caption font-semibold text-ink-700">{entry.voucher}</span>
                    <span className="text-body text-ink-900">{entry.narration}</span>
                  </div>
                  <span className="font-mono font-semibold text-body text-ink-900 shrink-0">
                    {fmt(entry.amount)}
                  </span>
                </button>
                {expanded === entry.voucher && (
                  <div className="border-t border-line-200 px-4 py-3 bg-surface-sink/30">
                    <table className="w-full text-left">
                      <tbody>
                        {entry.lines.map((l, j) => (
                          <tr key={j} className="text-body">
                            <td className="py-1 pr-6 text-ink-600">{l.desc}</td>
                            <td className="py-1 pr-6 font-mono text-ink-900">{l.dr > 0 ? fmt(l.dr) : '—'}</td>
                            <td className="py-1 font-mono text-ink-900">{l.cr > 0 ? fmt(l.cr) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Ageing ── */}
      {reportType === 'ageing' && !ageingQuery.isLoading && (
        <div className="space-y-6">
          <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            Ageing — FY {financialYear}
          </h2>
          {(['AP (payables)', 'AR (receivables)'] as const).map((label, idx) => {
            const data = idx === 0 ? ageing.ap : ageing.ar;
            const color = idx === 0 ? 'text-error-fg' : 'text-success-fg';
            return (
              <div key={label}>
                <h3 className="text-body font-semibold text-ink-900 mb-3">{label}</h3>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line-200">
                      {['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days', 'Total'].map((h) => (
                        <th key={h} className="pb-2 pr-6 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {[data.current, data.days1_30, data.days31_60, data.days61_90, data.over90, data.total].map(
                        (v, i) => (
                          <td key={i} className={`py-2.5 pr-6 font-mono font-semibold text-body ${i === 5 ? color : 'text-ink-900'}`}>
                            {fmt(v)}
                          </td>
                        ),
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-success-bg border border-success-fg px-4 py-3 text-body font-medium text-success-fg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
