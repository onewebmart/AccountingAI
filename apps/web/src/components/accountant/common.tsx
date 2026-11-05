'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

/** What went wrong, in the server's words when it said any. */
export function errorText(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** True when an approval policy held the posting: the request is made, nothing failed. */
export function isApprovalHold(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && /^Sent for approval/.test(err.message);
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** 2026-11-05 → 5 Nov 2026. */
export function shortDate(d: string | null | undefined): string {
  if (!d) return '—';
  const t = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface Account {
  _id: string;
  name: string;
  code: string;
  type: string;
  parentId?: string | null;
  balancePaise: number;
  isGroup: boolean;
  isSystem: boolean;
  systemKey?: string;
  isActive: boolean;
}

/** Kept party by party from documents and payments: a bulk move on or off these is refused. */
const PARTY_KEYS = new Set(['ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'CUSTOMER_ADVANCES', 'VENDOR_ADVANCES', 'EMPLOYEE_PAYABLE']);
export const isPartyAccount = (a: Account) => !!a.systemKey && PARTY_KEYS.has(a.systemKey);

export function useAccounts() {
  return useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<Account[]>('/gl/accounts') });
}

/** An account entries can be posted to: active and not a group. */
export function AccountSelect({ value, onChange, className, placeholder = 'Choose an account…', exclude, types, hide, id }: {
  value: string;
  onChange: (id: string) => void;
  className?: string;
  placeholder?: string;
  /** An account not to offer, such as the one lines are moving from. */
  exclude?: string;
  types?: string[];
  /** Accounts this form cannot use. */
  hide?: (a: Account) => boolean;
  id?: string;
}) {
  const { data } = useAccounts();
  const options = (data ?? []).filter(
    (a) => !a.isGroup && (a.isActive || a._id === value) && a._id !== exclude && (!types || types.includes(a.type)) && !hide?.(a),
  );
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((a) => (
        <option key={a._id} value={a._id}>
          {a.code} · {a.name}
        </option>
      ))}
    </select>
  );
}

/**
 * A small confirmation for an action that cannot be taken back quietly, such
 * as a reversal or closing a year. Forms are pages; only these stay pop-ups.
 */
export function ConfirmDialog({ title, body, confirmLabel, busy, destructive, onConfirm, onCancel }: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-xl border border-line-200 bg-surface-card p-6 shadow-e2">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-h3 font-display text-ink-900">{title}</h2>
          <button type="button" onClick={onCancel} className="-mr-1 p-1 text-ink-400 hover:text-ink-700" disabled={busy} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="mb-6 text-body text-ink-600">{body}</div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A notice in a page: amber waits, green is done. */
export function Notice({ tone, children }: { tone: 'pending' | 'success' | 'error'; children: React.ReactNode }) {
  const cls = {
    pending: 'border-pending-fg/30 bg-pending-bg text-pending-fg',
    success: 'border-success-fg/30 bg-success-bg text-success-fg',
    error: 'border-error-fg/30 bg-error-bg text-error-fg',
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-body ${cls}`}>{children}</div>;
}
