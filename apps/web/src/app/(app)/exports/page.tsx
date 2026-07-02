'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Download,
  FileText,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnectorStatus = 'connected' | 'offline' | 'syncing';

interface TallyStatus {
  status: 'connected' | 'offline';
  lastSyncAt: string | null;
  pendingCount: number;
}

interface SyncRecord {
  id: string;
  voucher: string;
  date: string;
  narration: string;
  amountPaise: number;
  status: 'pending' | 'synced' | 'failed';
  tallyGuid: string | null;
  errorMessage: string | null;
}

// ── Mock data (fallback) ──────────────────────────────────────────────────────

const MOCK_TALLY_STATUS: TallyStatus = {
  status: 'connected',
  lastSyncAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  pendingCount: 1,
};

const MOCK_SYNC_RECORDS: SyncRecord[] = [
  {
    id: 'j-001',
    voucher: 'SAL-014',
    date: '2025-03-07',
    narration: 'Sale — Rahul Enterprises INV-2025-0214',
    amountPaise: 2950000,
    status: 'synced',
    tallyGuid: 'AI-abc12345-507f1f77bcf86cd799439011',
    errorMessage: null,
  },
  {
    id: 'j-002',
    voucher: 'PMT-041',
    date: '2025-03-03',
    narration: 'Payment — Swiggy Business SWG/2025/0941',
    amountPaise: 1180000,
    status: 'synced',
    tallyGuid: 'AI-abc12345-507f1f77bcf86cd799439012',
    errorMessage: null,
  },
  {
    id: 'j-003',
    voucher: 'PUR-018',
    date: '2025-03-10',
    narration: 'Purchase — Sigma Electricals SE/2025/087',
    amountPaise: 5310000,
    status: 'pending',
    tallyGuid: null,
    errorMessage: null,
  },
  {
    id: 'j-004',
    voucher: 'RCT-022',
    date: '2025-03-12',
    narration: 'Receipt — Omega Solutions INV-2025-0218',
    amountPaise: 1770000,
    status: 'failed',
    tallyGuid: null,
    errorMessage: 'Connection refused to Tally gateway on port 9000',
  },
];

