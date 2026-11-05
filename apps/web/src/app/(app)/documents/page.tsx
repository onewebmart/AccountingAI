'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText, shortDate } from '@/components/accountant/common';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

/** An upload, as GET /documents lists it. */
interface ApiDocument {
  _id: string;
  originalName: string;
  status: 'UPLOADED' | 'CLASSIFYING' | 'EXTRACTING' | 'EXTRACTED' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DUPLICATE' | 'FAILED';
  documentType?: string;
  vendor: string | null;
  invoiceNumber: string | null;
  totalAmountPaise: number | null;
  proposalId: string | null;
  sizeBytes: number;
  uploadedAt: string;
  source?: { channel: 'upload' | 'email' | 'whatsapp'; from: string | null };
}
/** An audit entry for a file attached to, or removed from, a record. */
interface AuditRow {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: { name: string };
  before: { attachmentId?: string } | null;
  after: { attachmentId?: string; fileName?: string; sizeBytes?: number } | null;
}

type Status = 'reading' | 'ready' | 'posted' | 'rejected' | 'duplicate' | 'failed' | 'attached';
interface Row {
  key: string;
  id: string;
  source: 'upload' | 'attachment';
  name: string;
  type: string;
  status: Status;
  at: string;
  /** Party and number for an upload; the record and who attached it for an attachment. */
  detail: string;
  amountPaise: number | null;
  sizeBytes: number | null;
  proposalId: string | null;
  record: { href: string | null; label: string } | null;
}

