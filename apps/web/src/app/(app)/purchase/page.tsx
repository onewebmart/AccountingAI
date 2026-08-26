'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { DocumentUploadButton } from '@/components/shell/document-upload-button';
import { Plus, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { GST_RATES, GstRate, splitGst, rupeesToPaise, formatPaise } from '@/lib/gst';
import { TableError } from '@/components/ui/query-error';

// ── Types ─────────────────────────────────────────────────────────────────

type BillStatus = 'draft' | 'posted' | 'paid';

interface Bill {
  _id: string;
  vendorName: string;
  billNumber: string | null;
  billDate: string;
  dueDate: string | null;
  status: BillStatus;
  totalPaise: number;
}

interface Vendor {
  _id: string;
  name: string;
  gstin: string | null;
  outstandingPaise: number;
}

// ── Formatters ────────────────────────────────────────────────────────────

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(paise / 100);
}

function dueDays(dueDateStr: string | null): { label: string; variant: 'overdue' | 'due-soon' | 'ok' } | null {
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `Overdue ${Math.abs(days)} days`, variant: 'overdue' };
  if (days <= 7) return { label: `Due in ${days} days`, variant: 'due-soon' };
  return { label: `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, variant: 'ok' };
}

// ── Status badge ──────────────────────────────────────────────────────────

function BillStatusBadge({ status }: { status: BillStatus }) {
  const variants: Record<BillStatus, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-surface-sink text-ink-500 border border-line-200' },
    posted: { label: 'Posted', className: 'bg-pending-bg text-pending-fg border border-pending-fg/30' },
    paid: { label: 'Paid', className: 'bg-success-bg text-success-fg border border-success-fg/30' },
  };
  const { label, className } = variants[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${className}`}>{label}</span>;
}

// ── Tabs ──────────────────────────────────────────────────────────────────

type Tab = 'Bills' | 'Vendors' | 'Outstanding';

// ── Add Bill Modal ────────────────────────────────────────────────────────

interface AddBillModalProps {
  /** Existing vendors — the API takes a vendorId, not a typed-in name. */
  vendors: Vendor[];
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string) => void;
}

