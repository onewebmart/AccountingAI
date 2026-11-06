'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { Field, FormPage, PageHeader, Section, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ExpenseAccountPicker } from '@/components/purchases/expense-pickers';
import { useCanManageSettings } from '@/components/purchases/expense-tabs';
import { rateOn, unitWord, useMileageSettings, type MileageSettings, type MileageUnit } from '@/components/purchases/mileage';
import { errorText, rupeesText, shortDate, todayIso, useExpenseAccounts } from '@/components/purchases/purchase-data';

interface RateRow { key: number; startDate: string; rate: string }
let seq = 0;
const rateRow = (startDate = todayIso(), rate = ''): RateRow => ({ key: ++seq, startDate, rate });

const BACK = '/purchases/expenses/new?tab=mileage';

/**
 * The org's mileage preferences: the account mileage is booked to, km or
 * miles, and the rates by start date. An expense takes the rate in force on
 * its date, so a new rate from 1 April leaves the old trips as they were.
 */
export default function MileageSettingsPage({ searchParams }: { searchParams: { first?: string } }) {
  const settings = useMileageSettings();
  const canManage = useCanManageSettings();
  const first = searchParams.first === '1';
  return (
    <div>
      <PageHeader
        title={first ? 'Set your mileage preferences' : 'Mileage preferences'}
        subtitle={first ? 'Before your first mileage expense: the account it goes to, the unit, and the rate per unit.' : 'The account mileage is booked to, the unit, and the rates by start date.'}
        back={{ href: BACK, label: 'Record Mileage' }}
      />
      {settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : !settings.data ? (
        <p className="text-caption text-ink-400">Loading…</p>
      ) : canManage ? (
        <PreferencesForm settings={settings.data} first={first} />
      ) : (
        <ReadOnly settings={settings.data} />
      )}
    </div>
  );
}

