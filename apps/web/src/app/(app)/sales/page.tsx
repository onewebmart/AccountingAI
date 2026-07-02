'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, ChevronRight, Send } from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────

type InvoiceStatus = 'draft' | 'sent' | 'posted' | 'paid';

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

// ── Mock fallbacks ────────────────────────────────────────────────────────

const MOCK_INVOICES: Invoice[] = [
  {
    _id: 'inv-001',
    customerName: 'Rahul Enterprises',
    invoiceNumber: 'INV-2025-0214',
    invoiceDate: '2025-03-15',
    dueDate: '2025-04-14',
    status: 'posted',
    totalPaise: 2950000,
  },
  {
    _id: 'inv-002',
    customerName: 'TechSoft Solutions Ltd',
    invoiceNumber: 'INV-2025-0215',
    invoiceDate: '2025-03-18',
    dueDate: '2025-04-17',
    status: 'sent',
    totalPaise: 1180000,
  },
  {
    _id: 'inv-003',
    customerName: 'Kalyani Traders',
    invoiceNumber: 'INV-2025-0213',
    invoiceDate: '2025-03-01',
    dueDate: null,
    status: 'paid',
    totalPaise: 590000,
  },
  {
    _id: 'inv-004',
    customerName: 'Mehta & Co',
    invoiceNumber: null,
    invoiceDate: '2025-03-20',
    dueDate: '2025-04-19',
    status: 'draft',
    totalPaise: 472000,
  },
];

const MOCK_CUSTOMERS: Customer[] = [
  { _id: 'c-001', name: 'Rahul Enterprises', gstin: '27AAPFU0939F1ZV', receivablePaise: 2950000 },
  { _id: 'c-002', name: 'TechSoft Solutions Ltd', gstin: '29AAACT2727Q1ZZ', receivablePaise: 1180000 },
  { _id: 'c-003', name: 'Kalyani Traders', gstin: null, receivablePaise: 0 },
  { _id: 'c-004', name: 'Mehta & Co', gstin: '24AACCM5606G1Z5', receivablePaise: 0 },
];

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
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

function AddInvoiceModal({ onClose, onSuccess, showToast }: AddInvoiceModalProps) {
  const [form, setForm] = useState({
    customerName: '',
    invoiceNumber: '',
    invoiceDate: '',
    totalRupees: '',
    description: '',
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});

  const mutation = useMutation({
    mutationFn: (body: { customerName: string; invoiceNumber: string; invoiceDate: string; totalPaise: number; description: string }) =>
      api.post('/sales/invoices', body),
    onSuccess: () => {
      showToast('Invoice created');
      onSuccess();
      onClose();
    },
  });

  const validate = () => {
    const e: Partial<typeof form> = {};
    if (!form.customerName.trim()) e.customerName = 'Required';
    if (!form.invoiceDate) e.invoiceDate = 'Required';
    if (!form.totalRupees || isNaN(Number(form.totalRupees)) || Number(form.totalRupees) <= 0)
      e.totalRupees = 'Enter a valid amount';
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    mutation.mutate({
      customerName: form.customerName.trim(),
      invoiceNumber: form.invoiceNumber.trim(),
      invoiceDate: form.invoiceDate,
      totalPaise: Math.round(Number(form.totalRupees) * 100),
      description: form.description.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-card rounded-xl border border-line-200 shadow-xl w-full max-w-md p-6">
        <h2 className="text-h3 font-display text-ink-900 mb-5" style={{ fontFamily: 'var(--font-display)' }}>New invoice</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Customer name <span className="text-error-fg">*</span></label>
            <input
              type="text"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              placeholder="e.g. Rahul Enterprises"
            />
            {errors.customerName && <p className="text-caption text-error-fg mt-1">{errors.customerName}</p>}
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Invoice number</label>
            <input
              type="text"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.invoiceNumber}
              onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
              placeholder="e.g. INV-2025-0001"
            />
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Invoice date <span className="text-error-fg">*</span></label>
            <input
              type="date"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.invoiceDate}
              onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))}
            />
            {errors.invoiceDate && <p className="text-caption text-error-fg mt-1">{errors.invoiceDate}</p>}
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Amount (₹) <span className="text-error-fg">*</span></label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body font-mono text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.totalRupees}
              onChange={(e) => setForm((f) => ({ ...f, totalRupees: e.target.value }))}
              placeholder="0.00"
            />
            {errors.totalRupees && <p className="text-caption text-error-fg mt-1">{errors.totalRupees}</p>}
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Description</label>
            <input
              type="text"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional notes"
            />
          </div>
          {mutation.isError && (
            <p className="text-caption text-error-fg">Couldn&apos;t create invoice. Try again.</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'New invoice'}
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
      queryClient.invalidateQueries({ queryKey: ['sales', 'invoices'] });
    },
    onError: () => showToast("Couldn&apos;t send invoice. Try again.", 'info'),
  });

  const invoices = (invoicesQuery.data && invoicesQuery.data.length > 0) ? invoicesQuery.data : MOCK_INVOICES;
  const customers = (customersQuery.data && customersQuery.data.length > 0) ? customersQuery.data : MOCK_CUSTOMERS;

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
        <Button
          onClick={() => setShowInvoiceModal(true)}
          className="flex items-center gap-2"
        >
          <Plus size={14} />
          New invoice
        </Button>
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
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-caption text-error-fg">Couldn&apos;t load data.</td>
                  </tr>
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
                            <button
                              type="button"
                              title="Send invoice"
                              onClick={() => sendMutation.mutate(inv._id)}
                              disabled={sendMutation.isPending}
                              className="text-ink-400 hover:text-saffron-600 transition-colors disabled:opacity-40"
                            >
                              <Send size={14} />
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
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-caption text-error-fg">Couldn&apos;t load data.</td>
                </tr>
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
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-caption text-error-fg">Couldn&apos;t load data.</td>
                  </tr>
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
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['sales', 'invoices'] })}
          showToast={showToast}
        />
      )}
    </div>
  );
}
