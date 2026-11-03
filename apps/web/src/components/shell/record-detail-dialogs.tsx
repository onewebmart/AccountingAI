'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { GST_STATES } from '@/lib/gst';
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
  amountPaidPaise?: number;
  payments?: Array<{ _id: string; journalId: string; amountPaise: number; paidOn: string }>;
  adjustedPaise?: number;
  adjustments?: Array<{ noteId: string; journalId: string; amountPaise: number; noteDate: string }>;
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
              {(record.payments ?? []).map((p) => (
                <Row key={p._id} label={`${kind === 'invoice' ? 'Received' : 'Paid'} ${formatRupees(p.amountPaise)}`}>
                  <VoucherNumber id={p.journalId} />
                </Row>
              ))}
              {(record.adjustments ?? []).map((n) => (
                <Row key={n.noteId} label={`${kind === 'invoice' ? 'Credit note' : 'Debit note'} ${formatRupees(n.amountPaise)}`}>
                  <VoucherNumber id={n.journalId} />
                </Row>
              ))}
              {record.status !== 'paid' && (
                <Row label="Still owed">
                  <span className="font-mono font-semibold">
                    {formatRupees(a.total - (record.amountPaidPaise ?? 0) - (record.adjustedPaise ?? 0))}
                  </span>
                </Row>
              )}
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
            <a
              href={`/audit?entityType=${kind === 'invoice' ? 'SalesInvoice' : 'PurchaseBill'}&entityId=${record._id}`}
              className="block text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline"
            >
              History of this {kind}
            </a>
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
/** GET /sales/customers/:id or /purchase/vendors/:id. */
interface ApiParty {
  _id: string;
  name: string;
  gstin: string | null;
  stateCode?: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

const PARTY_FIELDS = ['name', 'gstin', 'stateCode', 'phone', 'email', 'address', 'notes'] as const;
type PartyForm = Record<(typeof PARTY_FIELDS)[number], string>;

/**
 * A customer's or vendor's details, editable. Only changed fields are sent.
 * Invoices and bills already issued keep the GSTIN they were issued with;
 * the server takes care of that.
 */
function PartyEditForm({ kind, id, onDone }: { kind: 'customer' | 'vendor'; id: string; onDone: (saved: boolean) => void }) {
  const queryClient = useQueryClient();
  const path = kind === 'customer' ? `/sales/customers/${id}` : `/purchase/vendors/${id}`;
  const { data, isError } = useQuery({ queryKey: [kind === 'customer' ? 'sales' : 'purchase', kind, id], queryFn: () => api.get<ApiParty>(path) });
  const [form, setForm] = useState<PartyForm | null>(null);
  const original: PartyForm | null = data
    ? Object.fromEntries(PARTY_FIELDS.map((k) => [k, (data[k as keyof ApiParty] as string | null | undefined) ?? ''])) as PartyForm
    : null;
  const current = form ?? original;

  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) => api.patch<ApiParty>(path, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [kind === 'customer' ? 'sales' : 'purchase'] });
      void queryClient.invalidateQueries({ queryKey: ['gst'] });
      onDone(true);
    },
  });

  if (isError) return <p className="text-caption text-error-fg">Couldn&apos;t load the {kind}&apos;s details.</p>;
  if (!current || !original) return <p className="text-caption text-ink-400">Loading…</p>;

  const set = (k: keyof PartyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...current, [k]: e.target.value });
  const gstin = current.gstin.trim().toUpperCase();
  const stateFromGstin = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  const gstinChanged = gstin !== original.gstin.trim().toUpperCase();
  const field =
    'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const label = 'text-caption font-medium text-ink-700 block mb-1';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, string | null> = {};
    for (const k of PARTY_FIELDS) {
      if (k === 'stateCode' && (kind === 'vendor' || stateFromGstin)) continue;
      const value = k === 'gstin' ? gstin : current[k].trim();
      if (value !== original[k].trim()) body[k] = value || null;
    }
    if (Object.keys(body).length === 0) return onDone(false);
    save.mutate(body);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className={label}>{kind === 'customer' ? 'Customer' : 'Vendor'} name</label>
        <input className={field} value={current.name} onChange={set('name')} required />
      </div>
      <div>
        <label className={label}>
          GSTIN <span className="text-ink-400">(blank if unregistered)</span>
        </label>
        <input className={`${field} font-mono`} value={current.gstin} onChange={set('gstin')} />
        {gstinChanged && (
          <p className="mt-1 text-caption text-ink-500">
            {kind === 'customer' ? 'Invoices' : 'Bills'} already issued keep the GSTIN they were issued with. New ones use this.
          </p>
        )}
      </div>
      {kind === 'customer' && (
        <div>
          <label className={label}>State</label>
          {stateFromGstin ? (
            <p className="text-body text-ink-700">
              {GST_STATES.find((s) => s.code === stateFromGstin)?.name ?? stateFromGstin} — from the GSTIN
            </p>
          ) : (
            <select className={field} value={current.stateCode} onChange={set('stateCode')}>
              <option value="">Choose a state</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Email</label>
          <input type="email" className={field} value={current.email} onChange={set('email')} />
        </div>
        <div>
          <label className={label}>Phone</label>
          <input type="tel" className={field} value={current.phone} onChange={set('phone')} />
        </div>
      </div>
      <div>
        <label className={label}>Address</label>
        <textarea className={field} rows={2} value={current.address} onChange={set('address')} />
      </div>
      <div>
        <label className={label}>Notes</label>
        <textarea className={field} rows={2} value={current.notes} onChange={set('notes')} />
      </div>
      {save.isError && (
        <p className="text-caption text-error-fg">
          {save.error instanceof ApiError && save.error.message ? save.error.message : `Couldn't save the ${kind}. Try again.`}
        </p>
      )}
      <div className="flex justify-end gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : kind === 'customer' ? 'Save customer' : 'Save vendor'}
        </Button>
      </div>
    </form>
  );
}

interface VendorBanking {
  bankAccount: { accountName: string | null; accountNumber: string; ifsc: string; bankName: string | null } | null;
  msme: { udyamNumber: string; category: 'micro' | 'small' | 'medium'; activity: 'manufacturing' | 'services' | 'trading'; writtenAgreement: boolean } | null;
}

/**
 * Where a vendor is paid, and their MSME registration. A changed bank account
 * is worth a phone call to the vendor before the next payment: it is the
 * usual first step of invoice fraud.
 */
function VendorBankingSection({ id, onSaved }: { id: string; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['purchase', 'vendor', id], queryFn: () => api.get<ApiParty & VendorBanking>(`/purchase/vendors/${id}`) });
  const [editing, setEditing] = useState(false);
  const [bank, setBank] = useState({ accountName: '', accountNumber: '', ifsc: '', bankName: '' });
  const [msme, setMsme] = useState({ registered: false, udyamNumber: '', category: 'micro', activity: 'manufacturing', writtenAgreement: false });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/purchase/vendors/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchase'] });
      setEditing(false);
      onSaved('Vendor saved');
    },
  });

  if (!data) return null;
  const start = () => {
    setBank({
      accountName: data.bankAccount?.accountName ?? '',
      accountNumber: data.bankAccount?.accountNumber ?? '',
      ifsc: data.bankAccount?.ifsc ?? '',
      bankName: data.bankAccount?.bankName ?? '',
    });
    setMsme({
      registered: !!data.msme,
      udyamNumber: data.msme?.udyamNumber ?? '',
      category: data.msme?.category ?? 'micro',
      activity: data.msme?.activity ?? 'manufacturing',
      writtenAgreement: data.msme?.writtenAgreement ?? false,
    });
    save.reset();
    setEditing(true);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({
      bankAccount: bank.accountNumber.trim()
        ? { accountName: bank.accountName.trim() || null, accountNumber: bank.accountNumber.trim(), ifsc: bank.ifsc.trim(), bankName: bank.bankName.trim() || null }
        : null,
      msme: msme.registered ? { udyamNumber: msme.udyamNumber.trim(), category: msme.category, activity: msme.activity, writtenAgreement: msme.writtenAgreement } : null,
    });
  };
  const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const label = 'text-caption font-medium text-ink-700 block mb-1';
  const protectedMsme = data.msme && data.msme.category !== 'medium' && data.msme.activity !== 'trading';

  if (!editing) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-caption font-semibold uppercase tracking-wide text-ink-500">Payment details</p>
          <button type="button" className="text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline" onClick={start}>
            Edit
          </button>
        </div>
        <Row label="Bank account">
          {data.bankAccount ? (
            <span className="font-mono">
              ••••{data.bankAccount.accountNumber.slice(-4)} · {data.bankAccount.ifsc}
              {data.bankAccount.bankName ? ` · ${data.bankAccount.bankName}` : ''}
            </span>
          ) : (
            <span className="text-ink-400">Not on file</span>
          )}
        </Row>
        <Row label="MSME">
          {data.msme ? (
            <span>
              <span className="font-mono">{data.msme.udyamNumber}</span> · {data.msme.category}, {data.msme.activity}
              {protectedMsme && (
                <span className="block text-caption text-pending-fg">
                  Pay within {data.msme.writtenAgreement ? 'the agreed days, at most 45' : '15 days'} (43B(h))
                </span>
              )}
            </span>
          ) : (
            <span className="text-ink-400">Not registered, or not known</span>
          )}
        </Row>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-line-200 bg-surface-sink p-3">
      <p className="text-caption font-semibold uppercase tracking-wide text-ink-500">Bank account</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={label}>Account name</label>
          <input className={field} value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} />
        </div>
        <div>
          <label className={label}>Account number</label>
          <input className={`${field} font-mono`} inputMode="numeric" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} />
        </div>
        <div>
          <label className={label}>IFSC</label>
          <input className={`${field} font-mono uppercase`} value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value })} placeholder="HDFC0001234" />
        </div>
        <div className="col-span-2">
          <label className={label}>Bank</label>
          <input className={field} value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
        </div>
      </div>
      {data.bankAccount && bank.accountNumber.replace(/[\s-]/g, '') !== data.bankAccount.accountNumber && (
        <p className="text-caption text-pending-fg">
          Changing where a vendor is paid? Confirm it with them on a number you already have, not one from the email asking for the change.
        </p>
      )}

      <label className="flex items-center gap-2 pt-1 text-body text-ink-900">
        <input type="checkbox" checked={msme.registered} onChange={(e) => setMsme({ ...msme, registered: e.target.checked })} />
        Registered as an MSME (Udyam)
      </label>
      {msme.registered && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label}>Udyam number</label>
            <input className={`${field} font-mono uppercase`} value={msme.udyamNumber} onChange={(e) => setMsme({ ...msme, udyamNumber: e.target.value })} placeholder="UDYAM-MH-26-0012345" />
          </div>
          <div>
            <label className={label}>Category</label>
            <select className={field} value={msme.category} onChange={(e) => setMsme({ ...msme, category: e.target.value })}>
              <option value="micro">Micro</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
            </select>
          </div>
          <div>
            <label className={label}>Activity</label>
            <select className={field} value={msme.activity} onChange={(e) => setMsme({ ...msme, activity: e.target.value })}>
              <option value="manufacturing">Manufacturing</option>
              <option value="services">Services</option>
              <option value="trading">Trading</option>
            </select>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-body text-ink-900">
            <input type="checkbox" checked={msme.writtenAgreement} onChange={(e) => setMsme({ ...msme, writtenAgreement: e.target.checked })} />
            We have a written agreement on payment terms
          </label>
        </div>
      )}
      {save.isError && (
        <p className="text-caption text-error-fg">{save.error instanceof ApiError && save.error.message ? save.error.message : "Couldn't save the vendor."}</p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save vendor'}
        </Button>
      </div>
    </form>
  );
}

