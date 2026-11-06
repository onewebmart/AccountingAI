'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { GST_STATES } from '@/lib/gst';
import {
  Building2,
  Users,
  FileText,
  Plug,
  Palette,
  Receipt,
  Check,
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { GuideButton } from '@/components/guide/module-guide';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'team' | 'tax-gst' | 'integrations' | 'invoice' | 'branding';

/**
 * GET/PATCH /settings, in the API's own field names. The page used orgName,
 * state and financialYearStart, which the API does not have — so the company
 * name, state and year start were never saved, whatever "Saved" said.
 */
interface OrgSettings {
  displayName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  tan?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  invoiceNotes?: string | null;
  stateCode?: string;
  financialYearStartMonth?: number;
  timezone?: string;
  gstFilingFrequency?: 'monthly' | 'quarterly';
}

/** The server's own sentence when there is one. */
function saveError(err: unknown): string {
  return err instanceof ApiError && err.message ? err.message : "Couldn't save — try again.";
}

interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  joinedAt?: string;
}

const ROLE_LABELS: Record<string, string> = {
  COMPANY_ADMIN: 'Company admin',
  ACCOUNTANT: 'Accountant',
  CA_REVIEWER: 'CA reviewer',
  EMPLOYEE: 'Employee',
  AUDITOR: 'Auditor',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  COMPANY_ADMIN: 'Full access to settings, users, and all financial data.',
  ACCOUNTANT: 'Can upload documents, post entries, and view all reports.',
  CA_REVIEWER: 'Can review proposals and view reports. Cannot post entries.',
  EMPLOYEE: 'Can upload documents and view reports, can\'t post entries.',
  AUDITOR: 'Read-only access to journals, reports, and audit trail.',
};

// ── Sub-nav ────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Building2 size={15} /> },
  { id: 'team', label: 'Team & roles', icon: <Users size={15} /> },
  { id: 'tax-gst', label: 'Tax & GST', icon: <Receipt size={15} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={15} /> },
  { id: 'invoice', label: 'Invoice template', icon: <FileText size={15} /> },
  { id: 'branding', label: 'Branding', icon: <Palette size={15} /> },
];

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── General tab ────────────────────────────────────────────────────────────────

