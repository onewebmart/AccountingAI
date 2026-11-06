'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { StatusChip } from '@/components/page/page-shell';

/**
 * What the purchase pages share: the shapes the API returns, the lists they
 * read, and the small pieces every record page shows (a voucher by its
 * number, a link to the history, a bill's status).
 */

export const GST_SLABS = [0, 3, 5, 12, 18, 28, 40] as const;

export type BillStatus = 'draft' | 'posted' | 'paid';

export interface Amounts {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

/** GET /purchase/bills — one row per bill, vendor name joined. */
export interface BillRow {
  _id: string;
  vendorId: string | null;
  vendorName: string;
  vendorGstin: string | null;
  billNumber: string | null;
  billDate: string;
  dueDate: string | null;
  status: BillStatus;
  amountsPaise: Amounts;
  totalPaise: number;
  amountPaidPaise: number;
  outstandingPaise: number;
  msmePayBy: string | null;
  msmeLate: boolean;
  tdsPaise: number;
  tdsSection: string | null;
  isReverseCharge: boolean;
  journalId: string | null;
  sourceDocumentId: string | null;
  recurringTemplateId: string | null;
}

export interface Foreign {
  currency: string;
  digits: number;
  rate: number;
  taxableMinor: number;
  totalMinor: number;
  paidMinor: number;
}

/** GET /purchase/bills/:id — the stored bill. */
export interface BillRecord {
  _id: string;
  vendorId: string;
  billNumber: string | null;
  billDate: string;
  dueDate: string | null;
  status: BillStatus;
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
    projectId: string | null;
    uqc?: string | null;
    /** Where the line is booked; null for the item's, or Purchases. */
    accountId?: string | null;
    /** Its discount before tax: its own, or its share of the bill's. */
    discountPaise?: number;
    discountPercent?: number | null;
    /** The customer the cost is for, and whether it is billed on to them. */
    customerId?: string | null;
    billable?: boolean;
  }>;
  /** The discount asked for, where it was given, and the adjustment already in the total. */
  discount?: { percent: number | null; amountPaise: number } | null;
  discountLevel?: 'transaction' | 'line' | null;
  adjustment?: { label: string; paise: number } | null;
  orderNumber?: string | null;
  subject?: string | null;
  paymentTerms?: string | null;
  journalId: string | null;
  amountPaidPaise: number;
  payments: Array<{ _id: string; journalId: string; amountPaise: number; paidOn: string }>;
  adjustedPaise: number;
  adjustments: Array<{ noteId: string; journalId: string; amountPaise: number; noteDate: string }>;
  tds: { section: string; rateBps: number; amountPaise: number } | null;
  isReverseCharge: boolean;
  foreign: Foreign | null;
  sourceDocumentId: string | null;
  recurringTemplateId: string | null;
  notes: string | null;
  source: { kind: 'purchase_order'; id: string } | null;
}

export interface VendorBank {
  accountName: string | null;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
}

export interface VendorMsme {
  udyamNumber: string;
  category: 'micro' | 'small' | 'medium';
  activity: 'manufacturing' | 'services' | 'trading';
  writtenAgreement: boolean;
}

/** GET /purchase/vendors (with outstandingPaise) and /purchase/vendors/:id. */
export interface VendorRecord {
  _id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
  pan: string | null;
  tdsSection: string | null;
  tdsRateBps: number | null;
  bankAccount: VendorBank | null;
  msme: VendorMsme | null;
  currency?: string;
  outstandingPaise?: number;
}

export interface LedgerAccountRow {
  _id: string;
  name: string;
  code: string;
  type: 'ASSETS' | 'LIABILITIES' | 'INCOME' | 'EXPENSE' | 'CAPITAL';
  isGroup: boolean;
  isActive: boolean;
  systemKey?: string;
}

export interface PaidThroughAccount {
  _id: string;
  name: string;
  code: string;
  kind: 'bank' | 'cash' | 'other';
}

/** The TDS sections a vendor's bills can be deducted under (gl/tds.ts), with their default rates. */
export const TDS_SECTIONS: Array<{ code: string; label: string; rateBps: number }> = [
  { code: '194C', label: 'Contractors and sub-contractors', rateBps: 200 },
  { code: '194H', label: 'Commission or brokerage', rateBps: 200 },
  { code: '194I-a', label: 'Rent — plant, machinery or equipment', rateBps: 200 },
  { code: '194I-b', label: 'Rent — land, building or furniture', rateBps: 1000 },
  { code: '194J-a', label: 'Fees for technical services', rateBps: 200 },
  { code: '194J-b', label: 'Fees for professional services', rateBps: 1000 },
  { code: '194Q', label: 'Purchase of goods', rateBps: 10 },
  { code: '194A', label: 'Interest other than on securities', rateBps: 1000 },
];

