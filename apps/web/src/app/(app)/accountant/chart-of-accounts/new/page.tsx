'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText, useAccounts, type Account } from '@/components/accountant/common';
import { ACCOUNT_TYPES, groupsFor } from '@/components/accountant/account-tree';
import { api } from '@/lib/api';

function NewAccount() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const all = useAccounts().data ?? [];
  const initialType = ACCOUNT_TYPES.some((t) => t.type === params.get('type')) ? params.get('type')! : ACCOUNT_TYPES[0].type;
  const [f, setF] = useState({ name: '', code: '', type: initialType, parentId: params.get('parentId') ?? '', isGroup: false });
  const [error, setError] = useState<string | null>(null);
  const groups = groupsFor(f.type, all);

  const save = useMutation({
    mutationFn: () =>
      api.post<Account>('/gl/accounts', {
        name: f.name.trim(),
        type: f.type,
        code: f.code.trim() || undefined,
        parentId: f.parentId || null,
        isGroup: f.isGroup,
      }),
    onMutate: () => setError(null),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      notify('Account saved');
      router.push(`/accountant/chart-of-accounts?selected=${a._id}`);
    },
    onError: (err) => setError(errorText(err, "Couldn't save the account.")),
  });

  return (
    <div>
      <PageHeader title="New account" back={{ href: '/accountant/chart-of-accounts', label: 'Chart of accounts' }} />
      <FormPage
        onSubmit={() => save.mutate()}
        error={error}
        actions={
          <>
            <Button type="submit" disabled={!f.name.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Save account'}</Button>
            <Button type="button" variant="secondary" asChild><Link href="/accountant/chart-of-accounts">Cancel</Link></Button>
          </>
        }
      >
        <Section title="Account">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" required>
              <input className={inputClass} value={f.name} maxLength={120} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Trade Receivables" />
            </Field>
            <Field label="Code" hint="Left blank, the next free code for the type is used.">
              <input className={`${inputClass} font-mono`} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label="Type" required hint="It never changes once entries are posted: reports depend on it.">
              <select className={inputClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, parentId: '' })}>
                {ACCOUNT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Under">
              <select className={inputClass} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
                <option value="">Top level</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.code} · {g.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-body text-ink-900 md:col-span-2">
              <input type="checkbox" checked={f.isGroup} onChange={(e) => setF({ ...f, isGroup: e.target.checked })} />
              A group: it holds other accounts, and nothing is posted to it directly.
            </label>
          </div>
        </Section>
      </FormPage>
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