function GeneralTab() {
  const qc = useQueryClient();
  const { data: remoteSettings } = useQuery<OrgSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get<OrgSettings>('/settings'),
  });

  const settings = remoteSettings ?? ({} as OrgSettings);

  const [form, setForm] = useState({
    displayName: '',
    timezone: '',
    financialYearStartMonth: '',
    address: '',
    city: '',
    pincode: '',
    phone: '',
    email: '',
    invoiceNotes: '',
  });
  const [initialised, setInitialised] = useState(false);

  if (!initialised && remoteSettings) {
    setForm({
      displayName: remoteSettings.displayName ?? '',
      timezone: remoteSettings.timezone ?? 'Asia/Kolkata',
      financialYearStartMonth: String(remoteSettings.financialYearStartMonth ?? 4),
      address: remoteSettings.address ?? '',
      city: remoteSettings.city ?? '',
      pincode: remoteSettings.pincode ?? '',
      phone: remoteSettings.phone ?? '',
      email: remoteSettings.email ?? '',
      invoiceNotes: remoteSettings.invoiceNotes ?? '',
    });
    setInitialised(true);
  }

  const updateMutation = useMutation({
    mutationFn: (body: Partial<OrgSettings>) => api.patch<OrgSettings>('/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    try {
      await updateMutation.mutateAsync({
        displayName: form.displayName || settings.displayName || undefined,
        timezone: form.timezone || settings.timezone,
        financialYearStartMonth: Number(form.financialYearStartMonth || settings.financialYearStartMonth || 4),
        address: form.address.trim(),
        // Left out when blank: a pincode is six digits or nothing.
        city: form.city.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim(),
        invoiceNotes: form.invoiceNotes.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(saveError(err));
    }
  };

  const displayForm = {
    displayName: form.displayName || settings.displayName || '',
    timezone: form.timezone || settings.timezone || 'Asia/Kolkata',
    financialYearStartMonth: form.financialYearStartMonth || String(settings.financialYearStartMonth ?? 4),
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-body font-semibold text-ink-900">Company details</h2>
        <p className="text-caption text-ink-500 mt-0.5">Shown on invoices, reports, and correspondence.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-caption font-medium text-ink-700 mb-1">Company name</label>
          <input
            type="text"
            value={displayForm.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-caption font-medium text-ink-700 mb-1">Address</label>
          <textarea
            rows={2}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Printed on every invoice — a tax invoice must carry it"
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">City</label>
          <input
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Pincode</label>
          <input
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '') })}
            placeholder="Needed for e-invoices and e-way bills"
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Customers' replies to invoices come here"
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-caption font-medium text-ink-700 mb-1">Printed on every invoice</label>
          <textarea
            rows={2}
            value={form.invoiceNotes}
            onChange={(e) => setForm({ ...form, invoiceNotes: e.target.value })}
            placeholder="e.g. Pay to HDFC Bank A/c 50100000001234, IFSC HDFC0000001 · UPI kumar@hdfcbank"
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Timezone</label>
          <select
            value={displayForm.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Asia/Dubai">Asia/Dubai (GST)</option>
            <option value="UTC">UTC</option>
          </select>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Financial year start</label>
          <select
            value={displayForm.financialYearStartMonth}
            onChange={(e) => setForm({ ...form, financialYearStartMonth: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="4">April (Indian FY)</option>
            <option value="1">January</option>
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-error-fg/30 bg-error-bg px-3 py-2 text-body text-error-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="flex items-center gap-2">
          {saved ? <><Check size={14} /> Saved</> : updateMutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

// ── Team tab ───────────────────────────────────────────────────────────────────

function TeamTab() {
  const qc = useQueryClient();

  const { data: remoteMembers } = useQuery<TeamMember[]>({
    queryKey: ['settings', 'team'],
    queryFn: () => api.get<TeamMember[]>('/settings/team'),
  });

  const members = remoteMembers ?? [];

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('EMPLOYEE');
  const [showInvite, setShowInvite] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      api.post<TeamMember>('/settings/team', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'team'] });
      setInviteEmail('');
      setShowInvite(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/settings/team/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'team'] }),
  });

  const handleInvite = () => {
    if (!inviteEmail) return;
    inviteMutation.mutate({ email: inviteEmail, role: inviteRole });
  };

  const handleRemove = (userId: string) => {
    removeMutation.mutate(userId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-body font-semibold text-ink-900">Team members</h2>
          <p className="text-caption text-ink-500 mt-0.5">
            Manage who can access this organisation and what they can do.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowInvite(true)} className="flex items-center gap-1.5">
          <Plus size={13} /> Add member
        </Button>
      </div>

      {/* Invite row */}
      {showInvite && (
        <div className="rounded-lg border border-brand-200 bg-honey-50 p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-caption font-medium text-ink-700 mb-1">Email address</label>
            <input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <Button onClick={handleInvite} disabled={inviteMutation.isPending}>
            {inviteMutation.isPending ? 'Adding…' : 'Add'}
          </Button>
          <button onClick={() => setShowInvite(false)} className="text-ink-400 hover:text-ink-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Role descriptions */}
      <div className="rounded-lg border border-line-100 bg-surface-sink p-4 space-y-2">
        <p className="text-caption font-semibold text-ink-700 mb-2">Role permissions</p>
        {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => (
          <div key={role} className="flex items-start gap-2">
            <span className="text-caption font-medium text-ink-700 w-32 shrink-0">{ROLE_LABELS[role]}</span>
            <span className="text-caption text-ink-500">{desc}</span>
          </div>
        ))}
      </div>

      {/* Members table */}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line-200">
            {['Name', 'Email', 'Role', 'Joined', 'Status', ''].map((h) => (
              <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} className={`border-b border-line-100 ${!m.isActive ? 'opacity-50' : ''}`}>
              <td className="py-3 pr-4 text-body font-medium text-ink-900">{m.name}</td>
              <td className="py-3 pr-4 text-body text-ink-500">{m.email}</td>
              <td className="py-3 pr-4">
                <span className="text-caption font-medium text-ink-700 bg-surface-sink rounded-full px-2 py-0.5 border border-line-100">
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
              </td>
              <td className="py-3 pr-4 text-caption text-ink-500">{fmtDate(m.joinedAt)}</td>
              <td className="py-3 pr-4">
                {m.isActive ? (
                  <span className="text-caption font-medium text-success-fg">Active</span>
                ) : (
                  <span className="text-caption font-medium text-ink-400">Inactive</span>
                )}
              </td>
              <td className="py-3">
                {m.role !== 'COMPANY_ADMIN' && (
                  <button
                    onClick={() => handleRemove(m.userId)}
                    disabled={removeMutation.isPending}
                    className="text-ink-300 hover:text-error-fg transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tax & GST tab ─────────────────────────────────────────────────────────────

function TaxGstTab() {
  const qc = useQueryClient();
  const { data: remoteSettings } = useQuery<OrgSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get<OrgSettings>('/settings'),
  });

  const settings = remoteSettings ?? ({} as OrgSettings);

  const [form, setForm] = useState({
    gstin: '',
    pan: '',
    tan: '',
    stateCode: '',
    gstFilingFrequency: 'monthly' as 'monthly' | 'quarterly',
  });
  const [initialised, setInitialised] = useState(false);

  // Real values only. Empty fields used to be pre-filled with a sample GSTIN
  // and PAN, so pressing Save registered the business under someone else's.
  if (!initialised && remoteSettings) {
    setForm({
      gstin: remoteSettings.gstin ?? '',
      pan: remoteSettings.pan ?? '',
      tan: remoteSettings.tan ?? '',
      stateCode: remoteSettings.stateCode ?? '',
      gstFilingFrequency: remoteSettings.gstFilingFrequency ?? 'monthly',
    });
    setInitialised(true);
  }

  const updateMutation = useMutation({
    mutationFn: (body: Partial<OrgSettings>) => api.patch<OrgSettings>('/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    try {
      await updateMutation.mutateAsync({
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        tan: form.tan || undefined,
        stateCode: form.stateCode || undefined,
        gstFilingFrequency: form.gstFilingFrequency,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(saveError(err));
    }
  };

  const displayForm = form;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-body font-semibold text-ink-900">Tax & GST configuration</h2>
        <p className="text-caption text-ink-500 mt-0.5">Used for GST registers, reconciliation, and invoice generation.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">GSTIN</label>
          <input
            type="text"
            value={displayForm.gstin}
            maxLength={15}
            onChange={(e) => {
              const gstin = e.target.value.toUpperCase();
              // A GSTIN's first two digits are its state; keep the picker in step.
              const state = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : form.stateCode;
              setForm({ ...form, gstin, stateCode: state });
            }}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-caption text-ink-400 mt-1">15 characters — state code + PAN + entity type</p>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">PAN</label>
          <input
            type="text"
            value={displayForm.pan}
            maxLength={10}
            onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">TAN</label>
          <input
            type="text"
            value={displayForm.tan}
            maxLength={10}
            onChange={(e) => setForm({ ...form, tan: e.target.value.toUpperCase() })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-caption text-ink-400 mt-1">For TDS returns (Form 26Q), like MUMK12345A</p>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">State</label>
          <select
            value={displayForm.stateCode}
            onChange={(e) => setForm({ ...form, stateCode: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Select a state…</option>
            {GST_STATES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.code} — {st.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">GST filing frequency</label>
          <select
            value={displayForm.gstFilingFrequency}
            onChange={(e) => setForm({ ...form, gstFilingFrequency: e.target.value as 'monthly' | 'quarterly' })}
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="monthly">Monthly (GSTR-3B by 20th)</option>
            <option value="quarterly">Quarterly (QRMP scheme)</option>
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-error-fg/30 bg-error-bg px-3 py-2 text-body text-error-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="flex items-center gap-2">
          {saved ? <><Check size={14} /> Saved</> : updateMutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

// ── Integrations tab ──────────────────────────────────────────────────────────

function IntegrationsTab() {
  const [showRazorpay, setShowRazorpay] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-body font-semibold text-ink-900">Integrations</h2>
        <p className="text-caption text-ink-500 mt-0.5">Connect external services to automate reconciliation and payments.</p>
      </div>

      {/* Tally */}
      <div className="rounded-lg border border-line-200 bg-surface-card p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-body font-semibold text-ink-900">Tally connector</p>
            <p className="text-caption text-ink-500 mt-0.5">Sync approved vouchers directly into Tally ERP.</p>
          </div>
          <a href="/exports" className="inline-flex items-center gap-1 text-caption font-medium text-brand-700 hover:underline">
            Configure <ChevronRight size={12} />
          </a>
        </div>
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Tally company name</label>
          <input
            type="text"
            placeholder="Acme Traders"
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            defaultValue="Acme Traders Pvt. Ltd."
          />
          <p className="text-caption text-ink-400 mt-1">Must match exactly the company name in Tally.</p>
        </div>
      </div>

      {/* Razorpay */}
      <div className="rounded-lg border border-line-200 bg-surface-card p-4 space-y-3">
        <div>
          <p className="text-body font-semibold text-ink-900">Razorpay</p>
          <p className="text-caption text-ink-500 mt-0.5">Auto-reconcile Razorpay settlements against your bank statement.</p>
        </div>
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Key ID</label>
          <div className="flex gap-2">
            <input
              type={showRazorpay ? 'text' : 'password'}
              placeholder="rzp_live_xxxxxxxxxxxx"
              className="flex-1 rounded-md border border-line-200 bg-surface-card px-3 py-2 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              defaultValue="rzp_live_abc123def456"
            />
            <button
              onClick={() => setShowRazorpay((v) => !v)}
              className="px-3 rounded-md border border-line-200 bg-surface-card text-ink-500 hover:text-ink-900"
            >
              {showRazorpay ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-caption text-ink-400 mt-1">Key secret is write-only. Re-enter to rotate.</p>
        </div>
      </div>
    </div>
  );
}

// ── Invoice template tab ───────────────────────────────────────────────────────

function InvoiceTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-body font-semibold text-ink-900">Invoice template</h2>
        <p className="text-caption text-ink-500 mt-0.5">Customise how invoices look when sent to customers.</p>
      </div>
      <div className="rounded-lg border border-line-200 bg-surface-sink p-8 text-center">
        <Receipt size={32} className="mx-auto text-ink-300 mb-3" />
        <p className="text-body font-medium text-ink-700">Invoice template editor</p>
        <p className="text-caption text-ink-400 mt-1">Coming in the next release. Your invoices use the default template for now.</p>
      </div>
    </div>
  );
}

// ── Branding tab ──────────────────────────────────────────────────────────────

function BrandingTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-body font-semibold text-ink-900">Branding</h2>
        <p className="text-caption text-ink-500 mt-0.5">White-label configuration for CA firms. Applies to the client portal.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Logo</label>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg border border-line-200 bg-surface-sink flex items-center justify-center text-ink-300">
              <Building2 size={20} />
            </div>
            <Button variant="secondary" size="sm">Upload logo</Button>
          </div>
          <p className="text-caption text-ink-400 mt-1">PNG or SVG, max 200 KB. Shown in the client portal header.</p>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Accent colour</label>
          <div className="flex items-center gap-3">
            <input type="color" defaultValue="#16A36A" className="h-9 w-16 rounded cursor-pointer border border-line-200" />
            <span className="text-caption font-mono text-ink-500">#16A36A</span>
          </div>
          <p className="text-caption text-ink-400 mt-1">Used for buttons and highlights in the client portal.</p>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Custom domain</label>
          <input
            type="text"
            placeholder="accounting.yourfirm.in"
            className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-caption text-ink-400 mt-1">Point a CNAME record to <code className="font-mono">portal.ai-accounting.in</code>.</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-line-200 bg-surface-card px-4 py-3">
          <div>
            <p className="text-body font-medium text-ink-900">Client portal</p>
            <p className="text-caption text-ink-500">Allow clients to view their documents and reports.</p>
          </div>
          <button className="relative h-6 w-11 rounded-full bg-line-200 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500">
            <span className="block h-5 w-5 rounded-full bg-white shadow translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button>Save branding</Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const { logout } = useAuth();

  const renderContent = () => {
    switch (activeTab) {
      case 'general': return <GeneralTab />;
      case 'team': return <TeamTab />;
      case 'tax-gst': return <TaxGstTab />;
      case 'integrations': return <IntegrationsTab />;
      case 'invoice': return <InvoiceTab />;
      case 'branding': return <BrandingTab />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-display text-navy-900">
            Settings
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Configure your organisation, team, and integrations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GuideButton guide="settings" />
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 rounded-md border border-line-200 bg-surface-card px-3 py-2 text-caption font-medium text-ink-600 hover:text-error-fg hover:border-error-fg transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </div>

      {/* Layout: left sub-nav + content */}
      <div className="flex gap-8">
        {/* Sub-nav */}
        <nav className="w-44 shrink-0">
          <ul className="space-y-0.5">
            {TABS.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-body transition-colors ${
                    activeTab === tab.id
                      ? 'bg-brand-50 text-brand-700 font-medium'
                      : 'text-ink-600 hover:bg-surface-sink hover:text-ink-900'
                  }`}
                >
                  <span className={activeTab === tab.id ? 'text-brand-700' : 'text-ink-400'}>{tab.icon}</span>
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 rounded-lg border border-line-200 bg-surface-card p-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
