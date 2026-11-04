'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ReviewQueueItem, ProposedEntryData } from '@/components/review/review-queue-item';
import { JournalLineDraft, PostingAccount } from '@/components/review/journal-lines-editor';
import { api, ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/query-error';
import { CheckCircle, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';

// ── API response type ─────────────────────────────────────────────────────────

interface ApiProposal {
  _id: string;
  documentType?: string;
  vendorName?: string | null;
  narration?: string | null;
  adjustment?: { kind: string; period: string | null; reason: string; reverseOn?: string | null } | null;
  vendorGstin?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  paymentTerms?: string | null;
  documentId?: string | null;
  suggestedLines?: Array<{
    accountId: string;
    accountName: string;
    debitPaise: number;
    creditPaise: number;
  }>;
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
  category?: ProposedEntryData['category'];
  checks?: ProposedEntryData['checks'];
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
    dueDate: p.dueDate ?? null,
    paymentTerms: p.paymentTerms ?? null,
    confidenceOverall: p.confidenceOverall ?? p.confidence ?? 0,
    fieldConfidence: p.fieldConfidence,
    rawWarnings: p.rawWarnings ?? p.warnings ?? [],
    amountsPaise: amounts,
    documentUrl: p.documentUrl,
    category: p.category ?? null,
    checks: p.checks ?? [],
    narration: p.narration ?? null,
    adjustment: p.adjustment ?? null,
    suggestedLines: (p.suggestedLines ?? []).map((l) => ({
      accountId: String(l.accountId),
      accountName: l.accountName,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
    })),
  };
}

/** The server's own sentence when there is one, else a fallback. */
function failureMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
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
  const apiDocumentIds = new Map(
    (Array.isArray(apiResponse) ? apiResponse : apiResponse && 'data' in apiResponse ? apiResponse.data : [])
      .filter((p) => p.documentId)
      .map((p) => [p._id, String(p.documentId)]),
  );

  // Accounts a reviewer can move a line to — posting accounts only, not groups.
  const { data: accountsResponse } = useQuery({
    queryKey: ['gl', 'accounts'],
    queryFn: () => api.get<Array<PostingAccount & { isGroup?: boolean; isActive?: boolean }>>('/gl/accounts'),
  });
  // Deactivated accounts are closed to new postings, so they are not offered.
  const postingAccounts = (accountsResponse ?? []).filter((a) => !a.isGroup && a.isActive !== false);

  // ── Approve mutation ────────────────────────────────────────────────────
  const approveMutation = useMutation({
    // An empty body accepts the AI-suggested lines as they stand. Sending
    // `lines: []` would instead post a journal with no lines at all.
    mutationFn: ({ id, lines }: { id: string; lines?: JournalLineDraft[] }) =>
      api.post(`/proposals/${id}/approve`, lines ? { lines } : {}),
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

  const handleApprove = async (id: string, lines?: JournalLineDraft[]) => {
    try {
      await approveMutation.mutateAsync({ id, lines });
      removeEntry(id);
      showToast('Posted to ledger');
    } catch (err) {
      showToast(failureMessage(err, "Couldn't post — try again."), 'error');
      throw new Error('approve failed'); // re-throw so ReviewQueueItem resets its state
    }
  };

  const handleReject = async (id: string) => {
    // Wait for the server before dropping the card: it used to vanish with a
    // "Rejected" toast even when the request failed.
    try {
      await rejectMutation.mutateAsync(id);
      removeEntry(id);
      showToast('Rejected and kept for audit');
    } catch (err) {
      showToast(failureMessage(err, "Couldn't reject — try again."), 'error');
    }
  };

  const handleApproveHighConfidence = async () => {
    // A flagged entry (likely duplicate, GST likely blocked…) is never approved
    // in bulk, however confident the extraction was: a person looks at it.
    const confident = allEntries.filter((e) => e.confidenceOverall >= 0.9);
    const highConf = confident.filter((e) => !(e.checks ?? []).length);
    const flagged = confident.length - highConf.length;
    if (!highConf.length) {
      showToast(flagged ? `${flagged} confident ${flagged === 1 ? 'entry needs' : 'entries need'} a look first, so none were approved` : 'No high-confidence entries to approve');
      return;
    }
    for (const e of highConf) {
      await handleApprove(e.id).catch(() => null);
    }
    if (flagged) showToast(`Left ${flagged} flagged ${flagged === 1 ? 'entry' : 'entries'} for you to check`);
  };

  const current = allEntries[currentIndex];
  const total = allEntries.length;

  // The source file beside the extracted fields. Proposals carry the upload's
  // id, not a link, so the preview pane was always the placeholder.
  const currentDocumentId = current ? apiDocumentIds.get(current.id) : undefined;
  const { data: documentLink } = useQuery({
    queryKey: ['documents', currentDocumentId, 'url'],
    queryFn: () => api.get<{ url: string }>(`/documents/${currentDocumentId}/url`),
    enabled: !!currentDocumentId,
    staleTime: 5 * 60 * 1000,
  });

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
          entry={{ ...current, documentUrl: current.documentUrl ?? documentLink?.url }}
          accounts={postingAccounts}
          onApprove={handleApprove}
          onReject={handleReject}
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
              <p className="font-medium truncate">{e.adjustment ? e.narration : e.vendorName ?? 'Unknown vendor'}</p>
              <p className="text-ink-400 truncate">{e.adjustment ? 'Month-end' : e.invoiceNumber ?? '—'}</p>
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
