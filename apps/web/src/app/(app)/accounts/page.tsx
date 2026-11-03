'use client';

import { useState } from 'react';
import { AccountType as SharedAccountType } from '@ai-accounting/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Plus, BookOpen, X, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

// Imported, not re-declared. This page previously defined its own union with
// 'ASSET' and 'LIABILITY' while the API stores 'ASSETS' and 'LIABILITIES', so
// those two sections silently rendered empty however many accounts existed.
type AccountType = SharedAccountType;

interface Account {
  _id: string;
  name: string;
  code: string;
  type: AccountType;
  parentId?: string | null;
  balancePaise: number;
  isGroup: boolean;
  isSystem: boolean;
  systemKey?: string;
  /** False once deactivated: kept for history, closed to new postings. */
  isActive: boolean;
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

const inputClass =
  'w-full rounded-md border border-line-200 bg-surface-card px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/30 focus:border-saffron-600';

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

function failure(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/** Ids of an account and everything under it: a group cannot move under these. */
function selfAndBelow(id: string, all: Account[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of all) {
      if (a.parentId && out.has(a.parentId) && !out.has(a._id)) {
        out.add(a._id);
        grew = true;
      }
    }
  }
  return out;
}

// ── Tree node ──────────────────────────────────────────────────────────────────

/**
 * One account and, beneath it, its children. It used to render children with
 * an empty account list, so anything two levels down never appeared.
 */
function AccountNode({
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
  const [expanded, setExpanded] = useState(true);
  const subAccounts = allAccounts.filter((a) => a.parentId === account._id);
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
          isSelected ? 'bg-honey-50 text-saffron-700' : 'hover:bg-surface-sink text-ink-700 hover:text-ink-900'
        } ${account.isActive ? '' : 'opacity-60'}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <span className="shrink-0 w-4 text-ink-400">
          {hasChildren ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="block w-3.5 h-3.5 rounded-full border border-line-200 ml-0.5" />
          )}
        </span>
        <span className="shrink-0 font-mono text-caption text-ink-400">{account.code}</span>
        <span className={`flex-1 text-body ${account.isGroup ? 'font-semibold' : 'font-normal'}`}>
          {account.name}
          {!account.isActive && <span className="ml-2 text-caption text-ink-500">Inactive</span>}
        </span>
        {!account.isGroup && account.balancePaise !== 0 && (
          <span className="text-caption font-mono text-ink-400 shrink-0">{formatPaise(account.balancePaise)}</span>
        )}
      </button>

