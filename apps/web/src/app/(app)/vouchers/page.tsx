'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { QueryError } from '@/components/ui/query-error';
import { FileText, Loader2, RotateCcw, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type VoucherType = 'all' | 'purchase' | 'sales' | 'payment' | 'receipt' | 'contra' | 'journal';
type VoucherStatus = 'posted' | 'reversed';

interface Voucher {
  id: string;
  voucherNo: string;
  date: string;
  type: Exclude<VoucherType, 'all'>;
  party: string;
  debitPaise: number;
  creditPaise: number;
  status: VoucherStatus;
  reversedBy?: string;
}

// ── API response shape ────────────────────────────────────────────────────────

type ApiVoucherType = 'purchase' | 'sales' | 'payment' | 'receipt' | 'contra' | 'journal' | string;

interface ApiJournal {
  _id: string;
  voucherNumber?: string;
  date: string;
  voucherType?: ApiVoucherType;
  description?: string;
  totalDebitPaise?: number;
  totalCreditPaise?: number;
  status?: string;
  reversedBy?: string;
}

function mapApiJournal(j: ApiJournal): Voucher {
  const rawType = j.voucherType ?? 'journal';
  const knownTypes: Array<Exclude<VoucherType, 'all'>> = [
    'purchase', 'sales', 'payment', 'receipt', 'contra', 'journal',
  ];
  const type: Exclude<VoucherType, 'all'> = knownTypes.includes(rawType as Exclude<VoucherType, 'all'>)
    ? (rawType as Exclude<VoucherType, 'all'>)
    : 'journal';

  return {
    id: j._id,
    voucherNo: j.voucherNumber ?? j._id,
    date: j.date,
    type,
    party: j.description ?? '—',
    debitPaise: j.totalDebitPaise ?? 0,
    creditPaise: j.totalCreditPaise ?? 0,
    status: j.status === 'reversed' ? 'reversed' : 'posted',
    reversedBy: j.reversedBy,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<Exclude<VoucherType, 'all'>, string> = {
  purchase: 'Purchase',
  sales: 'Sales',
  payment: 'Payment',
  receipt: 'Receipt',
  contra: 'Contra',
  journal: 'Journal',
};

const TYPE_COLORS: Record<Exclude<VoucherType, 'all'>, string> = {
  purchase: 'bg-surface-sink text-ink-700 border-line-200',
  sales: 'bg-success-bg text-success-fg border-success-fg/30',
  payment: 'bg-error-bg text-error-fg border-error-fg/30',
  receipt: 'bg-pending-bg text-pending-fg border-pending-fg/30',
  contra: 'bg-surface-sink text-ink-700 border-line-200',
  journal: 'bg-surface-sink text-ink-500 border-line-200',
};

const FY_OPTIONS = ['2025-26', '2024-25', '2023-24'];

function fmt(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(paise / 100);
}

// ── Reverse modal ─────────────────────────────────────────────────────────────

function ReverseModal({
  voucher,
  onClose,
  onConfirm,
  isPending,
}: {
  voucher: Voucher;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-card rounded-xl border border-line-200 shadow-e2 w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-h3 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
            Reverse entry
          </h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1 -mr-1" disabled={isPending}>
            <X size={18} />
          </button>
        </div>
        <p className="text-body text-ink-600 mb-2">
          This posts a reversing entry. The original stays in the record.
        </p>
        <p className="text-body text-ink-500 mb-6">
          Voucher <span className="font-mono text-ink-900">{voucher.voucherNo}</span> · {voucher.party}
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Reversing…</span>
            ) : (
              'Reverse entry'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VouchersPage() {
  const [typeFilter, setTypeFilter] = useState<VoucherType>('all');
  const [fy, setFy] = useState('2025-26');
  const [reversing, setReversing] = useState<Voucher | null>(null);
  // Optimistic local overrides: id → 'reversed'
  const [localReversed, setLocalReversed] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  // ── Fetch journals ─────────────────────────────────────────────────────
  const {
    data: apiResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['journals', fy],
    queryFn: () =>
      api.get<ApiJournal[] | { data: ApiJournal[] }>('/journals'),
  });

  const apiVouchers: Voucher[] = (() => {
    if (!apiResponse) return [];
    const raw = Array.isArray(apiResponse)
      ? apiResponse
      : 'data' in apiResponse && Array.isArray(apiResponse.data)
        ? apiResponse.data
        : [];
    return raw.map(mapApiJournal);
  })();

  const baseVouchers = apiVouchers;

  // Apply optimistic reversals
  const vouchers = baseVouchers.map((v) =>
    localReversed.has(v.id)
      ? { ...v, status: 'reversed' as VoucherStatus, reversedBy: v.reversedBy ?? `${v.voucherNo}-R` }
      : v,
  );

  // ── Reverse mutation ───────────────────────────────────────────────────
  const reverseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/journals/${id}/reverse`),
    onSuccess: (_data, id) => {
      setLocalReversed((prev) => new Set([...prev, id]));
      queryClient.invalidateQueries({ queryKey: ['journals'] });
    },
  });

  const filtered = vouchers.filter(
    (v) => (typeFilter === 'all' || v.type === typeFilter),
  );

  const handleReverse = () => {
    if (!reversing) return;
    const id = reversing.id;
    // Optimistically mark as reversed immediately
    setLocalReversed((prev) => new Set([...prev, id]));
    setReversing(null);
    reverseMutation.mutate(id, {
      onError: () => {
        // Roll back optimistic update on error
        setLocalReversed((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
    });
  };

  return (
    <>
      {reversing && (
        <ReverseModal
          voucher={reversing}
          onClose={() => setReversing(null)}
          onConfirm={handleReverse}
          isPending={reverseMutation.isPending}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1
            className="text-h1 font-display text-ink-900"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Vouchers
          </h1>
          {/* FY selector */}
          <select
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            className="rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400"
          >
            {FY_OPTIONS.map((f) => (
              <option key={f} value={f}>FY {f}</option>
            ))}
          </select>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          {(['all', 'purchase', 'sales', 'payment', 'receipt', 'contra', 'journal'] as VoucherType[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full px-3 py-1.5 text-caption font-medium border transition-colors capitalize ${
                typeFilter === t
                  ? 'bg-ink-900 text-white border-ink-900'
                  : 'bg-surface-card text-ink-600 border-line-200 hover:border-ink-400'
              }`}
            >
              {t === 'all' ? 'All types' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Error state */}
        {isError && <QueryError error={error} onRetry={() => void refetch()} />}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-ink-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading vouchers…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center rounded-xl border border-line-200 bg-surface-card">
            <FileText size={36} className="text-ink-300 mb-4" />
            <p className="text-h3 font-display text-ink-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              No vouchers yet.
            </p>
            <p className="text-body text-ink-500">Approved entries land here.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-line-200 bg-surface-card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  {['Voucher no.', 'Date', 'Type', 'Party', 'Debit', 'Credit', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-caption font-semibold text-ink-500 uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr
                    key={v.id}
                    className={`border-b border-line-100 last:border-0 transition-colors hover:bg-honey-50 ${
                      v.status === 'reversed' ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-caption text-ink-900">{v.voucherNo}</td>
                    <td className="px-4 py-3 text-body text-ink-600">
                      {new Date(v.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-caption font-medium rounded-full px-2.5 py-0.5 border ${TYPE_COLORS[v.type]}`}>
                        {TYPE_LABELS[v.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-body text-ink-900 max-w-[180px] truncate">{v.party}</td>
                    <td className="px-4 py-3 font-mono text-body text-ink-900">{fmt(v.debitPaise)}</td>
                    <td className="px-4 py-3 font-mono text-body text-ink-900">{fmt(v.creditPaise)}</td>
                    <td className="px-4 py-3">
                      {v.status === 'reversed' ? (
                        <span className="inline-flex items-center gap-1 text-caption text-error-fg">
                          <RotateCcw size={12} /> Reversed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-caption text-success-fg">
                          <span className="h-1.5 w-1.5 rounded-full bg-success-fg" /> Posted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.status === 'posted' && (
                        <button
                          onClick={() => setReversing(v)}
                          className="inline-flex items-center gap-1.5 text-caption text-ink-500 hover:text-error-fg transition-colors"
                        >
                          <RotateCcw size={13} /> Reverse
                        </button>
                      )}
                      {v.status === 'reversed' && v.reversedBy && (
                        <span className="font-mono text-caption text-ink-400">{v.reversedBy}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer summary */}
            <div className="border-t border-line-200 bg-surface-sink px-4 py-3 flex items-center justify-between">
              <span className="text-caption text-ink-500">{filtered.length} voucher{filtered.length !== 1 ? 's' : ''}</span>
              <span className="text-caption text-ink-400">All amounts in INR · paise-accurate</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
