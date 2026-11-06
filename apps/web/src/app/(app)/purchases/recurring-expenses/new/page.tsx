'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { REPEAT_EVERY, firstOccurrence, nextOccurrence, type Frequency } from '@/lib/schedule';
import { ExpenseFields, emptyExpense, expenseBody, useInterState, type ExpenseFormValue } from '@/components/purchases/expense-form';
import { errorText, shortDate, todayIso } from '@/components/purchases/purchase-data';

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });

/** The first and second dates the server will draft on: the same rule it runs, the day of the month taken from the start date. */
function firstRuns(startDate: string, frequency: Frequency) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const day = Number(startDate.slice(8, 10));
  const first = firstOccurrence(startDate, day, frequency);
  return { day, first, second: nextOccurrence(first, day, frequency) };
}

/**
 * An expense that repeats, laid out as Zoho's: a profile name, how often,
 * from when and until when, then the expense itself, itemized if need be.
 * Each one is drafted on its date for a person to check and post; nothing
 * posts on its own.
 */
export default function NewRecurringExpensePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [neverExpires, setNeverExpires] = useState(true);
  const [value, setValue] = useState<ExpenseFormValue>(emptyExpense);
  const [problem, setProblem] = useState<string | null>(null);
  const interState = useInterState(value);
  const runs = firstRuns(startDate, frequency);
  const today = todayIso();

  const save = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Give it a profile name, like "Accounting software".');
      if (!runs) throw new Error('Enter the start date.');
      const end = neverExpires ? null : endDate || null;
      if (!neverExpires && !end) throw new Error('Enter the end date, or tick Never expires.');
      if (end && end < startDate) throw new Error('The end date is before the start date.');
      if (end && runs.first > end) throw new Error(`The first one would fall on ${shortDate(runs.first)}, after the end date.`);
      const { vendorId, ...expense } = expenseBody(value, interState);
      return api.post('/recurring/expenses', {
        name: name.trim(),
        ...(vendorId ? { partyId: vendorId } : {}),
        frequency,
        dayOfMonth: runs.day,
        startDate,
        endDate: end,
        ...expense,
        notes: value.notes.trim() || null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring'] });
      notify(`Recurring expense saved: ${name.trim()}`);
      router.push('/purchases/recurring-expenses');
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the recurring expense.")),
  });

  const weekly = frequency === 'weekly' || frequency === 'fortnightly';
  return (
    <div>
      <PageHeader
        guide="recurringExpenses"
        title="New recurring expense"
        subtitle="Drafted on each date, for you to check and post. Nothing posts on its own."
        back={{ href: '/purchases/recurring-expenses', label: 'Recurring expenses' }}
      />
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Profile name" required>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Accounting software" maxLength={120} />
            </Field>
            <Field label="Repeat every" required>
              <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {(Object.keys(REPEAT_EVERY) as Frequency[]).map((f) => <option key={f} value={f}>{REPEAT_EVERY[f]}</option>)}
              </select>
            </Field>
            <Field
              label="Start date"
              required
              hint={
                runs ? (
                  <>
                    The recurring expense will be created on <span className="font-medium text-ink-900">{shortDate(runs.first)}</span>, then {shortDate(runs.second)}
                    {weekly ? `, every ${frequency === 'weekly' ? '' : 'other '}${weekday(runs.first)}` : runs.day >= 29 ? ` (the month's last day when shorter)` : ''}.
                    {runs.first < today && ' That is before today: dates already passed are drafted at the next morning run.'}
                  </>
                ) : undefined
              }
            >
              <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Ends on">
              <div className="space-y-1.5">
                <input type="date" className={inputClass} value={neverExpires ? '' : endDate} min={startDate} disabled={neverExpires} onChange={(e) => setEndDate(e.target.value)} aria-label="Ends on" />
                <label className="flex items-center gap-2 text-caption text-ink-700">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={neverExpires} onChange={(e) => setNeverExpires(e.target.checked)} />
                  Never expires
                </label>
              </div>
            </Field>
          </div>
        </Section>
        <ExpenseFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} withDate={false} title="Each expense" />
      </FormPage>
    </div>
  );
}
