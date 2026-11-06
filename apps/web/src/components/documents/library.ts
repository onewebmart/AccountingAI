'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

/**
 * The Documents area's data: every file with what it became, the folders,
 * the bank statements, the reading pipeline, and uploads with progress.
 * Every query key starts with 'documents', so whatever refreshes the
 * documents (an upload, Add to, Try again) refreshes these too.
 */

// ── Shapes, as the API sends them. Money is integer paise. ────────────────

export type FileKind = 'pdf' | 'image' | 'spreadsheet' | 'document' | 'other';
export type Stage = 'reading' | 'ready' | 'posted' | 'entered' | 'imported' | 'reconciled' | 'rejected' | 'duplicate' | 'failed' | 'attached';

/** GET /documents/library: what a file became, or where it waits. */
export interface AssociatedTo {
  kind: 'record' | 'statement' | 'review' | 'duplicate' | 'rejected';
  label: string;
  entityType: string | null;
  entityId: string | null;
  bankAccountId?: string | null;
}

export interface Uploader {
  channel: 'upload' | 'email' | 'whatsapp';
  name: string | null;
  from: string | null;
}

export interface LibraryRow {
  key: string;
  id: string;
  kind: 'upload' | 'attachment';
  fileName: string;
  mimeType: string;
  fileKind: FileKind;
  sizeBytes: number;
  stage: Stage;
  status: string;
  documentType: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  totalAmountPaise: number | null;
  proposalId: string | null;
  failureReason: string | null;
  enteredAs: { entityType: string; entityId: string; label: string } | null;
  uploadedAt: string;
  uploadedBy: Uploader;
  associatedTo: AssociatedTo | null;
  folder: { id: string; name: string } | null;
}

export interface Folder {
  id: string;
  name: string;
  count: number;
  createdAt: string;
}

/** GET /documents/statements. */
export interface StatementRow {
  key: string;
  documentId: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: Uploader;
  stage: 'reading' | 'imported' | 'reconciled' | 'failed';
  failureReason: string | null;
  warnings: string[];
  statementId: string | null;
  bankAccount: { id: string; name: string; bankName: string | null; last4: string | null } | null;
  periodStart: string | null;
  periodEnd: string | null;
  linesImported: number;
  matched: number;
  confirmed: number;
  unmatched: number;
  excluded: number;
}

/** GET /documents/pipeline. */
export interface DocumentPipeline {
  total: number;
  reading: number;
  readyForReview: number;
  couldNotRead: { count: number; reasons: Array<{ reason: string; count: number }> };
  duplicates: number;
  waiting: number;
  entered: { today: number; thisWeek: number };
}

// ── Words and colours ──────────────────────────────────────────────────────

/** Amber waits or is AI's, green is done, grey is neither, cool red is a problem. */
export const STAGE: Record<Stage, { label: string; tone: 'pending' | 'success' | 'neutral' | 'error' }> = {
  reading: { label: 'Reading…', tone: 'pending' },
  ready: { label: 'Ready to review', tone: 'pending' },
  posted: { label: 'Posted', tone: 'success' },
  entered: { label: 'Entered', tone: 'success' },
  imported: { label: 'Imported', tone: 'pending' },
  reconciled: { label: 'Reconciled', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  duplicate: { label: 'Duplicate?', tone: 'error' },
  failed: { label: "Couldn't read", tone: 'error' },
  attached: { label: 'Attached', tone: 'neutral' },
};

export const FILE_KINDS: Array<[FileKind | 'all', string]> = [
  ['all', 'All files'],
  ['pdf', 'PDF'],
  ['image', 'Images'],
  ['spreadsheet', 'Spreadsheets'],
  ['document', 'Word and text'],
  ['other', 'Other'],
];

/** Where each kind of record lives. A record with no page of its own (a payment) has no link. */
const RECORD_PAGE: Record<string, (id: string) => string | null> = {
  PurchaseBill: (id) => `/purchases/bills/${id}`,
  DirectExpense: (id) => `/purchases/expenses/${id}`,
  PurchaseOrder: (id) => `/purchases/orders/${id}`,
  DebitNote: () => '/purchases/vendor-credits',
  ExpenseClaim: (id) => `/purchases/claims/${id}`,
  Vendor: (id) => `/purchases/vendors/${id}`,
  Customer: (id) => `/sales/customers/${id}`,
  Quote: (id) => `/sales/quotes/${id}`,
  SalesOrder: (id) => `/sales/orders/${id}`,
  SalesInvoice: (id) => `/sales/invoices/${id}`,
  Journal: (id) => `/accountant/manual-journals/${id}`,
  PartyPayment: () => null,
};

/** The page "Associated to" opens: the record, the statement's reconciliation, or Review. */
export function associatedHref(a: AssociatedTo | null): string | null {
  if (!a) return null;
  if (a.kind === 'statement') return a.bankAccountId ? `/banking?account=${a.bankAccountId}` : '/banking';
  if (a.kind === 'review') return '/review';
  if (a.kind === 'record' && a.entityType && a.entityId) return RECORD_PAGE[a.entityType]?.(a.entityId) ?? null;
  return null;
}

/** 919876543210 → +91 98765 43210. */
export function phone(digits: string): string {
  return digits.length === 12 && digits.startsWith('91') ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : `+${digits}`;
}

/** "Asha Rao", "Email · bills@sharma.in", "WhatsApp · +91 98765 43210". */
export function uploaderText(u: Uploader): string {
  if (u.channel === 'email') return u.from ? `Email · ${u.from}` : 'Email';
  if (u.channel === 'whatsapp') return u.from ? `WhatsApp · ${phone(u.from)}` : 'WhatsApp';
  return u.name ?? 'Someone on the team';
}

/**
 * Joins class names without merging them. The app's cn() runs tailwind-merge with its default
 * config, which reads our own sizes (text-caption, text-h2) as colours and drops them when a
 * colour follows; these components never need a merge, so they never lose a size.
 */
export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export const fileSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// ── Queries ────────────────────────────────────────────────────────────────

export function useFolders() {
  return useQuery({ queryKey: ['documents', 'folders'], queryFn: () => api.get<Folder[]>('/documents/folders') });
}

/** Polls while anything is still being read: the reading runs in a background job. */
export function useLibrary(folderId?: string) {
  return useQuery({
    queryKey: ['documents', 'library', folderId ?? 'all'],
    queryFn: () => api.get<{ data: LibraryRow[]; truncated: boolean }>(`/documents/library${folderId ? `?folderId=${folderId}` : ''}`),
    refetchInterval: (q) => (q.state.data?.data.some((r) => r.stage === 'reading') ? 4000 : false),
  });
}

export function useStatements() {
  return useQuery({
    queryKey: ['documents', 'statements'],
    queryFn: () => api.get<StatementRow[]>('/documents/statements'),
    refetchInterval: (q) => (q.state.data?.some((r) => r.stage === 'reading') ? 4000 : false),
  });
}

export function usePipeline(enabled = true) {
  return useQuery({
    queryKey: ['documents', 'pipeline'],
    queryFn: () => api.get<DocumentPipeline>('/documents/pipeline'),
    enabled,
    refetchInterval: (q) => ((q.state.data?.reading ?? 0) > 0 ? 5000 : false),
  });
}

// ── Uploads, with progress ─────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
/** What the reading pipeline accepts, as the upload route checks it. */
export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.heic,.heif,.csv,.xlsx,.xls,.docx,.txt,.md,.rtf';
const ACCEPTED = /\.(pdf|jpe?g|png|webp|tiff?|heic|heif|xlsx?|csv|docx|txt|md|rtf)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** 0 to 1, while the bytes go up. */
  progress: number;
  state: 'queued' | 'uploading' | 'done' | 'duplicate' | 'error';
  message: string | null;
  documentId: string | null;
}

