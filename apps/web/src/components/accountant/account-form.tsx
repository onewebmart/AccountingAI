'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConfirmDialog, errorText, isPartyAccount, type Account } from './common';
import { ACCOUNT_TYPE_LIST, BASE_LABEL, accountTypeInfo } from './account-types';
import { selfAndBelow } from './account-tree';

const DESCRIPTION_MAX = 500;
const BASES = ['ASSETS', 'LIABILITIES', 'CAPITAL', 'INCOME', 'EXPENSE'];
/** "Reported as …", "past entries depend on the account being …". */
const AS: Record<string, string> = { ASSETS: 'an asset', LIABILITIES: 'a liability', CAPITAL: 'equity', INCOME: 'income', EXPENSE: 'an expense' };

/** The group a new account of this type most likely sits under: one of the same detailed type, else the first of its base type. */
function suggestedGroup(accountType: string, groups: Account[]): string {
  const base = accountTypeInfo(accountType)?.base;
  const mine = groups.filter((g) => g.type === base);
  const affinity: Record<string, string> = {
    cash: 'other_current_asset', bank: 'other_current_asset', stock: 'other_current_asset', payment_clearing: 'other_current_asset', input_tax: 'other_current_asset',
    credit_card: 'other_current_liability', output_tax: 'other_current_liability', long_term_liability: 'other_current_liability', other_liability: 'other_current_liability',
    other_income: 'income', other_expense: 'expense',
  };
  const exact = mine.find((g) => g.accountType === accountType) ?? mine.find((g) => g.accountType === affinity[accountType]);
  return (exact ?? mine[0])?._id ?? '';
}

/**
 * New account and Edit account, as a page. The detailed type decides the
 * base type (Asset, Liability, Equity, Income, Expense) that the reports use;
 * once an account exists it can change to another detailed type of the same
 * base type only, and a system account's type does not change at all.
 */
