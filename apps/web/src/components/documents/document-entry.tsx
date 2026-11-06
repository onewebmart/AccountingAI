'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, FileText, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/page/notifier';
import { api, ApiError } from '@/lib/api';

/**
 * "Add to": a form opened from a scanned document. The file shows on the
 * left, the page's own form on the right, filled from what AI read for a
 * person to check. The form saves a draft as it always does (nothing posts
 * by itself); once it is saved, the scan is kept against the new record and
 * its pending AI proposal is closed, so it can never be posted twice.
 */

/** GET /documents/:id/extraction. Money is integer paise. */
export interface DocumentExtraction {
  documentId: string;
  fileName: string;
  mimeType: string;
  read: boolean;
  /** Why the AI could not read it, when it tried and failed (no credit left, a limit, a refused key). */
  readProblem?: string | null;
  documentType: string | null;
  party: { name: string | null; gstin: string | null };
  vendor: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  number: string | null;
  date: string | null;
  dueDate: string | null;
  currency: string;
  isReverseCharge: boolean;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number } | null;
  lines: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; taxRatePct: number; amountPaise: number }>;
  confidence: number | null;
  enteredAs: EnteredAs | null;
  /** What the AI's proposal worked out: its account, blocked GST (17(5)), and a payment made at the counter. */
  suggested?: {
    accountId: string | null;
    accountName: string | null;
    reason: string | null;
    gstBlocked: boolean;
    paid: { mode: string; evidence: string } | null;
  } | null;
}

export interface EnteredAs {
  entityType: string;
  entityId: string;
  label: string;
}

/** The records a scan can be entered as, as POST /attachments/from-document names them. */
export type EntryEntity = 'PurchaseBill' | 'DirectExpense' | 'PurchaseOrder' | 'DebitNote' | 'Customer' | 'Vendor' | 'Quote' | 'SalesOrder' | 'SalesInvoice' | 'Journal';

export interface EntryRecord {
  entityType: EntryEntity;
  entityId: string;
  /** How the record reads: "Bill SGP/1342". */
  label: string;
}

/** Each record's page, for "Entered as". A debit note has no page of its own: its list. */
export const RECORD_HREF: Record<string, (id: string) => string> = {
  PurchaseBill: (id) => `/purchases/bills/${id}`,
  DirectExpense: (id) => `/purchases/expenses/${id}`,
  PurchaseOrder: (id) => `/purchases/orders/${id}`,
  DebitNote: () => '/purchases/vendor-credits',
  Customer: (id) => `/sales/customers/${id}`,
  Vendor: (id) => `/purchases/vendors/${id}`,
  Journal: (id) => `/accountant/manual-journals/${id}`,
  Quote: (id) => `/sales/quotes/${id}`,
  SalesOrder: (id) => `/sales/orders/${id}`,
  SalesInvoice: (id) => `/sales/invoices/${id}`,
};

/** Done reading, read or not: a form can start from it, beside the file. A failed read is entered by hand. */
const READ = ['EXTRACTED', 'PROPOSED', 'REJECTED', 'DUPLICATE', 'FAILED'];
export function canAddTo(status: string, enteredAs: EnteredAs | null | undefined): boolean {
  return READ.includes(status) && !enteredAs;
}

// ── Filling a form from the scan ─────────────────────────────────────────────