const STATUS: Record<Status, { label: string; tone: 'pending' | 'success' | 'neutral' | 'error' }> = {
  reading: { label: 'Reading…', tone: 'pending' },
  ready: { label: 'Ready to review', tone: 'pending' },
  posted: { label: 'Posted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  duplicate: { label: 'Duplicate?', tone: 'error' },
  failed: { label: "Couldn't read", tone: 'error' },
  attached: { label: 'Attached', tone: 'neutral' },
};
const TYPES: Record<string, string> = {
  purchase_invoice: 'Purchase invoice',
  sales_invoice: 'Sales invoice',
  bank_statement: 'Bank statement',
  receipt: 'Receipt',
  unknown: 'Not yet known',
  attachment: 'Attached to a record',
};
/** Where each kind of record lives, for an attachment's link. */
const RECORDS: Record<string, { label: string; href: (id: string) => string | null }> = {
  SalesInvoice: { label: 'Invoice', href: (id) => `/sales/invoices/${id}` },
  PurchaseBill: { label: 'Bill', href: (id) => `/purchases/bills/${id}` },
  Journal: { label: 'Voucher', href: (id) => `/accountant/manual-journals/${id}` },
  PartyPayment: { label: 'Payment', href: () => null },
  Customer: { label: 'Customer', href: (id) => `/sales/customers/${id}` },
  Vendor: { label: 'Vendor', href: (id) => `/purchases/vendors/${id}` },
  ExpenseClaim: { label: 'Expense claim', href: () => '/purchases/claims' },
};

function uploadStatus(s: ApiDocument['status']): Status {
  if (s === 'EXTRACTED' || s === 'PROPOSED') return 'ready';
  if (s === 'APPROVED') return 'posted';
  if (s === 'REJECTED') return 'rejected';
  if (s === 'DUPLICATE') return 'duplicate';
  if (s === 'FAILED') return 'failed';
  return 'reading';
}
const size = (b: number | null) => (b == null ? '' : b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Files attached to records, from the audit trail: attached, and not removed since. */
async function attachments(): Promise<AuditRow[]> {
  const [attached, removed] = await Promise.all([
    api.get<{ entries: AuditRow[] }>('/audit?action=ATTACH&limit=200'),
    api.get<{ entries: AuditRow[] }>('/audit?action=DETACH&limit=200'),
  ]);
  const gone = new Set(removed.entries.map((r) => r.before?.attachmentId).filter(Boolean));
  return attached.entries.filter((r) => r.after?.attachmentId && !gone.has(r.after.attachmentId));
}

/** Every file in the books: uploads read by the inbox, and files kept against records. */
export default function DocumentsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const docs = useQuery({ queryKey: ['documents'], queryFn: () => api.get<{ data: ApiDocument[] }>('/documents') });
  const files = useQuery({ queryKey: ['documents', 'attachments'], queryFn: attachments, retry: false });

  const rows: Row[] = [
    ...(docs.data?.data ?? []).map((d): Row => {
      const st = uploadStatus(d.status);
      const via = d.source && d.source.channel !== 'upload' ? `via ${d.source.channel === 'email' ? 'email' : 'WhatsApp'}` : '';
      return {
        key: `d:${d._id}`, id: d._id, source: 'upload', name: d.originalName, type: d.documentType ?? 'unknown', status: st, at: d.uploadedAt,
        detail: [d.vendor, d.invoiceNumber, via].filter(Boolean).join(' · '), amountPaise: d.totalAmountPaise, sizeBytes: d.sizeBytes, proposalId: d.proposalId,
        record: st === 'ready' ? { href: '/review', label: 'Review' } : st === 'posted' && d.proposalId ? { href: null, label: 'Open voucher' } : st === 'failed' || st === 'duplicate' || st === 'reading' ? { href: '/inbox', label: 'Inbox' } : null,
      };
    }),
    ...(files.data ?? []).map((a): Row => {
      const rec = RECORDS[a.entityType];
      return {
        key: `a:${a.after!.attachmentId}`, id: a.after!.attachmentId!, source: 'attachment', name: a.after?.fileName ?? 'file', type: 'attachment', status: 'attached', at: a.at,
        detail: `${rec?.label ?? a.entityType} · attached by ${a.actor.name}`, amountPaise: null, sizeBytes: a.after?.sizeBytes ?? null, proposalId: null,
        record: rec ? { href: rec.href(a.entityId), label: `Open ${rec.label.toLowerCase()}` } : null,
      };
    }),
  ].sort((x, y) => y.at.localeCompare(x.at));

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (type === 'all' || r.type === type || (type === 'unknown' && !TYPES[r.type])) &&
      (!needle || r.name.toLowerCase().includes(needle) || r.detail.toLowerCase().includes(needle)),
  );
  const types = [...new Set(rows.map((r) => (TYPES[r.type] ? r.type : 'unknown')))];

  const openFile = async (r: Row) => {
    setBusy(r.key);
    try {
      const { url } = await api.get<{ url: string }>(r.source === 'upload' ? `/documents/${r.id}/url` : `/attachments/${r.id}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      notify(errorText(err, "Couldn't open the file."), 'error');
    } finally {
      setBusy(null);
    }
  };
  const openVoucher = async (r: Row) => {
    setBusy(`${r.key}:v`);
    try {
      const p = await api.get<{ journalId: string | null }>(`/proposals/${r.proposalId}`);
      if (p.journalId) router.push(`/accountant/manual-journals/${p.journalId}`);
      else notify('This document has no voucher yet.', 'info');
    } catch (err) {
      notify(errorText(err, "Couldn't find its voucher."), 'error');
    } finally {
      setBusy(null);
    }
  };

  const noAudit = files.isError && files.error instanceof ApiError && files.error.status === 403;
  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Every file in the books: bills, invoices, statements and receipts sent to the inbox, and files kept against invoices, bills, vouchers and parties."
        actions={<Button asChild><Link href="/inbox">Upload in the inbox</Link></Button>}
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search file, party or number"
        filters={{
          value: status,
          onChange: setStatus,
          options: [['all', 'All'], ['ready', 'Ready to review'], ['posted', 'Posted'], ['attached', 'Attached'], ['reading', 'Reading'], ['duplicate', 'Duplicate?'], ['failed', "Couldn't read"], ['rejected', 'Rejected']],
        }}
      >
        <select className="h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="all">All types</option>
          {types.map((t) => <option key={t} value={t}>{TYPES[t] ?? t}</option>)}
        </select>
      </ListToolbar>

      {docs.isError && <QueryError error={docs.error} onRetry={() => void docs.refetch()} />}
      {files.isError && (
        <p className="mb-3 text-caption text-ink-500">
          {noAudit ? 'Files attached to records are listed for people who can read the audit trail; open them from each record.' : `Couldn't list the files attached to records: ${errorText(files.error)}`}
        </p>
      )}

      {docs.isLoading || files.isLoading ? (
        <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading documents…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          title={rows.length ? 'No document matches' : 'No documents yet'}
          body={rows.length ? 'Change the search, status or type.' : 'Upload bills, invoices and statements in the inbox, or attach files to a record.'}
        />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>File</th>
                <th className={th}>Type</th>
                <th className={th}>Added</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-b border-line-100 last:border-0 hover:bg-surface-sink">
                  <td className={`${td} max-w-[320px]`}>
                    <button type="button" className="flex max-w-full items-center gap-2 text-left hover:underline disabled:opacity-60" disabled={busy === r.key} onClick={() => void openFile(r)}>
                      {r.source === 'upload' ? <FileText size={14} className="shrink-0 text-ink-400" /> : <Paperclip size={14} className="shrink-0 text-ink-400" />}
                      <span className="truncate font-mono text-caption text-ink-900">{r.name}</span>
                    </button>
                    {r.detail && <p className="truncate pl-[22px] text-caption text-ink-500">{r.detail}</p>}
                  </td>
                  <td className={`${td} whitespace-nowrap text-caption text-ink-600`}>{TYPES[r.type] ?? r.type}</td>
                  <td className={`${td} whitespace-nowrap text-caption text-ink-500`}>{shortDate(r.at)}{r.sizeBytes != null ? ` · ${size(r.sizeBytes)}` : ''}</td>
                  <td className={tdMoney}>{r.amountPaise != null ? formatPaise(r.amountPaise) : ''}</td>
                  <td className={td}><StatusChip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusChip></td>
                  <td className={`${td} whitespace-nowrap text-right text-caption`}>
                    <span className="flex items-center justify-end gap-3">
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-ink-600 hover:text-ink-900 hover:underline disabled:opacity-50" disabled={busy === r.key} onClick={() => void openFile(r)}>
                        <ExternalLink size={12} /> {busy === r.key ? 'Opening…' : 'Open file'}
                      </button>
                      {r.record && (r.record.href ? (
                        <Link href={r.record.href} className="font-medium text-ink-600 hover:text-ink-900 hover:underline">{r.record.label}</Link>
                      ) : (
                        <button type="button" className="font-medium text-ink-600 hover:text-ink-900 hover:underline disabled:opacity-50" disabled={busy === `${r.key}:v`} onClick={() => void openVoucher(r)}>{r.record.label}</button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">
            {shown.length} file{shown.length === 1 ? '' : 's'}. The latest 100 uploads and 200 attachments.
          </div>
        </TableCard>
      )}
    </div>
  );
}