export function PartyDetailDialog({
  kind,
  party,
  documents,
  onClose,
  onSaved,
}: {
  kind: 'customer' | 'vendor';
  party: { id: string; name: string; gstin: string | null; balancePaise: number } | null;
  documents: PartyDocument[];
  onClose: () => void;
  /** Called after an edit is saved, with the toast to show. */
  onSaved?: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const close = () => {
    setEditing(false);
    onClose();
  };
  return (
    <Dialog open={!!party} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{party?.name}</DialogTitle>
          <DialogDescription>{kind === 'customer' ? 'Customer' : 'Vendor'}</DialogDescription>
        </DialogHeader>
        {party && editing && (
          <PartyEditForm
            kind={kind}
            id={party.id}
            onDone={(saved) => {
              setEditing(false);
              if (saved) onSaved?.(kind === 'customer' ? 'Customer saved' : 'Vendor saved');
            }}
          />
        )}
        {party && !editing && (
          <div className="space-y-4">
            <div className="flex justify-end gap-4">
              <a
                href={`/audit?entityType=${kind === 'customer' ? 'Customer' : 'Vendor'}&entityId=${party.id}`}
                className="text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline"
              >
                History
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline"
                onClick={() => setEditing(true)}
              >
                <Pencil size={12} /> Edit details
              </button>
            </div>
            {kind === 'vendor' && <VendorBankingSection id={party.id} onSaved={(m) => onSaved?.(m)} />}
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