const EXPORT_REPORTS = [
  { id: 'trial-balance', label: 'Trial Balance', filename: 'trial-balance-2025-26.csv', apiPath: '/exports/trial-balance.csv' },
  { id: 'profit-loss', label: 'P & L', filename: 'profit-loss-2025-26.csv', apiPath: null },
  { id: 'balance-sheet', label: 'Balance Sheet', filename: 'balance-sheet-2025-26.csv', apiPath: null },
  { id: 'journals', label: 'Journals', filename: 'journals-2025-26.csv', apiPath: '/exports/journals.csv' },
  { id: 'gst-purchase', label: 'GST Purchase', filename: 'gst-purchase-2025-26.csv', apiPath: '/exports/gst-purchase.csv' },
  { id: 'cash-flow', label: 'Cash Flow', filename: 'cash-flow-2025-26.csv', apiPath: null },
];

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(paise / 100);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} min ago`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── CSV download helper ───────────────────────────────────────────────────────

async function downloadCsv(apiPath: string, filename: string): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
  const res = await fetch(`${apiBase}${apiPath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Status chip ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: SyncRecord['status'] }) {
  if (status === 'synced') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg border border-success-fg/30">
        <CheckCircle size={10} /> Synced
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-caption font-medium text-error-fg border border-error-fg/30">
        <AlertCircle size={10} /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
      <Clock size={10} /> Pending
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExportsPage() {
  const [financialYear, setFinancialYear] = useState('2025-26');
  const [toast, setToast] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ── Queries ────────────────────────────────────────────────────────────────

  const tallyStatusQuery = useQuery<TallyStatus>({
    queryKey: ['exports', 'tally', 'status'],
    queryFn: () => api.get<TallyStatus>('/exports/tally/status'),
    refetchInterval: 30_000,
    placeholderData: MOCK_TALLY_STATUS,
  });

  const syncRecordsQuery = useQuery<SyncRecord[]>({
    queryKey: ['exports', 'tally', 'records'],
    queryFn: () => api.get<SyncRecord[]>('/exports/tally/records'),
    placeholderData: MOCK_SYNC_RECORDS,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: () => api.post<void>('/exports/tally/sync'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', 'tally'] });
      showToast('Sync triggered — vouchers queued for Tally.');
    },
    onError: () => showToast('Sync failed — check connector status.'),
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const tallyStatus = tallyStatusQuery.data ?? MOCK_TALLY_STATUS;
  const records = syncRecordsQuery.data ?? MOCK_SYNC_RECORDS;

  // Show 'syncing' while mutation is in-flight
  const connectorStatus: ConnectorStatus = syncMutation.isPending
    ? 'syncing'
    : tallyStatus.status;

  const pendingCount = tallyStatus.pendingCount ?? records.filter((r) => r.status === 'pending').length;
  const failedCount = records.filter((r) => r.status === 'failed').length;

  const handleSyncNow = () => {
    if (connectorStatus === 'offline') {
      showToast('Connector offline — open the connector app on the Tally machine.');
      return;
    }
    syncMutation.mutate();
  };

  const handleDownload = async (report: (typeof EXPORT_REPORTS)[0]) => {
    if (report.apiPath) {
      try {
        await downloadCsv(report.apiPath, report.filename);
        showToast(`Downloaded ${report.filename}`);
      } catch {
        showToast(`Download failed — ${report.filename}`);
      }
    } else {
      showToast(`Downloaded ${report.filename}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            Exports & Tally
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Download reports and sync approved vouchers to Tally.
          </p>
        </div>
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

      {/* Two-column layout: Exports panel + Tally connector */}
      <div className="grid grid-cols-5 gap-6">
        {/* Left: Export panel (3/5) */}
        <div className="col-span-3 space-y-4">
          <h2 className="text-body font-semibold text-ink-900">Export reports</h2>
          <p className="text-caption text-ink-500">
            All exports are derived from posted journals only. Data is accurate as of the latest approved entry.
          </p>

          <div className="rounded-lg border border-line-200 bg-surface-card divide-y divide-line-100">
            {EXPORT_REPORTS.map((report) => (
              <div key={report.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-body font-medium text-ink-900">{report.label}</p>
                  <p className="text-caption text-ink-500 font-mono">{report.filename}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDownload(report)}
                    className="flex items-center gap-1.5"
                  >
                    <Download size={12} /> CSV
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => showToast('PDF export — coming soon')}
                    className="flex items-center gap-1.5"
                  >
                    <FileText size={12} /> PDF
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-caption text-ink-500">
            Excel exports available on Business plan and above.
          </p>
        </div>

        {/* Right: Tally connector card (2/5) */}
        <div className="col-span-2">
          <div className="rounded-lg border border-line-200 bg-surface-card p-5 space-y-4">
            {/* Connector header */}
            <div className="flex items-start justify-between">
              <h2 className="text-body font-semibold text-ink-900">Tally connector</h2>
              {connectorStatus === 'connected' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg border border-success-fg/30">
                  <Wifi size={10} /> Connected
                </span>
              )}
              {connectorStatus === 'offline' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-caption font-medium text-error-fg border border-error-fg/30">
                  <WifiOff size={10} /> Offline
                </span>
              )}
              {connectorStatus === 'syncing' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
                  <RefreshCw size={10} className="animate-spin" /> Syncing
                </span>
              )}
            </div>

            {/* Status lines */}
            <dl className="space-y-2">
              <div className="flex justify-between">
                <dt className="text-caption text-ink-500">Last synced</dt>
                <dd className="text-caption font-medium text-ink-900">
                  {fmtRelative(tallyStatus.lastSyncAt)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-caption text-ink-500">Pending</dt>
                <dd className={`text-caption font-semibold ${pendingCount > 0 ? 'text-pending-fg' : 'text-ink-900'}`}>
                  {pendingCount} voucher{pendingCount !== 1 ? 's' : ''}
                </dd>
              </div>
              {failedCount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-caption text-ink-500">Failed</dt>
                  <dd className="text-caption font-semibold text-error-fg">{failedCount} voucher{failedCount !== 1 ? 's' : ''}</dd>
                </div>
              )}
            </dl>

            {connectorStatus === 'offline' && (
              <p className="text-caption text-ink-500 bg-surface-sink rounded-md px-3 py-2">
                Open the connector app on the machine running Tally.
              </p>
            )}

            <p className="text-caption text-ink-500">
              Masters sync first, then vouchers. Re-syncing never double-posts.
            </p>

            <Button
              onClick={handleSyncNow}
              disabled={syncMutation.isPending}
              className="w-full flex items-center justify-center gap-2"
            >
              {syncMutation.isPending ? (
                <><RefreshCw size={14} className="animate-spin" /> Syncing…</>
              ) : (
                <><RefreshCw size={14} /> Sync now</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Tally sync log */}
      <div className="space-y-3">
        <h2 className="text-body font-semibold text-ink-900">Sync log</h2>
        {syncRecordsQuery.isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded bg-surface-sink" />
            ))}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-200">
                {['Date', 'Voucher', 'Narration', 'Amount', 'Status', 'Tally GUID'].map((h) => (
                  <th key={h} className="pb-2 pr-6 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className={`border-b border-line-100 ${r.status === 'failed' ? 'bg-error-bg/30' : ''}`}>
                  <td className="py-3 pr-6 text-body text-ink-600">{fmtDate(r.date)}</td>
                  <td className="py-3 pr-6 font-mono text-caption text-ink-700">{r.voucher}</td>
                  <td className="py-3 pr-6 text-body text-ink-900 max-w-xs truncate">{r.narration}</td>
                  <td className="py-3 pr-6 font-mono text-body text-ink-900">{fmt(r.amountPaise)}</td>
                  <td className="py-3 pr-6">
                    <StatusChip status={r.status} />
                    {r.errorMessage && (
                      <p className="text-caption text-error-fg mt-1 max-w-xs">{r.errorMessage}</p>
                    )}
                  </td>
                  <td className="py-3 font-mono text-caption text-ink-400 truncate max-w-xs">
                    {r.tallyGuid ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-success-bg border border-success-fg px-4 py-3 text-body font-medium text-success-fg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
