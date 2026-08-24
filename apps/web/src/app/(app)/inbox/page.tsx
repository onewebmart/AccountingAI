'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ChevronRight,
  X, RefreshCw } from 'lucide-react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocStatus = 'reading' | 'ready' | 'posted' | 'duplicate' | 'failed';
type DocType = 'purchase_invoice' | 'sales_invoice' | 'bank_statement' | 'receipt' | 'unknown';

interface InboxDoc {
  id: string;
  fileName: string;
  type: DocType;
  uploadedAt: string;
  vendor: string | null;
  amountPaise: number | null;
  confidence: number | null;
  status: DocStatus;
  duplicateOf?: string;
  /** Why the pipeline gave up, when it did. */
  failureReason?: string;
}

// ── API response shape ────────────────────────────────────────────────────────

interface ApiDocument {
  _id: string;
  originalName: string;
  documentType?: DocType;
  /** Server-side pipeline state — see DocumentStatus in @ai-accounting/shared. */
  status:
    | 'UPLOADED'
    | 'CLASSIFYING'
    | 'EXTRACTING'
    | 'EXTRACTED'
    | 'PROPOSED'
    | 'APPROVED'
    | 'REJECTED'
    | 'DUPLICATE'
    | 'FAILED';
  vendor?: string | null;
  invoiceNumber?: string | null;
  totalAmountPaise?: number | null;
  confidence?: number | null;
  proposalId?: string | null;
  uploadedAt: string;
  duplicateOf?: string;
  duplicateOfName?: string;
  /** Why the pipeline gave up, when it did. */
  failureReason?: string;
}

// ── Status mapping ────────────────────────────────────────────────────────────

function mapApiStatus(apiStatus: ApiDocument['status']): DocStatus {
  switch (apiStatus) {
    case 'UPLOADED':
    case 'CLASSIFYING':
    case 'EXTRACTING':
      return 'reading';
    case 'EXTRACTED':
    case 'PROPOSED':
      return 'ready';
    case 'APPROVED':
      return 'posted';
    case 'DUPLICATE':
      return 'duplicate';
    case 'REJECTED':
    case 'FAILED':
      return 'failed';
    default:
      return 'reading';
  }
}

function mapApiDoc(doc: ApiDocument): InboxDoc {
  return {
    id: doc._id,
    fileName: doc.originalName,
    type: doc.documentType ?? 'unknown',
    uploadedAt: doc.uploadedAt,
    vendor: doc.vendor ?? null,
    amountPaise: doc.totalAmountPaise ?? null,
    confidence: doc.confidence ?? null,
    status: mapApiStatus(doc.status),
    duplicateOf: doc.duplicateOfName ?? doc.duplicateOf,
    failureReason: doc.failureReason,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<DocType, string> = {
  purchase_invoice: 'Purchase invoice',
  sales_invoice: 'Sales invoice',
  bank_statement: 'Bank statement',
  receipt: 'Receipt',
  unknown: 'Unknown',
};

function fmt(paise: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(paise / 100);
}

function StatusChip({ status, duplicateOf }: { status: DocStatus; duplicateOf?: string }) {
  if (status === 'reading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption font-medium text-pending-fg bg-pending-bg border border-pending-fg/30 rounded-full px-2.5 py-0.5">
        <Loader2 size={11} className="animate-spin" /> Reading…
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption font-medium text-pending-fg bg-pending-bg border border-pending-fg/30 rounded-full px-2.5 py-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-pending-fg" /> Ready to review
      </span>
    );
  }
  if (status === 'posted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption font-medium text-success-fg bg-success-bg border border-success-fg/30 rounded-full px-2.5 py-0.5">
        <CheckCircle2 size={11} /> Posted
      </span>
    );
  }
  if (status === 'duplicate') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption font-medium text-error-fg bg-error-bg border border-error-fg/30 rounded-full px-2.5 py-0.5">
        <Copy size={11} /> Duplicate?
      </span>
    );
  }
  // failed or unknown
  void duplicateOf;
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-medium text-error-fg bg-error-bg border border-error-fg/30 rounded-full px-2.5 py-0.5">
      <AlertCircle size={11} /> Couldn&apos;t read
    </span>
  );
}

