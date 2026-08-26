'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { DocumentUploadButton } from '@/components/shell/document-upload-button';
import { Plus, ChevronRight, Send } from 'lucide-react';
import { InvoiceStatus as SharedInvoiceStatus } from '@ai-accounting/shared';
import { api } from '@/lib/api';
import { GST_RATES, GstRate, splitGst, rupeesToPaise, formatPaise } from '@/lib/gst';
import { TableError } from '@/components/ui/query-error';

// ── Types ─────────────────────────────────────────────────────────────────

// Imported rather than redeclared: a local copy of this union is how the
// chart of accounts ended up filtering on values the API never sends.
type InvoiceStatus = `${SharedInvoiceStatus}`;

interface Invoice {
  _id: string;
  customerName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  totalPaise: number;
}

interface Customer {
  _id: string;
  name: string;
  gstin: string | null;
  receivablePaise: number;
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
        <h2 className="text-h3 font-display text-ink-900 mb-5" style={{ fontFamily: 'var(--font-display)' }}>New invoice</h2>
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

// ── Page ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Invoices');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const queryClient = useQueryClient();

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

  const customersQuery = useQuery<Customer[]>({
    queryKey: ['sales', 'customers'],
    queryFn: () => api.get<Customer[]>('/sales/customers'),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/invoices/${id}/send`),
    onSuccess: () => {
      showToast('Invoice sent');
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
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

  const payMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/invoices/${id}/pay`),
    onSuccess: () => {
      showToast('Payment recorded');
      afterLedgerChange();
    },
    onError: (e) => showToast((e as Error).message, 'info'),
  });

  const invoices = invoicesQuery.data ?? [];
  const customers = customersQuery.data ?? [];

  const totalReceivable = customers.reduce((s, c) => s + c.receivablePaise, 0);
  const openInvoices = invoices.filter((i) => i.status !== 'paid' && i.status !== 'draft');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
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
              <p className="text-h3 font-display text-ink-700 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
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
                        {inv.invoiceNumber ?? <span className="text-ink-400">—</span>}
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
                                title="Send invoice"
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
                          {(inv.status === 'sent' || inv.status === 'posted') && (
                            <button
                              type="button"
                              onClick={() => payMutation.mutate(inv._id)}
                              disabled={payMutation.isPending}
                              className="rounded border border-success-fg/30 px-2 py-0.5 text-caption font-medium text-success-fg transition-colors hover:bg-success-bg disabled:opacity-40"
                            >
                              Mark paid
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-ink-400 hover:text-ink-700 transition-colors"
                            onClick={() => showToast(`Invoice ${inv._id} — detail view coming soon`, 'info')}
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
        <div className="rounded-lg border border-line-200 overflow-hidden">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">GSTIN</th>
                <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Receivable</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-100">
              {customersQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                </tr>
              ) : customersQuery.isError ? (
                <TableError error={customersQuery.error} colSpan={4} onRetry={() => void customersQuery.refetch()} />
              ) : (
                customers.map((customer) => (
                  <tr key={customer._id} className="bg-surface-card hover:bg-surface-sink/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-ink-900">{customer.name}</td>
                    <td className="px-4 py-3 font-mono text-caption text-ink-600">
                      {customer.gstin ?? <span className="text-ink-400">—</span>}
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
                        onClick={() => showToast(`Customer ${customer._id} — detail view coming soon`, 'info')}
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
      )}

      {/* Receivables tab */}
      {activeTab === 'Receivables' && (
        <div className="space-y-4">
          <p className="text-caption text-ink-500">AR ageing — open invoices by days past due date.</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '0–30 days', paise: 2950000, color: 'text-pending-fg' },
              { label: '31–60 days', paise: 1180000, color: 'text-error-fg' },
              { label: '61–90 days', paise: 0, color: 'text-error-fg' },
              { label: '90+ days', paise: 0, color: 'text-error-fg' },
            ].map((bucket) => (
              <div key={bucket.label} className="rounded-lg border border-line-200 bg-surface-card p-4">
                <p className="text-caption text-ink-500 mb-1">{bucket.label}</p>
                <p className={`text-h3 font-mono font-semibold ${bucket.paise > 0 ? bucket.color : 'text-ink-400'}`}>
                  {formatRupees(bucket.paise)}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-line-200 overflow-hidden">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Customer</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Invoice no.</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                  <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {invoicesQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                  </tr>
                ) : invoicesQuery.isError ? (
                  <TableError error={invoicesQuery.error} colSpan={4} onRetry={() => void invoicesQuery.refetch()} />
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
                        {formatRupees(inv.totalPaise)}
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