function PreferencesForm({ settings, first }: { settings: MileageSettings; first: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const accounts = useExpenseAccounts();
  const [accountId, setAccountId] = useState(settings.defaultAccountId ?? '');
  const [unit, setUnit] = useState<MileageUnit>(settings.unit);
  const [rates, setRates] = useState<RateRow[]>(() => (settings.rates.length ? settings.rates.map((r) => rateRow(r.startDate, rupeesText(r.ratePaise))) : [rateRow(`${todayIso().slice(0, 4)}-04-01`)]));
  const [problem, setProblem] = useState<string | null>(null);

  // Nothing chosen yet: Travelling & Conveyance, where a trip usually goes.
  useEffect(() => {
    if (accountId || !accounts.data.length) return;
    const travel = accounts.data.find((a) => /travel|conveyance|fuel|mileage/i.test(a.name));
    if (travel) setAccountId(travel._id);
  }, [accounts.data, accountId]);

  const save = useMutation({
    mutationFn: () => {
      const filled = rates.filter((r) => r.rate.trim() || r.startDate);
      const body = filled.map((r, i) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate)) throw new Error(`Rate ${i + 1}: enter the date it starts.`);
        const ratePaise = parseRupees(r.rate);
        if (ratePaise === null || ratePaise <= 0) throw new Error(`Rate ${i + 1}: enter the rate per ${unit}, in rupees.`);
        return { startDate: r.startDate, ratePaise };
      });
      if (new Set(body.map((r) => r.startDate)).size !== body.length) throw new Error('Two rates start on the same date: keep one.');
      return api.put<MileageSettings>('/direct-expenses/mileage-settings', { defaultAccountId: accountId || null, unit, rates: body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['direct-expenses', 'mileage-settings'] });
      notify('Mileage preferences saved');
      router.push(BACK);
    },
    onError: (e) => setProblem(errorText(e, "Couldn't save the preferences.")),
  });

  const today = todayIso();
  const parsed = rates.map((r) => ({ startDate: r.startDate, ratePaise: parseRupees(r.rate) ?? 0 })).filter((r) => r.ratePaise > 0 && r.startDate);
  const inForce = rateOn(parsed, today);

  return (
    <FormPage
      onSubmit={() => {
        setProblem(null);
        save.mutate();
      }}
      error={problem}
      actions={
        <>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save preferences'}</Button>
          <Button type="button" variant="ghost" asChild>
            {/* The first time, skipping lands on the form with the rate to type. */}
            <Link href={first ? `${BACK}&prefs=skip` : BACK}>{first ? 'Skip for now' : 'Cancel'}</Link>
          </Button>
        </>
      }
    >
      <Section title="Defaults">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Default mileage account" hint="Where a trip is booked unless you pick another on the expense.">
            <ExpenseAccountPicker value={accountId} onChange={setAccountId} />
          </Field>
          <Field label="Default unit">
            <div className="inline-flex overflow-hidden rounded-md border border-line-200 bg-surface-card" role="radiogroup" aria-label="Default unit">
              {(['km', 'mile'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={unit === u}
                  onClick={() => setUnit(u)}
                  className={cn('min-h-[40px] px-5 text-body font-medium', unit === u ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-surface-sink')}
                >
                  {u === 'km' ? 'Km' : 'Mile'}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Mileage rates" description={`A rate per ${unit} from its start date. An expense takes the rate in force on its date.`}>
        <div className="overflow-hidden rounded-md border border-line-200">
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className="px-3 py-2 text-left text-caption font-medium text-ink-500">Start date</th>
                <th className="px-3 py-2 text-right text-caption font-medium text-ink-500">Rate per {unit} (₹)</th>
                <th className="w-12 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={r.key} className="border-b border-line-100 last:border-0">
                  <td className="px-3 py-2">
                    <input type="date" className={inputClass} value={r.startDate} onChange={(e) => setRates(rates.map((x) => (x.key === r.key ? { ...x, startDate: e.target.value } : x)))} aria-label={`Rate ${i + 1} start date`} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={`${inputClass} text-right font-mono`} inputMode="decimal" value={r.rate} onChange={(e) => setRates(rates.map((x) => (x.key === r.key ? { ...x, rate: e.target.value } : x)))} placeholder="0.00" aria-label={`Rate ${i + 1} per ${unit}`} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setRates(rates.filter((x) => x.key !== r.key))} className="rounded p-2 text-ink-400 hover:bg-surface-sink hover:text-error-fg" aria-label={`Remove rate ${i + 1}`} title="Remove rate">
                      <X size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-4 text-center text-caption text-ink-500">No rates: each mileage expense will need its rate typed.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="inline-flex items-center gap-1 text-body font-medium text-saffron-700 hover:underline" onClick={() => setRates([...rates, rateRow()])}>
            <Plus size={15} /> Add a rate
          </button>
          <p className="text-caption text-ink-500">
            {inForce ? <>In force today: <span className="font-mono text-ink-900">{formatPaise(inForce.ratePaise)}/{unit}</span>, from {shortDate(inForce.startDate)}.</> : 'No rate is in force today.'}
          </p>
        </div>
      </Section>
    </FormPage>
  );
}

/** For those who record expenses but do not manage settings. */
function ReadOnly({ settings }: { settings: MileageSettings }) {
  const accounts = useExpenseAccounts();
  const account = accounts.data.find((a) => a._id === settings.defaultAccountId);
  return (
    <div className="space-y-5">
      <p className="rounded-md border border-line-200 bg-surface-card px-4 py-3 text-body text-ink-700">
        Only an admin who manages the organisation can change these. You can still type a rate on a mileage expense.
      </p>
      <Section title="Mileage preferences">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-caption text-ink-500">Default mileage account</dt><dd className="text-body text-ink-900">{account?.name ?? '—'}</dd></div>
          <div><dt className="text-caption text-ink-500">Default unit</dt><dd className="text-body text-ink-900">{unitWord(settings.unit)}</dd></div>
        </dl>
        <ul className="mt-4 space-y-1">
          {settings.rates.length === 0 && <li className="text-caption text-ink-500">No rates set.</li>}
          {settings.rates.map((r) => (
            <li key={r.startDate} className="flex justify-between border-b border-line-100 py-1.5 text-body last:border-0">
              <span>From {shortDate(r.startDate)}</span>
              <span className="font-mono">{formatPaise(r.ratePaise)}/{settings.unit}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
