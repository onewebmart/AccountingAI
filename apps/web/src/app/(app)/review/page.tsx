'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ReviewQueueItem, ProposedEntryData } from '@/components/review/review-queue-item';
import { api } from '@/lib/api';
import { QueryError } from '@/components/ui/query-error';
import { CheckCircle, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';

// ── API response type ─────────────────────────────────────────────────────────

interface ApiProposal {
  _id: string;
  documentType?: string;
  vendorName?: string | null;
  vendorGstin?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  confidenceOverall?: number;
  confidence?: number;
  fieldConfidence?: {
    vendor: number;
    invoiceNumber: number;
    invoiceDate: number;
    amounts: number;
  };
  rawWarnings?: string[];
  warnings?: string[];
  amountsPaise?: {
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    total: number;
  };
  extractedData?: {
    taxableValue?: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    cess?: number;
    totalAmountPaise?: number;
  };
  documentUrl?: string;
  status?: string;
}

function mapApiProposal(p: ApiProposal): ProposedEntryData {
  const amounts = p.amountsPaise ?? {
    taxableValue: p.extractedData?.taxableValue ?? 0,
    cgst: p.extractedData?.cgst ?? 0,
    sgst: p.extractedData?.sgst ?? 0,
    igst: p.extractedData?.igst ?? 0,
    cess: p.extractedData?.cess ?? 0,
    total: p.extractedData?.totalAmountPaise ?? 0,
  };

  return {
    id: p._id,
    documentType: p.documentType ?? 'purchase_invoice',
    vendorName: p.vendorName ?? null,
    vendorGstin: p.vendorGstin ?? null,
    invoiceNumber: p.invoiceNumber ?? null,
    invoiceDate: p.invoiceDate ?? null,
    confidenceOverall: p.confidenceOverall ?? p.confidence ?? 0,
    fieldConfidence: p.fieldConfidence,
    rawWarnings: p.rawWarnings ?? p.warnings ?? [],
    amountsPaise: amounts,
    documentUrl: p.documentUrl,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReviewQueuePage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // Track locally removed IDs so UI is instant even before refetch
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  // ── Fetch proposals ─────────────────────────────────────────────────────
  const {
    data: apiResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['proposals', 'proposed'],
    queryFn: () =>
      api.get<ApiProposal[] | { data: ApiProposal[] }>('/proposals?status=proposed'),
  });

  const apiProposals: ProposedEntryData[] = (() => {
    if (!apiResponse) return [];
    const raw = Array.isArray(apiResponse)
      ? apiResponse
      : 'data' in apiResponse && Array.isArray(apiResponse.data)
        ? apiResponse.data
        : [];
    return raw.map(mapApiProposal);
  })();

  const allEntries = apiProposals.filter((e) => !removedIds.has(e.id));

  // ── Approve mutation ────────────────────────────────────────────────────
  const approveMutation = useMutation({
    // An empty body accepts the AI-suggested lines as they stand. Sending
    // `lines: []` would instead post a journal with no lines at all.
    mutationFn: (id: string) => api.post(`/proposals/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      // The posting also creates a voucher, a bill/invoice and ledger movement.
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['journals'] });
    },
  });

  // ── Reject mutation ─────────────────────────────────────────────────────
  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/proposals/${id}/reject`, { reason: 'rejected by user' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const removeEntry = (id: string) => {
    setRemovedIds((prev) => new Set([...prev, id]));
    setCurrentIndex((idx) => {
      const nextEntries = allEntries.filter((e) => e.id !== id);
      if (idx >= nextEntries.length && nextEntries.length > 0) {
        return nextEntries.length - 1;
      }
      return idx;
    });
  };

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync(id);
      removeEntry(id);
      showToast('Posted to ledger');
    } catch {
      showToast('Failed to post. Try again.', 'error');
      throw new Error('approve failed'); // re-throw so ReviewQueueItem resets its state
    }
  };

  const handleReject = (id: string) => {
    rejectMutation.mutate(id, {
      onError: () => showToast('Failed to reject. Try again.', 'error'),
    });
    removeEntry(id);
    showToast('Rejected and kept for audit');
  };

  const handleEdit = (id: string) => {
    // Edit sheet/modal — Phase 9
    console.log('edit', id);
  };

  const handleApproveHighConfidence = async () => {
    const highConf = allEntries.filter((e) => e.confidenceOverall >= 0.9);
    if (!highConf.length) {
      showToast('No high-confidence entries to approve');
      return;
    }
    for (const e of highConf) {
      await handleApprove(e.id).catch(() => null);
    }
  };

  const current = allEntries[currentIndex];
  const total = allEntries.length;

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-ink-400">
        <Loader2 size={24} className="animate-spin mr-2" />
        <span className="text-body">Loading proposals…</span>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (isError) {
    return <QueryError error={error} onRetry={() => void refetch()} />;
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (!allEntries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-16 h-16 rounded-full bg-success-bg flex items-center justify-center mb-6">
          <CheckCircle size={32} className="text-success-fg" />
        </div>
        <h2 className="text-h2 font-display text-ink-900 mb-2">
          All caught up.
        </h2>
        <p className="text-body text-ink-500">Nothing to review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900">
            Review &amp; post
          </h1>
          <p className="text-body text-ink-500 mt-1">
            I&apos;ve pulled the details. Confirm or fix, then post.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={handleApproveHighConfidence}
          className="flex items-center gap-2 shrink-0"
        >
          <Sparkles size={14} className="text-marigold-400" />
          Approve all high-confidence
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between text-caption text-ink-500">
        <div className="flex items-center gap-1">
          <span className="font-mono text-ink-700 font-medium">{currentIndex + 1}</span>
          <span>of</span>
          <span className="font-mono text-ink-700 font-medium">{total}</span>
          <span>to review</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            className="p-1.5 rounded hover:bg-surface-sink disabled:opacity-30 transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={currentIndex === total - 1}
            className="p-1.5 rounded hover:bg-surface-sink disabled:opacity-30 transition-colors"
            aria-label="Next"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            className="text-ink-400 hover:text-ink-700 transition-colors px-2 py-1 text-caption"
          >
            Skip for now
          </button>
        </div>
      </div>

      {/* The review card */}
      {current && (
        <ReviewQueueItem
          key={current.id}
          entry={current}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
        />
      )}

      {/* Queue list (thumbnails) */}
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {allEntries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setCurrentIndex(i)}
              className={`shrink-0 rounded-md border-2 px-3 py-2 text-caption text-left transition-colors min-w-[140px] ${
                i === currentIndex
                  ? 'border-saffron-600 bg-honey-50 text-ink-900'
                  : 'border-line-200 bg-surface-card text-ink-500 hover:border-ink-400'
              }`}
            >
              <p className="font-medium truncate">{e.vendorName ?? 'Unknown vendor'}</p>
              <p className="text-ink-400 truncate">{e.invoiceNumber ?? '—'}</p>
              {e.confidenceOverall < 0.8 && (
                <p className="text-pending-fg mt-0.5">⬤ Needs attention</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-md px-4 py-3 text-body font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-success-bg border border-success-fg text-success-fg'
              : 'bg-error-bg border border-error-fg text-error-fg'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