/** Paise as the rupees a form's rupee input takes, "1250.50"; the form turns it back into paise. Blank for nothing. */
export function rupeesOf(paise: number | null | undefined): string {
  if (!paise || paise <= 0 || !Number.isInteger(paise)) return '';
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

const SLABS = [0, 3, 5, 12, 18, 28, 40];
/** A GST slab from a rate read off the scan: 9 read from a CGST column is 18; anything else, the nearest slab. */
export function gstSlab(pct: number | null | undefined): number {
  const p = Number(pct) || 0;
  if (SLABS.includes(p)) return p;
  if (p > 0 && SLABS.includes(p * 2)) return p * 2;
  return SLABS.reduce((best, s) => (Math.abs(s - p) < Math.abs(best - p) ? s : best), 0);
}

/** The document's GST rate from its tax total over its taxable value. */
export function scanTaxRate(x: DocumentExtraction): number {
  const a = x.amountsPaise;
  if (!a || a.taxableValue <= 0) return gstSlab(x.lines.find((l) => l.taxRatePct > 0)?.taxRatePct ?? 0);
  const tax = a.cgst + a.sgst + a.igst;
  return tax > 0 ? gstSlab((tax * 100) / a.taxableValue) : 0;
}

/** The taxable value: as read, or the lines added up. Paise. */
export function scanTaxable(x: DocumentExtraction): number {
  if (x.amountsPaise && x.amountsPaise.taxableValue > 0) return x.amountsPaise.taxableValue;
  return x.lines.reduce((s, l) => s + (Number.isInteger(l.amountPaise) ? l.amountPaise : 0), 0);
}

/** One line read off the scan, as a form's line editor types it. */
export interface ScanLine {
  description: string;
  hsnSac: string;
  qty: string;
  /** Rupees text. */
  rate: string;
  taxRatePct: number;
}

/** The scan's lines; with none read, one line for its taxable value. */
export function scanLines(x: DocumentExtraction): ScanLine[] {
  const docRate = scanTaxRate(x);
  const lineRates = x.lines.some((l) => l.taxRatePct > 0);
  if (x.lines.length) {
    return x.lines.map((l) => {
      const qty = l.qty > 0 ? Number(l.qty.toFixed(3)) : 1;
      const ratePaise = l.ratePaise > 0 ? l.ratePaise : l.amountPaise > 0 ? Math.round(l.amountPaise / qty) : 0;
      return {
        description: (l.description ?? '').trim().slice(0, 200),
        hsnSac: (l.hsnSac ?? '').replace(/\D/g, '').slice(0, 8),
        qty: String(qty),
        rate: rupeesOf(ratePaise),
        taxRatePct: lineRates ? gstSlab(l.taxRatePct) : docRate,
      };
    });
  }
  const taxable = scanTaxable(x);
  if (taxable <= 0) return [];
  return [{ description: 'As per the scanned document', hsnSac: '', qty: '1', rate: rupeesOf(taxable), taxRatePct: docRate }];
}

/** "Bill SGP/1342 from Sunrise Traders": for a narration or a note. */
export function scanSummary(x: DocumentExtraction): string {
  const word = x.documentType === 'sales_invoice' ? 'Invoice' : x.documentType === 'receipt' ? 'Receipt' : x.documentType === 'purchase_invoice' ? 'Bill' : 'Document';
  return [word, x.number, x.party.name ? `from ${x.party.name}` : null].filter(Boolean).join(' ');
}

// ── The entry context ────────────────────────────────────────────────────────

interface EntryContext {
  documentId: string;
  /** Opened to add a party for another form: go back there with the new one chosen. */
  returnTo: string | null;
  extraction: DocumentExtraction | null;
  loading: boolean;
  /** Set when "Save and next" is the button pressed. */
  intent: React.MutableRefObject<boolean>;
}

const Ctx = createContext<EntryContext | null>(null);

interface ListedDocument {
  _id: string;
  status: string;
  enteredAs?: EnteredAs | null;
  /** A bank statement went into banking: nothing to enter by hand. */
  importKind?: string | null;
}

/** The read-but-not-entered document after this one, in the list's order. */
async function nextDocument(current: string): Promise<string | null> {
  const res = await api.get<ListedDocument[] | { data: ListedDocument[] }>('/documents');
  const all = Array.isArray(res) ? res : res?.data ?? [];
  const i = all.findIndex((d) => d._id === current);
  const ordered = i >= 0 ? [...all.slice(i + 1), ...all.slice(0, i)] : all;
  return ordered.find((d) => d._id !== current && d.importKind !== 'bank_statement' && canAddTo(d.status, d.enteredAs))?._id ?? null;
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
const safePath = (p: string | null | undefined) => (p && p.startsWith('/') && !p.startsWith('//') ? p : null);
const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Try again.');

/**
 * What a form needs from the scan it was opened from. Outside a
 * <DocumentEntry> (no ?document=) it is inactive, and finish() simply goes
 * where the page goes after saving.
 */
export function useDocumentEntry() {
  const ctx = useContext(Ctx);
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const documentId = ctx?.documentId ?? null;

  /** Keep the scan against the record. False, with a toast, when it could not be. */
  const markEntered = async (entityType: EntryEntity, entityId: string, label: string): Promise<boolean> => {
    if (!documentId) return false;
    try {
      await api.post('/attachments/from-document', { documentId, entityType, entityId, label: label.slice(0, 120) });
      return true;
    } catch (e) {
      notify(`${label} is saved, but the scan couldn't be kept with it: ${message(e)}`, 'error');
      return false;
    } finally {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['proposals'] });
    }
  };

  const goNext = async (fallback: string | null) => {
    if (!documentId) return;
    let next: string | null = null;
    try {
      next = await nextDocument(documentId);
    } catch {
      next = null;
    }
    if (next) {
      router.push(`${pathname}?document=${next}`);
      return;
    }
    notify('No other scanned documents are waiting to be entered.', 'info');
    router.push(fallback ?? '/documents');
  };

  /**
   * After the page's own save: keep the scan with the record, then go to its
   * page, or to the next document when "Save and next" was pressed.
   */
  const finish = async (record: EntryRecord | null, href: string) => {
    if (!ctx || !documentId || !record) {
      router.push(href);
      return;
    }
    if (ctx.returnTo) {
      // A party added for another form: back to it, with the party chosen. The scan is that form's to keep.
      void qc.invalidateQueries({ queryKey: ['documents', documentId] });
      if (record.entityType === 'Vendor' || record.entityType === 'Customer') {
        router.push(withParam(ctx.returnTo, record.entityType === 'Vendor' ? 'vendorId' : 'customerId', record.entityId));
      } else router.push(ctx.returnTo);
      return;
    }
    const andNext = ctx.intent.current;
    ctx.intent.current = false;
    await markEntered(record.entityType, record.entityId, record.label);
    if (andNext) await goNext(href);
    else router.push(href);
  };

  return {
    active: !!ctx,
    documentId,
    extraction: ctx?.extraction ?? null,
    loading: ctx?.loading ?? false,
    returnTo: ctx?.returnTo ?? null,
    markEntered,
    finish,
    /** "Skip for now": the next document in the same form; nothing saved. */
    skip: () => goNext(null),
  };
}

