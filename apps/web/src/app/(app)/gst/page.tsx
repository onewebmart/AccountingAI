'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Upload,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  FileText,
  Plus,
} from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type ReconStatus = 'pending' | 'matched' | 'missing_in_books' | 'missing_in_2b' | 'mismatched';

interface PurchaseRegisterEntry {
  id: string;
  vendorName: string;
  supplierGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  itcEligiblePaise: number;
  isInterState: boolean;
}

interface SalesRegisterEntry {
  id: string;
  customerName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  isInterState: boolean;
}

interface Gstr2bLine {
  id: string;
  supplierGstin: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  taxableValuePaise: number;
  itcEligiblePaise: number;
  reconStatus: ReconStatus;
  mismatchType: string | null;
}

interface ReconcileResult {
  matched: number;
  missingInBooks: number;
  missingIn2b: number;
  mismatched: number;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(paise / 100);
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

// ── Recon status chip ─────────────────────────────────────────────────────────

function ReconChip({ status }: { status: ReconStatus }) {
  switch (status) {
    case 'matched':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-caption font-medium text-success-fg border border-success-fg/30">
          <CheckCircle size={10} /> Matched
        </span>
      );
    case 'missing_in_books':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
          <AlertTriangle size={10} /> Missing in books
        </span>
      );
    case 'missing_in_2b':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-caption font-medium text-pending-fg border border-pending-fg/30">
          <AlertTriangle size={10} /> Missing in 2B
        </span>
      );
    case 'mismatched':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-caption font-medium text-error-fg border border-error-fg/30">
          <AlertCircle size={10} /> Mismatched
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-sink px-2 py-0.5 text-caption font-medium text-ink-500 border border-line-200">
          Pending
        </span>
      );
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'purchase' | 'sales' | 'recon' | 'summary';

const TABS: { id: Tab; label: string }[] = [
  { id: 'purchase', label: 'Purchase register' },
  { id: 'sales', label: 'Sales register' },
  { id: 'recon', label: '2A/2B reconciliation' },
  { id: 'summary', label: 'Summary' },
];

// ── Table skeleton ─────────────────────────────────────────────────────────────

