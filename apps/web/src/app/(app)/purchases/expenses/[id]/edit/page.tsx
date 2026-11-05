'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { FormPage, PageHeader } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { ExpenseFields, expenseBody, expenseToForm, useInterState, type ExpenseFormValue, type ExpenseRow } from '@/components/purchases/expense-form';
import { errorText } from '@/components/purchases/purchase-data';

function EditForm({ expense }: { expense: ExpenseRow }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [value, setValue] = useState<ExpenseFormValue>(() => expenseToForm(expense));
  const [problem, setProblem] = useState<string | null>(null);
  const interState = useInterState(value);
  const save = useMutation({
    mutationFn: () => api.patch(`/direct-expenses/${expense._id}`, { ...expenseBody(value, interState), date: value.date, notes: value.notes.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['direct-expenses'] });
      notify('Expense saved');
      router.push(`/purchases/expenses/${expense._id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the expense.")),
  });
  return (
    <FormPage
      onSubmit={() => {
        setProblem(null);
        save.mutate();
      }}
      error={problem}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save expense'}</Button>
          <Button type="button" variant="secondary" asChild><Link href={`/purchases/expenses/${expense._id}`}>Cancel</Link></Button>
        </>
      }
    >
      <ExpenseFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} />
    </FormPage>
  );
}

/** A draft expense, changed. A posted one is history: reverse its voucher instead. */
export default function EditExpensePage() {
  const { id } = useParams<{ id: string }>();
  const expense = useQuery({ queryKey: ['direct-expenses', id], queryFn: () => api.get<ExpenseRow>(`/direct-expenses/${id}`) });
  const e = expense.data;
  return (
    <div>
      <PageHeader title={e ? <>Edit expense <span className="font-mono">{e.number}</span></> : 'Edit expense'} back={{ href: `/purchases/expenses/${id}`, label: e?.number ?? 'Expense' }} />
      {expense.isError ? (
        <QueryError error={expense.error} onRetry={() => void expense.refetch()} />
      ) : !e ? (
        <p className="text-caption text-ink-400">Loading…</p>
      ) : e.status !== 'draft' ? (
        <p className="rounded-md border border-line-200 bg-surface-card px-4 py-3 text-body text-ink-700">
          This expense is posted, so it cannot be changed. Reverse its voucher from <Link href="/vouchers" className="underline">All vouchers</Link> and enter it again.
        </p>
      ) : (
        <EditForm key={e._id} expense={e} />
      )}
    </div>
  );
}