function ConfidenceDot({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? 'text-success-fg' : value >= 0.7 ? 'text-pending-fg' : 'text-error-fg';
  return <span className={`font-mono text-caption ${color}`}>{pct}%</span>;
}

// ── Dropzone ──────────────────────────────────────────────────────────────────

function Dropzone({ onDrop }: { onDrop: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = (files: FileList | null) => {
    if (!files) return;
    onDrop(Array.from(files));
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors ${
        dragging
          ? 'border-marigold-400 bg-honey-100'
          : 'border-line-200 bg-surface-card hover:border-marigold-400 hover:bg-honey-50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />
      <Upload size={28} className={`mx-auto mb-3 ${dragging ? 'text-marigold-400' : 'text-ink-300'}`} />
      <p className="text-body font-medium text-ink-900 mb-1">
        Drop bank statements, bills, invoices, or receipts
      </p>
      <p className="text-caption text-ink-500">
        PDF, image, or Excel. We&apos;ll figure out what each one is.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type FilterStatus = 'all' | DocStatus;

export default function InboxPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [optimisticDocs, setOptimisticDocs] = useState<InboxDoc[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  // ── Fetch documents ──────────────────────────────────────────────────────
  const {
    data: apiResponse,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['documents'],
    queryFn: () =>
      api.get<ApiDocument[] | { data: ApiDocument[] }>('/documents'),
    // OCR and extraction run in a background worker, so poll while anything is
    // still being read and stop once the queue is clear.
    refetchInterval: (query) => {
      const res = query.state.data;
      const raw = Array.isArray(res)
        ? res
        : res && 'data' in res && Array.isArray(res.data)
          ? res.data
          : [];
      const stillReading = raw.some((d) =>
        ['UPLOADED', 'CLASSIFYING', 'EXTRACTING'].includes(d.status),
      );
      return stillReading ? 3000 : false;
    },
  });

  // Normalise API response (array or {data:[...]})
  const apiDocs: InboxDoc[] = (() => {
    if (!apiResponse) return [];
    const raw = Array.isArray(apiResponse)
      ? apiResponse
      : 'data' in apiResponse && Array.isArray(apiResponse.data)
        ? apiResponse.data
        : [];
    return raw.map(mapApiDoc);
  })();

  // Merge optimistic uploads at the front, exclude dismissed duplicates
  const docs = [
    ...optimisticDocs,
    ...apiDocs.filter((d) => !dismissedIds.has(d.id) && !optimisticDocs.find((o) => o.id === d.id)),
  ];

  // ── Upload mutation ───────────────────────────────────────────────────────
  /**
   * A failed document is often only transiently failed — a model blip that
   * outlasted the three automatic attempts. Retrying re-runs the pipeline on
   * the file already stored, so nobody has to upload it again and live with a
   * duplicate.
   */
  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/documents/${id}/retry`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<ApiDocument>('/documents/upload', form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const handleDrop = (files: File[]) => {
    // Add optimistic "reading" placeholders immediately
    const placeholders: InboxDoc[] = files.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      fileName: f.name,
      type: 'unknown',
      uploadedAt: new Date().toISOString(),
      vendor: null,
      amountPaise: null,
      confidence: null,
      status: 'reading',
    }));
    setOptimisticDocs((prev) => [...placeholders, ...prev]);

    // Upload each file; on completion remove placeholder and refresh
    files.forEach((file, i) => {
      uploadMutation.mutate(file, {
        onSettled: () => {
          setOptimisticDocs((prev) => prev.filter((d) => d.id !== placeholders[i].id));
        },
      });
    });
  };

  const dismissDuplicate = (id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  };

  const filtered = docs.filter((d) => filter === 'all' || d.status === filter);
  const readyCount = docs.filter((d) => d.status === 'ready').length;

  const FILTER_OPTS: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'reading', label: 'Reading…' },
    { value: 'ready', label: 'Ready to review' },
    { value: 'posted', label: 'Posted' },
    { value: 'duplicate', label: 'Duplicate?' },
    { value: 'failed', label: "Couldn't read" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          Inbox
        </h1>
        {readyCount > 0 && (
          <Button variant="primary" asChild>
            <Link href="/review">
              Review {readyCount} document{readyCount !== 1 ? 's' : ''} <ChevronRight size={15} />
            </Link>
          </Button>
        )}
      </div>

      {/* Dropzone */}
      <Dropzone onDrop={handleDrop} />

      {/* Error state */}
      {isError && (
        <p className="text-body text-error-fg text-center py-4">
          Couldn&apos;t load data. Try refreshing.
        </p>
      )}

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`rounded-full px-3 py-1.5 text-caption font-medium border transition-colors ${
              filter === opt.value
                ? 'bg-ink-900 text-white border-ink-900'
                : 'bg-surface-card text-ink-600 border-line-200 hover:border-ink-400'
            }`}
          >
            {opt.label}
            {opt.value === 'ready' && readyCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-marigold-400 px-1 text-[0.65rem] font-bold text-ink-900">
                {readyCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Document list */}
      {isLoading && optimisticDocs.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-ink-400 text-body">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading documents…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-line-200 bg-surface-card">
          <FileText size={36} className="text-ink-300 mb-4" />
          <p className="text-h3 font-display text-ink-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Your inbox is clear.
          </p>
          <p className="text-body text-ink-500">Drop a document above to begin.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-line-200 bg-surface-card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                {['File', 'Type', 'Uploaded', 'Vendor', 'Amount', 'Confidence', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-caption font-semibold text-ink-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <>
                  <tr
                    key={doc.id}
                    className={`border-b border-line-100 last:border-0 transition-colors hover:bg-honey-50 ${
                      doc.status === 'duplicate' ? 'bg-error-bg/10' : ''
                    } ${doc.status === 'failed' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 max-w-[180px]">
                      <span className="flex items-center gap-2">
                        <FileText size={14} className="text-ink-400 shrink-0" />
                        <span className="font-mono text-caption text-ink-900 truncate">{doc.fileName}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-caption text-ink-600 whitespace-nowrap">
                      {TYPE_LABELS[doc.type]}
                    </td>
                    <td className="px-4 py-3 text-caption text-ink-500 whitespace-nowrap">
                      {new Date(doc.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-body text-ink-900 max-w-[150px] truncate">
                      {doc.vendor ?? <span className="text-ink-300">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-body text-ink-900 whitespace-nowrap">
                      {doc.amountPaise != null ? fmt(doc.amountPaise) : <span className="text-ink-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {doc.confidence != null
                        ? <ConfidenceDot value={doc.confidence} />
                        : <span className="text-ink-300 text-caption">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusChip status={doc.status} duplicateOf={doc.duplicateOf} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {doc.status === 'ready' && (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href="/review">Review <ChevronRight size={13} /></Link>
                        </Button>
                      )}
                      {doc.status === 'duplicate' && (
                        <button
                          onClick={() => dismissDuplicate(doc.id)}
                          className="inline-flex items-center gap-1 text-caption text-ink-400 hover:text-error-fg transition-colors"
                        >
                          <X size={13} /> Skip
                        </button>
                      )}
                      {doc.status === 'failed' && (
                        <button
                          onClick={() => retryMutation.mutate(doc.id)}
                          disabled={retryMutation.isPending}
                          className="inline-flex items-center gap-1 text-caption text-saffron-700 transition-colors hover:underline disabled:opacity-50"
                        >
                          <RefreshCw size={13} />
                          {retryMutation.isPending ? 'Retrying…' : 'Try again'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {doc.status === 'failed' && (
                    <tr key={`${doc.id}-err`} className="border-b border-line-100 bg-error-bg/10">
                      <td colSpan={8} className="px-4 py-2">
                        <p className="text-caption text-error-fg">
                          {doc.failureReason
                            ? doc.failureReason
                            : 'The pipeline could not finish this one. Try again, or re-scan the document more clearly.'}
                        </p>
                      </td>
                    </tr>
                  )}
                  {doc.status === 'duplicate' && doc.duplicateOf && (
                    <tr key={`${doc.id}-dup`} className="border-b border-line-100 bg-error-bg/10">
                      <td colSpan={8} className="px-4 py-2">
                        <p className="text-caption text-error-fg">
                          Looks like a duplicate of{' '}
                          <span className="font-mono font-medium">{doc.duplicateOf}</span>.{' '}
                          Keep both, or skip?
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line-200 bg-surface-sink px-4 py-3">
            <span className="text-caption text-ink-500">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}
