'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { ExpenseFields, emptyExpense, expenseBody, useInterState, type ExpenseFormValue } from '@/components/purchases/expense-form';
import { ScheduleFields, type Frequency } from '@/components/purchases/recurring';
import { errorText, todayIso } from '@/components/purchases/purchase-data';

/** An expense that repeats. Each one is drafted on its date for you to check and post. */
export default function NewRecurringExpensePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [value, setValue] = useState<ExpenseFormValue>(emptyExpense);
  const [schedule, setSchedule] = useState({ frequency: 'monthly' as Frequency, dayOfMonth: '1', startDate: todayIso(), endDate: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const interState = useInterState(value);

  const save = useMutation({
    mutationFn: () => {
      const day = Number(schedule.dayOfMonth);
      if (!name.trim()) throw new Error('Give it a name, like "Accounting software".');
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('The day is 1 to 31.');
      if (schedule.endDate && schedule.endDate < schedule.startDate) throw new Error('The end date is before the start date.');
      const { vendorId, ...expense } = expenseBody(value, interState);
      return api.post('/recurring/expenses', {
        name: name.trim(),
        ...(vendorId ? { partyId: vendorId } : {}),
        frequency: schedule.frequency,
        dayOfMonth: day,
        startDate: schedule.startDate,
        endDate: schedule.endDate || null,
        ...expense,
        notes: value.notes.trim() || null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring'] });
      notify(`Recurring expense saved: ${name.trim()}`);
      router.push('/purchases/recurring-expenses');
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the schedule.")),
  });

  return (
    <div>
      <PageHeader title="New recurring expense" subtitle="Drafted on its date, for you to check and post. Nothing posts on its own." back={{ href: '/purchases/recurring-expenses', label: 'Recurring expenses' }} />
      <FormPage
        onSubmit={() => {
          setProblem(null);
          save.mutate();
        }}
        error={problem}
        actions={
          <>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save recurring expense'}</Button>
            <Button type="button" variant="secondary" asChild><Link href="/purchases/recurring-expenses">Cancel</Link></Button>
          </>
        }
      >
        <Section title="Schedule">
          <Field label="Name" required className="mb-4 max-w-md">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Accounting software" maxLength={120} />
          </Field>
          <ScheduleFields value={schedule} onChange={(p) => setSchedule((s) => ({ ...s, ...p }))} />
        </Section>
        <ExpenseFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} withDate={false} title="Each expense" />
      </FormPage>
    </div>
  );
}
