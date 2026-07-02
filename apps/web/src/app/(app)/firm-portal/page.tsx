'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Clock,
  AlertCircle,
  ChevronRight,
  Plus,
  Search,
  Globe,
  Users,
  FileCheck,
  Settings,
  CheckCircle2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'clients' | 'branding' | 'domain';

interface ClientSummary {
  orgId: string;
  name: string;
  gstin?: string;
  pendingReviewCount: number;
  overdueApCount: number;
  gstDueDays: number;
}

interface FirmConfig {
  name: string;
  logoUrl?: string;
  accentColor?: string;
  customDomain?: string;
  clientPortalEnabled?: boolean;
}

// ── Mock fallbacks ─────────────────────────────────────────────────────────────

const MOCK_FIRM_NAME = 'Sharma & Associates';
const MOCK_FIRM_SLUG = 'sharma-associates';

const MOCK_CONFIG: FirmConfig = {
  name: MOCK_FIRM_NAME,
  logoUrl: '',
  accentColor: '#E8590C',
  customDomain: '',
  clientPortalEnabled: true,
};

const MOCK_CLIENTS: ClientSummary[] = [
  { orgId: 'org-1', name: 'Mehta Exports Pvt Ltd', pendingReviewCount: 7, overdueApCount: 2, gstDueDays: 4 },
  { orgId: 'org-2', name: 'Kapoor Textiles', pendingReviewCount: 0, overdueApCount: 0, gstDueDays: 18 },
  { orgId: 'org-3', name: 'Sunrise Foods Ltd', pendingReviewCount: 3, overdueApCount: 5, gstDueDays: 4 },
  { orgId: 'org-4', name: 'Verma Construction', pendingReviewCount: 1, overdueApCount: 0, gstDueDays: 11 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function UrgencyDot({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-[#C92A2A] text-white text-[11px] font-semibold font-mono">
      {count}
    </span>
  );
}

function GstBadge({ days }: { days: number }) {
  if (days > 7) {
    return <span className="text-xs text-stone-400 font-mono">GST in {days}d</span>;
  }
  if (days >= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 font-mono">
        <Clock className="h-3 w-3" />
        GST in {days}d
      </span>
    );
  }
  return null;
}

function ClientCard({ client, onOpen }: { client: ClientSummary; onOpen: (orgId: string) => void }) {
  const hasUrgency = client.pendingReviewCount > 0 || client.overdueApCount > 0;

  return (
    <button
      onClick={() => onOpen(client.orgId)}
      className={`w-full text-left rounded-xl border bg-white p-5 transition-all hover:shadow-md hover:border-[#E8590C]/40 active:scale-[0.99] ${
        hasUrgency ? 'border-amber-200' : 'border-stone-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-stone-500" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-stone-900 truncate font-[Bricolage_Grotesque]">{client.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <GstBadge days={client.gstDueDays} />
            </div>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-stone-400 shrink-0 mt-1" />
      </div>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-stone-100">
        <div className="flex items-center gap-1.5">
          <FileCheck className="h-4 w-4 text-stone-400" />
          <span className="text-sm text-stone-600">Pending review</span>
          <UrgencyDot count={client.pendingReviewCount} />
          {client.pendingReviewCount === 0 && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        </div>
        <div className="flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-stone-400" />
          <span className="text-sm text-stone-600">Overdue AP</span>
          <UrgencyDot count={client.overdueApCount} />
          {client.overdueApCount === 0 && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        </div>
      </div>
    </button>
  );
}

// ── Clients tab ───────────────────────────────────────────────────────────────

function ClientsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientGstin, setNewClientGstin] = useState('');

  const { data: remoteClients } = useQuery<ClientSummary[]>({
    queryKey: ['firm', 'clients'],
    queryFn: () => api.get<ClientSummary[]>('/firm/clients'),
  });

  const clients = remoteClients ?? MOCK_CLIENTS;

  const addClientMutation = useMutation({
    mutationFn: (body: { name: string; gstin?: string }) =>
      api.post<ClientSummary>('/firm/clients', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm', 'clients'] });
      setAddingClient(false);
      setNewClientName('');
      setNewClientGstin('');
    },
  });

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const urgentCount = clients.filter(
    (c) => c.pendingReviewCount > 0 || c.overdueApCount > 0 || c.gstDueDays <= 7,
  ).length;

  const handleAddClient = () => {
    if (!newClientName.trim()) return;
    addClientMutation.mutate({
      name: newClientName.trim(),
      gstin: newClientGstin.trim() || undefined,
    });
  };

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-2xl font-bold text-stone-900 font-[Bricolage_Grotesque]">{clients.length}</p>
          <p className="text-sm text-stone-500 mt-0.5">Total clients</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-2xl font-bold text-amber-800 font-[Bricolage_Grotesque]">{urgentCount}</p>
          <p className="text-sm text-amber-700 mt-0.5">Need attention</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-2xl font-bold text-stone-900 font-[Bricolage_Grotesque]">
            {clients.reduce((sum, c) => sum + c.pendingReviewCount, 0)}
          </p>
          <p className="text-sm text-stone-500 mt-0.5">Entries pending</p>
        </div>
      </div>

      {/* Search + Add */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 bg-white text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#E8590C]/30 focus:border-[#E8590C]"
          />
        </div>
        <Button
          onClick={() => setAddingClient(true)}
          className="bg-[#E8590C] hover:bg-[#D04E0B] text-white gap-2"
        >
          <Plus className="h-4 w-4" />
          Add client
        </Button>
      </div>

      {/* Add client inline form */}
      {addingClient && (
        <div className="rounded-xl border-2 border-dashed border-[#E8590C]/40 bg-[#E8590C]/5 p-4">
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-stone-700">New client</p>
            <button onClick={() => { setAddingClient(false); setNewClientName(''); setNewClientGstin(''); }} className="text-stone-400 hover:text-stone-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="Company name, e.g. Patel Industries Pvt Ltd"
              className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#E8590C]/30 focus:border-[#E8590C]"
              autoFocus
            />
            <input
              type="text"
              value={newClientGstin}
              onChange={(e) => setNewClientGstin(e.target.value.toUpperCase())}
              placeholder="GSTIN (optional)"
              maxLength={15}
              className="w-48 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E8590C]/30 focus:border-[#E8590C]"
            />
            <Button
              disabled={!newClientName.trim() || addClientMutation.isPending}
              className="bg-[#E8590C] hover:bg-[#D04E0B] text-white"
              onClick={handleAddClient}
            >
              {addClientMutation.isPending ? 'Creating…' : 'Create client'}
            </Button>
          </div>
        </div>
      )}

      {/* Client grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((client) => (
            <ClientCard
              key={client.orgId}
              client={client}
              onOpen={(orgId) => { window.location.href = `/review?orgId=${orgId}`; }}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-stone-400">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No clients match your search</p>
        </div>
      )}
    </div>
  );
}

// ── Branding tab ──────────────────────────────────────────────────────────────

function BrandingTab() {
  const qc = useQueryClient();

  const { data: remoteConfig } = useQuery<FirmConfig>({
    queryKey: ['firm', 'config'],
    queryFn: () => api.get<FirmConfig>('/firm/config'),
  });

  const config = remoteConfig ?? MOCK_CONFIG;

  const [form, setForm] = useState<Partial<FirmConfig>>({});
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (body: Partial<FirmConfig>) => api.patch<FirmConfig>('/firm/config', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm', 'config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const display = { ...config, ...form };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-xl border border-stone-200 bg-white p-6 space-y-5">
        <h3 className="font-semibold text-stone-900 font-[Bricolage_Grotesque]">Client portal branding</h3>

        <div className="space-y-1">
          <label className="text-sm font-medium text-stone-700">Logo URL</label>
          <input
            type="url"
            value={display.logoUrl ?? ''}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder="https://cdn.yourfirm.in/logo.png"
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#E8590C]/30 focus:border-[#E8590C]"
          />
          <p className="text-xs text-stone-400">Shown in the client portal header</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-stone-700">Accent colour</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={display.accentColor ?? '#E8590C'}
              onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
              className="h-9 w-16 cursor-pointer rounded border border-stone-200 p-0.5"
            />
            <input
              type="text"
              value={display.accentColor ?? ''}
              onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
              placeholder="#E8590C"
              className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E8590C]/30 focus:border-[#E8590C]"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-sm font-medium text-stone-700">Client portal</p>
            <p className="text-xs text-stone-400 mt-0.5">Allow clients to view their books via the portal</p>
          </div>
          <button
            onClick={() => setForm({ ...form, clientPortalEnabled: !display.clientPortalEnabled })}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              display.clientPortalEnabled ? 'bg-emerald-500' : 'bg-stone-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                display.clientPortalEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <Button
          onClick={() => updateMutation.mutate(form)}
          disabled={updateMutation.isPending}
          className="w-full bg-[#E8590C] hover:bg-[#D04E0B] text-white"
        >
          {saved ? 'Saved' : updateMutation.isPending ? 'Saving…' : 'Save branding'}
        </Button>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div
          className="h-10 flex items-center px-4 gap-2"
          style={{ backgroundColor: display.accentColor ?? '#E8590C' }}
        >
          {display.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={display.logoUrl} alt="Logo" className="h-6 object-contain" />
          ) : (
            <span className="text-white font-semibold text-sm font-[Bricolage_Grotesque]">{display.name}</span>
          )}
        </div>
        <div className="p-4 bg-[#FFFCF6]">
          <p className="text-xs text-stone-400 text-center">Portal preview</p>
        </div>
      </div>
    </div>
  );
}

// ── Domain tab ────────────────────────────────────────────────────────────────

function DomainTab() {
  const qc = useQueryClient();

  const { data: remoteConfig } = useQuery<FirmConfig>({
    queryKey: ['firm', 'config'],
    queryFn: () => api.get<FirmConfig>('/firm/config'),
  });

  const config = remoteConfig ?? MOCK_CONFIG;
  const firmSlug = config.name
    ? config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : MOCK_FIRM_SLUG;

  const [domain, setDomain] = useState('');
  const [initialised, setInitialised] = useState(false);

  if (!initialised && remoteConfig) {
    setDomain(remoteConfig.customDomain ?? '');
    setInitialised(true);
  }

  const displayDomain = domain || config.customDomain || '';
  const defaultDomain = `${firmSlug}.aiaccounting.in`;

  const updateMutation = useMutation({
    mutationFn: (body: Partial<FirmConfig>) => api.patch<FirmConfig>('/firm/config', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['firm', 'config'] }),
  });

  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await updateMutation.mutateAsync({ customDomain: displayDomain });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-xl border border-stone-200 bg-white p-6 space-y-5">
        <h3 className="font-semibold text-stone-900 font-[Bricolage_Grotesque]">Custom domain</h3>

        <div className="rounded-lg bg-stone-50 border border-stone-200 p-4">
          <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Default portal URL</p>
          <p className="text-sm font-mono text-stone-700">{defaultDomain}</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-stone-700">Custom domain</label>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-stone-400 shrink-0" />
            <input
              type="text"
              value={displayDomain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="portal.yourfirm.in"
              className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E8590C]/30 focus:border-[#E8590C]"
            />
          </div>
          <p className="text-xs text-stone-400">
            Add a CNAME record pointing to <span className="font-mono">{defaultDomain}</span>
          </p>
        </div>

        {displayDomain && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-amber-800">DNS setup required</p>
            <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs font-mono">
              <span className="text-stone-500">Type</span>
              <span className="text-stone-800">CNAME</span>
              <span className="text-stone-500">Name</span>
              <span className="text-stone-800">{displayDomain.split('.')[0]}</span>
              <span className="text-stone-500">Value</span>
              <span className="text-stone-800">{defaultDomain}</span>
            </div>
          </div>
        )}

        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="w-full bg-[#E8590C] hover:bg-[#D04E0B] text-white"
        >
          {saved ? 'Saved' : updateMutation.isPending ? 'Saving…' : 'Save domain'}
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'branding', label: 'Branding', icon: Settings },
  { id: 'domain', label: 'Custom domain', icon: Globe },
];

export default function FirmPortalPage() {
  const [activeTab, setActiveTab] = useState<Tab>('clients');

  const { data: firmConfig } = useQuery<FirmConfig>({
    queryKey: ['firm', 'config'],
    queryFn: () => api.get<FirmConfig>('/firm/config'),
  });

  const firmName = firmConfig?.name ?? MOCK_FIRM_NAME;

  return (
    <div className="min-h-screen bg-[#FFFCF6] p-6 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-8 rounded-lg bg-[#E8590C] flex items-center justify-center">
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900 font-[Bricolage_Grotesque]">{firmName}</h1>
        </div>
        <p className="text-stone-500 text-sm ml-11">Manage your clients and white-label portal settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-[#E8590C] text-[#E8590C]'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'clients' && <ClientsTab />}
      {activeTab === 'branding' && <BrandingTab />}
      {activeTab === 'domain' && <DomainTab />}
    </div>
  );
}
