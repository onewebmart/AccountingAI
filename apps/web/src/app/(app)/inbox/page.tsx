'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, Info, Loader2, Mail, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { SentInPanel, formatPhone } from '@/components/inbox/sent-in-panel';
import { ModuleGuide } from '@/components/guide/module-guide';
import { AddToMenu } from '@/components/documents/add-to-menu';
import { EnteredAsLink, canAddTo, type EnteredAs } from '@/components/documents/document-entry';
import { cx, usePipeline, useUploads } from '@/components/documents/library';
import { DropArea, UploadList } from '@/components/documents/upload-parts';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocStatus = 'reading' | 'ready' | 'imported' | 'posted' | 'entered' | 'rejected' | 'duplicate' | 'failed';
type DocType = 'purchase_invoice' | 'sales_invoice' | 'bank_statement' | 'receipt' | 'unknown';

interface InboxDoc {
  id: string;
  fileName: string;
  type: DocType;
  uploadedAt: string;
  vendor: string | null;
  amountPaise: number | null;
  confidence: number | null;
  /** Which OCR tier read the file: 0 native text … 3 vision model. */
  ocrTier: number | null;
  status: DocStatus;
  duplicateOf?: string;
  /** Why the pipeline gave up, when it did. */
  failureReason?: string;
  /** Sent in by email or WhatsApp rather than uploaded, and by whom. */
  source?: { channel: 'upload' | 'email' | 'whatsapp'; from: string | null };
  /** Read and not yet entered: "Add to" opens a form filled from it. */
  addTo?: boolean;
  /** Entered by hand from "Add to" as this record. */
  enteredAs?: EnteredAs | null;
}

/** GET /documents, one upload. Server-side pipeline state: see DocumentStatus in @ai-accounting/shared. */
interface ApiDocument {
  _id: string;
  originalName: string;
  documentType?: DocType;
  status: 'UPLOADED' | 'CLASSIFYING' | 'EXTRACTING' | 'EXTRACTED' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DUPLICATE' | 'FAILED';
  vendor?: string | null;
  totalAmountPaise?: number | null;
  confidence?: number | null;
  ocrTier?: number | null;
  uploadedAt: string;
  duplicateOf?: string;
  duplicateOfName?: string;
  failureReason?: string;
  source?: { channel: 'upload' | 'email' | 'whatsapp'; from: string | null };
  enteredAs?: EnteredAs | null;
  /** 'bank_statement': its lines went to Banking, not Review. */
  importKind?: string | null;
}

interface InboxAddress {
  address: string | null;
  configured: boolean;
}

function mapApiStatus(s: ApiDocument['status']): DocStatus {
  if (s === 'EXTRACTED' || s === 'PROPOSED') return 'ready';
  if (s === 'APPROVED') return 'posted';
  if (s === 'DUPLICATE') return 'duplicate';
  // Turned down in Review: not a failed read, and not one to read again.
  if (s === 'REJECTED') return 'rejected';
  if (s === 'FAILED') return 'failed';
  return 'reading';
}

function mapApiDoc(doc: ApiDocument): InboxDoc {
  // A statement read into Banking: its lines wait there to be matched, not in Review, and it is not entered with Add to.
  const statement = doc.importKind === 'bank_statement' && (doc.status === 'PROPOSED' || doc.status === 'EXTRACTED');
  return {
    id: doc._id,
    fileName: doc.originalName,
    type: statement || doc.importKind === 'bank_statement' ? 'bank_statement' : doc.documentType ?? 'unknown',
    uploadedAt: doc.uploadedAt,
    vendor: doc.vendor ?? null,
    amountPaise: doc.totalAmountPaise ?? null,
    confidence: doc.confidence ?? null,
    ocrTier: doc.ocrTier ?? null,
    // Entered by hand: its AI proposal was closed, so it reads as entered, not as failed.
    status: doc.enteredAs ? 'entered' : statement ? 'imported' : mapApiStatus(doc.status),
    duplicateOf: doc.duplicateOfName ?? doc.duplicateOf,
    failureReason: doc.failureReason,
    source: doc.source,
    addTo: !statement && canAddTo(doc.status, doc.enteredAs),
    enteredAs: doc.enteredAs ?? null,
  };
}

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

