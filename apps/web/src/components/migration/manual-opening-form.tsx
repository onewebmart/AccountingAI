'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { formatRupees } from '@/lib/utils';

interface Account {
  _id: string;
  name: string;
  code: string;
  type: 'ASSETS' | 'LIABILITIES' | 'CAPITAL' | 'INCOME' | 'EXPENSE';
  isGroup: boolean;
  isActive?: boolean;
  systemKey?: string;
}

interface Party {
  _id: string;
  name: string;
  gstin: string | null;
}

const SECTIONS: Array<{ type: Account['type']; label: string }> = [
  { type: 'ASSETS', label: 'Assets' },
  { type: 'LIABILITIES', label: 'Liabilities' },
  { type: 'CAPITAL', label: 'Capital' },
  { type: 'INCOME', label: 'Income (only if opening mid-year)' },
  { type: 'EXPENSE', label: 'Expenses (only if opening mid-year)' },
];

/** Receivables and payables open at what the customers and vendors owe; they are not typed. */
const CONTROL = new Set(['ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE']);

const cell = 'w-28 rounded border border-line-200 bg-white px-2 py-1 text-right font-mono text-body focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/**
 * Opening balances typed in over the org's own chart, customers and vendors.
 * Sent for a check first: the server builds the same preview an import gets,
 * and nothing is posted until the next step's **Import opening balances**.
 */
export function ManualOpeningForm({ onPreview, onError }: { onPreview: (view: unknown) => void; onError: (message: string | null) => void }) {
  const accounts = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<Account[]>('/gl/accounts') });
  const customers = useQuery({ queryKey: ['sales', 'customers'], queryFn: () => api.get<Party[]>('/sales/customers') });
  const vendors = useQuery({ queryKey: ['purchase', 'vendors'], queryFn: () => api.get<Party[]>('/purchase/vendors') });
  // Typed text by key: `dr:<accountId>`, `cr:<accountId>`, `customer:<id>`, `vendor:<id>`.
  const [text, setText] = useState<Record<string, string>>({});
  const [showPl, setShowPl] = useState(false);

  const amount = (key: string) => parseRupees(text[key] ?? '');
  const ledgers = (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive !== false && !CONTROL.has(a.systemKey ?? ''));
  const keys = Object.keys(text);
  const bad = keys.filter((k) => amount(k) === null || (/^(dr|cr):/.test(k) && (amount(k) ?? 0) < 0));
  const sum = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).reduce((s, k) => s + (amount(k) ?? 0), 0);
  const receivable = sum('customer:');
  const payable = sum('vendor:');
  const debit = sum('dr:') + receivable;
  const credit = sum('cr:') + payable;

  const check = useMutation({
    mutationFn: () =>
      api.post('/migration/manual', {
        accounts: ledgers
          .map((a) => ({ accountId: a._id, debitPaise: amount(`dr:${a._id}`) ?? 0, creditPaise: amount(`cr:${a._id}`) ?? 0 }))
          .filter((l) => l.debitPaise || l.creditPaise),
        parties: [
          ...(customers.data ?? []).map((c) => ({ kind: 'customer', partyId: c._id, balancePaise: amount(`customer:${c._id}`) ?? 0 })),
          ...(vendors.data ?? []).map((v) => ({ kind: 'vendor', partyId: v._id, balancePaise: amount(`vendor:${v._id}`) ?? 0 })),
        ].filter((p) => p.balancePaise),
      }),
    onSuccess: (view) => {
      onError(null);
      onPreview(view);
    },
    onError: (err) => onError(err instanceof ApiError && err.message ? err.message : "Couldn't check those balances."),
  });

  if (accounts.isLoading || customers.isLoading || vendors.isLoading) return <p className="text-caption text-ink-400">Loading your chart…</p>;
  if (accounts.isError) return <p className="text-caption text-error-fg">Couldn&apos;t load the chart of accounts.</p>;

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setText((t) => ({ ...t, [key]: e.target.value }));
  const field = (key: string, label: string) => (
    <input
      aria-label={label}
      inputMode="decimal"
      className={`${cell} ${amount(key) === null ? 'border-error-fg' : ''}`}
      value={text[key] ?? ''}
      onChange={set(key)}
      placeholder="0"
    />
  );

  return (
    <div className="space-y-5">
      <p className="text-caption text-ink-500">
        Enter each account&apos;s balance on the opening day, as a debit or a credit, in rupees. Receivables and payables are entered per customer and vendor below.
      </p>

      {SECTIONS.filter((s) => showPl || (s.type !== 'INCOME' && s.type !== 'EXPENSE')).map((section) => {
        const rows = ledgers.filter((a) => a.type === section.type);
        if (rows.length === 0) return null;
        return (
          <div key={section.type}>
            <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">{section.label}</p>
            <div className="divide-y divide-line-100 rounded-md border border-line-200">
              {rows.map((a) => (
                <div key={a._id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-14 shrink-0 font-mono text-caption text-ink-400">{a.code}</span>
                  <span className="flex-1 text-body text-ink-900">{a.name}</span>
                  {field(`dr:${a._id}`, `${a.name} debit`)}
                  {field(`cr:${a._id}`, `${a.name} credit`)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <button type="button" className="text-caption font-medium text-ink-500 hover:text-ink-900" onClick={() => setShowPl((v) => !v)}>
        {showPl ? 'Hide income and expense accounts' : 'Opening mid-year? Show income and expense accounts'}
      </button>

      {[
        { kind: 'customer', label: 'Customers — what each owes you', list: customers.data ?? [] },
        { kind: 'vendor', label: 'Vendors — what you owe each', list: vendors.data ?? [] },
      ].map(({ kind, label, list }) => (
        <div key={kind}>
          <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">{label}</p>
          {list.length === 0 ? (
            <p className="text-caption text-ink-400">No {kind}s yet. Add them on the {kind === 'customer' ? 'Sales' : 'Purchase'} page first.</p>
          ) : (
            <div className="max-h-72 divide-y divide-line-100 overflow-auto rounded-md border border-line-200">
              {list.map((p) => (
                <div key={p._id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="flex-1 text-body text-ink-900">
                    {p.name} {p.gstin && <span className="font-mono text-caption text-ink-400">{p.gstin}</span>}
                  </span>
                  {field(`${kind}:${p._id}`, `${p.name} balance`)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="text-caption text-ink-500">An advance (money paid before the bill or invoice) is entered with a minus sign.</p>

      <div className="flex flex-wrap items-center gap-6 rounded-md bg-surface-sink px-4 py-3 text-body">
        <span>
          Debits <span className="font-mono font-semibold">{formatRupees(debit)}</span>
        </span>
        <span>
          Credits <span className="font-mono font-semibold">{formatRupees(credit)}</span>
        </span>
        <span className={debit === credit ? 'text-success-fg' : 'text-error-fg'}>
          {debit === credit ? 'Balanced' : `Out by ${formatRupees(Math.abs(debit - credit))} ${debit > credit ? 'Dr' : 'Cr'}`}
        </span>
        <Button className="ml-auto" disabled={check.isPending || bad.length > 0 || (debit === 0 && credit === 0)} onClick={() => check.mutate()}>
          {check.isPending ? 'Checking…' : 'Check the balances'}
        </Button>
      </div>
      {bad.length > 0 && <p className="text-caption text-error-fg">Some amounts aren&apos;t numbers in rupees, or a debit or credit is negative.</p>}
    </div>
  );
}