export function AccountForm({ account, all, initialType, initialParent }: {
  account?: Account;
  all: Account[];
  initialType?: string;
  initialParent?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = !!account;
  const groups = useMemo(() => {
    const exclude = account ? selfAndBelow(account._id, all) : new Set<string>();
    return all.filter((a) => a.isGroup && a.isActive && !exclude.has(a._id));
  }, [all, account]);

  const startType = account?.accountType ?? (initialType && accountTypeInfo(initialType) ? initialType : 'expense');
  const [f, setF] = useState(() => ({
    accountType: startType,
    name: account?.name ?? '',
    code: account?.code ?? '',
    description: account?.description ?? '',
    watchlist: account?.watchlist ?? false,
    isGroup: false,
    sub: account ? !!account.parentId : true,
    parentId: account?.parentId ?? initialParent ?? suggestedGroup(startType, groups),
  }));
  const [parentTouched, setParentTouched] = useState(!!account || !!initialParent);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const info = accountTypeInfo(f.accountType);
  const base = info?.base ?? account?.type ?? 'EXPENSE';
  const parentOptions = groups.filter((g) => g.type === base);
  const fixedType = !!account?.systemKey;
  // Editing: only the detailed types of the account's own base type.
  const typeOptions = editing ? ACCOUNT_TYPE_LIST.filter((t) => t.base === account!.type) : ACCOUNT_TYPE_LIST;

  const chooseType = (accountType: string) => {
    const nextBase = accountTypeInfo(accountType)?.base;
    setF((cur) => {
      const parentFits = groups.some((g) => g._id === cur.parentId && g.type === nextBase);
      return { ...cur, accountType, parentId: parentTouched && parentFits ? cur.parentId : suggestedGroup(accountType, groups) };
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const parentId = f.sub ? f.parentId || null : null;
      if (f.sub && !parentId) throw new Error('Choose the parent account, or untick Make this a sub-account.');
      if (!editing) {
        return api.post<Account>('/gl/accounts', {
          name: f.name.trim(),
          accountType: f.accountType,
          code: f.code.trim() || undefined,
          parentId,
          isGroup: f.isGroup,
          description: f.description.trim(),
          watchlist: f.watchlist,
        });
      }
      const body: Record<string, unknown> = {};
      const a = account!;
      if (f.name.trim() !== a.name) body.name = f.name.trim();
      if (f.code.trim() !== a.code) body.code = f.code.trim();
      if (parentId !== (a.parentId ?? null)) body.parentId = parentId;
      if (!fixedType && f.accountType !== a.accountType) body.accountType = f.accountType;
      if (f.description.trim() !== (a.description ?? '')) body.description = f.description.trim();
      if (f.watchlist !== !!a.watchlist) body.watchlist = f.watchlist;
      if (!Object.keys(body).length) return null;
      return api.patch<Account>(`/gl/accounts/${a._id}`, body);
    },
    onMutate: () => setError(null),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['gl', 'accounts'] });
      notify(r || !editing ? 'Account saved' : 'Nothing changed', r || !editing ? 'success' : 'info');
      router.push(`/accountant/chart-of-accounts?selected=${r?._id ?? account?._id ?? ''}`);
    },
    onError: (err) => setError(errorText(err, "Couldn't save the account.")),
  });

  const toggle = useMutation({
    mutationFn: (isActive: boolean) => api.patch<Account>(`/gl/accounts/${account!._id}`, { isActive }),
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
    <>
      {confirming && account && (
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
      <FormPage
        onSubmit={() => save.mutate()}
        error={error}
        actions={
          <>
            <Button type="submit" disabled={!f.name.trim() || (editing && !f.code.trim()) || save.isPending}>{save.isPending ? 'Saving…' : 'Save account'}</Button>
            <Button type="button" variant="secondary" asChild><Link href="/accountant/chart-of-accounts">Cancel</Link></Button>
          </>
        }
      >
        <Section>
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            <div className="space-y-4">
              <Field label="Account Type" required>
                <select
                  className={inputClass}
                  value={f.accountType}
                  disabled={fixedType}
                  onChange={(e) => chooseType(e.target.value)}
                  autoFocus={!editing}
                >
                  {BASES.filter((b) => typeOptions.some((t) => t.base === b)).map((b) => (
                    <optgroup key={b} label={BASE_LABEL[b]}>
                      {typeOptions.filter((t) => t.base === b).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                {fixedType && (
                  <p className="mt-1 flex items-center gap-1 text-caption text-ink-500"><Lock size={12} /> The books rely on this account, so its type stays as it is.</p>
                )}
                {editing && !fixedType && (
                  <p className="mt-1 text-caption text-ink-500">Only {BASE_LABEL[account!.type].toLowerCase()} types: past entries depend on the account being {AS[account!.type]}.</p>
                )}
              </Field>
              <Field label="Account Name" required>
                <input className={inputClass} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="HDFC Current Account" />
              </Field>
              <Field label="Account Code" hint={editing ? undefined : 'Left blank, the next free code for the type is used.'}>
                <input className={`${inputClass} max-w-[220px] font-mono`} value={f.code} maxLength={12} onChange={(e) => setF({ ...f, code: e.target.value })} />
              </Field>
              {!editing && (
                <label className="flex items-start gap-2 text-body text-ink-900">
                  <input type="checkbox" className="mt-1" checked={f.isGroup} onChange={(e) => setF({ ...f, isGroup: e.target.checked })} />
                  <span>A group: it holds other accounts, and nothing is posted to it directly.</span>
                </label>
              )}
              <label className="flex items-start gap-2 text-body text-ink-900">
                <input type="checkbox" className="mt-1" checked={f.sub} onChange={(e) => setF({ ...f, sub: e.target.checked, parentId: f.parentId || suggestedGroup(f.accountType, groups) })} />
                <span>Make this a sub-account</span>
              </label>
              {f.sub && (
                <Field label="Parent Account" required hint={`A group of ${BASE_LABEL[base].toLowerCase()} accounts.`}>
                  <select
                    className={cn(inputClass, !f.parentId && 'border-error-fg')}
                    value={f.parentId}
                    onChange={(e) => {
                      setParentTouched(true);
                      setF({ ...f, parentId: e.target.value });
                    }}
                  >
                    <option value="">Choose a group</option>
                    {parentOptions.map((g) => <option key={g._id} value={g._id}>{g.code} · {g.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Description" hint={<span className="flex justify-end font-mono">{f.description.length}/{DESCRIPTION_MAX}</span>}>
                <textarea className={`${inputClass} min-h-[84px]`} value={f.description} maxLength={DESCRIPTION_MAX} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What is booked here, so others pick the right account." />
              </Field>
              <label className="flex items-start gap-2 text-body text-ink-900">
                <input type="checkbox" className="mt-1" checked={f.watchlist} onChange={(e) => setF({ ...f, watchlist: e.target.checked })} />
                <span>Add to the watchlist on my dashboard</span>
              </label>
            </div>

            <aside className="h-fit rounded-lg border border-line-200 bg-honey-50 p-4">
              <p className="mb-1 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-ink-600"><Info size={13} /> {info?.label ?? 'Account type'}</p>
              <p className="text-body text-ink-700">{info?.about}</p>
              <p className="mt-3 text-caption text-ink-500">
                Reported as {AS[base]}, in the {base === 'INCOME' || base === 'EXPENSE' ? 'profit and loss' : 'balance sheet'}.
              </p>
            </aside>
          </div>
        </Section>

        {account && (
          <Section title="Status">
            <div className="flex flex-wrap items-center gap-3">
              {account.isSystem ? (
                <p className="flex items-center gap-1.5 text-body text-ink-600"><Lock size={14} /> Used by the books: it can be renamed and moved, not deactivated.</p>
              ) : account.isActive ? (
                <Button type="button" variant="secondary" size="sm" disabled={toggle.isPending} onClick={() => setConfirming(true)}>Deactivate account</Button>
              ) : (
                <Button type="button" variant="secondary" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>Reactivate account</Button>
              )}
              {!account.isGroup && account.isActive && !isPartyAccount(account) && (
                <Button type="button" variant="secondary" size="sm" asChild><Link href="/accountant/bulk-update">Move posted lines</Link></Button>
              )}
              {account.isGroup && account.isActive && (
                <Button type="button" variant="secondary" size="sm" asChild>
                  <Link href={`/accountant/chart-of-accounts/new?parentId=${account._id}&type=${account.accountType ?? ''}`}>Add sub-account</Link>
                </Button>
              )}
            </div>
          </Section>
        )}
      </FormPage>
    </>
  );
}
