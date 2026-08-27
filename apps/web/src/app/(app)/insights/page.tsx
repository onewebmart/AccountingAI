'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Clock,
  BarChart3,
  Activity,
  ChevronRight,
  Lightbulb,
} from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type InsightType =
  | 'expense_spike'
  | 'cashflow_warning'
  | 'overdue_ap'
  | 'gst_due_soon'
  | 'monthly_summary'
  | 'health_score';

type Priority = 'high' | 'medium' | 'low';

interface Insight {
  id: string;
  type: InsightType;
  priority: Priority;
  // API fields
  title?: string;
  body?: string;
  amount?: number;
  drillInUrl?: string;
  // Legacy/mock fields
  headline?: string;
  explanation?: string;
  actionLabel?: string;
  actionHref?: string;
  amountPaise?: number;
  changePercent?: number;
}

interface InsightsApiResponse {
  insights: Insight[];
}

// ── Icon per insight type ─────────────────────────────────────────────────────

function InsightIcon({ type }: { type: InsightType }) {
  const cls = 'shrink-0';
  if (type === 'expense_spike') return <TrendingUp size={18} className={cls} />;
  if (type === 'cashflow_warning') return <TrendingDown size={18} className={cls} />;
  if (type === 'overdue_ap') return <Clock size={18} className={cls} />;
  if (type === 'gst_due_soon') return <AlertCircle size={18} className={cls} />;
  if (type === 'monthly_summary') return <BarChart3 size={18} className={cls} />;
  return <Activity size={18} className={cls} />;
}

// ── Priority style mapping ─────────────────────────────────────────────────────

type PriorityStyle = {
  card: string;
  iconBg: string;
  iconColor: string;
  badge: string;
  badgeText: string;
};

const PRIORITY_STYLES: Record<Priority, PriorityStyle> = {
  high: {
    card: 'border-error-fg/30 bg-error-bg/40',
    iconBg: 'bg-error-bg',
    iconColor: 'text-error-fg',
    badge: 'bg-error-bg border border-error-fg/30 text-error-fg',
    badgeText: 'Urgent',
  },
  medium: {
    card: 'border-pending-fg/30 bg-pending-bg/40',
    iconBg: 'bg-pending-bg',
    iconColor: 'text-pending-fg',
    badge: 'bg-pending-bg border border-pending-fg/30 text-pending-fg',
    badgeText: 'Attention',
  },
  low: {
    card: 'border-line-200 bg-surface-card',
    iconBg: 'bg-surface-sink',
    iconColor: 'text-ink-500',
    badge: 'bg-surface-sink border border-line-200 text-ink-500',
    badgeText: 'Info',
  },
};

// ── Insight Card ──────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const style = PRIORITY_STYLES[insight.priority];
  // Normalise API fields vs mock fields
  const headline = insight.title ?? insight.headline ?? '';
  const explanation = insight.body ?? insight.explanation ?? '';
  const actionLabel = insight.actionLabel;
  const actionHref = insight.drillInUrl ?? insight.actionHref;

  return (
    <div className={`rounded-lg border p-4 flex items-start gap-4 transition-shadow hover:shadow-sm ${style.card}`}>
      {/* Icon */}
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.iconBg} ${style.iconColor}`}>
        <InsightIcon type={insight.type} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-body font-semibold text-ink-900">{headline}</p>
            <p className="text-caption text-ink-500 mt-0.5">{explanation}</p>
          </div>
          <span className={`shrink-0 text-caption font-medium rounded-full px-2 py-0.5 ${style.badge}`}>
            {style.badgeText}
          </span>
        </div>

        {actionLabel && actionHref && (
          <a
            href={actionHref}
            className={`mt-3 inline-flex items-center gap-1 text-caption font-medium hover:underline ${style.iconColor}`}
          >
            {actionLabel} <ChevronRight size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function InsightSkeleton() {
  return (
    <div className="rounded-lg border border-line-200 bg-surface-card p-4 flex items-start gap-4 animate-pulse">
      <div className="h-9 w-9 rounded-lg bg-surface-sink shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-3/4 rounded bg-surface-sink" />
        <div className="h-3 w-1/2 rounded bg-surface-sink" />
        <div className="h-3 w-24 rounded bg-surface-sink mt-3" />
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sink text-ink-400 mb-4">
        <Lightbulb size={24} />
      </div>
      <p className="text-body font-semibold text-ink-900">Not enough history yet.</p>
      <p className="text-caption text-ink-500 mt-1">Insights appear as you post more.</p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-6"
        onClick={() => (window.location.href = '/review')}
      >
        Go to review queue
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [financialYear, setFinancialYear] = useState('2025-26');

  const insightsQuery = useQuery<InsightsApiResponse>({
    queryKey: ['insights', financialYear],
    queryFn: () => api.get<InsightsApiResponse>(`/insights?financialYear=${financialYear}`),
  });

  const insights = insightsQuery.data?.insights ?? [];
  const highCount = insights.filter((i) => i.priority === 'high').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900">
            AI Insights
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Read-only advisory based on your posted journals.
          </p>
        </div>

        <div className="flex items-center gap-3">
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

      {/* Urgent banner */}
      {!insightsQuery.isLoading && highCount > 0 && (
        <div className="rounded-lg border border-error-fg/30 bg-error-bg/50 px-4 py-3 flex items-center gap-3">
          <AlertCircle size={16} className="text-error-fg shrink-0" />
          <p className="text-caption font-medium text-error-fg">
            {highCount} insight{highCount !== 1 ? 's' : ''} need{highCount === 1 ? 's' : ''} your attention.
          </p>
        </div>
      )}

      {/* Insights feed */}
      {insightsQuery.isLoading ? (
        <div className="space-y-3">
          <InsightSkeleton />
          <InsightSkeleton />
          <InsightSkeleton />
        </div>
      ) : insightsQuery.isError ? (
        <p className="text-body text-error-fg py-4 text-center">
          Failed to load insights. Please try again.
        </p>
      ) : insights.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}

      {/* Disclaimer footer */}
      {!insightsQuery.isLoading && insights.length > 0 && (
        <div className="flex justify-center pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line-200 bg-surface-sink px-3 py-1.5 text-caption text-ink-400">
            <Lightbulb size={11} />
            AI suggestion — review before acting.
          </span>
        </div>
      )}
    </div>
  );
}
