'use client';

import { useQuery } from '@tanstack/react-query';
import { ReportBarChart } from '@/components/reports/report-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRupeesCompact } from '@/lib/utils';
import { api } from '@/lib/api';
import { currentFinancialYear } from '@/lib/financial-year';
import {
  AlertCircle,
  FileText,
  AlertTriangle,
  ReceiptIndianRupee,
  Upload,
  TrendingUp,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

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

interface InsightsResponse {
  insights?: { text: string }[];
  items?: { text: string }[];
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
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

  /**
   * Overdue receivables and unmatched GST lines — the two rows that used to
   * claim "2 invoices overdue" and "5 GST mismatches" whatever the books said.
   */
  const { data: arAgeing } = useQuery({
    queryKey: ['sales', 'ar-ageing'],
    queryFn: () =>
      api.get<{ days1_30: number; days31_60: number; days61_90: number; over90: number }>(
        '/sales/ar-ageing',
      ),
  });

  const { data: gstReconLines } = useQuery({
    queryKey: ['gst', 'recon-lines'],
    queryFn: () => api.get<{ status?: string }[]>('/gst/recon-lines'),
  });

  const { data: insightsData } = useQuery({
    queryKey: ['insights', FINANCIAL_YEAR],
    queryFn: () => api.get<InsightsResponse>(`/insights?financialYear=${FINANCIAL_YEAR}`),
  });

  // Resolve pending proposals count
  const pendingProposals = (() => {
    if (!proposalsData) return 0;
    if (Array.isArray(proposalsData)) return proposalsData.length;
    if ('total' in proposalsData && typeof proposalsData.total === 'number') return proposalsData.total;
    if ('data' in proposalsData && Array.isArray(proposalsData.data)) return proposalsData.data.length;
    return 0;
  })();

  // Resolve uploaded documents count
  const uploadedDocs = (() => {
    if (!docsData) return 0;
    if (Array.isArray(docsData)) return docsData.length;
    if ('total' in docsData && typeof docsData.total === 'number') return docsData.total;
    if ('data' in docsData && Array.isArray(docsData.data)) return docsData.data.length;
    return 0;
  })();

  const kpis = {
    incomeMTD: plData?.incomeMTD ?? 0,
    expensesMTD: plData?.expensesMTD ?? 0,
    cashOnHand: plData?.cashOnHand ?? 0,
    gstDue: plData?.gstDue ?? 0,
  };

  const isLoadingAny = plLoading || proposalsLoading || docsLoading;

  // Resolve AI insights text
  const insightItems = (() => {
    if (!insightsData) return null;
    const raw = insightsData as InsightsResponse;
    if (Array.isArray(raw.insights) && raw.insights.length > 0) return raw.insights.map((i) => i.text);
    if (Array.isArray(raw.items) && raw.items.length > 0) return raw.items.map((i) => i.text);
    return null;
  })();

  /**
   * GSTR-3B for a month is due on the 20th of the next one. Computed rather
   * than stated, because a fixed "due in 6 days" is wrong on 364 days a year.
   */
  /**
   * Ageing reports amounts, not counts, so this row states the amount overdue
   * rather than inventing a number of invoices from it.
   */
  const overduePaise =
    (arAgeing?.days1_30 ?? 0) +
    (arAgeing?.days31_60 ?? 0) +
    (arAgeing?.days61_90 ?? 0) +
    (arAgeing?.over90 ?? 0);

  const gstMismatches = (gstReconLines ?? []).filter(
    (l) => l.status && l.status !== 'MATCHED',
  ).length;

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

  const attention = [
    {
      label: pendingProposals > 0
        ? `${pendingProposals} ${pendingProposals === 1 ? 'entry' : 'entries'} to review`
        : '0 entries to review',
      href: '/review',
      icon: <FileText size={14} />,
    },
    {
      label: uploadedDocs > 0
        ? `${uploadedDocs} ${uploadedDocs === 1 ? 'document' : 'documents'} waiting`
        : '0 documents waiting',
      href: '/inbox',
      icon: <AlertCircle size={14} />,
    },
    {
      label:
        overduePaise > 0
          ? `${formatRupeesCompact(overduePaise)} overdue from customers`
          : 'Nothing overdue',
      href: '/sales',
      icon: <AlertTriangle size={14} />,
    },
    {
      label: `${gstMismatches} GST ${gstMismatches === 1 ? 'mismatch' : 'mismatches'}`,
      href: '/gst',
      icon: <ReceiptIndianRupee size={14} />,
    },
  ];

  const hasData = !isLoadingAny || pendingProposals > 0 || uploadedDocs > 0 || !!plData;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h1 font-display text-ink-900">
          Dashboard
        </h1>
      </div>

      {!hasData && !isLoadingAny ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-h3 font-display text-ink-900 mb-2">
            Nothing&apos;s waiting.
          </p>
          <p className="text-body text-ink-500 mb-8">
            Upload some documents to get started.
          </p>
          <Button variant="primary" asChild>
            <Link href="/inbox">
              <Upload size={16} />
              Upload documents
            </Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Attention band */}
          <div className="rounded-md border-2 border-marigold-400 bg-honey-100 p-4">
            <p className="text-label font-medium text-pending-fg mb-3 uppercase tracking-[0.04em]">
              Needs your attention
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {attention.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-2 rounded-sm bg-surface-card border border-line-200 px-3 py-2 text-body text-ink-700 hover:bg-honey-50 transition-colors min-h-[44px]"
                >
                  <span className="text-marigold-400">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Income (MTD)</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-h2 font-mono tabular-nums text-ink-900">
                  {plLoading ? '--' : formatRupeesCompact(kpis.incomeMTD)}
                </p>
                <p className="text-caption text-ink-500 mt-1">This month to date</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Expenses</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-h2 font-mono tabular-nums text-ink-900">
                  {plLoading ? '--' : formatRupeesCompact(kpis.expensesMTD)}
                </p>
                <p className="text-caption text-ink-500 mt-1">This month to date</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Cash on hand</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-h2 font-mono tabular-nums text-ink-900">
                  {plLoading ? '--' : formatRupeesCompact(kpis.cashOnHand)}
                </p>
                <p className="text-caption text-ink-500 mt-1">
                  Across all accounts
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>GST due</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-h2 font-mono tabular-nums text-ink-900">
                  {plLoading ? '--' : formatRupeesCompact(kpis.gstDue)}
                </p>
                <p className="text-caption text-ink-500 mt-1">
                  GSTR-3B due {gstDueLabel}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Cash flow</CardTitle>
              </CardHeader>
              <CardContent>
                <ReportBarChart
                  title="This month"
                  rows={[
                    { label: 'Income', valuePaise: kpis.incomeMTD },
                    { label: 'Expenses', valuePaise: kpis.expensesMTD },
                    { label: 'Cash on hand', valuePaise: kpis.cashOnHand },
                  ]}
                  emptyMessage="Approve an entry in Review and it shows up here."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  What I noticed
                  <span className="rounded-full bg-info-bg px-2 py-0.5 text-[0.7rem] text-info-fg font-medium flex items-center gap-1">
                    <Sparkles size={10} /> AI
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {insightItems && insightItems.length > 0 ? (
                  insightItems.slice(0, 4).map((text, i) => (
                    <p key={i} className="text-body text-ink-700">• {text}</p>
                  ))
                ) : (
                  <p className="text-body text-ink-500">
                    Nothing to flag yet. Observations appear once entries are posted to the
                    ledger.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function CardDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-caption text-ink-500 uppercase tracking-[0.04em]">{children}</p>;
}
