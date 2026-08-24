'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Clock, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/motion/primitives';

interface MonthlyPoint {
  month: string;
  label: string;
}

interface CrmReports {
  revenueTrend: (MonthlyPoint & { billedPaise: number; collectedPaise: number })[];
  clientGrowth: (MonthlyPoint & { added: number; cumulative: number })[];
  compliance: {
    completionRate: number;
    filed: number;
    pending: number;
    overdue: number;
    byType: { complianceType: string; filed: number; pending: number }[];
  };
  leads: {
    conversionRate: number;
    won: number;
    lost: number;
    openPipelineValuePaise: number;
    bySource: { source: string; count: number; wonCount: number }[];
  };
  automation: {
    remindersSent: number;
    agentReplies: number;
    leadsQualified: number;
    estimatedHoursSaved: number;
  };
}

function formatPaise(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

/**
 * A minimal bar chart in plain markup — no chart library, so nothing to ship
 * and nothing to theme twice.
 */
function BarRow({
  label,
  value,
  max,
  display,
  tone = 'saffron',
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  tone?: 'saffron' | 'green';
}) {
  const width = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-ink-500">{label}</span>
      <div className="h-5 flex-1 overflow-hidden rounded bg-surface-sink">
        <div
          className={cn('h-full rounded', tone === 'green' ? 'bg-[#1E7B34]' : 'bg-saffron-600')}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-xs text-ink-700">{display}</span>
    </div>
  );
}

export default function CrmReportsPage() {
  const { data, isLoading, error } = useQuery<CrmReports>({
    queryKey: ['crm', 'reports'],
    queryFn: () => api.get<CrmReports>('/crm/reports'),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-[#C92A2A]/30 bg-[#C92A2A]/5 p-6">
        <p className="font-medium text-[#C92A2A]">Couldn&apos;t load reports</p>
        <p className="mt-1 text-sm text-ink-500">{(error as Error)?.message}</p>
      </div>
    );
  }

  const maxBilled = Math.max(...data.revenueTrend.map((p) => p.billedPaise), 1);
  const maxClients = Math.max(...data.clientGrowth.map((p) => p.cumulative), 1);

  return (
    <div>
      <FadeIn>
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold text-ink-900">Reports</h1>
          <p className="mt-1 text-sm text-ink-500">
            How the practice is performing over the last six months.
          </p>
        </div>
      </FadeIn>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Revenue */}
        <section className="rounded-xl border border-line-200 bg-surface-card p-4">
          <h2 className="mb-1 font-heading text-sm font-semibold text-ink-900">Revenue</h2>
          <p className="mb-4 text-xs text-ink-500">
            Billed in the month raised; collected in the month the money arrived.
          </p>
          <div className="space-y-2">
            {data.revenueTrend.map((p) => (
              <div key={p.month} className="space-y-1">
                <BarRow
                  label={p.label}
                  value={p.billedPaise}
                  max={maxBilled}
                  display={formatPaise(p.billedPaise)}
                />
                <BarRow
                  label=""
                  value={p.collectedPaise}
                  max={maxBilled}
                  display={formatPaise(p.collectedPaise)}
                  tone="green"
                />
              </div>
            ))}
          </div>
          <p className="mt-3 flex gap-4 text-[11px] text-ink-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-saffron-600" /> Billed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#1E7B34]" /> Collected
            </span>
          </p>
        </section>

        {/* Client growth */}
        <section className="rounded-xl border border-line-200 bg-surface-card p-4">
          <h2 className="mb-1 font-heading text-sm font-semibold text-ink-900">Client growth</h2>
          <p className="mb-4 text-xs text-ink-500">Clients on the books at each month end.</p>
          <div className="space-y-2">
            {data.clientGrowth.map((p) => (
              <BarRow
                key={p.month}
                label={p.label}
                value={p.cumulative}
                max={maxClients}
                display={p.added > 0 ? `${p.cumulative} (+${p.added})` : String(p.cumulative)}
              />
            ))}
          </div>
        </section>

        {/* Compliance */}
        <section className="rounded-xl border border-line-200 bg-surface-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 size={15} className="text-saffron-600" />
            <h2 className="font-heading text-sm font-semibold text-ink-900">Compliance</h2>
          </div>
          <div className="mb-4 flex items-end gap-6">
            <div>
              <p className="font-mono text-2xl font-bold text-[#1E7B34]">
                {data.compliance.completionRate}%
              </p>
              <p className="text-xs text-ink-500">Filed on the books</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-bold text-ink-900">{data.compliance.pending}</p>
              <p className="text-xs text-ink-500">Still pending</p>
            </div>
            {data.compliance.overdue > 0 ? (
              <div>
                <p className="font-mono text-2xl font-bold text-[#C92A2A]">
                  {data.compliance.overdue}
                </p>
                <p className="text-xs text-ink-500">Overdue</p>
              </div>
            ) : null}
          </div>
          {data.compliance.byType.length === 0 ? (
            <p className="text-sm text-ink-400">No obligations on the calendar yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.compliance.byType.map((t) => (
                <li key={t.complianceType} className="flex items-center justify-between text-sm">
                  <span className="text-ink-700">{t.complianceType.replace(/_/g, '-')}</span>
                  <span className="font-mono text-xs text-ink-500">
                    {t.filed} filed · {t.pending} pending
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Leads */}
        <section className="rounded-xl border border-line-200 bg-surface-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp size={15} className="text-saffron-600" />
            <h2 className="font-heading text-sm font-semibold text-ink-900">Leads</h2>
          </div>
          <div className="mb-4 flex items-end gap-6">
            <div>
              <p className="font-mono text-2xl font-bold text-[#1E7B34]">
                {data.leads.conversionRate}%
              </p>
              <p className="text-xs text-ink-500">Conversion</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-bold text-saffron-700">
                {formatPaise(data.leads.openPipelineValuePaise)}
              </p>
              <p className="text-xs text-ink-500">Open pipeline</p>
            </div>
          </div>
          <p className="mb-2 text-[11px] text-ink-400">
            Conversion counts decided leads only — {data.leads.won} won, {data.leads.lost} lost.
          </p>
          {data.leads.bySource.length === 0 ? (
            <p className="text-sm text-ink-400">No leads recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.leads.bySource.map((s) => (
                <li key={s.source} className="flex items-center justify-between text-sm">
                  <span className="text-ink-700">{s.source.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="font-mono text-xs text-ink-500">
                    {s.count} total · {s.wonCount} won
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Automation */}
      <section className="mt-4 rounded-xl border border-line-200 bg-surface-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock size={15} className="text-saffron-600" />
          <h2 className="font-heading text-sm font-semibold text-ink-900">Automation</h2>
        </div>
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="font-mono text-2xl font-bold text-ink-900">
              {data.automation.remindersSent}
            </p>
            <p className="text-xs text-ink-500">Reminders sent</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-bold text-ink-900">
              {data.automation.agentReplies}
            </p>
            <p className="text-xs text-ink-500">Questions answered</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-bold text-ink-900">
              {data.automation.leadsQualified}
            </p>
            <p className="text-xs text-ink-500">Leads qualified</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-bold text-saffron-700">
              {data.automation.estimatedHoursSaved}h
            </p>
            <p className="text-xs text-ink-500">Estimated time saved</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-ink-400">
          Time saved is an estimate, not a measurement — it assumes 4 minutes per reminder,
          6 per answered question and 10 per lead qualified.
        </p>
      </section>
    </div>
  );
}
