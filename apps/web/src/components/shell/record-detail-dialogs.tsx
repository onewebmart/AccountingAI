'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

/** GET /sales/invoices/:id or /purchase/bills/:id — the stored record. */
interface ApiRecord {
  _id: string;
  invoiceNumber?: string | null;
  billNumber?: string | null;
  invoiceDate?: string;
  billDate?: string;
  dueDate: string | null;
  status: string;
  financialYear?: string | null;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  journalId?: string | null;
  paymentJournalId?: string | null;
  sourceDocumentId?: string | null;
  notes?: string | null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-100 py-1.5 last:border-0">
      <span className="text-caption text-ink-500">{label}</span>
      <span className="text-right text-body text-ink-900">{children}</span>
    </div>
  );
}

/** A voucher by id, shown by its number. */
function VoucherNumber({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ['journals', id],
    queryFn: () => api.get<{ voucherNumber: string; date: string }>(`/journals/${id}`),
  });
  return <span className="font-mono">{data ? `${data.voucherNumber} · ${data.date}` : '…'}</span>;
}

async function openOriginal(documentId: string) {
  const { url } = await api.get<{ url: string }>(`/documents/${documentId}/url`);
  window.open(url, '_blank', 'noopener');
}

/**
 * One invoice or bill: its amounts, dates, and the vouchers that posted and
 * settled it. Replaces the "detail view coming soon" toasts.
 */
export function DocumentDetailDialog({
  kind,
  id,
  partyName,
  onClose,
}: {
  kind: 'invoice' | 'bill';
  id: string | null;
  partyName: string;
  onClose: () => void;
}) {
  const { data: record, isLoading, isError } = useQuery({
    queryKey: [kind === 'invoice' ? 'sales' : 'purchase', kind, id],
    queryFn: () => api.get<ApiRecord>(kind === 'invoice' ? `/sales/invoices/${id}` : `/purchase/bills/${id}`),
    enabled: !!id,
  });
  const number = record?.invoiceNumber ?? record?.billNumber ?? 'No number';
  const a = record?.amountsPaise;

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === 'invoice' ? 'Invoice' : 'Bill'} <span className="font-mono">{record ? number : ''}</span>
          </DialogTitle>
          <DialogDescription>{partyName}</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-caption text-ink-400">Loading…</p>}
        {isError && <p className="text-body text-error-fg">Couldn&apos;t load this {kind}.</p>}
        {record && a && (
          <div className="space-y-4">
            <div>
              <Row label="Status">
                <span className="capitalize">{record.status}</span>
              </Row>
              <Row label={kind === 'invoice' ? 'Invoice date' : 'Bill date'}>{record.invoiceDate ?? record.billDate}</Row>
              <Row label="Due">{record.dueDate ?? '—'}</Row>
              {record.financialYear && <Row label="Financial year">{record.financialYear}</Row>}
            </div>

            <div>
              <Row label="Taxable value"><span className="font-mono">{formatRupees(a.taxableValue)}</span></Row>
              {a.cgst > 0 && <Row label="CGST"><span className="font-mono">{formatRupees(a.cgst)}</span></Row>}
              {a.sgst > 0 && <Row label="SGST"><span className="font-mono">{formatRupees(a.sgst)}</span></Row>}
              {a.igst > 0 && <Row label="IGST"><span className="font-mono">{formatRupees(a.igst)}</span></Row>}
              {a.cess > 0 && <Row label="Cess"><span className="font-mono">{formatRupees(a.cess)}</span></Row>}
              <Row label="Total"><span className="font-mono font-semibold">{formatRupees(a.total)}</span></Row>
            </div>

            <div>
              <Row label="Posted as">{record.journalId ? <VoucherNumber id={record.journalId} /> : 'Not posted yet'}</Row>
              <Row label={kind === 'invoice' ? 'Received by' : 'Paid by'}>
                {record.paymentJournalId ? <VoucherNumber id={record.paymentJournalId} /> : record.status === 'paid' ? 'Paid' : 'Unpaid'}
              </Row>
            </div>

            {record.notes && <p className="text-caption text-ink-500">{record.notes}</p>}

            {record.sourceDocumentId && (
              <button
                type="button"
                onClick={() => void openOriginal(record.sourceDocumentId!)}
                className="inline-flex items-center gap-1.5 text-caption font-medium text-ink-700 hover:text-ink-900"
              >
                <ExternalLink size={12} /> View the original upload
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface PartyDocument {
  id: string;
  number: string | null;
  date: string;
  status: string;
  totalPaise: number;
}

/** A customer or vendor: identity, balance, and their invoices or bills. */
export function PartyDetailDialog({
  kind,
  party,
  documents,
  onClose,
}: {
  kind: 'customer' | 'vendor';
  party: { id: string; name: string; gstin: string | null; balancePaise: number } | null;
  documents: PartyDocument[];
  onClose: () => void;
}) {
  return (
    <Dialog open={!!party} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{party?.name}</DialogTitle>
          <DialogDescription>{kind === 'customer' ? 'Customer' : 'Vendor'}</DialogDescription>
        </DialogHeader>
        {party && (
          <div className="space-y-4">
            <div>
              <Row label="GSTIN"><span className="font-mono">{party.gstin ?? '—'}</span></Row>
              <Row label={kind === 'customer' ? 'They owe you' : 'You owe them'}>
                <span className="font-mono font-semibold">{formatRupees(party.balancePaise)}</span>
              </Row>
            </div>
            <div>
              <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">
                {kind === 'customer' ? 'Invoices' : 'Bills'}
              </p>
              {documents.length === 0 ? (
                <p className="text-caption text-ink-400">None yet.</p>
              ) : (
                documents.map((d) => (
                  <Row key={d.id} label={`${d.date} · ${d.status}`}>
                    <span className="font-mono">
                      {d.number ?? 'No number'} — {formatRupees(d.totalPaise)}
                    </span>
                  </Row>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
