'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText, useAccounts, type Account } from '@/components/accountant/common';
import { groupsFor, selfAndBelow, typeLabel } from '@/components/accountant/account-tree';
import { api } from '@/lib/api';

/** Rename, recode or move an account. Its type never changes: past entries depend on it. */
export default function EditAccountPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useAccounts();
  const all = q.data ?? [];
  const account = all.find((a) => a._id === id);
  const [f, setF] = useState<{ name: string; code: string; parentId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (account && !f) setF({ name: account.name, code: account.code, parentId: account.parentId ?? '' });
  }, [account, f]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (!account || !f) return Promise.resolve(null);
      if (f.name.trim() !== account.name) body.name = f.name.trim();
      if (f.code.trim() !== account.code) body.code = f.code.trim();
      if (f.parentId !== (account.parentId ?? '')) body.parentId = f.parentId || null;
      if (!Object.keys(body).length) return Promise.resolve(null);
      return api.patch<Account>(`/gl/accounts/${account._id}`, body);
    },
    onMutate: () => setError(null),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      notify(r ? 'Account saved' : 'Nothing changed', r ? 'success' : 'info');
      router.push(`/accountant/chart-of-accounts?selected=${id}`);
    },
    onError: (err) => setError(errorText(err, "Couldn't save the account.")),
  });

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>;
  if (!account) return <EmptyState title="No such account" action={<Button asChild><Link href="/accountant/chart-of-accounts">Chart of accounts</Link></Button>} />;
  if (!f) return null;

  const groups = groupsFor(account.type, all, selfAndBelow(account._id, all));
  return (
    <div>
      <PageHeader title={`Edit ${account.name}`} back={{ href: `/accountant/chart-of-accounts?selected=${account._id}`, label: 'Chart of accounts' }} />
      <FormPage
        onSubmit={() => save.mutate()}
        error={error}
        actions={
          <>
            <Button type="submit" disabled={!f.name.trim() || !f.code.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Save account'}</Button>
            <Button type="button" variant="secondary" asChild><Link href={`/accountant/chart-of-accounts?selected=${account._id}`}>Cancel</Link></Button>
          </>
        }
      >
        <Section title="Account" description={`${typeLabel(account.type)} · ${account.isGroup ? 'a group' : 'a ledger account'}${account.isSystem ? ' used by the books' : ''}`}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" required>
              <input className={inputClass} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Code" required>
              <input className={`${inputClass} font-mono`} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label="Under" hint={`Only ${typeLabel(account.type).toLowerCase()} groups. The type never changes: past entries depend on it.`} className="md:col-span-2">
              <select className={inputClass} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
                <option value="">Top level</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.code} · {g.name}</option>)}
              </select>
            </Field>
          </div>
        </Section>
      </FormPage>
    </div>
  );
}
