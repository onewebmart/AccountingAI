'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Lock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { useAccounts, type Account } from '@/components/accountant/common';
import { ACCOUNT_TYPE_LIST, BASE_LABEL, accountTypeLabel } from '@/components/accountant/account-types';
import { formatPaise } from '@/lib/gst';
import { cn } from '@/lib/utils';

const BASES = ['ASSETS', 'LIABILITIES', 'CAPITAL', 'INCOME', 'EXPENSE'];
const selectClass = 'h-10 rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40';

/** Accounts in chart order: by base type, each group followed by what sits under it, by code. */
function inTreeOrder(all: Account[]): Array<{ account: Account; depth: number }> {
  const children = new Map<string, Account[]>();
  for (const a of all) {
    const key = a.parentId && all.some((p) => p._id === a.parentId) ? a.parentId : '';
    children.set(key, [...(children.get(key) ?? []), a]);
  }
  const out: Array<{ account: Account; depth: number }> = [];
  const walk = (parent: string, depth: number) => {
    const kids = (children.get(parent) ?? []).sort((a, b) => BASES.indexOf(a.type) - BASES.indexOf(b.type) || a.code.localeCompare(b.code));
    for (const a of kids) {
      out.push({ account: a, depth });
      if (depth < 20) walk(a._id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

function ChartOfAccounts() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get('selected');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('active');
  const [type, setType] = useState('');
  const q = useAccounts();
  const all = useMemo(() => q.data ?? [], [q.data]);
  const byId = useMemo(() => new Map(all.map((a) => [a._id, a])), [all]);
  const ordered = useMemo(() => inTreeOrder(all), [all]);

  const needle = search.trim().toLowerCase();
  const filtering = !!needle || !!type || show !== 'active';
  const rows = ordered.filter(({ account: a }) => {
    if (show === 'active' && !a.isActive) return false;
    if (show === 'inactive' && a.isActive) return false;
    if (type && (type.startsWith('base:') ? a.type !== type.slice(5) : a.accountType !== type)) return false;
    if (needle && !(a.name.toLowerCase().includes(needle) || a.code.toLowerCase().includes(needle) || accountTypeLabel(a.accountType).toLowerCase().includes(needle))) return false;
    return true;
  });
  const inactive = all.filter((a) => !a.isActive).length;

  return (
    <div>
      <PageHeader
        guide="chartOfAccounts"
        title="Chart of accounts"
        subtitle="The groups and ledger accounts your books are kept in. A lock marks an account the books rely on."
        actions={<Button asChild><Link href="/accountant/chart-of-accounts/new"><Plus size={14} /> New account</Link></Button>}
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name, code or type"
        filters={{ value: show, onChange: setShow, options: [['active', 'Active'], ['inactive', `Inactive${inactive ? ` (${inactive})` : ''}`], ['all', 'All']] }}
      >
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)} aria-label="Account type">
          <option value="">All account types</option>
          {BASES.map((b) => (
            <optgroup key={b} label={BASE_LABEL[b]}>
              <option value={`base:${b}`}>Every {BASE_LABEL[b].toLowerCase()} account</option>
              {ACCOUNT_TYPE_LIST.filter((t) => t.base === b).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      </ListToolbar>

      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading ? (
        <p className="py-10 text-caption text-ink-400">Loading the chart of accounts…</p>
      ) : rows.length === 0 && !q.isError ? (
        <EmptyState title="No account matches" body="Change the search, the type or Active / Inactive." />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Account name</th>
                <th className={th}>Account code</th>
                <th className={th}>Account type</th>
                <th className={th}>Parent account</th>
                <th className={`${th} text-right`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account: a, depth }) => {
                const parent = a.parentId ? byId.get(a.parentId) : undefined;
                return (
                  <tr
                    key={a._id}
                    className={cn(rowLink, a._id === selectedId && 'bg-honey-50', !a.isActive && 'text-ink-500')}
                    onClick={() => router.push(`/accountant/chart-of-accounts/${a._id}/edit`)}
                  >
                    <td className={td}>
                      <span className="flex items-center gap-1.5" style={{ paddingLeft: filtering ? 0 : depth * 20 }}>
                        <Link
                          href={`/accountant/chart-of-accounts/${a._id}/edit`}
                          onClick={(e) => e.stopPropagation()}
                          className={cn('hover:underline', a.isGroup && 'font-semibold', !a.isActive && 'text-ink-500')}
                        >
                          {a.name}
                        </Link>
                        {a.isSystem && <Lock size={12} className="shrink-0 text-ink-400" aria-label="System account" />}
                        {a.watchlist && <Eye size={12} className="shrink-0 text-brand-700" aria-label="On the dashboard watchlist" />}
                        {!a.isActive && <span className="text-caption text-ink-500">Inactive</span>}
                      </span>
                    </td>
                    <td className={`${td} font-mono text-caption text-ink-600`}>{a.code}</td>
                    <td className={`${td} text-ink-600`}>{a.isGroup ? <span>Group <span className="text-caption text-ink-400">· {accountTypeLabel(a.accountType)}</span></span> : accountTypeLabel(a.accountType)}</td>
                    <td className={`${td} text-ink-600`}>{parent ? parent.name : <span className="text-ink-400">—</span>}</td>
                    <td className={cn(tdMoney, a.isGroup ? 'text-ink-500' : '')}>{a.balancePaise !== 0 ? formatPaise(a.balancePaise) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line-200 bg-surface-sink px-3 py-2.5 text-caption text-ink-500">
            <span>{rows.length} account{rows.length === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-3"><span className="flex items-center gap-1"><Lock size={11} /> used by the books</span><span className="flex items-center gap-1"><Eye size={11} /> on the dashboard watchlist</span></span>
          </div>
        </TableCard>
      )}
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