function AddBillModal({ vendors, onClose, onSuccess, showToast }: AddBillModalProps) {
  const [form, setForm] = useState({
    vendorId: '',
    billNumber: '',
    billDate: new Date().toISOString().slice(0, 10),
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
    mutationFn: (body: unknown) => api.post('/purchase/bills', body),
    onSuccess: () => {
      showToast('Bill created');
      onSuccess();
      onClose();
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.vendorId) e.vendorId = 'Choose a vendor';
    if (!form.billDate) e.billDate = 'Required';
    if (rupeesToPaise(form.taxableRupees) === null || taxablePaise <= 0)
      e.taxableRupees = 'Enter a valid amount';
    if (form.dueDate && form.dueDate < form.billDate)
      e.dueDate = 'Due date cannot precede the bill date';
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
      vendorId: form.vendorId,
      billNumber: form.billNumber.trim() || null,
      billDate: form.billDate,
      dueDate: form.dueDate || null,
      amountsPaise: amounts,
      lineItems: [
        {
          description: form.description.trim() || 'Purchase',
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
        <h2 className="text-h3 font-display text-ink-900 mb-5" style={{ fontFamily: 'var(--font-display)' }}>New bill</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">
              Vendor <span className="text-error-fg">*</span>
            </label>
            <select
              className={field}
              value={form.vendorId}
              onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}
            >
              <option value="">Choose a vendor…</option>
              {vendors.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.gstin ? ` · ${c.gstin}` : ''}
                </option>
              ))}
            </select>
            {vendors.length === 0 && (
              <p className="mt-1 text-caption text-ink-500">
                No vendors yet — add one on the Vendors tab first.
              </p>
            )}
            {errors.vendorId && <p className="text-caption text-error-fg mt-1">{errors.vendorId}</p>}
          </div>

          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Bill number</label>
            <input
              type="text"
              className={field}
              value={form.billNumber}
              onChange={(e) => setForm((f) => ({ ...f, billNumber: e.target.value }))}
              placeholder="Vendor's bill number"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption font-medium text-ink-700 block mb-1">
                Bill date <span className="text-error-fg">*</span>
              </label>
              <input
                type="date"
                className={field}
                value={form.billDate}
                onChange={(e) => setForm((f) => ({ ...f, billDate: e.target.value }))}
              />
              {errors.billDate && <p className="text-caption text-error-fg mt-1">{errors.billDate}</p>}
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
              placeholder="What was bought"
            />
          </div>

          {mutation.isError && (
            <p className="text-caption text-error-fg">{(mutation.error as Error).message}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Create bill'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddVendorModalProps {
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string) => void;
}

function AddVendorModal({ onClose, onSuccess, showToast }: AddVendorModalProps) {
  const [form, setForm] = useState({ name: '', gstin: '' });
  const [errors, setErrors] = useState<Partial<typeof form>>({});

  const mutation = useMutation({
    mutationFn: (body: { name: string; gstin?: string }) =>
      api.post('/purchase/vendors', body),
    onSuccess: () => {
      showToast('Vendor added');
      onSuccess();
      onClose();
    },
  });

  const validate = () => {
    const e: Partial<typeof form> = {};
    if (!form.name.trim()) e.name = 'Required';
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    mutation.mutate({
      name: form.name.trim(),
      ...(form.gstin.trim() ? { gstin: form.gstin.trim() } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-card rounded-xl border border-line-200 shadow-xl w-full max-w-md p-6">
        <h2 className="text-h3 font-display text-ink-900 mb-5" style={{ fontFamily: 'var(--font-display)' }}>New vendor</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">Vendor name <span className="text-error-fg">*</span></label>
            <input
              type="text"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sigma Electricals Pvt Ltd"
            />
            {errors.name && <p className="text-caption text-error-fg mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="text-caption font-medium text-ink-700 block mb-1">GSTIN <span className="text-ink-400">(optional)</span></label>
            <input
              type="text"
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body font-mono text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40"
              value={form.gstin}
              onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))}
              placeholder="e.g. 29AABCS1429B1ZA"
            />
          </div>
          {mutation.isError && (
            <p className="text-caption text-error-fg">Couldn&apos;t save vendor. Try again.</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Add vendor'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function PurchasePage() {
  const [activeTab, setActiveTab] = useState<Tab>('Bills');
  const [toast, setToast] = useState<string | null>(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);

  const queryClient = useQueryClient();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const billsQuery = useQuery<Bill[]>({
    queryKey: ['purchase', 'bills'],
    queryFn: () => api.get<Bill[]>('/purchase/bills'),
  });

  const vendorsQuery = useQuery<Vendor[]>({
    queryKey: ['purchase', 'vendors'],
    queryFn: () => api.get<Vendor[]>('/purchase/vendors'),
  });

  /** Posting is what moves the ledger; adding a bill only records it. */
  const afterLedgerChange = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchase'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  const postMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/bills/${id}/post`),
    onSuccess: () => {
      showToast('Posted to ledger');
      afterLedgerChange();
    },
    onError: (e) => showToast((e as Error).message),
  });

  const payMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/bills/${id}/pay`),
    onSuccess: () => {
      showToast('Payment recorded');
      afterLedgerChange();
    },
    onError: (e) => showToast((e as Error).message),
  });

  const bills = billsQuery.data ?? [];
  const vendors = vendorsQuery.data ?? [];

  const totalOutstanding = vendors.reduce((s, v) => s + v.outstandingPaise, 0);
  const postedBills = bills.filter((b) => b.status === 'posted');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            Purchases
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Bills, vendors, and what you owe.
          </p>
        </div>
        <div className="flex items-start gap-2">
          {/* Two ways in: photograph the document and let the pipeline read it,
              or type it yourself when there is nothing to scan. */}
          <DocumentUploadButton
            label="Upload bill"
            onUploaded={(msg) => showToast(msg)}
          />
          <Button
            onClick={() => setShowBillModal(true)}
            className="flex items-center gap-2"
          >
            <Plus size={14} />
            New bill
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Total outstanding</p>
          <p className="text-h2 font-mono text-ink-900">{formatRupees(totalOutstanding)}</p>
        </div>
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Unpaid bills</p>
          <p className="text-h2 font-mono text-ink-900">{postedBills.length}</p>
        </div>
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Vendors</p>
          <p className="text-h2 font-mono text-ink-900">{vendors.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-line-200">
        <nav className="flex gap-0">
          {(['Bills', 'Vendors', 'Outstanding'] as Tab[]).map((tab) => (
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

      {/* Bills tab */}
      {activeTab === 'Bills' && (
        <div>
          {billsQuery.isLoading ? (
            <div className="rounded-lg border border-line-200 overflow-hidden">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Vendor</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Bill no.</th>
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
          ) : billsQuery.isError ? (
            <div className="rounded-lg border border-line-200 overflow-hidden">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Vendor</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Bill no.</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Date</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Due</th>
                    <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  <TableError error={billsQuery.error} colSpan={7} onRetry={() => void billsQuery.refetch()} />
                </tbody>
              </table>
            </div>
          ) : bills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-h3 font-display text-ink-700 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                No purchase bills yet.
              </p>
              <p className="text-body text-ink-500 mb-6">Upload a bill or add one manually.</p>
              <Button onClick={() => setShowBillModal(true)}>
                <Plus size={14} className="mr-2" />
                New bill
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-line-200 overflow-hidden">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line-200 bg-surface-sink">
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Vendor</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Bill no.</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Date</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Due</th>
                    <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                    <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-100">
                  {bills.map((bill) => {
                    const due = bill.status === 'posted' ? dueDays(bill.dueDate) : null;
                    return (
                      <tr key={bill._id} className="bg-surface-card hover:bg-surface-sink/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-ink-900">{bill.vendorName}</td>
                        <td className="px-4 py-3 font-mono text-ink-600 text-caption">
                          {bill.billNumber ?? <span className="text-ink-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-ink-600">
                          {new Date(bill.billDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">
                          {due ? (
                            <span className={due.variant === 'overdue' ? 'text-error-fg text-caption font-medium' : due.variant === 'due-soon' ? 'text-pending-fg text-caption' : 'text-ink-500 text-caption'}>
                              {due.label}
                            </span>
                          ) : (
                            <span className="text-ink-400 text-caption">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-ink-900">
                          {formatRupees(bill.totalPaise)}
                        </td>
                        <td className="px-4 py-3">
                          <BillStatusBadge status={bill.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                          {bill.status === 'draft' && (
                            <button
                              type="button"
                              onClick={() => postMutation.mutate(bill._id)}
                              disabled={postMutation.isPending}
                              className="rounded border border-saffron-600/30 px-2 py-0.5 text-caption font-medium text-saffron-600 transition-colors hover:bg-saffron-600/10 disabled:opacity-40"
                            >
                              Post to ledger
                            </button>
                          )}
                          {bill.status === 'posted' && (
                            <button
                              type="button"
                              onClick={() => payMutation.mutate(bill._id)}
                              disabled={payMutation.isPending}
                              className="rounded border border-success-fg/30 px-2 py-0.5 text-caption font-medium text-success-fg transition-colors hover:bg-success-bg disabled:opacity-40"
                            >
                              Mark paid
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-ink-400 hover:text-ink-700 transition-colors"
                            onClick={() => showToast(`Bill ${bill._id} — detail view coming soon`)}
                          >
                            <ChevronRight size={16} />
                          </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Vendors tab */}
      {activeTab === 'Vendors' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowVendorModal(true)} className="flex items-center gap-2">
              <Plus size={14} />
              New vendor
            </Button>
          </div>
          <div className="rounded-lg border border-line-200 overflow-hidden">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Vendor</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">GSTIN</th>
                  <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Outstanding</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {vendorsQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                  </tr>
                ) : vendorsQuery.isError ? (
                  <TableError error={vendorsQuery.error} colSpan={4} onRetry={() => void vendorsQuery.refetch()} />
                ) : (
                  vendors.map((vendor) => (
                    <tr key={vendor._id} className="bg-surface-card hover:bg-surface-sink/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink-900">{vendor.name}</td>
                      <td className="px-4 py-3 font-mono text-caption text-ink-600">
                        {vendor.gstin ?? <span className="text-ink-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {vendor.outstandingPaise > 0 ? (
                          <span className="font-mono font-medium text-ink-900">
                            {formatRupees(vendor.outstandingPaise)}
                          </span>
                        ) : (
                          <span className="text-success-fg font-medium text-caption">Cleared</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-ink-400 hover:text-ink-700 transition-colors"
                          onClick={() => showToast(`Vendor ${vendor._id} — detail view coming soon`)}
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

      {/* Outstanding tab */}
      {activeTab === 'Outstanding' && (
        <div className="space-y-4">
          <p className="text-caption text-ink-500">AP ageing — posted bills by days past due date.</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '0–30 days', paise: 1180000, color: 'text-pending-fg' },
              { label: '31–60 days', paise: 5310000, color: 'text-error-fg' },
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
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Vendor</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Bill no.</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Due date</th>
                  <th className="px-4 py-3 text-right text-caption font-medium text-ink-500">Amount</th>
                  <th className="px-4 py-3 text-left text-caption font-medium text-ink-500">Ageing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-100">
                {billsQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-caption text-ink-400">Loading…</td>
                  </tr>
                ) : billsQuery.isError ? (
                  <TableError error={billsQuery.error} colSpan={5} onRetry={() => void billsQuery.refetch()} />
                ) : (
                  bills.filter((b) => b.status === 'posted').map((bill) => {
                    const due = dueDays(bill.dueDate);
                    return (
                      <tr key={bill._id} className="bg-surface-card">
                        <td className="px-4 py-3 font-medium text-ink-900">{bill.vendorName}</td>
                        <td className="px-4 py-3 font-mono text-caption text-ink-600">
                          {bill.billNumber ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-ink-600">
                          {bill.dueDate
                            ? new Date(bill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-ink-900">
                          {formatRupees(bill.totalPaise)}
                        </td>
                        <td className="px-4 py-3">
                          {due ? (
                            <span className={`text-caption font-medium ${due.variant === 'overdue' ? 'text-error-fg' : 'text-ink-500'}`}>
                              {due.label}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-success-bg border border-success-fg px-4 py-3 text-body font-medium text-success-fg shadow-lg">
          {toast}
        </div>
      )}

      {/* Modals */}
      {showBillModal && (
        <AddBillModal
          vendors={vendorsQuery.data ?? []}
          onClose={() => setShowBillModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['purchase', 'bills'] })}
          showToast={showToast}
        />
      )}
      {showVendorModal && (
        <AddVendorModal
          onClose={() => setShowVendorModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['purchase', 'vendors'] })}
          showToast={showToast}
        />
      )}
    </div>
  );
}