interface UploadAnswer {
  id: string;
  status: string;
}

/** POST /documents/upload with upload progress. A 401 is retried through the API client, which refreshes the session. */
function send(file: File, onProgress: (p: number) => void): Promise<UploadAnswer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/documents/upload`);
    const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "Can't reach the server. Check your connection and try again."));
    xhr.onload = () => {
      let body: { message?: string | string[] } & Partial<UploadAnswer> = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        body = {};
      }
      if (xhr.status === 401) {
        const form = new FormData();
        form.append('file', file);
        api.post<UploadAnswer>('/documents/upload', form).then(resolve, reject);
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        reject(new ApiError(xhr.status, message ?? `The upload failed (${xhr.status}).`));
        return;
      }
      resolve(body as UploadAnswer);
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/**
 * Uploads files three at a time, each with its own progress. In a folder,
 * each file is filed there once it is in. Every upload is read in the
 * background like any other; nothing posts by itself.
 */
export function useUploads(folderId?: string | null) {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<Array<{ id: string; file: File }>>([]);
  const running = useRef(0);
  const folder = useRef(folderId ?? null);
  folder.current = folderId ?? null;

  const patch = useCallback((id: string, p: Partial<UploadItem>) => setItems((all) => all.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  const pump = useCallback(() => {
    while (running.current < 3 && queue.current.length) {
      const next = queue.current.shift()!;
      running.current += 1;
      patch(next.id, { state: 'uploading' });
      send(next.file, (progress) => patch(next.id, { progress }))
        .then(async (res) => {
          const duplicate = res.status === 'DUPLICATE';
          patch(next.id, {
            progress: 1,
            state: duplicate ? 'duplicate' : 'done',
            documentId: res.id,
            message: duplicate ? 'Duplicate? This exact file was uploaded before.' : 'Sent for reading',
          });
          if (folder.current && res.id) {
            await api.post('/documents/move', { folderId: folder.current, items: [{ kind: 'document', id: res.id }] }).catch(() => undefined);
          }
        })
        .catch((err: unknown) => patch(next.id, { state: 'error', message: err instanceof Error ? err.message : 'The upload failed. Try again.' }))
        .finally(() => {
          running.current -= 1;
          void qc.invalidateQueries({ queryKey: ['documents'] });
          void qc.invalidateQueries({ queryKey: ['workspace'] });
          pump();
        });
    }
  }, [patch, qc]);

  const add = useCallback(
    (files: File[]) => {
      const fresh: UploadItem[] = [];
      files.forEach((file, i) => {
        const id = `${Date.now()}-${i}-${file.name}`;
        const tooBig = file.size > MAX_BYTES;
        const unread = !ACCEPTED.test(file.name);
        const item: UploadItem = {
          id,
          name: file.name,
          size: file.size,
          progress: 0,
          state: tooBig || unread ? 'error' : 'queued',
          message: tooBig
            ? 'Bigger than 20 MB. Compress it or split it, then upload again.'
            : unread
              ? "This type of file can't be read. Upload a PDF, photo, Word document, spreadsheet or text file."
              : null,
          documentId: null,
        };
        fresh.push(item);
        if (item.state === 'queued') queue.current.push({ id, file });
      });
      setItems((all) => [...fresh, ...all]);
      pump();
    },
    [pump],
  );

  const clearFinished = useCallback(() => setItems((all) => all.filter((it) => it.state === 'queued' || it.state === 'uploading')), []);

  return { items, add, clearFinished, busy: items.some((it) => it.state === 'queued' || it.state === 'uploading') };
}
