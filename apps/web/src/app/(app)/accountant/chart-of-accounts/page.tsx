'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { ListToolbar, PageHeader } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { ConfirmDialog, errorText, isPartyAccount, useAccounts, type Account } from '@/components/accountant/common';
import { ACCOUNT_TYPES, AccountNode, typeLabel } from '@/components/accountant/account-tree';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

function Detail({ account, all }: { account: Account; all: Account[] }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const parent = all.find((a) => a._id === account.parentId);
  const toggle = useMutation({
    mutationFn: (isActive: boolean) => api.patch<Account>(`/gl/accounts/${account._id}`, { isActive }),
    onSuccess: (_r, isActive) => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      notify(isActive ? 'Account reactivated' : 'Account deactivated');
    },
    onError: (err) => {
      setConfirming(false);
      notify(errorText(err, "Couldn't change the account."), 'error');
    },
  });

  return (
    <div className="space-y-5">
      {confirming && (
        <ConfirmDialog
          title="Deactivate account"
          confirmLabel="Deactivate account"
          destructive
          busy={toggle.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => toggle.mutate(false)}
          body={<p>Deactivate <strong>{account.name}</strong>? Its history stays in the reports; nothing new can be posted to it.</p>}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-caption font-medium uppercase tracking-wide text-ink-500">
            {account.isGroup ? 'Group' : 'Account'} · <span className="font-mono">{account.code}</span>
          </p>
          <h2 className="text-h2 font-display text-ink-900">{account.name}</h2>
          {!account.isActive && <p className="mt-1 text-caption text-ink-500">Deactivated. Its history stays in the reports; nothing new can be posted to it.</p>}
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/accountant/chart-of-accounts/${account._id}/edit`}><Pencil size={12} /> Edit account</Link>
        </Button>
      </div>

      <dl className="space-y-3 rounded-lg border border-line-200 bg-surface-sink p-4">
        <div className="flex items-center justify-between"><dt className="text-caption text-ink-500">Type</dt><dd className="text-caption font-medium text-ink-700">{typeLabel(account.type)}</dd></div>
        <div className="flex items-center justify-between"><dt className="text-caption text-ink-500">Under</dt><dd className="text-caption font-medium text-ink-700">{parent ? `${parent.code} · ${parent.name}` : 'Top level'}</dd></div>
        <div className="flex items-center justify-between">
          <dt className="text-caption text-ink-500">Kind</dt>
          <dd className="text-caption font-medium text-ink-700">{account.isGroup ? 'Group / header' : 'Ledger'}{account.isSystem && ' · used by the books'}</dd>
        </div>
      </dl>

      <div className="rounded-lg border border-line-200 bg-surface-card p-4">
        <p className="mb-1 text-caption text-ink-500">{account.isGroup ? 'Total of the accounts under it' : 'Closing balance'}</p>
        <p className="text-h2 font-mono text-ink-900">{formatPaise(account.balancePaise)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {account.isGroup && account.isActive && (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/accountant/chart-of-accounts/new?parentId=${account._id}&type=${account.type}`}><Plus size={13} /> Add sub-account</Link>
          </Button>
        )}
        {!account.isGroup && account.isActive && !isPartyAccount(account) && (
          <Button size="sm" variant="secondary" asChild>
            <Link href="/accountant/bulk-update">Move posted lines</Link>
          </Button>
        )}
      </div>

      {!account.isSystem && (
        <div className="border-t border-line-100 pt-4">
          {account.isActive ? (
            <button type="button" disabled={toggle.isPending} className="text-caption font-medium text-ink-500 hover:text-error-fg disabled:opacity-50" onClick={() => setConfirming(true)}>
              Deactivate account
            </button>
          ) : (
            <Button size="sm" variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>Reactivate account</Button>
          )}
        </div>
      )}
    </div>
  );
}

function ChartOfAccounts() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get('selected');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('active');
  const q = useAccounts();
  const all = q.data ?? [];
  const inactive = all.filter((a) => !a.isActive).length;
  const visible = show === 'all' ? all : all.filter((a) => a.isActive);
  const needle = search.trim().toLowerCase();
  const matches = needle ? visible.filter((a) => a.name.toLowerCase().includes(needle) || a.code.toLowerCase().includes(needle)) : [];
  const selected = all.find((a) => a._id === selectedId) ?? null;
  const select = (a: Account) => router.replace(`/accountant/chart-of-accounts?selected=${a._id}`, { scroll: false });

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        subtitle="The groups and ledger accounts your books are kept in."
        actions={<Button asChild><Link href="/accountant/chart-of-accounts/new"><Plus size={14} /> New account</Link></Button>}
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name or code"
        filters={inactive ? { value: show, onChange: setShow, options: [['active', 'Active'], ['all', `All, with ${inactive} deactivated`]] } : undefined}
      />
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}

      <div className="flex min-h-[600px] gap-6">
        <div className="w-[400px] shrink-0 overflow-auto rounded-xl border border-line-200 bg-surface-card">
          {needle ? (
            <div className="py-1">
              {matches.length === 0 && <p className="px-4 py-3 text-caption text-ink-400">No account matches.</p>}
              {matches.map((a) => (
                <AccountNode key={a._id} account={a} all={[]} depth={0} selectedId={selectedId} onSelect={select} />
              ))}
            </div>
          ) : (
            ACCOUNT_TYPES.map(({ type, label }) => {
              const roots = visible.filter((a) => a.type === type && !a.parentId);
              return (
                <div key={type} className="border-b border-line-200 last:border-b-0">
                  <div className="flex items-center justify-between bg-surface-sink px-4 py-2.5">
                    <span className="text-caption font-semibold uppercase tracking-wide text-ink-700">{label}</span>
                    <Link href={`/accountant/chart-of-accounts/new?type=${type}`} className="text-ink-400 transition-colors hover:text-saffron-600" title={`New ${label.toLowerCase()} account`}>
                      <Plus size={14} />
                    </Link>
                  </div>
                  {roots.length === 0 ? (
                    <p className="px-4 py-3 text-caption italic text-ink-400">No accounts under {label} yet.</p>
                  ) : (
                    <div className="py-1">
                      {roots.map((a) => <AccountNode key={a._id} account={a} all={visible} depth={0} selectedId={selectedId} onSelect={select} />)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex-1 rounded-xl border border-line-200 bg-surface-card p-6">
          {selected ? (
            <Detail key={selected._id} account={selected} all={all} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <BookOpen size={36} className="text-ink-400" />
              <div>
                <p className="text-body font-medium text-ink-700">Select an account</p>
                <p className="mt-0.5 text-caption text-ink-400">Choose any account in the tree to see its details and balance.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChartOfAccountsPage() {
  return (
    <Suspense>
      <ChartOfAccounts />
    </Suspense>
  );
}