const chip = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium';
function StatusChip({ status }: { status: DocStatus }) {
  if (status === 'reading') return <span className={cx(chip, 'border-pending-fg/30 bg-pending-bg text-pending-fg')}><Loader2 size={11} className="animate-spin" /> Reading…</span>;
  if (status === 'ready') return <span className={cx(chip, 'border-pending-fg/30 bg-pending-bg text-pending-fg')}><span className="h-1.5 w-1.5 rounded-full bg-pending-fg" /> Ready to review</span>;
  if (status === 'imported') return <span className={cx(chip, 'border-pending-fg/30 bg-pending-bg text-pending-fg')}>Imported</span>;
  if (status === 'posted') return <span className={cx(chip, 'border-success-fg/30 bg-success-bg text-success-fg')}><CheckCircle2 size={11} /> Posted</span>;
  if (status === 'entered') return <span className={cx(chip, 'border-success-fg/30 bg-success-bg text-success-fg')}><CheckCircle2 size={11} /> Entered</span>;
  if (status === 'rejected') return <span className={cx(chip, 'border-line-200 bg-surface-sink text-ink-600')}>Rejected</span>;
  if (status === 'duplicate') return <span className={cx(chip, 'border-error-fg/30 bg-error-bg text-error-fg')}><Copy size={11} /> Duplicate?</span>;
  return <span className={cx(chip, 'border-error-fg/30 bg-error-bg text-error-fg')}><AlertCircle size={11} /> Couldn&apos;t read</span>;
}

/**
 * Which tier read this file, and what that cost: tier 0 reads text straight
 * out of the file for nothing, tier 3 posts the page to a vision model.
 */
function OcrTierChip({ tier }: { tier: number | null }) {
  if (tier == null) return null;
  const meta: Record<number, { label: string; title: string; className: string }> = {
    0: { label: 'T0', title: 'Read straight from the file — no OCR, no cost', className: 'bg-surface-sink text-ink-500' },
    1: { label: 'T1', title: 'PDF text layer — cheapest OCR tier', className: 'bg-surface-sink text-ink-500' },
    2: { label: 'T2', title: 'Image or scanned PDF — vision OCR', className: 'bg-honey-100 text-pending-fg' },
    3: { label: 'T3', title: 'Escalated to the vision model — most expensive tier', className: 'bg-honey-100 text-pending-fg' },
  };
  const m = meta[tier];
  if (!m) return null;
  return <span title={m.title} className={`rounded px-1 py-0.5 font-mono text-[10px] font-medium ${m.className}`}>{m.label}</span>;
}

function ConfidenceDot({ value }: { value: number }) {
  const color = value >= 0.85 ? 'text-success-fg' : value >= 0.7 ? 'text-pending-fg' : 'text-error-fg';
  return <span className={`font-mono text-caption ${color}`}>{Math.round(value * 100)}%</span>;
}

/** "Send your documents to <address>", with Copy. */
function SendToFooter({ onSetUp, open }: { onSetUp: () => void; open: boolean }) {
  const [copied, setCopied] = useState(false);
  const address = useQuery({ queryKey: ['inbox', 'address'], queryFn: () => api.get<InboxAddress>('/inbox/address') });
  const a = address.data;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address is on screen to select by hand.
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line-200 bg-surface-sink px-4 py-3">
      <Mail size={15} className="shrink-0 text-ink-400" aria-hidden />
      {address.isLoading ? (
        <span className="text-caption text-ink-400">Loading your inbox address…</span>
      ) : a?.configured && a.address ? (
        <>
          <span className="text-body text-ink-700">Send your documents to</span>
          <code className="break-all rounded-md bg-surface-card px-2 py-1 font-mono text-caption text-ink-900">{a.address}</code>
          <Button variant="secondary" size="sm" onClick={() => void copy(a.address!)}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy address'}
          </Button>
        </>
      ) : (
        <span className="text-caption text-ink-500">Email-in is not set up on this server yet. Upload files here, or link a phone to send them on WhatsApp.</span>
      )}
      <button type="button" className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline" onClick={onSetUp} aria-expanded={open}>
        Email and WhatsApp set-up <ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type FilterStatus = 'all' | DocStatus;
const FILTER_OPTS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'reading', label: 'Reading…' },
  { value: 'ready', label: 'Ready to review' },
  { value: 'failed', label: "Couldn't read" },
  { value: 'duplicate', label: 'Duplicate?' },
  { value: 'posted', label: 'Posted' },
  { value: 'entered', label: 'Entered' },
];

