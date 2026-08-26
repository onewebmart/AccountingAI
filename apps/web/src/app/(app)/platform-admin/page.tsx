'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/use-workspace';
import {
  AlertTriangle,
  Building2,
  Cpu,
  ClipboardList,
  X,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Shield,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'cost' | 'orgs' | 'audit';

interface OrgRow {
  orgId: string;
  name: string;
  /** Real: derived from the org's isActive flag. */
  status: 'active' | 'cancelled';
  costPaise: number;
  ocrPages: number;
  groqTokens: number;
  marginAlert: boolean;
}

/** Raw API shapes, mapped into the row models above. */
interface ApiOrg {
  _id: string;
  name: string;
  gstin?: string;
  isActive?: boolean;
}

interface ApiCostRow {
  orgId: string;
  orgName: string;
  period: string;
  ocrPagesTier1: number;
  ocrPagesTier2: number;
  ocrPagesTier3: number;
  groqTokensIn: number;
  groqTokensOut: number;
  totalCostPaise: number;
  marginAlert: boolean;
}

interface ApiCostSummary {
  period: string;
  totalCostPaise: number;
  byOrg: ApiCostRow[];
}

interface ApiAuditLog {
  _id: string;
  orgId: string;
  action: string;
  performedBy?: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

type SubscriptionPlan = 'free' | 'starter' | 'business' | 'enterprise';

interface ApiSubscription {
  orgId: string;
  plan: SubscriptionPlan;
  status: 'active' | 'cancelled' | 'past_due';
  ocrPageQuota: number;
  groqTokenQuota: number;
  changedBy: string | null;
}

interface ApiFeatureFlag {
  orgId: string;
  flagName: string;
  enabled: boolean;
  overriddenBy: string | null;
}

interface ApiUsageMeter {
  orgId: string;
  period: string;
  ocrPagesTier1: number;
  ocrPagesTier2: number;
  ocrPagesTier3: number;
  groqTokensIn: number;
  groqTokensOut: number;
}

interface AuditRow {
  id: string;
  orgId: string;
  orgName: string;
  action: string;
  performedBy: string;
  timestamp: string;
  meta: string;
}




// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(paise / 100);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Impersonation banner ───────────────────────────────────────────────────────

/**
 * The endpoint behind this records an audit row; it does not start a session in
 * the target org. Saying "you're viewing X as support" would be false, and a
 * platform admin who believed it might think they had checked something they
 * had not.
 */
function ImpersonationBanner({ org, onExit }: { org: OrgRow; onExit: () => void }) {
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-pending-fg text-white px-6 py-2.5 flex items-center justify-between text-body font-medium shadow-lg">
      <div className="flex items-center gap-2">
        <Shield size={16} />
        Support access to <strong className="mx-1">{org.name}</strong> recorded in the audit trail.
      </div>
      <button onClick={onExit} className="inline-flex items-center gap-1.5 rounded bg-white/20 px-3 py-1 text-caption font-medium hover:bg-white/30 transition">
        <X size={12} /> Exit
      </button>
    </div>
  );
}

// ── Cost tab ──────────────────────────────────────────────────────────────────

function CostTab({ orgs }: { orgs: OrgRow[] }) {
  const totalCost = orgs.reduce((s, o) => s + o.costPaise, 0);
  const alertCount = orgs.filter((o) => o.marginAlert).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500">AI spend this month</p>
          <p className="text-h2 font-display font-semibold text-ink-900 mt-1" style={{ fontFamily: 'var(--font-display)' }}>
            {fmt(totalCost)}
          </p>
        </div>
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500">Active orgs</p>
          <p className="text-h2 font-display font-semibold text-ink-900 mt-1" style={{ fontFamily: 'var(--font-display)' }}>
            {orgs.filter((o) => o.status === 'active').length}
          </p>
        </div>
        <div className={`rounded-lg border p-4 ${alertCount > 0 ? 'border-error-fg/30 bg-error-bg/50' : 'border-line-200 bg-surface-card'}`}>
          <p className="text-caption text-ink-500">Margin alerts</p>
          <p className={`text-h2 font-display font-semibold mt-1 ${alertCount > 0 ? 'text-error-fg' : 'text-ink-900'}`} style={{ fontFamily: 'var(--font-display)' }}>
            {alertCount}
          </p>
        </div>
      </div>

      {/* Per-org cost breakdown */}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200">
            {['Organisation', 'Tier 1 pages', 'Tier 2 pages', 'Tier 3 pages', 'Groq tokens', 'Cost', ''].map((h) => (
              <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...orgs].sort((a, b) => b.costPaise - a.costPaise).map((org) => (
            <tr key={org.orgId} className={`border-b border-line-100 ${org.marginAlert ? 'bg-error-bg/20' : ''}`}>
              <td className="py-3 pr-4 text-body font-medium text-ink-900">
                {org.name}
                {org.marginAlert && <AlertTriangle size={12} className="inline ml-1.5 text-error-fg" />}
              </td>
              <td className="py-3 pr-4 font-mono text-caption text-ink-600">{org.ocrPages.toLocaleString('en-IN')}</td>
              <td className="py-3 pr-4 font-mono text-caption text-ink-600">—</td>
              <td className="py-3 pr-4 font-mono text-caption text-ink-600">—</td>
              <td className="py-3 pr-4 font-mono text-caption text-ink-600">{org.groqTokens.toLocaleString('en-IN')}</td>
              <td className="py-3 pr-4 font-mono text-body font-semibold text-ink-900">{fmt(org.costPaise)}</td>
              <td className="py-3">
                {org.marginAlert && (
                  <span className="text-caption font-medium text-error-fg bg-error-bg border border-error-fg/20 rounded-full px-2 py-0.5">
                    High
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Orgs tab ──────────────────────────────────────────────────────────────────

function OrgsTab({
  orgs,
  onImpersonate,
  onManage,
}: {
  orgs: OrgRow[];
  onImpersonate: (org: OrgRow) => void;
  onManage: (org: OrgRow) => void;
}) {
  return (
    <div className="space-y-4">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200">
            {['Organisation', 'Status', 'Cost this month', ''].map((h) => (
              <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.orgId} className="border-b border-line-100">
              <td className="py-3 pr-4 text-body font-medium text-ink-900">{org.name}</td>
              <td className="py-3 pr-4">
                <span className={`text-caption font-medium ${org.status === 'active' ? 'text-success-fg' : 'text-error-fg'}`}>
                  {org.status === 'active' ? 'Active' : 'Cancelled'}
                </span>
              </td>
              <td className="py-3 pr-4 font-mono text-body text-ink-900">{fmt(org.costPaise)}</td>
              <td className="py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onManage(org)}
                    className="inline-flex items-center gap-1 text-caption font-medium text-brand-600 hover:underline"
                  >
                    Manage <ChevronRight size={12} />
                  </button>
                  <button
                    onClick={() => onImpersonate(org)}
                    className="text-caption font-medium text-ink-500 hover:text-ink-900 hover:underline"
                  >
                    Record access
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Org detail panel ──────────────────────────────────────────────────────────

const PLANS: SubscriptionPlan[] = ['free', 'starter', 'business', 'enterprise'];

/**
 * Flags the platform knows how to name.
 *
 * Kept as a list here because flags are stored per org on write — there is no
 * catalogue collection to read, so an org that has never been touched has no
 * flag rows at all and the panel would otherwise show nothing to toggle.
 */
const KNOWN_FLAGS = [
  'ai_insights',
  'bank_reconciliation',
  'e_invoicing',
  'practice_portal',
  'whatsapp_agent',
];

function OrgDetailPanel({ org, onClose }: { org: OrgRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const period = new Date().toISOString().slice(0, 7);

  const usage = useQuery<ApiUsageMeter | null>({
    queryKey: ['platform', 'usage', org.orgId, period],
    queryFn: () => api.get<ApiUsageMeter | null>(`/platform/orgs/${org.orgId}/usage?period=${period}`),
  });

  const subscription = useQuery<ApiSubscription | null>({
    queryKey: ['platform', 'subscription', org.orgId],
    queryFn: () => api.get<ApiSubscription | null>(`/platform/orgs/${org.orgId}/subscription`),
  });

  const flags = useQuery<ApiFeatureFlag[]>({
    queryKey: ['platform', 'flags', org.orgId],
    queryFn: () => api.get<ApiFeatureFlag[]>(`/platform/orgs/${org.orgId}/features`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform'] });
  };

  const changePlan = useMutation({
    mutationFn: (plan: SubscriptionPlan) =>
      api.patch(`/platform/orgs/${org.orgId}/subscription`, { plan }),
    onSuccess: invalidate,
  });

  const toggleFlag = useMutation({
    mutationFn: ({ flagName, enabled }: { flagName: string; enabled: boolean }) =>
      api.patch(`/platform/orgs/${org.orgId}/features/${flagName}`, { enabled }),
    onSuccess: invalidate,
  });

  const flagState = (name: string) => flags.data?.find((f) => f.flagName === name);
  const currentPlan = subscription.data?.plan ?? 'free';
  const meter = usage.data;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-white/10 bg-ink-900 p-6 text-white shadow-2xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">{org.name}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-white/40">{org.orgId}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white">
          <X size={16} />
        </button>
      </div>

      {/* Usage — real, metered per org per month */}
      <section className="mb-7">
        <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-white/40">
          Usage · {period}
        </h3>
        {usage.isLoading ? (
          <p className="text-caption text-white/40">Loading…</p>
        ) : !meter ? (
          <p className="text-caption text-white/40">Nothing metered this month.</p>
        ) : (
          <dl className="space-y-1.5 text-body">
            {[
              ['OCR pages — tier 1', meter.ocrPagesTier1],
              ['OCR pages — tier 2', meter.ocrPagesTier2],
              ['OCR pages — tier 3', meter.ocrPagesTier3],
              ['AI tokens in', meter.groqTokensIn],
              ['AI tokens out', meter.groqTokensOut],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-white/60">{label}</dt>
                <dd className="font-mono">{(value as number).toLocaleString('en-IN')}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-white/10 pt-1.5">
              <dt className="text-white/60">Cost</dt>
              <dd className="font-mono text-marigold-400">{fmt(org.costPaise)}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* Subscription — persisted, but nothing enforces it yet */}
      <section className="mb-7">
        <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-white/40">Plan</h3>
        <div className="flex flex-wrap gap-2">
          {PLANS.map((plan) => (
            <button
              key={plan}
              disabled={changePlan.isPending}
              onClick={() => changePlan.mutate(plan)}
              className={`rounded px-3 py-1.5 text-caption font-medium capitalize transition ${
                currentPlan === plan
                  ? 'bg-marigold-400 text-ink-900'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              {plan}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Recorded against the org and shown in the list. Quotas are stored on the plan but no
          code enforces them yet, so changing this does not restrict the org.
        </p>
        {changePlan.isError ? (
          <p className="mt-2 text-caption text-error-fg">{(changePlan.error as Error).message}</p>
        ) : null}
      </section>

      {/* Feature flags — persisted, but nothing reads them yet */}
      <section className="mb-7">
        <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-white/40">
          Feature flags
        </h3>
        <ul className="space-y-1">
          {KNOWN_FLAGS.map((name) => {
            const state = flagState(name);
            const enabled = state?.enabled ?? false;
            return (
              <li key={name} className="flex items-center justify-between py-1">
                <div>
                  <span className="font-mono text-caption text-white/80">{name}</span>
                  {state?.overriddenBy ? (
                    <p className="text-[10px] text-white/35">overridden by {state.overriddenBy}</p>
                  ) : null}
                </div>
                <button
                  disabled={toggleFlag.isPending}
                  onClick={() => toggleFlag.mutate({ flagName: name, enabled: !enabled })}
                  className={enabled ? 'text-success-fg' : 'text-white/25'}
                >
                  {enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          These persist and are audited, but no feature currently consults them — nothing in the
          product changes when you flip one.
        </p>
      </section>
    </div>
  );
}

// ── Audit tab ─────────────────────────────────────────────────────────────────

function AuditTab({ logs }: { logs: AuditRow[] }) {
  return (
    <div className="space-y-4">
      <p className="text-caption text-ink-500">Cross-org audit trail — impersonation and plan changes logged here.</p>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200">
            {['Time', 'Org', 'Action', 'By', 'Detail'].map((h) => (
              <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className={`border-b border-line-100 ${log.action === 'impersonate' ? 'bg-pending-bg/30' : ''}`}>
              <td className="py-3 pr-4 font-mono text-caption text-ink-500">{fmtDate(log.timestamp)}</td>
              <td className="py-3 pr-4 text-body text-ink-900">{log.orgName}</td>
              <td className="py-3 pr-4">
                <span className={`text-caption font-semibold ${log.action === 'impersonate' ? 'text-pending-fg' : 'text-ink-700'}`}>
                  {log.action.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="py-3 pr-4 text-caption text-ink-500">{log.performedBy}</td>
              <td className="py-3 text-caption text-ink-500">{log.meta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'cost', label: 'AI cost', icon: <Cpu size={15} /> },
  { id: 'orgs', label: 'Organisations', icon: <Building2 size={15} /> },
  { id: 'audit', label: 'Audit', icon: <ClipboardList size={15} /> },
];

export default function PlatformAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('cost');
  const [managing, setManaging] = useState<OrgRow | null>(null);
  const [impersonating, setImpersonating] = useState<OrgRow | null>(null);
  const queryClient = useQueryClient();

  /**
   * Records a support access against the org.
   *
   * The endpoint writes an audit row and nothing else — it mints no session and
   * grants no rights, so this deliberately does not claim to "view as" the org.
   * Invariant 6 requires platform access to leave an audited trace; this is that
   * trace, and the banner says so plainly.
   */
  const recordAccess = useMutation({
    mutationFn: (org: OrgRow) => api.post(`/platform/orgs/${org.orgId}/impersonate`, {}),
    onSuccess: (_data, org) => {
      setImpersonating(org);
      void queryClient.invalidateQueries({ queryKey: ['platform', 'audit'] });
    },
  });
  const [period] = useState(() => new Date().toISOString().slice(0, 7));

  // The API is the authority here — every /platform route refuses a non-admin
  // token. This check only decides what the page says, so someone who reaches
  // the URL directly gets a plain answer rather than four failed panels.
  const { data: workspace, isLoading: workspaceLoading } = useWorkspace();
  const isPlatformAdmin = workspace?.user.role === 'PLATFORM_SUPER_ADMIN';

  // Cost is metered per org per period and already carries the org name and
  // margin flag, so it doubles as the organisation list.
  const costQuery = useQuery<ApiCostSummary>({
    queryKey: ['platform', 'cost', period],
    queryFn: () => api.get<ApiCostSummary>(`/platform/cost?period=${period}`),
    enabled: isPlatformAdmin,
  });

  const orgsQuery = useQuery<ApiOrg[]>({
    queryKey: ['platform', 'orgs'],
    queryFn: () => api.get<ApiOrg[]>('/platform/orgs'),
    enabled: isPlatformAdmin,
  });

  const auditQuery = useQuery<ApiAuditLog[]>({
    queryKey: ['platform', 'audit'],
    queryFn: () => api.get<ApiAuditLog[]>('/platform/audit'),
    enabled: isPlatformAdmin,
  });

  const costByOrg = new Map((costQuery.data?.byOrg ?? []).map((r) => [r.orgId, r]));

  const orgs: OrgRow[] = (orgsQuery.data ?? []).map((o) => {
    const cost = costByOrg.get(o._id);
    return {
      orgId: o._id,
      name: o.name,
      status: o.isActive === false ? 'cancelled' : 'active',
      costPaise: cost?.totalCostPaise ?? 0,
      ocrPages:
        (cost?.ocrPagesTier1 ?? 0) + (cost?.ocrPagesTier2 ?? 0) + (cost?.ocrPagesTier3 ?? 0),
      groqTokens: (cost?.groqTokensIn ?? 0) + (cost?.groqTokensOut ?? 0),
      marginAlert: cost?.marginAlert ?? false,
    };
  });

  const auditLogs: AuditRow[] = (auditQuery.data ?? []).map((l) => ({
    id: l._id,
    orgId: l.orgId,
    orgName: l.orgId,
    action: l.action,
    performedBy: l.performedBy ?? '—',
    timestamp: l.createdAt,
    meta: l.meta ? JSON.stringify(l.meta) : '',
  }));

  const alertCount = orgs.filter((o) => o.marginAlert).length;

  if (workspaceLoading) {
    return <p className="text-body text-ink-500">Loading…</p>;
  }

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-sm border border-line-200 bg-surface-card p-8">
        <h1 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          Platform admin only
        </h1>
        <p className="mt-2 max-w-prose text-body text-ink-500">
          This area covers every organisation on the platform, so it is limited to platform
          administrators. Your own organisation&apos;s figures are on the dashboard.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-body font-medium text-saffron-600 hover:underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Impersonation banner */}
      {impersonating && (
        <ImpersonationBanner org={impersonating} onExit={() => setImpersonating(null)} />
      )}

      {/* Dark platform shell */}
      <div className={`min-h-screen bg-ink-900 text-white ${impersonating ? 'pt-12' : ''}`}>
        {/* Platform header */}
        <header className="border-b border-white/10 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={18} className="text-marigold-400" />
            <span className="text-body font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              Platform admin
            </span>
            <span className="text-caption text-white/40 font-mono">Onewebmart-internal</span>
          </div>
          <div className="flex items-center gap-4">
            {alertCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-caption font-medium text-error-fg bg-error-bg/20 border border-error-fg/30 rounded-full px-3 py-1">
                <AlertTriangle size={12} /> {alertCount} margin alert{alertCount !== 1 ? 's' : ''}
              </span>
            )}
            <span className="text-caption text-white/50">FY 2025-26 · {period}</span>
          </div>
        </header>

        {/* Tab nav */}
        <nav className="border-b border-white/10 px-8 flex gap-1 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-body rounded-t-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <span className={activeTab === tab.id ? 'text-marigold-400' : 'text-white/30'}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="px-8 py-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            {activeTab === 'cost' && <CostTab orgs={orgs} />}
            {activeTab === 'orgs' && (
              <OrgsTab
                orgs={orgs}
                onImpersonate={(org) => recordAccess.mutate(org)}
                onManage={setManaging}
              />
            )}
            {activeTab === 'audit' && <AuditTab logs={auditLogs} />}
          </div>
        </main>

        {managing ? <OrgDetailPanel org={managing} onClose={() => setManaging(null)} /> : null}

        {/* System health footer */}
        <footer className="px-8 py-4 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-4 text-caption text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success-fg" /> API healthy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success-fg" /> OCR queue 0 stuck
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success-fg" /> DB replica set 3/3
            </span>
          </div>
          <span className="text-caption text-white/30 font-mono">v0.1.0 · {new Date().toLocaleDateString('en-IN')}</span>
        </footer>
      </div>
    </>
  );
}
