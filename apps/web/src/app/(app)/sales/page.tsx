'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { DocumentUploadButton } from '@/components/shell/document-upload-button';
import { DocumentDetailDialog, PartyDetailDialog } from '@/components/shell/record-detail-dialogs';
import { RecordPaymentDialog } from '@/components/shell/record-payment-dialog';
import { AdjustmentNoteDialog } from '@/components/shell/adjustment-note-dialog';
import { AgeingBuckets } from '@/components/shell/ageing-buckets';
import { RecordPartyPaymentDialog } from '@/components/payments/record-party-payment-dialog';
import { AdvancesPanel } from '@/components/payments/advances-panel';
import { Plus, ChevronRight, Send, FileDown, Mail } from 'lucide-react';
import { InvoiceStatus as SharedInvoiceStatus } from '@ai-accounting/shared';
import { api, downloadFile } from '@/lib/api';
import { EmailInvoiceDialog } from '@/components/sales/email-invoice-dialog';
import { GST_RATES, GST_STATES, GstRate, splitGst, rupeesToPaise, formatPaise } from '@/lib/gst';
import { TableError } from '@/components/ui/query-error';

// ── Types ─────────────────────────────────────────────────────────────────

// Imported rather than redeclared: a local copy of this union is how the
// chart of accounts ended up filtering on values the API never sends.
type InvoiceStatus = `${SharedInvoiceStatus}`;

interface Invoice {
  _id: string;
  customerId?: string | null;
  customerName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  totalPaise: number;
  /** Paid so far, and still owed — part payments leave both non-zero. */
  amountPaidPaise: number;
  outstandingPaise: number;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  /** Set when this row was read off an upload; null when typed in by hand. */
  sourceDocumentId?: string | null;
  /** Set when a recurring schedule drafted this invoice. */
  recurringTemplateId?: string | null;
}

interface Customer {
  _id: string;
  name: string;
  gstin: string | null;
  /** GST state code: the place of supply for their invoices. */
  stateCode?: string | null;
  /** Where "Email invoice" sends the PDF unless another address is typed. */
  email?: string | null;
  receivablePaise: number;
}

function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

// ── Formatters ────────────────────────────────────────────────────────────

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(paise / 100);
}

