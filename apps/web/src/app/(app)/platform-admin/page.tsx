'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Cpu,
  Flag,
  ClipboardList,
  X,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Shield,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'cost' | 'orgs' | 'flags' | 'audit';

interface OrgRow {
  orgId: string;
  name: string;
  plan: 'free' | 'starter' | 'business' | 'enterprise';
  status: 'active' | 'past_due' | 'cancelled';
  costPaise: number;
  ocrPages: number;
  groqTokens: number;
  marginAlert: boolean;
  memberCount: number;
}

interface FeatureFlagRow {
  orgId: string;
  orgName: string;
  flagName: string;
  enabled: boolean;
  overriddenBy: string | null;
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

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_ORGS: OrgRow[] = [
  { orgId: 'org-001', name: 'Acme Traders Pvt. Ltd.', plan: 'business', status: 'active', costPaise: 1428300, ocrPages: 4271, groqTokens: 182000, marginAlert: true, memberCount: 6 },
  { orgId: 'org-002', name: 'Sharma & Sons', plan: 'starter', status: 'active', costPaise: 84200, ocrPages: 623, groqTokens: 45000, marginAlert: false, memberCount: 3 },
  { orgId: 'org-003', name: 'Omega Solutions', plan: 'enterprise', status: 'active', costPaise: 2210000, ocrPages: 9841, groqTokens: 312000, marginAlert: true, memberCount: 14 },
  { orgId: 'org-004', name: 'Horizon Exports', plan: 'free', status: 'past_due', costPaise: 15600, ocrPages: 87, groqTokens: 8200, marginAlert: false, memberCount: 2 },
  { orgId: 'org-005', name: 'Raj Consultancy', plan: 'starter', status: 'active', costPaise: 62100, ocrPages: 411, groqTokens: 28000, marginAlert: false, memberCount: 4 },
];

const MOCK_FLAGS: FeatureFlagRow[] = [
  { orgId: 'org-001', orgName: 'Acme Traders Pvt. Ltd.', flagName: 'vision_ocr_enabled', enabled: true, overriddenBy: 'platform-admin-1' },
  { orgId: 'org-001', orgName: 'Acme Traders Pvt. Ltd.', flagName: 'white_label', enabled: false, overriddenBy: null },
  { orgId: 'org-003', orgName: 'Omega Solutions', flagName: 'vision_ocr_enabled', enabled: true, overriddenBy: 'platform-admin-1' },
  { orgId: 'org-003', orgName: 'Omega Solutions', flagName: 'white_label', enabled: true, overriddenBy: 'platform-admin-1' },
  { orgId: 'org-003', orgName: 'Omega Solutions', flagName: 'tally_sync', enabled: true, overriddenBy: 'platform-admin-1' },
];

const MOCK_AUDIT: AuditRow[] = [
  { id: 'a-001', orgId: 'org-001', orgName: 'Acme Traders', action: 'impersonate', performedBy: 'platform-admin-1', timestamp: '2025-03-14T10:32:00Z', meta: 'Support session' },
  { id: 'a-002', orgId: 'org-003', orgName: 'Omega Solutions', action: 'plan_change', performedBy: 'platform-admin-1', timestamp: '2025-03-12T14:18:00Z', meta: 'starter → enterprise' },
  { id: 'a-003', orgId: 'org-003', orgName: 'Omega Solutions', action: 'flag_enabled', performedBy: 'platform-admin-1', timestamp: '2025-03-12T14:20:00Z', meta: 'white_label = true' },
  { id: 'a-004', orgId: 'org-004', orgName: 'Horizon Exports', action: 'plan_change', performedBy: 'platform-admin-1', timestamp: '2025-03-10T09:00:00Z', meta: 'business → free' },
];

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(paise / 100);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function planBadge(plan: OrgRow['plan']) {
  const cls: Record<string, string> = {
    free: 'bg-surface-sink text-ink-500 border-line-200',
    starter: 'bg-pending-bg text-pending-fg border-pending-fg/30',
    business: 'bg-success-bg text-success-fg border-success-fg/30',
    enterprise: 'bg-brand-50 text-brand-700 border-brand-200',
  };
  return (
    <span className={`inline-flex text-caption font-semibold rounded-full px-2 py-0.5 border capitalize ${cls[plan]}`}>
      {plan}
    </span>
  );
}

// ── Impersonation banner ───────────────────────────────────────────────────────

function ImpersonationBanner({ org, onExit }: { org: OrgRow; onExit: () => void }) {
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-pending-fg text-white px-6 py-2.5 flex items-center justify-between text-body font-medium shadow-lg">
      <div className="flex items-center gap-2">
        <Shield size={16} />
        You&apos;re viewing <strong className="ml-1">{org.name}</strong> as support.
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

function OrgsTab({ orgs, onImpersonate }: { orgs: OrgRow[]; onImpersonate: (org: OrgRow) => void }) {
  return (
    <div className="space-y-4">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200">
            {['Organisation', 'Plan', 'Status', 'Members', 'Cost this month', ''].map((h) => (
              <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.orgId} className="border-b border-line-100">
              <td className="py-3 pr-4 text-body font-medium text-ink-900">{org.name}</td>
              <td className="py-3 pr-4">{planBadge(org.plan)}</td>
              <td className="py-3 pr-4">
                <span className={`text-caption font-medium ${org.status === 'active' ? 'text-success-fg' : 'text-error-fg'}`}>
                  {org.status === 'past_due' ? 'Past due' : org.status.charAt(0).toUpperCase() + org.status.slice(1)}
                </span>
              </td>
              <td className="py-3 pr-4 text-body text-ink-600">{org.memberCount}</td>
              <td className="py-3 pr-4 font-mono text-body text-ink-900">{fmt(org.costPaise)}</td>
              <td className="py-3">
                <button
                  onClick={() => onImpersonate(org)}
                  className="inline-flex items-center gap-1 text-caption font-medium text-brand-600 hover:underline"
                >
                  View as this org <ChevronRight size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Feature flags tab ─────────────────────────────────────────────────────────

function FlagsTab({ flags: initialFlags }: { flags: FeatureFlagRow[] }) {
  const [flags, setFlags] = useState(initialFlags);

  const toggle = (orgId: string, flagName: string) => {
    setFlags((f) =>
      f.map((flag) =>
        flag.orgId === orgId && flag.flagName === flagName
          ? { ...flag, enabled: !flag.enabled }
          : flag,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-caption text-ink-500">Per-org feature overrides. Changes take effect immediately.</p>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200">
            {['Organisation', 'Flag', 'State', 'Changed by', ''].map((h) => (
              <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flags.map((flag, i) => (
            <tr key={i} className="border-b border-line-100">
              <td className="py-3 pr-4 text-body text-ink-900">{flag.orgName}</td>
              <td className="py-3 pr-4 font-mono text-caption text-ink-700">{flag.flagName}</td>
              <td className="py-3 pr-4">
                <span className={`text-caption font-semibold ${flag.enabled ? 'text-success-fg' : 'text-ink-400'}`}>
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </td>
              <td className="py-3 pr-4 text-caption text-ink-500">{flag.overriddenBy ?? '—'}</td>
              <td className="py-3">
                <button
                  onClick={() => toggle(flag.orgId, flag.flagName)}
                  className={`transition-colors ${flag.enabled ? 'text-success-fg' : 'text-ink-300'}`}
                >
                  {flag.enabled
                    ? <ToggleRight size={22} />
                    : <ToggleLeft size={22} />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  { id: 'flags', label: 'Feature flags', icon: <Flag size={15} /> },
  { id: 'audit', label: 'Audit', icon: <ClipboardList size={15} /> },
];

export default function PlatformAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('cost');
  const [impersonating, setImpersonating] = useState<OrgRow | null>(null);
  const [period] = useState('2025-03');

  const alertCount = MOCK_ORGS.filter((o) => o.marginAlert).length;

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
            {activeTab === 'cost' && <CostTab orgs={MOCK_ORGS} />}
            {activeTab === 'orgs' && <OrgsTab orgs={MOCK_ORGS} onImpersonate={setImpersonating} />}
            {activeTab === 'flags' && <FlagsTab flags={MOCK_FLAGS} />}
            {activeTab === 'audit' && <AuditTab logs={MOCK_AUDIT} />}
          </div>
        </main>

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
