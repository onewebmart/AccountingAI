'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InvoiceStatus as SharedInvoiceStatus } from '@ai-accounting/shared';
import { api, ApiError } from '@/lib/api';
import { GST_STATES } from '@/lib/gst';

/**
 * What the Sales pages read from the API, and the few helpers they share.
 * Types mirror what the endpoints return; money is integer paise throughout.
 */

// Imported rather than redeclared: a local copy of this union is how the
// chart of accounts ended up filtering on values the API never sends.
export type InvoiceStatus = `${SharedInvoiceStatus}`;

export interface Amounts {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface PaymentLink {
  url: string;
  status: 'created' | 'paid' | 'confirmed';
  paidPaise: number | null;
  paidOn: string | null;
}

/** GET /sales/invoices — one row of the list. */
export interface InvoiceRow {
  _id: string;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  totalPaise: number;
  amountPaidPaise: number;
  outstandingPaise: number;
  amountsPaise: Amounts;
  journalId: string | null;
  sourceDocumentId: string | null;
  recurringTemplateId: string | null;
  paymentLink: PaymentLink | null;
}

export interface Foreign {
  currency: string;
  digits: number;
  rate: number;
  taxableMinor: number;
  totalMinor: number;
  paidMinor: number;
  linesMinor: number[];
}

/** GET /sales/invoices/:id — the stored invoice. */
export interface InvoiceRecord {
  _id: string;
  customerId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  financialYear: string | null;
  amountsPaise: Amounts;
  lineItems: Array<{
    description: string;
    hsnSac: string | null;
    qty: number;
    ratePaise: number;
    amountPaise: number;
    taxRatePct: number;
    itemId: string | null;
    uqc: string | null;
    projectId: string | null;
  }>;
  journalId: string | null;
  amountPaidPaise?: number;
  payments?: Array<{ _id: string; journalId: string; amountPaise: number; tdsPaise?: number; paidOn: string }>;
  adjustedPaise?: number;
  adjustments?: Array<{ noteId: string; journalId: string; amountPaise: number; noteDate: string }>;
  sourceDocumentId: string | null;
  recurringTemplateId: string | null;
  notes: string | null;
  sentAt: string | null;
  emailedTo: string | null;
  emailedAt: string | null;
  partyAtIssue: { name: string; gstin: string | null; stateCode: string | null } | null;
  source: { kind: 'quote' | 'sales_order' | 'project'; id: string } | null;
  foreign: Foreign | null;
  exportType: 'lut' | null;
  shippingBill: { number: string; date: string; portCode: string } | null;
  paymentLink: PaymentLink | null;
  isOpeningBalance?: boolean;
}

/** GET /sales/customers — a customer and what they owe. */
export interface CustomerRow {
  _id: string;
  name: string;
  gstin: string | null;
  /** GST state code: the place of supply for their invoices. */
  stateCode?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  notes?: string | null;
  currency?: string;
  receivablePaise: number;
}

/** GET /sales/customers/:id — the stored customer, without what they owe. */
export type CustomerRecord = Omit<CustomerRow, 'receivablePaise'>;

export interface DocLine {
  description: string;
  itemId?: string | null;
  hsnSac?: string | null;
  qty: number;
  ratePaise: number;
  amountPaise: number;
  taxRatePct: number;
  invoicedQty?: number;
  deliveredQty?: number;
}

export interface QuoteRow {
  _id: string;
  number: string;
  customerName: string;
  customerId: string;
  date: string;
  validUntil: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'converted';
  expired: boolean;
  amountsPaise: Amounts;
  lines: DocLine[];
  notes?: string | null;
  sentTo?: string | null;
  drafted: { source: string; unread: string[]; message?: string } | null;
  convertedTo: { kind: 'sales_order' | 'invoice'; id: string } | null;
}

export interface OrderRow {
  _id: string;
  number: string;
  customerName: string;
  customerId: string;
  date: string;
  expectedBy?: string | null;
  status: 'open' | 'closed' | 'cancelled';
  customerPoNumber: string | null;
  amountsPaise: Amounts;
  lines: DocLine[];
  notes?: string | null;
  quoteId?: string | null;
  fullyInvoiced: boolean;
}

export interface ChallanRow {
  _id: string;
  number: string;
  customerName: string;
  customerId: string;
  date: string;
  reason: 'supply' | 'job_work' | 'approval' | 'other';
  status: 'issued' | 'returned' | 'cancelled';
  vehicleNo?: string | null;
  notes?: string | null;
  salesOrderId?: string | null;
  lines: Array<{ line: DocLine; orderLine: number | null }>;
}

export const CHALLAN_REASON: Record<ChallanRow['reason'], string> = {
  supply: 'Supply, invoiced later',
  job_work: 'Job work',
  approval: 'On approval',
  other: 'Other',
};

/** The words for an API failure, or a fallback when it said nothing useful. */
export function errorText(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

/** Today in India, as YYYY-MM-DD: the date an Indian business is working in. */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function shortDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A PDF from the API, opened in a new tab. */
export async function openPdf(path: string): Promise<void> {
  const url = URL.createObjectURL(await api.blob(path));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function fileSafe(text: string | null | undefined, fallback = 'draft'): string {
  return (text ?? fallback).replace(/[^A-Za-z0-9-]+/g, '-');
}

/** Foreign minor units for display: 123450 cents → "USD 1,234.50". */
export function formatMinor(minor: number, code: string, digits: number): string {
  return `${code} ${(minor / 10 ** digits).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "1,234.50" in a currency with `digits` minor digits → minor units; null when it is not an amount. */
export function toMinor(text: string, digits: number): number | null {
  const s = text.replace(/[,\s]/g, '');
  if (s === '') return null;
  const m = s.match(new RegExp(`^(\\d+)(?:\\.(\\d{0,${digits}}))?$`));
  if (!m) return null;
  return Number(m[1]) * 10 ** digits + Number((m[2] ?? '').padEnd(digits, '0') || '0');
}

export function useCustomers() {
  return useQuery({ queryKey: ['sales', 'customers'], queryFn: () => api.get<CustomerRow[]>('/sales/customers') });
}

export function useInvoices() {
  return useQuery({ queryKey: ['sales', 'invoices'], queryFn: () => api.get<InvoiceRow[]>('/sales/invoices') });
}

/** A customer's invoices: the latest 200 of theirs, not of everyone's. */
export function useCustomerInvoices(customerId: string) {
  return useQuery({
    queryKey: ['sales', 'invoices', { customerId }],
    queryFn: () => api.get<InvoiceRow[]>(`/sales/invoices?customerId=${encodeURIComponent(customerId)}`),
    enabled: !!customerId,
  });
}

/** One record by id, shaped as its list shows it; null when this org has no such record. */
export async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function useQuote(id: string) {
  return useQuery({ queryKey: ['orders', 'quotes', id], queryFn: () => getOrNull<QuoteRow>(`/orders/quotes/${id}`) });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: ['orders', 'sales-orders', id], queryFn: () => getOrNull<OrderRow>(`/orders/sales-orders/${id}`) });
}

export function useChallan(id: string) {
  return useQuery({ queryKey: ['orders', 'challans', id], queryFn: () => getOrNull<ChallanRow>(`/orders/challans/${id}`) });
}

export function useQuotes() {
  return useQuery({ queryKey: ['orders', 'quotes'], queryFn: () => api.get<QuoteRow[]>('/orders/quotes') });
}

export function useOrders() {
  return useQuery({ queryKey: ['orders', 'sales-orders'], queryFn: () => api.get<OrderRow[]>('/orders/sales-orders') });
}

export function useChallans() {
  return useQuery({ queryKey: ['orders', 'challans'], queryFn: () => api.get<ChallanRow[]>('/orders/challans') });
}

/** Where a sale to this customer is supplied: IGST across states, CGST and SGST within one. */
export function useSupply(customerId: string) {
  return useQuery({
    queryKey: ['sales', 'supply', customerId],
    queryFn: () => api.get<{ ourStateCode: string | null; customerStateCode: string | null; interState: boolean }>(`/sales/customers/${customerId}/supply`),
    enabled: !!customerId,
  });
}

/**
 * Posting moves the ledger, so every figure derived from it is refreshed:
 * the sales lists, payments, journals and reports.
 */
export function useLedgerRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['sales', 'orders', 'payments', 'journals', 'reports', 'einvoice', 'currency', 'gst']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}
