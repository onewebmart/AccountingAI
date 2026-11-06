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
import { MileageFields, mileageBody, mileageToForm, useMileageSettings, type MileageFormValue } from '@/components/purchases/mileage';
import { useCanManageSettings } from '@/components/purchases/expense-tabs';
import { errorText } from '@/components/purchases/purchase-data';

function useSaveDraft(id: string) {
  const router = useRouter();
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/direct-expenses/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['direct-expenses'] });
      notify('Expense saved');
      router.push(`/purchases/expenses/${id}`);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the expense.")),
  });
  const submit = (body: () => Record<string, unknown>) => {
    setProblem(null);
    try {
      save.mutate(body());
    } catch (e) {
      setProblem(errorText(e));
    }
  };
  return { save, submit, problem };
}

function Actions({ id, pending }: { id: string; pending: boolean }) {
  return (
    <>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save expense'}</Button>
      <Button type="button" variant="secondary" asChild><Link href={`/purchases/expenses/${id}`}>Cancel</Link></Button>
    </>
  );
}

function EditExpense({ expense }: { expense: ExpenseRow }) {
  const [value, setValue] = useState<ExpenseFormValue>(() => expenseToForm(expense));
  const interState = useInterState(value);
  const { save, submit, problem } = useSaveDraft(expense._id);
  return (
    <FormPage onSubmit={() => submit(() => ({ ...expenseBody(value, interState), date: value.date, notes: value.notes.trim() || null }))} error={problem} actions={<Actions id={expense._id} pending={save.isPending} />}>
      <ExpenseFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} />
    </FormPage>
  );
}

function EditMileage({ expense }: { expense: ExpenseRow }) {
  const [value, setValue] = useState<MileageFormValue>(() => mileageToForm(expense));
  const settings = useMileageSettings();
  const canManage = useCanManageSettings();
  const { save, submit, problem } = useSaveDraft(expense._id);
  return (
    <FormPage
      onSubmit={() =>
        submit(() => {
          // An expense keeps its kind: everything but that is sent.
          const body: Record<string, unknown> = { ...mileageBody(value, settings.data) };
          delete body.kind;
          return body;
        })
      }
      error={problem}
      actions={<Actions id={expense._id} pending={save.isPending} />}
    >
      <MileageFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} settings={settings.data} canManage={canManage} />
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
      <PageHeader title={e ? <>Edit {e.kind === 'mileage' ? 'mileage expense' : 'expense'} <span className="font-mono">{e.number}</span></> : 'Edit expense'} back={{ href: `/purchases/expenses/${id}`, label: e?.number ?? 'Expense' }} />
      {expense.isError ? (
        <QueryError error={expense.error} onRetry={() => void expense.refetch()} />
      ) : !e ? (
        <p className="text-caption text-ink-400">Loading…</p>
      ) : e.status !== 'draft' ? (
        <p className="rounded-md border border-line-200 bg-surface-card px-4 py-3 text-body text-ink-700">
          This expense is posted, so it cannot be changed. Reverse its voucher from <Link href="/vouchers" className="underline">All vouchers</Link> and enter it again.
        </p>
      ) : e.kind === 'mileage' ? (
        <EditMileage key={e._id} expense={e} />
      ) : (
        <EditExpense key={e._id} expense={e} />
      )}
    </div>
  );
}
