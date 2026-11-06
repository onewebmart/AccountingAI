'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader } from '@/components/page/page-shell';
import { useAccounts } from '@/components/accountant/common';
import { AccountForm } from '@/components/accountant/account-form';
import { accountTypeInfo } from '@/components/accountant/account-types';

/** Older links name a base type; start those on its plainest detailed type. */
const DEFAULT_FOR_BASE: Record<string, string> = {
  ASSETS: 'other_current_asset',
  LIABILITIES: 'other_current_liability',
  CAPITAL: 'equity',
  INCOME: 'income',
  EXPENSE: 'expense',
};

function NewAccount() {
  const params = useSearchParams();
  const q = useAccounts();
  const asked = params.get('type') ?? '';
  const parentId = params.get('parentId') ?? undefined;
  const parent = (q.data ?? []).find((a) => a._id === parentId);
  const type = accountTypeInfo(asked) ? asked : DEFAULT_FOR_BASE[asked] ?? (parent ? DEFAULT_FOR_BASE[parent.type] : undefined);

  return (
    <div>
      <PageHeader title="New account" back={{ href: '/accountant/chart-of-accounts', label: 'Chart of accounts' }} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading || !q.data ? (
        <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      ) : (
        <AccountForm all={q.data} initialType={type} initialParent={parent?._id} />
      )}
    </div>
  );
}

export default function NewAccountPage() {
  return (
    <Suspense>
      <NewAccount />
    </Suspense>
  );
}