// ── Status badge ──────────────────────────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const variants: Record<InvoiceStatus, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-surface-sink text-ink-500 border border-line-200' },
    sent: { label: 'Sent', className: 'bg-pending-bg text-pending-fg border border-pending-fg/30' },
    posted: { label: 'Posted', className: 'bg-pending-bg text-pending-fg border border-pending-fg/30' },
    paid: { label: 'Paid', className: 'bg-success-bg text-success-fg border border-success-fg/30' },
  };
  const { label, className } = variants[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${className}`}>{label}</span>;
}

// ── Tabs ──────────────────────────────────────────────────────────────────

type Tab = 'Invoices' | 'Customers' | 'Receivables';

// ── Add Customer Modal ────────────────────────────────────────────────────

interface AddCustomerModalProps {
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

/**
 * The invoice form told people to add a customer on the Customers tab, and the
 * tab had no way to add one.
 */
function AddCustomerModal({ onClose, onSuccess, showToast }: AddCustomerModalProps) {
  const [form, setForm] = useState({ name: '', gstin: '', stateCode: '', email: '', phone: '' });
  const [nameError, setNameError] = useState<string | null>(null);
  const gstin = form.gstin.trim().toUpperCase();
  // A GSTIN starts with the state it was issued in, so it settles the question.
  const stateFromGstin = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/sales/customers', body),
    onSuccess: () => {
      showToast('Customer added');
      onSuccess();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setNameError('Required');
      return;
    }
    const body: Record<string, string> = { name: form.name.trim() };
    if (gstin) body.gstin = gstin;
    else if (form.stateCode) body.stateCode = form.stateCode;
    if (form.email.trim()) body.email = form.email.trim();
    if (form.phone.trim()) body.phone = form.phone.trim();
    mutation.mutate(body);
  };

  const field =
    'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-surface-card rounded-xl border border-line-200 shadow-xl w-full max-w-md p-6">
        <h2 className="text-h3 font-display text-ink-900 mb-5">New customer</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">
              Customer name <span className="text-error-fg">*</span>
            </label>
            <input
              type="text"
              className={field}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sharma Traders"
            />
            {nameError && <p className="text-caption text-error-fg mt-1">{nameError}</p>}
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">
              GSTIN <span className="text-ink-400">(leave blank if unregistered)</span>
            </label>
            <input
              type="text"
              className={`${field} font-mono`}
              value={form.gstin}
              onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))}
              placeholder="e.g. 27AAPFU0939F1ZV"
            />
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">State</label>
            {stateFromGstin ? (
              <p className="text-body text-ink-700">{stateName(stateFromGstin)} — from the GSTIN</p>
            ) : (
              <>
                <select
                  className={field}
                  value={form.stateCode}
                  onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value }))}
                >
                  <option value="">Choose a state</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-caption text-ink-500 mt-1">
                  The place of supply on your GSTR-1 for sales to this customer.
                </p>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">Email</label>
              <input
                type="email"
                className={field}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">Phone</label>
              <input
                type="tel"
                className={field}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          {mutation.isError && (
            <p className="text-caption text-error-fg">
              {(mutation.error as Error).message || "Couldn't save the customer. Try again."}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Add customer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Invoice Modal ─────────────────────────────────────────────────────

interface AddInvoiceModalProps {
  /** Existing customers — the API takes a customerId, not a typed-in name. */
  customers: Customer[];
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

function AddInvoiceModal({ customers, onClose, onSuccess, showToast }: AddInvoiceModalProps) {
  const [form, setForm] = useState({
    customerId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    taxableRupees: '',
    rate: 18 as GstRate,
    interState: false,
    description: '',
    hsnSac: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const taxablePaise = rupeesToPaise(form.taxableRupees) ?? 0;
  const amounts = splitGst(taxablePaise, form.rate, form.interState);

  const mutation = useMutation({
    mutationFn: (body: unknown) => api.post('/sales/invoices', body),
    onSuccess: () => {
      showToast('Invoice created');
      onSuccess();
      onClose();
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.customerId) e.customerId = 'Choose a customer';
    if (!form.invoiceDate) e.invoiceDate = 'Required';
    if (rupeesToPaise(form.taxableRupees) === null || taxablePaise <= 0)
      e.taxableRupees = 'Enter a valid amount';
    if (form.dueDate && form.dueDate < form.invoiceDate)
      e.dueDate = 'Due date cannot precede the invoice date';
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    // The shape the API actually takes: a customer id, a full tax breakdown in
    // paise, and the line items behind it.
    mutation.mutate({
      customerId: form.customerId,
      invoiceNumber: form.invoiceNumber.trim() || null,
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate || null,
      amountsPaise: amounts,
      lineItems: [
        {
          description: form.description.trim() || 'Sale',
          hsnSac: form.hsnSac.trim() || null,
          qty: 1,
          ratePaise: amounts.taxableValue,
          amountPaise: amounts.taxableValue,
          taxRatePct: form.rate,
        },
      ],
      notes: form.description.trim() || null,
    });
  };

  const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line-200 bg-surface-card p-6 shadow-xl">
        <h2 className="text-h3 font-display text-ink-900 mb-5">New invoice</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">
              Customer <span className="text-error-fg">*</span>
            </label>
            <select
              className={field}
              value={form.customerId}
              onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
            >
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.gstin ? ` · ${c.gstin}` : ''}
                </option>
              ))}
            </select>
            {customers.length === 0 && (
              <p className="mt-1 text-caption text-ink-500">
                No customers yet — add one on the Customers tab first.
              </p>
            )}
            {errors.customerId && <p className="text-caption text-error-fg mt-1">{errors.customerId}</p>}
          </div>

          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Invoice number</label>
            <input
              type="text"
              className={field}
              value={form.invoiceNumber}
              onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
              placeholder="Leave blank to number it automatically"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">
                Invoice date <span className="text-error-fg">*</span>
              </label>
              <input
                type="date"
                className={field}
                value={form.invoiceDate}
                onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))}
              />
              {errors.invoiceDate && <p className="text-caption text-error-fg mt-1">{errors.invoiceDate}</p>}
            </div>
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">Due date</label>
              <input
                type="date"
                className={field}
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
              {errors.dueDate && <p className="text-caption text-error-fg mt-1">{errors.dueDate}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">
                Taxable amount (₹) <span className="text-error-fg">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={`${field} font-mono`}
                value={form.taxableRupees}
                onChange={(e) => setForm((f) => ({ ...f, taxableRupees: e.target.value }))}
                placeholder="0.00"
              />
              {errors.taxableRupees && <p className="text-caption text-error-fg mt-1">{errors.taxableRupees}</p>}
            </div>
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">GST rate</label>
              <select
                className={field}
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) as GstRate }))}
              >
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>{r}%</option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-caption text-ink-700">
            <input
              type="checkbox"
              checked={form.interState}
              onChange={(e) => setForm((f) => ({ ...f, interState: e.target.checked }))}
              className="h-4 w-4 rounded border-line-200 accent-saffron-600"
            />
            Inter-state supply (IGST instead of CGST + SGST)
          </label>

          {/* What will actually be stored, before it is stored. */}
          {taxablePaise > 0 && (
            <dl className="rounded-md border border-line-200 bg-surface-sink px-3 py-2 text-caption">
              <div className="flex justify-between py-0.5">
                <dt className="text-ink-500">Taxable</dt>
                <dd className="font-mono text-ink-900">{formatPaise(amounts.taxableValue)}</dd>
              </div>
              {form.interState ? (
                <div className="flex justify-between py-0.5">
                  <dt className="text-ink-500">IGST {form.rate}%</dt>
                  <dd className="font-mono text-ink-900">{formatPaise(amounts.igst)}</dd>
                </div>
              ) : (
                <>
                  <div className="flex justify-between py-0.5">
                    <dt className="text-ink-500">CGST {form.rate / 2}%</dt>
                    <dd className="font-mono text-ink-900">{formatPaise(amounts.cgst)}</dd>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <dt className="text-ink-500">SGST {form.rate / 2}%</dt>
                    <dd className="font-mono text-ink-900">{formatPaise(amounts.sgst)}</dd>
                  </div>
                </>
              )}
              <div className="mt-1 flex justify-between border-t border-line-200 pt-1 font-medium">
                <dt className="text-ink-700">Total</dt>
                <dd className="font-mono text-ink-900">{formatPaise(amounts.total)}</dd>
              </div>
            </dl>
          )}

          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">Description</label>
              <input
                type="text"
                className={field}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What was sold"
              />
            </div>
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">HSN/SAC</label>
              <input
                type="text"
                inputMode="numeric"
                className={`${field} font-mono`}
                value={form.hsnSac}
                onChange={(e) => setForm((f) => ({ ...f, hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                placeholder="e.g. 998314"
              />
            </div>
          </div>
          <p className="-mt-2 text-caption text-ink-500">The HSN or SAC code goes on your GSTR-1 HSN summary.</p>

          {mutation.isError && (
            <p className="text-caption text-error-fg">{(mutation.error as Error).message}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Create invoice'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Whether this row was typed in or read off an upload.
 *
 * Once posted the two are identical in the ledger, which is correct — but when
 * a figure looks wrong the first question is always "where did this come from",
 * and the answer was not on the screen.
 */
function SourceChip({ documentId, recurring }: { documentId?: string | null; recurring?: boolean }) {
  if (recurring) {
    return (
      <Link
        href="/recurring"
        title="Drafted from a recurring schedule"
        className="rounded bg-info-bg px-1.5 py-0.5 text-[10px] font-medium text-info-fg hover:underline"
      >
        Recurring
      </Link>
    );
  }
  if (!documentId) {
    return (
      <span title="Entered by hand" className="rounded bg-surface-sink px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
        Manual
      </span>
    );
  }
  return (
    <Link
      href="/inbox"
      title="Read from an uploaded document — open the Inbox"
      className="rounded bg-honey-100 px-1.5 py-0.5 text-[10px] font-medium text-pending-fg hover:underline"
    >
      Scanned
    </Link>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Invoices');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [emailingInvoice, setEmailingInvoice] = useState<Invoice | null>(null);
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [notingInvoice, setNotingInvoice] = useState<Invoice | null>(null);
  const [openCustomer, setOpenCustomer] = useState<Customer | null>(null);

  const queryClient = useQueryClient();
  const [recordingPayment, setRecordingPayment] = useState(false);

  /**
   * Posting is what moves the ledger — creating an invoice only records it.
   * Both refresh the journals and reports caches, because a posting changes
   * every figure derived from them.
   */
  const afterLedgerChange = () => {
    void queryClient.invalidateQueries({ queryKey: ['sales'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const invoicesQuery = useQuery<Invoice[]>({
    queryKey: ['sales', 'invoices'],
    queryFn: () => api.get<Invoice[]>('/sales/invoices'),
  });

  const [showCustomerModal, setShowCustomerModal] = useState(false);

  const customersQuery = useQuery<Customer[]>({
    queryKey: ['sales', 'customers'],
    queryFn: () => api.get<Customer[]>('/sales/customers'),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/invoices/${id}/send`),
    onSuccess: () => {
      showToast('Marked as sent');
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (e) => showToast((e as Error).message, 'info'),
  });

  // Chase one invoice now. The API words it, logs it and queues it.
  const remindMutation = useMutation({
    mutationFn: (id: string) => api.post<{ to: string }>(`/reminders/invoices/${id}`),
    onSuccess: (reminder) => showToast(`Reminder sent to ${reminder.to}`),
    onError: (e) => showToast((e as Error).message, 'info'),
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/invoices/${id}/post`),
    onSuccess: () => {
      showToast('Posted to ledger');
      afterLedgerChange();
    },
    onError: (e) => showToast((e as Error).message, 'info'),
  });

  const invoices = invoicesQuery.data ?? [];
  // Open invoices, for recording a receipt across several and applying advances.
  const openDocuments = invoices
    .filter((d) => d.status === 'posted' && d.outstandingPaise > 0)
    .map((d) => ({ id: d._id, partyId: d.customerId ?? null, number: d.invoiceNumber, date: d.invoiceDate, owedPaise: d.outstandingPaise }));
  const customers = customersQuery.data ?? [];

  const totalReceivable = customers.reduce((s, c) => s + c.receivablePaise, 0);
  const openInvoices = invoices.filter((i) => i.status !== 'paid' && i.status !== 'draft');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900">
            Sales
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Invoices, customers, and what you are owed.
          </p>
        </div>
        <div className="flex items-start gap-2">
          {/* Two ways in: photograph the document and let the pipeline read it,
              or type it yourself when there is nothing to scan. */}
          <DocumentUploadButton
            label="Upload invoice"
            onUploaded={(msg) => showToast(msg)}
          />
          <Button variant="secondary" onClick={() => setRecordingPayment(true)}>
            Record receipt
          </Button>
          <Button
            onClick={() => setShowInvoiceModal(true)}
            className="flex items-center gap-2"
          >
            <Plus size={14} />
            New invoice
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Total receivable</p>
          <p className="text-h2 font-mono text-ink-900">{formatRupees(totalReceivable)}</p>
        </div>
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Open invoices</p>
          <p className="text-h2 font-mono text-ink-900">{openInvoices.length}</p>
        </div>
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Customers</p>
          <p className="text-h2 font-mono text-ink-900">{customers.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-line-200">
        <nav className="flex gap-0">
          {(['Invoices', 'Customers', 'Receivables'] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-body font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-saffron-600 text-saffron-600'
                  : 'border-transparent text-ink-500 hover:text-ink-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Invoices tab */}
      {activeTab === 'Invoices' && (
        <div>
          {invoicesQuery.isLoading ? (
            <div className="rounded-lg border border-line-200 overflow-hidden">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Invoice no.</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Date</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Due</th>
                    <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : invoicesQuery.isError ? (
            <div className="rounded-lg border border-line-200 overflow-hidden">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Invoice no.</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Date</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Due</th>
                    <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  <TableError error={invoicesQuery.error} colSpan={7} onRetry={() => void invoicesQuery.refetch()} />
                </tbody>
              </table>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-h3 font-display text-ink-700 mb-2">
                Create your first invoice.
              </p>
              <Button onClick={() => setShowInvoiceModal(true)}>
                <Plus size={14} className="mr-2" />
                New invoice
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-line-200 overflow-hidden">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Invoice no.</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Date</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Due</th>
                    <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-100">
                  {invoices.map((inv) => (
                    <tr key={inv._id} className="bg-surface-card hover:bg-surface-sink/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink-900">{inv.customerName}</td>
                      <td className="px-4 py-3 font-mono text-caption text-ink-600">
                        <span className="flex items-center gap-2">
                          {inv.invoiceNumber ?? <span className="text-ink-400">—</span>}
                          <SourceChip documentId={inv.sourceDocumentId} recurring={!!inv.recurringTemplateId} />
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-600">
                        {new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-caption text-ink-500">
                        {inv.dueDate
                          ? new Date(inv.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-ink-900">
                        {formatRupees(inv.totalPaise)}
                        {inv.amountPaidPaise > 0 && inv.outstandingPaise > 0 && (
                          <span className="block text-caption font-normal text-pending-fg">
                            {formatRupees(inv.outstandingPaise)} due
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {inv.status === 'draft' && (
                            <>
                              <button
                                type="button"
                                title="Mark as sent (you sent it yourself)"
                                onClick={() => sendMutation.mutate(inv._id)}
                                disabled={sendMutation.isPending}
                                className="text-ink-400 hover:text-saffron-600 transition-colors disabled:opacity-40"
                              >
                                <Send size={14} />
                              </button>
                              {/* The only action here that reaches the ledger. */}
                              <button
                                type="button"
                                onClick={() => postMutation.mutate(inv._id)}
                                disabled={postMutation.isPending}
                                className="rounded border border-saffron-600/30 px-2 py-0.5 text-caption font-medium text-saffron-600 transition-colors hover:bg-saffron-600/10 disabled:opacity-40"
                              >
                                Post to ledger
                              </button>
                            </>
                          )}
                          {inv.status === 'posted' && (
                            <button
                              type="button"
                              onClick={() => setPayingInvoice(inv)}
                              className="rounded border border-success-fg/30 px-2 py-0.5 text-caption font-medium text-success-fg transition-colors hover:bg-success-bg disabled:opacity-40"
                            >
                              Mark paid
                            </button>
                          )}
                          {inv.status === 'posted' && (
                            <button
                              type="button"
                              onClick={() => setNotingInvoice(inv)}
                              className="rounded border border-line-200 px-2 py-0.5 text-caption font-medium text-ink-600 transition-colors hover:bg-surface-sink"
                            >
                              Credit note
                            </button>
                          )}
                          <button
                            type="button"
                            title="Download PDF"
                            aria-label={`Download invoice ${inv.invoiceNumber ?? ''} as PDF`}
                            onClick={() =>
                              void downloadFile(`/sales/invoices/${inv._id}/pdf`, `Invoice-${(inv.invoiceNumber ?? 'draft').replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`).catch(
                                (e: Error) => showToast(e.message || "Couldn't download the PDF", 'info'),
                              )
                            }
                            className="text-ink-400 hover:text-ink-700 transition-colors"
                          >
                            <FileDown size={14} />
                          </button>
                          {inv.invoiceNumber && (
                            <button
                              type="button"
                              title="Email invoice"
                              aria-label={`Email invoice ${inv.invoiceNumber}`}
                              onClick={() => setEmailingInvoice(inv)}
                              className="text-ink-400 hover:text-saffron-600 transition-colors"
                            >
                              <Mail size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-ink-400 hover:text-ink-700 transition-colors"
                            aria-label={`Open invoice ${inv.invoiceNumber ?? ''}`}
                            onClick={() => setOpenInvoice(inv)}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Customers tab */}
      {activeTab === 'Customers' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowCustomerModal(true)} className="flex items-center gap-2">
              <Plus size={14} />
              New customer
            </Button>
          </div>
          <div className="rounded-lg border border-line-200 overflow-hidden">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">GSTIN</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">State</th>
                  <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Receivable</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {customersQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                  </tr>
                ) : customersQuery.isError ? (
                  <TableError error={customersQuery.error} colSpan={5} onRetry={() => void customersQuery.refetch()} />
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-caption text-ink-400">
                      No customers yet. Add one to start invoicing.
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => (
                    <tr key={customer._id} className="bg-surface-card hover:bg-surface-sink/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink-900">{customer.name}</td>
                      <td className="px-4 py-3 font-mono text-caption text-ink-600">
                        {customer.gstin ?? <span className="text-ink-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-caption text-ink-600">
                        {stateName(customer.stateCode) ?? (
                          <span className="text-pending-fg" title="Needed for GSTR-1 when they have no GSTIN">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {customer.receivablePaise > 0 ? (
                          <span className="font-mono font-medium text-ink-900">
                            {formatRupees(customer.receivablePaise)}
                          </span>
                        ) : (
                          <span className="text-success-fg font-medium text-caption">Cleared</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-ink-400 hover:text-ink-700 transition-colors"
                          aria-label={`Open ${customer.name}`}
                          onClick={() => setOpenCustomer(customer)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Receivables tab */}
      {activeTab === 'Receivables' && (
        <div className="space-y-4">
          <p className="text-caption text-ink-500">AR ageing — what customers still owe, by days past the due date.</p>
          <AgeingBuckets kind="receivable" />
          <AdvancesPanel kind="receipt" documents={openDocuments} onDone={(m) => showToast(m)} />

          <div className="rounded-lg border border-line-200 overflow-hidden">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Invoice no.</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                  <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {invoicesQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                  </tr>
                ) : invoicesQuery.isError ? (
                  <TableError error={invoicesQuery.error} colSpan={5} onRetry={() => void invoicesQuery.refetch()} />
                ) : (
                  invoices.filter((i) => i.status === 'posted' || i.status === 'sent').map((inv) => (
                    <tr key={inv._id} className="bg-surface-card">
                      <td className="px-4 py-3 font-medium text-ink-900">{inv.customerName}</td>
                      <td className="px-4 py-3 font-mono text-caption text-ink-600">
                        {inv.invoiceNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-ink-900">
                        {formatRupees(inv.outstandingPaise)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inv.outstandingPaise > 0 && (
                          <button
                            type="button"
                            disabled={remindMutation.isPending}
                            onClick={() => remindMutation.mutate(inv._id)}
                            className="inline-flex items-center gap-1 text-caption font-medium text-brand-600 hover:underline disabled:opacity-50"
                          >
                            <Send size={12} /> Send reminder
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toast */}
      <AdjustmentNoteDialog
        kind="credit"
        document={
          notingInvoice && {
            id: notingInvoice._id,
            number: notingInvoice.invoiceNumber,
            partyName: notingInvoice.customerName,
            date: notingInvoice.invoiceDate,
            outstandingPaise: notingInvoice.outstandingPaise,
            amountsPaise: notingInvoice.amountsPaise,
          }
        }
        onClose={() => setNotingInvoice(null)}
        onRaised={(message) => {
          showToast(message);
          afterLedgerChange();
        }}
      />
      <RecordPaymentDialog
        kind="invoice"
        document={
          payingInvoice && {
            id: payingInvoice._id,
            number: payingInvoice.invoiceNumber,
            partyName: payingInvoice.customerName,
            outstandingPaise: payingInvoice.outstandingPaise,
          }
        }
        onClose={() => setPayingInvoice(null)}
        onRecorded={(message) => {
          showToast(message);
          afterLedgerChange();
        }}
      />
      <DocumentDetailDialog
        kind="invoice"
        id={openInvoice?._id ?? null}
        partyName={openInvoice?.customerName ?? ''}
        onClose={() => setOpenInvoice(null)}
      />
      <EmailInvoiceDialog
        invoice={emailingInvoice}
        customerEmail={customers.find((c) => c._id === emailingInvoice?.customerId)?.email ?? null}
        onClose={() => setEmailingInvoice(null)}
        onSent={(m) => showToast(m)}
      />

      <RecordPartyPaymentDialog
        open={recordingPayment}
        kind="receipt"
        parties={customers}
        documents={openDocuments}
        onClose={() => setRecordingPayment(false)}
        onDone={(m) => showToast(m)}
      />

      <PartyDetailDialog
        kind="customer"
        party={
          openCustomer && {
            id: openCustomer._id,
            name: openCustomer.name,
            gstin: openCustomer.gstin,
            balancePaise: openCustomer.receivablePaise,
          }
        }
        documents={invoices
          .filter((i) => i.customerId === openCustomer?._id)
          .map((i) => ({ id: i._id, number: i.invoiceNumber, date: i.invoiceDate, status: i.status, totalPaise: i.totalPaise }))}
        onClose={() => setOpenCustomer(null)}
        onSaved={(message) => showToast(message)}
      />

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-md px-4 py-3 text-body font-medium shadow-lg border ${
            toast.type === 'success'
              ? 'bg-success-bg border-success-fg text-success-fg'
              : 'bg-surface-card border-line-200 text-ink-700'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      {/* Modals */}
      {showCustomerModal && (
        <AddCustomerModal
          onClose={() => setShowCustomerModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['sales', 'customers'] })}
          showToast={showToast}
        />
      )}
      {showInvoiceModal && (
        <AddInvoiceModal
          customers={customersQuery.data ?? []}
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['sales', 'invoices'] })}
          showToast={showToast}
        />
      )}
    </div>
  );
}
