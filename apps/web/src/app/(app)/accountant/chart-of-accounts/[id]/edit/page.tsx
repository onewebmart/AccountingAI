'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, PageHeader, StatusChip } from '@/components/page/page-shell';
import { useAccounts } from '@/components/accountant/common';
import { AccountForm } from '@/components/accountant/account-form';
import { accountTypeLabel } from '@/components/accountant/account-types';
import { formatPaise } from '@/lib/gst';

/** Rename, recode, retype within its base type, move, describe or watch an account. */
export default function EditAccountPage() {
  const { id } = useParams<{ id: string }>();
  const q = useAccounts();
  const all = q.data ?? [];
  const account = all.find((a) => a._id === id);

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>;
  if (!account) return <EmptyState title="No such account" action={<Button asChild><Link href="/accountant/chart-of-accounts">Chart of accounts</Link></Button>} />;

  return (
    <div>
      <PageHeader
        title={`Edit ${account.name}`}
        back={{ href: `/accountant/chart-of-accounts?selected=${account._id}`, label: 'Chart of accounts' }}
        subtitle={
          <>
            <span className="font-mono">{account.code}</span> · {account.isGroup ? 'Group' : accountTypeLabel(account.accountType)} ·{' '}
            {account.isGroup ? 'total of the accounts under it' : 'balance'} <span className="font-mono">{formatPaise(account.balancePaise)}</span>
          </>
        }
        meta={
          <>
            {account.isSystem && <StatusChip tone="neutral"><Lock size={11} className="mr-1" /> System account</StatusChip>}
            {!account.isActive && <StatusChip tone="neutral">Inactive</StatusChip>}
          </>
        }
      />
      <AccountForm key={account._id} account={account} all={all} />
    </div>
  );
}
