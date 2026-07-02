'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRupeesCompact } from '@/lib/utils';
import { api } from '@/lib/api';
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

interface ProfitLossReport {
  totalIncomePaise?: number;
  totalExpensesPaise?: number;
  cashOnHandPaise?: number;
  gstDuePaise?: number;
  // API may return different field shapes — handled below with fallbacks
  [key: string]: unknown;
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

// ── Fallback mock values (keep UI populated in dev) ────────────────────────

const MOCK_KPIS = {
  incomeMTD: 84210000,
  expensesMTD: 51030000,
  cashOnHand: 129000000,
  gstDue: 8420000,
};

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: plData, isLoading: plLoading } = useQuery({
    queryKey: ['reports', 'profit-loss', '2025-26'],
    queryFn: () => api.get<ProfitLossReport>('/reports/profit-loss?financialYear=2025-26'),
  });

  const { data: proposalsData, isLoading: proposalsLoading } = useQuery({
    queryKey: ['proposals', 'pending'],
    queryFn: () => api.get<ProposalListResponse | { id: string }[]>('/proposals?status=pending'),
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['documents', 'uploaded'],
    queryFn: () => api.get<DocumentListResponse | { id: string }[]>('/documents?status=uploaded'),
  });

  const { data: insightsData } = useQuery({
    queryKey: ['insights', '2025-26'],
    queryFn: () => api.get<InsightsResponse>('/insights?financialYear=2025-26'),
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

  // Resolve KPIs — use real data when present, fall back to mock
  const kpis = {
    incomeMTD:
      typeof plData?.totalIncomePaise === 'number'
        ? plData.totalIncomePaise
        : MOCK_KPIS.incomeMTD,
    expensesMTD:
      typeof plData?.totalExpensesPaise === 'number'
        ? plData.totalExpensesPaise
        : MOCK_KPIS.expensesMTD,
    cashOnHand:
      typeof plData?.cashOnHandPaise === 'number'
        ? plData.cashOnHandPaise
        : MOCK_KPIS.cashOnHand,
    gstDue:
      typeof plData?.gstDuePaise === 'number'
        ? plData.gstDuePaise
        : MOCK_KPIS.gstDue,
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
    { label: '2 invoices overdue', href: '/sales', icon: <AlertTriangle size={14} /> },
    { label: '5 GST mismatches', href: '/gst', icon: <ReceiptIndianRupee size={14} /> },
  ];

  const hasData = !isLoadingAny || pendingProposals > 0 || uploadedDocs > 0 || !!plData;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          Dashboard
        </h1>
      </div>

      {!hasData && !isLoadingAny ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-h3 font-display text-ink-900 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
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
                <p className="text-caption text-[#1E7A47] flex items-center gap-1 mt-1">
                  <TrendingUp size={12} /> +12% vs last month
                </p>
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
                <p className="text-caption text-[#C92A2A] flex items-center gap-1 mt-1">
                  <TrendingUp size={12} /> +18% vs last month
                </p>
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
                <Badge variant="pending" className="mt-1 text-[0.7rem]">
                  Due in 6 days
                </Badge>
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
                <div className="flex items-center justify-center h-40 text-ink-400 text-body">
                  Chart renders after Phase 13 (Reports)
                </div>
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
                  <>
                    <p className="text-body text-ink-700">• Expenses up 18% this month</p>
                    <p className="text-caption text-ink-500">Mostly logistics. See breakdown →</p>
                    <p className="text-body text-ink-700">• GST due in 6 days</p>
                    <p className="text-caption text-ink-500">Estimated ₹84,200 payable.</p>
                  </>
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
