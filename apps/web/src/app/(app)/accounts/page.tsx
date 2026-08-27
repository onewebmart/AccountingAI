'use client';

import { useState } from 'react';
import { AccountType as SharedAccountType } from '@ai-accounting/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Plus, BookOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

// Imported, not re-declared. This page previously defined its own union with
// 'ASSET' and 'LIABILITY' while the API stores 'ASSETS' and 'LIABILITIES', so
// those two sections silently rendered empty however many accounts existed.
type AccountType = SharedAccountType;

interface Account {
  _id: string;
  name: string;
  type: AccountType;
  parentId?: string | null;
  balancePaise: number;
  isGroup: boolean;
}

interface NewAccountForm {
  name: string;
  type: AccountType;
  parentId?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES: { type: AccountType; label: string }[] = [
  { type: SharedAccountType.ASSETS, label: 'Assets' },
  { type: SharedAccountType.LIABILITIES, label: 'Liabilities' },
  { type: SharedAccountType.INCOME, label: 'Income' },
  { type: SharedAccountType.EXPENSE, label: 'Expenses' },
  { type: SharedAccountType.CAPITAL, label: 'Capital' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPaise(paise: number): string {
  if (paise === 0) return '₹0';
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

// ── Tree node component ────────────────────────────────────────────────────────

function AccountNode({
  account,
  subAccounts,
  depth,
  selectedId,
  onSelect,
}: {
  account: Account;
  subAccounts: Account[];
  depth: number;
  selectedId: string | null;
  onSelect: (account: Account) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = subAccounts.length > 0;
  const isSelected = selectedId === account._id;

  return (
    <div>
      <button
        onClick={() => {
          onSelect(account);
          if (hasChildren) setExpanded((v) => !v);
        }}
        className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-left transition-colors group ${
          isSelected
            ? 'bg-honey-50 text-saffron-700'
            : 'hover:bg-surface-sink text-ink-700 hover:text-ink-900'
        }`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <span className="shrink-0 w-4 text-ink-400">
          {hasChildren ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="block w-3.5 h-3.5 rounded-full border border-line-200 ml-0.5" />
          )}
        </span>
        <span className={`flex-1 text-body ${account.isGroup ? 'font-semibold' : 'font-normal'}`}>
          {account.name}
        </span>
        {!account.isGroup && account.balancePaise > 0 && (
          <span className="text-caption font-mono text-ink-400 shrink-0">
            {formatPaise(account.balancePaise)}
          </span>
        )}
      </button>

      {hasChildren && expanded && (
        <div>
          {subAccounts.map((child) => (
            <AccountNodeWrapper
              key={child._id}
              account={child}
              allAccounts={[]}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Wrapper that receives all accounts and computes children
function AccountNodeWrapper({
  account,
  allAccounts,
  depth,
  selectedId,
  onSelect,
}: {
  account: Account;
  allAccounts: Account[];
  depth: number;
  selectedId: string | null;
  onSelect: (account: Account) => void;
}) {
  const subAccounts = allAccounts.filter((a) => a.parentId === account._id);
  return (
    <AccountNode
      account={account}
      subAccounts={subAccounts}
      depth={depth}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}

// ── Add account modal ──────────────────────────────────────────────────────────

function AddAccountModal({
  defaultType,
  defaultParentId,
  onClose,
  onSuccess,
}: {
  defaultType?: AccountType;
  defaultParentId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<NewAccountForm>({
    name: '',
    type: defaultType ?? SharedAccountType.ASSETS,
    parentId: defaultParentId,
  });

  const createMutation = useMutation({
    mutationFn: (body: NewAccountForm) => api.post<Account>('/gl/accounts', body),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40">
      <div className="w-full max-w-md rounded-xl border border-line-200 bg-surface-card p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-h3 font-display text-ink-900">
            Add account
          </h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Account name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Trade Receivables"
              autoFocus
              className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/30 focus:border-saffron-600"
            />
          </div>

          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Account type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
              className="w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/30 focus:border-saffron-600"
            >
              {ACCOUNT_TYPES.map(({ type, label }) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
          </div>

          {createMutation.isError && (
            <p className="text-caption text-[#C92A2A]">
              {(createMutation.error as Error).message ?? 'Failed to create account.'}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Add account'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────

function AccountDetail({
  account,
  onAddChild,
}: {
  account: Account;
  onAddChild: (parentId: string, type: AccountType) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-caption font-medium text-ink-500 uppercase tracking-wide mb-1">Account</p>
        <h2 className="text-h2 font-display text-ink-900">
          {account.name}
        </h2>
      </div>

      <div className="rounded-lg border border-line-200 bg-surface-sink p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-caption text-ink-500">Type</span>
          <span className="text-caption font-medium text-ink-700 bg-honey-50 border border-line-200 rounded-full px-2 py-0.5">
            {ACCOUNT_TYPES.find((t) => t.type === account.type)?.label ?? account.type}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-caption text-ink-500">Kind</span>
          <span className="text-caption font-medium text-ink-700">
            {account.isGroup ? 'Group / header' : 'Ledger'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-caption text-ink-500">Account ID</span>
          <span className="text-caption font-mono text-ink-500">{account._id}</span>
        </div>
      </div>

      {!account.isGroup && (
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Closing balance</p>
          <p className="text-h2 font-mono text-ink-900">{formatPaise(account.balancePaise)}</p>
        </div>
      )}

      {account.isGroup && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAddChild(account._id, account.type)}
          className="flex items-center gap-1.5 w-full justify-center"
        >
          <Plus size={13} /> Add sub-account
        </Button>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const qc = useQueryClient();
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [addModal, setAddModal] = useState<{ type?: AccountType; parentId?: string } | null>(null);

  const { data: remoteAccounts } = useQuery<Account[]>({
    queryKey: ['gl', 'accounts'],
    queryFn: () => api.get<Account[]>('/gl/accounts'),
  });

  const accounts = remoteAccounts ?? [];

  const handleSuccess = () => {
    qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900">
            Chart of accounts
          </h1>
          <p className="text-body text-ink-500 mt-1">
            Ledger groups and accounts that make up your books.
          </p>
        </div>
        <Button
          onClick={() => setAddModal({})}
          className="flex items-center gap-2"
        >
          <Plus size={14} /> Add account
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6 min-h-[600px]">
        {/* Tree panel */}
        <div className="w-[380px] shrink-0 rounded-xl border border-line-200 bg-surface-card overflow-auto">
          {ACCOUNT_TYPES.map(({ type, label }) => {
            const rootAccounts = accounts.filter(
              (a) => a.type === type && !a.parentId,
            );

            return (
              <div key={type} className="border-b border-line-200 last:border-b-0">
                {/* Section header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface-sink">
                  <span className="text-caption font-semibold text-ink-700 uppercase tracking-wide">
                    {label}
                  </span>
                  <button
                    onClick={() => setAddModal({ type })}
                    className="text-ink-400 hover:text-saffron-600 transition-colors"
                    title={`Add ${label} account`}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {rootAccounts.length === 0 ? (
                  <div className="px-4 py-3 text-caption text-ink-400 italic">
                    No accounts under {label} yet.
                  </div>
                ) : (
                  <div className="py-1">
                    {rootAccounts.map((acct) => {
                      const subAccounts = accounts.filter((a) => a.parentId === acct._id);
                      return (
                        <AccountNode
                          key={acct._id}
                          account={acct}
                          subAccounts={subAccounts}
                          depth={0}
                          selectedId={selectedAccount?._id ?? null}
                          onSelect={setSelectedAccount}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="flex-1 rounded-xl border border-line-200 bg-surface-card p-6">
          {selectedAccount ? (
            <AccountDetail
              account={selectedAccount}
              onAddChild={(parentId, type) => setAddModal({ parentId, type })}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <BookOpen size={36} className="text-ink-400" />
              <div>
                <p className="text-body font-medium text-ink-700">Select an account</p>
                <p className="text-caption text-ink-400 mt-0.5">
                  Click any account in the tree to see its details and balance.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddModal({})}
                className="flex items-center gap-1.5 mt-2"
              >
                <Plus size={13} /> Add account
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Add account modal */}
      {addModal !== null && (
        <AddAccountModal
          defaultType={addModal.type}
          defaultParentId={addModal.parentId}
          onClose={() => setAddModal(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