/** Fill the form once, when the scan's reading arrives. */
export function usePrefill(apply: (x: DocumentExtraction) => void) {
  const { extraction } = useDocumentEntry();
  const done = useRef<string | null>(null);
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    if (!extraction || !extraction.read || done.current === extraction.documentId) return;
    done.current = extraction.documentId;
    latest.current(extraction);
  }, [extraction]);
}

// ── The split view ───────────────────────────────────────────────────────────

/**
 * Wrap a form page in this. With a document it shows the file beside the
 * form (above it on a narrow screen) and offers the reading to the form;
 * without one it renders the page as it is. Key it by the document so the
 * next document starts a fresh form.
 */
export function DocumentEntry({ documentId, returnTo, children }: { documentId?: string | null; returnTo?: string | null; children: React.ReactNode }) {
  if (!documentId || !/^[a-f0-9]{24}$/i.test(documentId)) return <>{children}</>;
  return (
    <SplitView documentId={documentId} returnTo={safePath(returnTo)}>
      {children}
    </SplitView>
  );
}

function SplitView({ documentId, returnTo, children }: { documentId: string; returnTo: string | null; children: React.ReactNode }) {
  const intent = useRef(false);
  // Not kept once the form closes: a party added meanwhile must match when the form opens again.
  const extraction = useQuery({
    queryKey: ['documents', documentId, 'extraction'],
    queryFn: () => api.get<DocumentExtraction>(`/documents/${documentId}/extraction`),
    gcTime: 0,
    retry: false,
  });

  return (
    <Ctx.Provider value={{ documentId, returnTo, extraction: extraction.data ?? null, loading: extraction.isLoading, intent }}>
      <div
        // Wider than the page on a wide screen: the file and the form side by side need the room.
        className="grid gap-6 lg:mx-[calc((100%_-_100vw_+_260px)/2_+_32px)] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        onClickCapture={(e) => {
          // Which button in the form's bar was pressed: "Save and next", or another.
          const button = (e.target as HTMLElement).closest('button');
          if (button && button.closest('[data-form-bar]')) intent.current = button.hasAttribute('data-entry-next');
        }}
      >
        <FilePane documentId={documentId} extraction={extraction.data ?? null} loading={extraction.isLoading} failed={extraction.isError ? message(extraction.error) : null} />
        <div className="min-w-0">{children}</div>
      </div>
    </Ctx.Provider>
  );
}