      {hasChildren && expanded && (
        <div>
          {subAccounts.map((child) => (
            <AccountNode
              key={child._id}
              account={child}
              allAccounts={allAccounts}
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
          <h2 className="text-h3 font-display text-ink-900">Add account</h2>
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
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Account type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
              className={inputClass}
            >
              {ACCOUNT_TYPES.map(({ type, label }) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {createMutation.isError && (
            <p className="text-caption text-error-fg">{failure(createMutation.error, 'Failed to create account.')}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate(form)} disabled={!form.name.trim() || createMutation.isPending}>
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
  allAccounts,
  onAddChild,
  onChanged,
}: {
  account: Account;
  allAccounts: Account[];
  onAddChild: (parentId: string, type: AccountType) => void;
  onChanged: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: account.name, code: account.code, parentId: account.parentId ?? '' });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Account>(`/gl/accounts/${account._id}`, body),
    onSuccess: (_res, body) => {
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      setEditing(false);
      onChanged(body.isActive === false ? 'Account deactivated' : body.isActive === true ? 'Account reactivated' : 'Account saved');
    },
  });

  const blocked = selfAndBelow(account._id, allAccounts);
  const groups = allAccounts.filter((a) => a.isGroup && a.type === account.type && a.isActive && !blocked.has(a._id));
  const parent = allAccounts.find((a) => a._id === account.parentId);
  const startEdit = () => {
    setForm({ name: account.name, code: account.code, parentId: account.parentId ?? '' });
    update.reset();
    setEditing(true);
  };
  const save = () => {
    const body: Record<string, unknown> = {};
    if (form.name.trim() !== account.name) body.name = form.name.trim();
    if (form.code.trim() !== account.code) body.code = form.code.trim();
    if (form.parentId !== (account.parentId ?? '')) body.parentId = form.parentId || null;
    if (Object.keys(body).length === 0) return setEditing(false);
    update.mutate(body);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-caption font-medium text-ink-500 uppercase tracking-wide mb-1">
            {account.isGroup ? 'Group' : 'Account'} · <span className="font-mono">{account.code}</span>
          </p>
          <h2 className="text-h2 font-display text-ink-900">{account.name}</h2>
          {!account.isActive && (
            <p className="mt-1 text-caption text-ink-500">Deactivated. Its history stays in the reports; nothing new can be posted to it.</p>
          )}
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4 rounded-lg border border-line-200 bg-surface-sink p-4">
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Name</label>
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Code</label>
            <input className={`${inputClass} font-mono`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">Under</label>
            <select className={inputClass} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">Top level</option>
              {groups.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.code} · {g.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-caption text-ink-500">
              Only {ACCOUNT_TYPES.find((t) => t.type === account.type)?.label.toLowerCase()} groups. The type never changes: past entries depend on it.
            </p>
          </div>
          {update.isError && <p className="text-caption text-error-fg">{failure(update.error, "Couldn't save the account.")}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!form.name.trim() || !form.code.trim() || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save account'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-line-200 bg-surface-sink p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-caption text-ink-500">Type</span>
            <span className="text-caption font-medium text-ink-700 bg-honey-50 border border-line-200 rounded-full px-2 py-0.5">
              {ACCOUNT_TYPES.find((t) => t.type === account.type)?.label ?? account.type}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-caption text-ink-500">Under</span>
            <span className="text-caption font-medium text-ink-700">{parent ? `${parent.code} · ${parent.name}` : 'Top level'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-caption text-ink-500">Kind</span>
            <span className="text-caption font-medium text-ink-700">
              {account.isGroup ? 'Group / header' : 'Ledger'}
              {account.isSystem && ' · used by the books'}
            </span>
          </div>
        </div>
      )}

      {!account.isGroup && (
        <div className="rounded-lg border border-line-200 bg-surface-card p-4">
          <p className="text-caption text-ink-500 mb-1">Closing balance</p>
          <p className="text-h2 font-mono text-ink-900">{formatPaise(account.balancePaise)}</p>
        </div>
      )}

      {account.isGroup && account.isActive && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAddChild(account._id, account.type)}
          className="flex items-center gap-1.5 w-full justify-center"
        >
          <Plus size={13} /> Add sub-account
        </Button>
      )}

      {!editing && !account.isSystem && (
        <div className="border-t border-line-100 pt-4">
          {account.isActive ? (
            <button
              type="button"
              disabled={update.isPending}
              className="text-caption font-medium text-ink-500 hover:text-error-fg disabled:opacity-50"
              onClick={() =>
                window.confirm(`Deactivate ${account.name}? Its history stays; nothing new can be posted to it.`) &&
                update.mutate({ isActive: false })
              }
            >
              Deactivate account
            </button>
          ) : (
            <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ isActive: true })}>
              Reactivate account
            </Button>
          )}
          {update.isError && !editing && (
            <p className="mt-2 text-caption text-error-fg">{failure(update.error, "Couldn't change the account.")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addModal, setAddModal] = useState<{ type?: AccountType; parentId?: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data: remoteAccounts } = useQuery<Account[]>({
    queryKey: ['gl', 'accounts'],
    queryFn: () => api.get<Account[]>('/gl/accounts'),
  });

  const allAccounts = remoteAccounts ?? [];
  const accounts = showInactive ? allAccounts : allAccounts.filter((a) => a.isActive);
  const inactiveCount = allAccounts.length - allAccounts.filter((a) => a.isActive).length;
  // Read from the list, so a rename or move shows at once.
  const selectedAccount = allAccounts.find((a) => a._id === selectedId) ?? null;

  const handleSuccess = () => {
    qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
  };
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Chart of accounts</h1>
          <p className="text-body text-ink-500 mt-1">Ledger groups and accounts that make up your books.</p>
        </div>
        <div className="flex items-center gap-4">
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-caption text-ink-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show {inactiveCount} deactivated
            </label>
          )}
          <Button onClick={() => setAddModal({})} className="flex items-center gap-2">
            <Plus size={14} /> Add account
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6 min-h-[600px]">
        {/* Tree panel */}
        <div className="w-[380px] shrink-0 rounded-xl border border-line-200 bg-surface-card overflow-auto">
          {ACCOUNT_TYPES.map(({ type, label }) => {
            const rootAccounts = accounts.filter((a) => a.type === type && !a.parentId);

            return (
              <div key={type} className="border-b border-line-200 last:border-b-0">
                {/* Section header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface-sink">
                  <span className="text-caption font-semibold text-ink-700 uppercase tracking-wide">{label}</span>
                  <button
                    onClick={() => setAddModal({ type })}
                    className="text-ink-400 hover:text-saffron-600 transition-colors"
                    title={`Add ${label} account`}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {rootAccounts.length === 0 ? (
                  <div className="px-4 py-3 text-caption text-ink-400 italic">No accounts under {label} yet.</div>
                ) : (
                  <div className="py-1">
                    {rootAccounts.map((acct) => (
                      <AccountNode
                        key={acct._id}
                        account={acct}
                        allAccounts={accounts}
                        depth={0}
                        selectedId={selectedId}
                        onSelect={(a) => setSelectedId(a._id)}
                      />
                    ))}
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
              key={selectedAccount._id}
              account={selectedAccount}
              allAccounts={allAccounts}
              onAddChild={(parentId, type) => setAddModal({ parentId, type })}
              onChanged={showToast}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <BookOpen size={36} className="text-ink-400" />
              <div>
                <p className="text-body font-medium text-ink-700">Select an account</p>
                <p className="text-caption text-ink-400 mt-0.5">Click any account in the tree to see its details and balance.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setAddModal({})} className="flex items-center gap-1.5 mt-2">
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

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 rounded-md border border-success-fg bg-success-bg px-4 py-3 text-body font-medium text-success-fg shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