/** The Files inbox: drop documents in, follow each as it is read, and send them in by email or WhatsApp. */
export default function InboxPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [setUpOpen, setSetUpOpen] = useState(false);
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const pipeline = usePipeline();

  // A link may open a filter: /inbox?show=failed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const show = params.get('show') as FilterStatus | null;
    if (show && FILTER_OPTS.some((o) => o.value === show)) setFilter(show);
    if (params.get('setup')) setSetUpOpen(true);
  }, []);

  const { data: apiResponse, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.get<ApiDocument[] | { data: ApiDocument[] }>('/documents'),
    // Reading runs in a background worker: poll while anything is still being read.
    refetchInterval: (query) => {
      const res = query.state.data;
      const raw = Array.isArray(res) ? res : res?.data ?? [];
      return raw.some((d) => ['UPLOADED', 'CLASSIFYING', 'EXTRACTING'].includes(d.status)) ? 3000 : false;
    },
  });
  const raw = !apiResponse ? [] : Array.isArray(apiResponse) ? apiResponse : apiResponse.data ?? [];
  const docs = raw.map(mapApiDoc).filter((d) => !dismissedIds.has(d.id));

  /**
   * A failed document is often only transiently failed: a model outage that
   * outlasted the three automatic attempts, or credit since topped up. Trying
   * again re-reads the file already stored, so nobody uploads it twice.
   */
  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/documents/${id}/retry`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });

  const filtered = docs.filter((d) => filter === 'all' || d.status === filter);
  const readyCount = docs.filter((d) => d.status === 'ready').length;
  const failed = pipeline.data?.couldNotRead;

  return (
    <div className="space-y-5">
      <PageHeader
        guide="inbox"
        title="Files"
        subtitle="Your documents inbox. Bills, invoices, receipts and bank statements come in here, are read in the background, and wait for you."
        actions={
          readyCount > 0 ? (
            <Button asChild>
              <Link href="/review">
                Review {readyCount} document{readyCount !== 1 ? 's' : ''} <ChevronRight size={15} />
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* The AI could not read some uploads: say so plainly, with why, and what to do. */}
      {failed && failed.count > 0 && (
        <section role="alert" className="rounded-xl border border-error-fg/40 bg-error-bg px-4 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-error-fg" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-error-fg">
                <span className="font-mono tabular-nums">{failed.count}</span> {failed.count === 1 ? 'document' : 'documents'} couldn&apos;t be read
              </p>
              <ul className="mt-1 space-y-0.5 text-caption text-error-fg">
                {failed.reasons.map((r) => (
                  <li key={r.reason}>
                    {r.reason}
                    {failed.reasons.length > 1 && <span className="font-mono tabular-nums"> ({r.count})</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-caption text-ink-700">
                Nothing is lost: the files are kept. Click <span className="font-medium">Try again</span> once it is sorted, or open <span className="font-medium">Add to</span> and enter one yourself, with the file beside the form.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setFilter('failed')}>
              Show them
            </Button>
          </div>
        </section>
      )}

      <DropArea onFiles={uploads.add} hint="Up to 20 MB each: PDF, photos (JPG, PNG, WEBP, TIFF, HEIC), Excel or CSV, Word or text." />
      <UploadList items={uploads.items} onClear={uploads.clearFinished} />

      <div className="flex gap-2.5 rounded-xl border border-line-200 bg-surface-card px-4 py-3 text-caption text-ink-600">
        <Info size={15} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        <p>
          <span className="font-medium text-ink-900">How reading works.</span> Each file is read in the background: text straight from the file where it has some, OCR for scans and
          photos, then AI picks out the party, number, dates, amounts and lines. A bill or invoice then waits in <Link href="/review" className="font-medium text-brand-600 hover:underline">Review</Link>;
          a bank statement&apos;s lines go to <Link href="/documents/statements" className="font-medium text-brand-600 hover:underline">Bank Statements</Link> for reconciliation. Nothing posts until a person approves it.
        </p>
      </div>

      {isError && <QueryError error={error} onRetry={() => void refetch()} />}

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilter(opt.value)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-caption font-medium transition-colors',
              filter === opt.value ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600 hover:border-ink-400',
            )}
          >
            {opt.label}
            {opt.value === 'ready' && readyCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-marigold-400 px-1 text-[0.65rem] font-bold text-ink-900">{readyCount}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-body text-ink-400">
          <Loader2 size={20} className="mr-2 animate-spin" /> Loading documents…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-line-200 bg-surface-card py-14 text-center">
          <FileText size={32} className="mb-3 text-ink-300" />
          <p className="mb-1 font-display text-h3 text-ink-900">{docs.length ? 'Nothing here.' : 'Your inbox is clear.'}</p>
          <p className="text-body text-ink-500">{docs.length ? 'Pick another filter above.' : 'Drop a document above to begin.'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                {['File', 'Uploaded', 'Party and amount', 'Confidence', 'Status', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-caption font-medium text-ink-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <Fragment key={doc.id}>
                  <tr className={cx('border-b border-line-100 transition-colors last:border-0 hover:bg-honey-50', doc.status === 'duplicate' && 'bg-error-bg/10')}>
                    <td className="max-w-[230px] px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <FileText size={14} className="shrink-0 text-ink-400" />
                        <span className="truncate font-mono text-caption text-ink-900" title={doc.fileName}>{doc.fileName}</span>
                      </span>
                      <span className="mt-0.5 block truncate pl-[22px] text-[0.7rem] text-ink-500">
                        {TYPE_LABELS[doc.type] ?? TYPE_LABELS.unknown}
                        {doc.source && doc.source.channel !== 'upload' && (
                          <>
                            {' · via '}
                            {doc.source.channel === 'email' ? 'email' : 'WhatsApp'}
                            {doc.source.from && ` · ${doc.source.channel === 'whatsapp' ? formatPhone(doc.source.from) : doc.source.from}`}
                          </>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-caption text-ink-500">
                      {new Date(doc.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      <span className="block font-mono text-[0.7rem] tabular-nums text-ink-400">
                        {new Date(doc.uploadedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td className="max-w-[170px] px-3 py-2.5">
                      <span className="block truncate text-body text-ink-900">{doc.vendor ?? <span className="text-ink-300">—</span>}</span>
                      {/* An empty read reads ₹0: nothing was read, so nothing is shown. */}
                      {doc.amountPaise ? <span className="block font-mono text-caption tabular-nums text-ink-700">{fmt(doc.amountPaise)}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {doc.confidence != null ? <ConfidenceDot value={doc.confidence} /> : <span className="text-caption text-ink-300">—</span>}
                        <OcrTierChip tier={doc.ocrTier} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5"><StatusChip status={doc.status} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {doc.enteredAs && <EnteredAsLink enteredAs={doc.enteredAs} />}
                        {doc.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => retryMutation.mutate(doc.id)}
                            disabled={retryMutation.isPending}
                            className="inline-flex items-center gap-1 text-caption font-medium text-saffron-700 transition-colors hover:underline disabled:opacity-50"
                          >
                            <RefreshCw size={13} />
                            {retryMutation.isPending && retryMutation.variables === doc.id ? 'Retrying…' : 'Try again'}
                          </button>
                        )}
                        {doc.addTo && <AddToMenu documentId={doc.id} fileName={doc.fileName} />}
                        {doc.status === 'imported' && (
                          <Link href="/documents/statements" className="text-caption font-medium text-brand-600 hover:underline">Bank Statements</Link>
                        )}
                        {doc.status === 'ready' && (
                          <Button variant="secondary" size="sm" asChild>
                            <Link href="/review">Review <ChevronRight size={13} /></Link>
                          </Button>
                        )}
                        {doc.status === 'duplicate' && (
                          <button type="button" onClick={() => setDismissedIds((prev) => new Set([...prev, doc.id]))} className="inline-flex items-center gap-1 text-caption text-ink-400 transition-colors hover:text-error-fg">
                            <X size={13} /> Skip
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {doc.status === 'failed' && (
                    <tr className="border-b border-line-100 bg-error-bg/10">
                      <td colSpan={6} className="px-3 py-2">
                        <p className="text-caption text-error-fg">
                          {doc.failureReason ?? 'The pipeline could not finish this one. Try again, or re-scan the document more clearly.'}
                          {doc.addTo && ' You can also enter it yourself with Add to.'}
                        </p>
                      </td>
                    </tr>
                  )}
                  {doc.status === 'duplicate' && doc.duplicateOf && (
                    <tr className="border-b border-line-100 bg-error-bg/10">
                      <td colSpan={6} className="px-3 py-2">
                        <p className="text-caption text-error-fg">
                          Looks like a duplicate of <span className="font-mono font-medium">{doc.duplicateOf}</span>. Keep both, or skip?
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">
            <span className="font-mono tabular-nums">{filtered.length}</span> document{filtered.length !== 1 ? 's' : ''}. Every file, with what it became, is in{' '}
            <Link href="/documents" className="font-medium text-brand-600 hover:underline">All Documents</Link>.
          </div>
        </div>
      )}

      <SendToFooter open={setUpOpen} onSetUp={() => setSetUpOpen((v) => !v)} />
      {setUpOpen && <SentInPanel />}

      {/* Before the first document arrives, show how the inbox works. */}
      {!isLoading && !isError && docs.length === 0 && <ModuleGuide guide="inbox" />}
    </div>
  );
}