function kindOf(mimeType: string | undefined, fileName: string | undefined): 'pdf' | 'image' | 'other' {
  const m = (mimeType ?? '').toLowerCase();
  const ext = (fileName ?? '').toLowerCase().split('.').pop() ?? '';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  // HEIC and TIFF are images browsers mostly cannot show; they open in a new tab.
  if (/^image\/(png|jpe?g|webp|gif)$/.test(m) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  return 'other';
}

function FilePane({ documentId, extraction: x, loading, failed }: { documentId: string; extraction: DocumentExtraction | null; loading: boolean; failed: string | null }) {
  const file = useQuery({
    queryKey: ['documents', documentId, 'url'],
    queryFn: () => api.get<{ url: string }>(`/documents/${documentId}/url`),
    staleTime: 240_000,
    retry: false,
  });
  const [fit, setFit] = useState(true);
  const [broken, setBroken] = useState(false);
  const [opening, setOpening] = useState(false);
  const kind = kindOf(x?.mimeType, x?.fileName);
  const name = x?.fileName ?? 'Scanned document';

  const openInTab = async () => {
    setOpening(true);
    try {
      // A fresh link: the one showing may have expired while the form was open.
      const { url } = await api.get<{ url: string }>(`/documents/${documentId}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      notify(`Couldn't open the file: ${message(e)}`, 'error');
    } finally {
      setOpening(false);
    }
  };

  const notes: Array<{ tone: 'pending' | 'success' | 'error'; body: React.ReactNode }> = [];
  if (failed) notes.push({ tone: 'error', body: `Couldn't load what was read: ${failed}` });
  else if (x?.enteredAs) {
    const href = RECORD_HREF[x.enteredAs.entityType]?.(x.enteredAs.entityId);
    notes.push({
      tone: 'success',
      body: (
        <>
          Already entered as {href ? <Link href={href} className="font-medium underline">{x.enteredAs.label}</Link> : x.enteredAs.label}. Saving this form makes another record; the scan stays with the first.
        </>
      ),
    });
  } else if (x && !x.read && x.readProblem) notes.push({ tone: 'pending', body: `AI couldn't read this one: ${x.readProblem} Meanwhile, fill the form from the file.` });
  else if (x && !x.read) notes.push({ tone: 'pending', body: 'Not read yet: fill the form from the file.' });
  else if (x && !x.party.name && !x.number && !x.date && !x.lines.length && !(x.amountsPaise && x.amountsPaise.total > 0)) {
    notes.push({ tone: 'pending', body: 'AI could not read anything from this one: fill the form from the file.' });
  } else if (x) {
    notes.push({ tone: 'pending', body: 'Filled in from what AI read on the scan. Check each field against the file before you save.' });
    if (x.currency && x.currency !== 'INR') notes.push({ tone: 'pending', body: `The scan is in ${x.currency}: choose the currency and check the rates.` });
  }

  return (
    <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label="Scanned document">
      <div className="flex h-[60vh] flex-col overflow-hidden rounded-xl border border-line-200 bg-surface-card lg:h-[calc(100vh-11rem)]">
        <div className="flex items-center gap-2 border-b border-line-200 px-3 py-2">
          <FileText size={14} className="shrink-0 text-ink-400" />
          <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-900" title={name}>{name}</span>
          {x?.read && x.confidence != null && x.confidence > 0 && (
            <span className="shrink-0 rounded-full border border-pending-fg/30 bg-pending-bg px-2 py-0.5 text-[0.7rem] font-medium text-pending-fg" title="How sure the reading is">
              Read {Math.round(x.confidence * 100)}%
            </span>
          )}
          {kind === 'image' && file.data && !broken && (
            <button type="button" className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline" onClick={() => setFit((f) => !f)}>
              {fit ? <Maximize2 size={12} /> : <Minimize2 size={12} />} {fit ? 'Actual size' : 'Fit'}
            </button>
          )}
          <button type="button" className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline disabled:opacity-50" disabled={opening} onClick={() => void openInTab()}>
            <ExternalLink size={12} /> {opening ? 'Opening…' : 'Open in new tab'}
          </button>
        </div>
        {notes.map((n, i) => (
          <p
            key={i}
            className={
              n.tone === 'error'
                ? 'border-b border-error-fg/20 bg-error-bg px-3 py-1.5 text-caption text-error-fg'
                : n.tone === 'success'
                  ? 'flex items-start gap-1.5 border-b border-success-fg/20 bg-success-bg px-3 py-1.5 text-caption text-success-fg'
                  : 'border-b border-pending-fg/20 bg-pending-bg px-3 py-1.5 text-caption text-pending-fg'
            }
          >
            {n.tone === 'success' && <CheckCircle2 size={13} className="mt-0.5 shrink-0" />}
            <span>{n.body}</span>
          </p>
        ))}
        <div className="relative min-h-0 flex-1 bg-surface-sink">
          {file.isLoading || loading ? (
            <p className="flex h-full items-center justify-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading the file…</p>
          ) : file.isError || !file.data ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-caption text-error-fg">Couldn&apos;t load the file{file.error ? `: ${message(file.error)}` : '.'}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => void file.refetch()}>Try again</Button>
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={`${file.data.url}#view=FitH&navpanes=0`} title={`Scanned document: ${name}`} className="h-full w-full border-0" />
          ) : kind === 'image' && !broken ? (
            <div className="h-full overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset */}
              <img src={file.data.url} alt={`Scanned document: ${name}`} className={fit ? 'h-full w-full object-contain' : 'max-w-none'} onError={() => setBroken(true)} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-body text-ink-600">This file can&apos;t be shown here.</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => void openInTab()}><ExternalLink size={13} /> Open in new tab</Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Pieces a form puts in its page ───────────────────────────────────────────

/**
 * "Save and next" and "Skip for now", beside the page's own save button,
 * when the form was opened from a scan. "Save and next" submits the form;
 * the page saves as usual and finish() opens the next document.
 */
export function EntryActions({ busy, nextLabel = 'Save and next', nextDisabled }: {
  busy?: boolean;
  nextLabel?: string;
  /** As the page's own save button is: a journal that does not balance. */
  nextDisabled?: boolean;
}) {
  const entry = useDocumentEntry();
  const [skipping, setSkipping] = useState(false);
  if (!entry.active || entry.returnTo) return null;
  return (
    <>
      <Button type="submit" variant="secondary" data-entry-next="" disabled={busy || skipping || nextDisabled}>
        {nextLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={busy || skipping}
        onClick={async () => {
          setSkipping(true);
          try {
            await entry.skip();
          } finally {
            setSkipping(false);
          }
        }}
      >
        {skipping ? 'Opening…' : 'Skip for now'}
      </Button>
    </>
  );
}

/**
 * The scan's party is not in the books: add them (the party's form opens
 * filled from the scan, and comes back here with them chosen), or pick one.
 */
export function PartyFound({ kind, chosen, selectId }: { kind: 'vendor' | 'customer'; chosen: boolean; selectId: string }) {
  const entry = useDocumentEntry();
  const pathname = usePathname();
  const x = entry.extraction;
  if (!entry.active || entry.returnTo || !x?.read || chosen || x[kind] || !x.party.name) return null;
  const here = `${pathname}?document=${entry.documentId}`;
  const form = kind === 'vendor' ? '/purchases/vendors/new' : '/sales/customers/new';
  const addHref = `${form}?document=${entry.documentId}&returnTo=${encodeURIComponent(here)}`;
  const pickExisting = () => {
    const found = document.getElementById(selectId);
    if (!found) return;
    found.scrollIntoView({ block: 'center', behavior: 'smooth' });
    found.focus();
    // A searchable picker is a button: clicking it opens its list.
    if (found instanceof HTMLButtonElement) {
      found.click();
      return;
    }
    const el = found as HTMLElement & { showPicker?: () => void };
    try {
      el.showPicker?.();
    } catch {
      // Not every browser opens a select's list on request; focus is enough.
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-pending-fg/30 bg-pending-bg px-3 py-2 text-body text-pending-fg" role="status">
      <span>
        New {kind} &quot;<span className="font-medium">{x.party.name}</span>&quot; found.
      </span>
      <span className="flex items-center gap-2">
        <Link href={addHref} className="font-medium underline-offset-2 hover:underline">Add new {kind}</Link>
        <span aria-hidden className="text-pending-fg/50">|</span>
        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={pickExisting}>Select existing {kind}</button>
      </span>
    </div>
  );
}

/** "Entered as Bill SGP/1342", linking to the record: in place of the "Add to" menu. */
export function EnteredAsLink({ enteredAs }: { enteredAs: EnteredAs }) {
  const href = RECORD_HREF[enteredAs.entityType]?.(enteredAs.entityId);
  const body = (
    <>
      <CheckCircle2 size={12} className="shrink-0" /> Entered as {enteredAs.label}
    </>
  );
  return href ? (
    <Link href={href} className="inline-flex items-center gap-1 text-caption font-medium text-success-fg hover:underline">{body}</Link>
  ) : (
    <span className="inline-flex items-center gap-1 text-caption font-medium text-success-fg">{body}</span>
  );
}