function TableSkeleton({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-8 flex-1 rounded bg-surface-sink animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Period options ────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
  '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GstPage() {
  const [tab, setTab] = useState<Tab>('recon');
  const [period, setPeriod] = useState('2025-03');
  const file2bInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const STATE_CODE = '27';

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ── Queries ────────────────────────────────────────────────────────────────

  const purchaseQuery = useQuery<PurchaseRegisterEntry[]>({
    queryKey: ['gst', 'purchase-register', period],
    queryFn: () =>
      api.get<PurchaseRegisterEntry[]>(
        `/gst/purchase-register?period=${period}&buyerStateCode=${STATE_CODE}`,
      ),
  });

  const salesQuery = useQuery<SalesRegisterEntry[]>({
    queryKey: ['gst', 'sales-register', period],
    queryFn: () =>
      api.get<SalesRegisterEntry[]>(
        `/gst/sales-register?period=${period}&buyerStateCode=${STATE_CODE}`,
      ),
  });

  const lines2bQuery = useQuery<Gstr2bLine[]>({
    queryKey: ['gst', '2b-lines', period],
    queryFn: () => api.get<Gstr2bLine[]>(`/gst/recon-lines?period=${period}`),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  // The portal hands you a JSON or Excel download — send the file itself rather
  // than asking the user to re-key every inward invoice.
  const import2bMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<{ period: string; imported: number; warnings: string[] }>(
        `/gst/import-2b/file?period=${period}`,
        form,
      );
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['gst'] });
      showToast(`Imported ${res.imported} GSTR-2B lines for ${res.period}.`);
    },
    onError: (err: Error) => showToast(err.message || 'Import failed — please try again.'),
  });

  const reconcileMutation = useMutation({
    mutationFn: () =>
      api.post<ReconcileResult>(
        `/gst/reconcile-2b?period=${period}&buyerStateCode=${STATE_CODE}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gst', '2b-lines'] });
      showToast('Reconciliation complete.');
    },
    onError: () => showToast('Reconciliation failed — please try again.'),
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const purchaseRows = purchaseQuery.data ?? [];
  const salesRows = salesQuery.data ?? [];
  const lines = lines2bQuery.data ?? [];
  const has2B = lines.length > 0;

  const totalInBooks = purchaseRows.reduce((s, e) => s + e.itcEligiblePaise, 0);
  const confirmedIn2B = lines
    .filter((l) => l.reconStatus === 'matched')
    .reduce((s, l) => s + l.itcEligiblePaise, 0);
  const missingCredit = lines
    .filter((l) => l.reconStatus === 'missing_in_books')
    .reduce((s, l) => s + l.itcEligiblePaise, 0);
  const missingInBooks = lines.filter((l) => l.reconStatus === 'missing_in_books');

  // Turns a 2B line the books are missing into a proposal for the review queue.
  // It never posts directly: a human still approves it (Invariant 4).
  const createEntryMutation = useMutation({
    mutationFn: (lineId: string) =>
      api.post<{ _id: string }>(`/gst/recon-lines/${lineId}/create-entry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gst'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const handleCreateEntry = (lineId: string, supplierName: string | null) => {
    createEntryMutation.mutate(lineId, {
      onSuccess: () =>
        showToast(`Entry created for ${supplierName ?? 'supplier'} — review in queue.`),
      onError: () => showToast('Could not create the entry — try again.'),
    });
  };

  return (
    <div className="space-y-6">
      {/* Hidden picker driving both "Import GSTR-2B" buttons */}
      <input
        ref={file2bInputRef}
        type="file"
        accept=".json,.xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) import2bMutation.mutate(file);
          e.target.value = '';
        }}
      />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-h1 font-display text-ink-900"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            GST
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Registers, reconciliation, and input tax credit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border border-line-200 bg-surface-card px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {['2025-01', '2025-02', '2025-03', ...PERIOD_OPTIONS].map((p) => (
              <option key={p} value={p}>
                {new Date(`${p}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => showToast('Export GSTR-ready — coming soon')}
            className="flex items-center gap-2"
          >
            <FileText size={14} />
            Export GSTR-ready
          </Button>
        </div>
      </div>

      {/* ITC alert banner */}
      {missingCredit > 0 && (
        <div className="rounded-lg border border-pending-fg/40 bg-pending-bg px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-pending-fg shrink-0" />
          <p className="text-body font-medium text-ink-900">
            You may be missing{' '}
            <span className="font-mono font-bold">{formatRupees(missingCredit)}</span> of input
            credit.{' '}
            <span className="font-normal text-ink-600">
              {missingInBooks.length}{' '}
              {missingInBooks.length === 1 ? 'invoice is' : 'invoices are'} in your 2B but not in
              your books.
            </span>
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="border-b border-line-200">
        <nav className="flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-body font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-ink-500 hover:text-ink-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Purchase register ── */}
      {tab === 'purchase' && (
        <div>
          {purchaseQuery.isLoading ? (
            <TableSkeleton cols={10} />
          ) : purchaseQuery.isError ? (
            <p className="text-body text-error-fg py-8 text-center">
              Failed to load purchase register.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-200">
                  {['Supplier', 'GSTIN', 'Invoice no.', 'Date', 'Taxable', 'CGST', 'SGST', 'IGST', 'ITC eligible', 'Type'].map(
                    (h) => (
                      <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {purchaseRows.map((e) => (
                  <tr key={e.id} className="border-b border-line-100 hover:bg-surface-sink/50">
                    <td className="py-3 pr-4 text-body text-ink-900 font-medium">{e.vendorName}</td>
                    <td className="py-3 pr-4 font-mono text-caption text-ink-500">{e.supplierGstin ?? '—'}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-900">{e.invoiceNumber ?? '—'}</td>
                    <td className="py-3 pr-4 text-body text-ink-600">{fmtDate(e.invoiceDate)}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-900">{formatRupees(e.taxableValuePaise)}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-600">{e.cgstPaise > 0 ? formatRupees(e.cgstPaise) : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-600">{e.sgstPaise > 0 ? formatRupees(e.sgstPaise) : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-600">{e.igstPaise > 0 ? formatRupees(e.igstPaise) : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-body font-semibold text-success-fg">
                      {formatRupees(e.itcEligiblePaise)}
                    </td>
                    <td className="py-3">
                      <span className="text-caption px-2 py-0.5 rounded-full border bg-surface-sink text-ink-500 border-line-200">
                        {e.isInterState ? 'Inter-state' : 'Intra-state'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-200">
                  <td colSpan={4} className="py-3 text-body font-semibold text-ink-900">Total</td>
                  <td className="py-3 font-mono font-bold text-ink-900">
                    {formatRupees(purchaseRows.reduce((s, e) => s + e.taxableValuePaise, 0))}
                  </td>
                  <td colSpan={3} />
                  <td className="py-3 font-mono font-bold text-success-fg">
                    {formatRupees(totalInBooks)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Sales register ── */}
      {tab === 'sales' && (
        <div>
          {salesQuery.isLoading ? (
            <TableSkeleton cols={8} />
          ) : salesQuery.isError ? (
            <p className="text-body text-error-fg py-8 text-center">
              Failed to load sales register.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-200">
                  {['Customer', 'Invoice no.', 'Date', 'Taxable', 'CGST', 'SGST', 'IGST', 'Type'].map((h) => (
                    <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {salesRows.map((e) => (
                  <tr key={e.id} className="border-b border-line-100 hover:bg-surface-sink/50">
                    <td className="py-3 pr-4 text-body text-ink-900 font-medium">{e.customerName}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-900">{e.invoiceNumber ?? '—'}</td>
                    <td className="py-3 pr-4 text-body text-ink-600">{fmtDate(e.invoiceDate)}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-900">{formatRupees(e.taxableValuePaise)}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-600">{e.cgstPaise > 0 ? formatRupees(e.cgstPaise) : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-600">{e.sgstPaise > 0 ? formatRupees(e.sgstPaise) : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-body text-ink-600">{e.igstPaise > 0 ? formatRupees(e.igstPaise) : '—'}</td>
                    <td className="py-3">
                      <span className="text-caption px-2 py-0.5 rounded-full border bg-surface-sink text-ink-500 border-line-200">
                        {e.isInterState ? 'Inter-state' : 'Intra-state'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── 2A/2B Reconciliation ── */}
      {tab === 'recon' && (
        <div className="space-y-4">
          {lines2bQuery.isLoading ? (
            <TableSkeleton cols={8} />
          ) : !has2B ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="w-16 h-16 rounded-full bg-surface-sink flex items-center justify-center mb-6 border border-line-200">
                <Upload size={28} className="text-ink-400" />
              </div>
              <h2
                className="text-h2 font-display text-ink-900 mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Import GSTR-2B.
              </h2>
              <p className="text-body text-ink-500 mb-6">
                Download your 2B from the GSTN portal and upload it here.
              </p>
              <Button
                onClick={() => file2bInputRef.current?.click()}
                disabled={import2bMutation.isPending}
                className="flex items-center gap-2"
              >
                <Upload size={14} />
                {import2bMutation.isPending ? 'Importing…' : 'Import GSTR-2B'}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => reconcileMutation.mutate()}
                  disabled={reconcileMutation.isPending}
                  className="flex items-center gap-2"
                >
                  {reconcileMutation.isPending ? 'Running…' : 'Run reconciliation'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => file2bInputRef.current?.click()}
                  disabled={import2bMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <Upload size={14} />
                  {import2bMutation.isPending ? 'Importing…' : 'Import GSTR-2B'}
                </Button>
              </div>

              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line-200">
                    {['Supplier', 'GSTIN', 'Invoice no.', 'Date', 'Taxable', 'ITC (2B)', 'Status', ''].map((h) => (
                      <th key={h} className="pb-2 pr-4 text-caption font-semibold text-ink-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={line.id}
                      className={`border-b border-line-100 hover:bg-surface-sink/50 ${
                        line.reconStatus === 'missing_in_books' ? 'bg-pending-bg/30' : ''
                      } ${line.reconStatus === 'mismatched' ? 'bg-error-bg/30' : ''}`}
                    >
                      <td className="py-3 pr-4 text-body text-ink-900 font-medium">
                        {line.supplierName ?? '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-caption text-ink-500">
                        {line.supplierGstin ?? '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-body text-ink-900">
                        {line.invoiceNumber ?? '—'}
                      </td>
                      <td className="py-3 pr-4 text-body text-ink-600">{fmtDate(line.invoiceDate)}</td>
                      <td className="py-3 pr-4 font-mono text-body text-ink-900">
                        {formatRupees(line.taxableValuePaise)}
                      </td>
                      <td className="py-3 pr-4 font-mono font-semibold text-body text-ink-900">
                        {formatRupees(line.itcEligiblePaise)}
                      </td>
                      <td className="py-3 pr-4">
                        <ReconChip status={line.reconStatus} />
                      </td>
                      <td className="py-3">
                        {line.reconStatus === 'missing_in_books' && (
                          <Button
                            size="sm"
                            onClick={() => handleCreateEntry(line.id, line.supplierName)}
                            className="flex items-center gap-1 text-caption"
                          >
                            <Plus size={12} />
                            Create entry
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── Summary ── */}
      {tab === 'summary' && (
        <div className="grid grid-cols-2 gap-4">
          {/* ITC summary card */}
          <div className="rounded-lg border border-line-200 bg-surface-card p-5 space-y-4">
            <h2
              className="text-body font-semibold text-ink-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Input tax credit
            </h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-body text-ink-600">Total ITC in books</dt>
                <dd className="font-mono font-semibold text-ink-900">{formatRupees(totalInBooks)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-body text-ink-600">Confirmed in 2B</dt>
                <dd className="font-mono font-semibold text-success-fg">{formatRupees(confirmedIn2B)}</dd>
              </div>
              {missingCredit > 0 && (
                <div className="flex justify-between border-t border-line-200 pt-3">
                  <dt className="text-body font-medium text-pending-fg">Missing credit</dt>
                  <dd className="font-mono font-bold text-pending-fg">{formatRupees(missingCredit)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Recon buckets card */}
          <div className="rounded-lg border border-line-200 bg-surface-card p-5 space-y-4">
            <h2
              className="text-body font-semibold text-ink-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              2B reconciliation
            </h2>
            <dl className="space-y-3">
              {[
                { label: 'Matched', count: lines.filter((l) => l.reconStatus === 'matched').length, color: 'text-success-fg' },
                { label: 'Missing in books', count: lines.filter((l) => l.reconStatus === 'missing_in_books').length, color: 'text-pending-fg' },
                { label: 'Missing in 2B', count: purchaseRows.length - lines.filter((l) => l.reconStatus === 'matched').length, color: 'text-pending-fg' },
                { label: 'Mismatched', count: lines.filter((l) => l.reconStatus === 'mismatched').length, color: 'text-error-fg' },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-body text-ink-600">{label}</dt>
                  <dd className={`font-mono font-semibold ${color}`}>{count}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Output tax card */}
          <div className="rounded-lg border border-line-200 bg-surface-card p-5 space-y-4">
            <h2 className="text-body font-semibold text-ink-900">Output tax liability</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-body text-ink-600">Total sales (taxable)</dt>
                <dd className="font-mono font-semibold text-ink-900">
                  {formatRupees(salesRows.reduce((s, e) => s + e.taxableValuePaise, 0))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-body text-ink-600">Total output GST</dt>
                <dd className="font-mono font-semibold text-ink-900">
                  {formatRupees(
                    salesRows.reduce(
                      (s, e) => s + e.cgstPaise + e.sgstPaise + e.igstPaise,
                      0,
                    ),
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Net GST payable */}
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-5 space-y-4">
            <h2 className="text-body font-semibold text-ink-900">Net GST payable</h2>
            <div className="flex items-end justify-between">
              <p className="text-caption text-ink-500">Output GST − ITC claimed</p>
              <p className="text-h1 font-mono font-bold text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
                {formatRupees(
                  salesRows.reduce(
                    (s, e) => s + e.cgstPaise + e.sgstPaise + e.igstPaise,
                    0,
                  ) - confirmedIn2B,
                )}
              </p>
            </div>
          </div>
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