/** The server's words when it gave some; the fallback otherwise. */
export function errorText(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** 2026-11-04 → 4 Nov 2026, read as a calendar day (no time zone shift). */
export function shortDate(d: string | null | undefined): string {
  if (!d) return '—';
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t.getTime())) return d;
  return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Days to a due date, in words, and whether it is late. */
export function dueInfo(dueDate: string | null): { label: string; tone: 'late' | 'soon' | 'ok' } | null {
  if (!dueDate) return null;
  const today = Date.parse(`${todayIso()}T00:00:00Z`);
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - today) / 86_400_000);
  if (days < 0) return { label: `${-days} day${days === -1 ? '' : 's'} late`, tone: 'late' };
  if (days === 0) return { label: 'Due today', tone: 'soon' };
  if (days <= 7) return { label: `Due in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon' };
  return { label: `Due ${shortDate(dueDate)}`, tone: 'ok' };
}

/** A foreign amount in its own units: 123456 cents → "USD 1,234.56". */
export function formatMinor(minor: number, currency: string, digits: number): string {
  return `${currency} ${(minor / 10 ** digits).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Text in a currency's units → its minor units, by string arithmetic. Null when unreadable. */
export function parseMinor(text: string, digits: number): number | null {
  const s = text.replace(/[,\s]/g, '');
  if (s === '') return null;
  const m = s.match(digits > 0 ? new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`) : /^(\d+)$/);
  if (!m) return null;
  return Number(m[1]) * 10 ** digits + Number((m[2] ?? '').padEnd(digits, '0') || 0);
}

export function useVendors() {
  return useQuery({ queryKey: ['purchase', 'vendors'], queryFn: () => api.get<VendorRecord[]>('/purchase/vendors') });
}

export function useBills() {
  return useQuery({ queryKey: ['purchase', 'bills'], queryFn: () => api.get<BillRow[]>('/purchase/bills') });
}

export function useAccounts() {
  return useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<LedgerAccountRow[]>('/gl/accounts'), retry: false });
}

/** Expense accounts a cost can be booked to: not groups, not deactivated. */
export function useExpenseAccounts() {
  const q = useAccounts();
  return { ...q, data: (q.data ?? []).filter((a) => a.type === 'EXPENSE' && !a.isGroup && a.isActive) };
}

export function usePaidThroughAccounts() {
  return useQuery({ queryKey: ['direct-expenses', 'paid-through'], queryFn: () => api.get<PaidThroughAccount[]>('/direct-expenses/paid-through-accounts'), retry: false });
}

/** After anything that moves the ledger: the lists, vouchers and reports that show it. */
export function useLedgerRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['purchase', 'payments', 'journals', 'reports', 'direct-expenses', 'orders', 'approvals', 'expense-claims']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** A voucher by id, shown by its number. */
export function Voucher({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['journals', id], queryFn: () => api.get<{ voucherNumber: string | number; voucherType?: string; date: string }>(`/journals/${id}`) });
  return <span className="font-mono">{data ? `${data.voucherNumber} · ${shortDate(data.date)}` : '…'}</span>;
}

/** The record's entries in the audit trail. */
export function HistoryLink({ entityType, entityId, label = 'History' }: { entityType: string; entityId: string; label?: string }) {
  return (
    <Link href={`/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`} className="text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline">
      {label}
    </Link>
  );
}

/** Amber waits for posting, green is in the books; paid is done. */
export function BillStatusChip({ status }: { status: BillStatus }) {
  if (status === 'draft') return <StatusChip tone="pending">Draft</StatusChip>;
  if (status === 'posted') return <StatusChip tone="success">Posted</StatusChip>;
  return <StatusChip tone="success">Paid</StatusChip>;
}

/** A label and value on one line, value on the right. */
export function Line({ label, children, strong }: { label: React.ReactNode; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line-100 py-1.5 last:border-0 ${strong ? 'font-semibold' : ''}`}>
      <span className="text-body text-ink-600">{label}</span>
      <span className="text-right text-body text-ink-900">{children}</span>
    </div>
  );
}

/** Shows rupees from paise with two decimals, for an input's starting value. */
export const rupeesText = (paise: number) => (paise ? (paise / 100).toFixed(2) : '');
