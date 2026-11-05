'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Field, PageHeader, Section, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { Notice, errorText, shortDate, todayIso } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Currency { code: string; name: string; digits: number }
interface Rate { id: string; currency: string; date: string; rate: number; source: string | null }
interface Revaluation {
  period: string; date: string; missingRates: string[]; receivablesPaise: number; payablesPaise: number; inReview: boolean; approved: number;
  rows: Array<{ kind: 'invoice' | 'bill'; id: string; number: string | null; currency: string; digits: number; openMinor: number; bookedRate: number; rate: number | null; bookedPaise: number; revaluedPaise: number | null; differencePaise: number | null }>;
}

const lastMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7);
};
const fmtMinor = (minor: number, code: string, digits: number) =>
  `${code} ${(minor / 10 ** digits).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function Rates() {
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ['currency', 'list'], queryFn: () => api.get<Currency[]>('/currency/currencies') }).data ?? [];
  const rates = useQuery({ queryKey: ['currency', 'rates'], queryFn: () => api.get<Rate[]>('/currency/rates') });
  const [f, setF] = useState({ currency: 'USD', date: todayIso(), rate: '', source: 'RBI reference rate' });
  const save = useMutation({
    mutationFn: () => api.post('/currency/rates', { currency: f.currency, date: f.date, rate: Number(f.rate), source: f.source.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['currency'] });
      setF({ ...f, rate: '' });
      notify('Rate saved');
    },
    onError: (err) => notify(errorText(err, "Couldn't save the rate."), 'error'),
  });

  return (
    <Section
      title="Exchange rates"
      description="Rates are entered, never guessed: the RBI/FBIL reference rate or your bank's. A document takes the latest rate on or before its date unless you give it one."
    >
      <form
        className="mb-4 grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_2fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Currency">
          <select className={inputClass} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="₹ for one unit">
          <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="84.1025" />
        </Field>
        <Field label="Source">
          <input className={inputClass} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
        </Field>
        <Button type="submit" disabled={!(Number(f.rate) > 0) || save.isPending}>{save.isPending ? 'Saving…' : 'Save rate'}</Button>
      </form>
      {rates.isError && <Notice tone="error">{errorText(rates.error)}</Notice>}
      {rates.data?.length === 0 ? (
        <EmptyState title="No rates yet" body="Save the rate for each currency you invoice or are billed in." />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Date</th>
                <th className={th}>Currency</th>
                <th className={`${th} text-right`}>₹ for one unit</th>
                <th className={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {(rates.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-line-100 last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{shortDate(r.date)}</td>
                  <td className={`${td} font-mono`}>{r.currency}</td>
                  <td className={tdMoney}>{r.rate}</td>
                  <td className={`${td} text-caption text-ink-500`}>{r.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </Section>
  );
}

function RevaluationSection() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(lastMonth());
  const q = useQuery({ queryKey: ['currency', 'revaluation', period], queryFn: () => api.get<Revaluation>(`/currency/revaluation?period=${period}`) });
  const propose = useMutation({
    mutationFn: () => api.post('/currency/revaluation/propose', { period }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['currency'] });
      void qc.invalidateQueries({ queryKey: ['workspace'] });
      notify('Sent to the review queue');
    },
    onError: (err) => notify(errorText(err, "Couldn't propose the revaluation."), 'error'),
  });
  const r = q.data;
  const canPropose = !!r && !r.missingRates.length && !r.inReview && !r.approved && (r.receivablesPaise !== 0 || r.payablesPaise !== 0);

  return (
    <Section
      title="Month-end revaluation"
      description="Open foreign-currency invoices and bills at the month-end rate. Unrealised: the entry reverses on the 1st of the next month, and the gain or loss is realised when each is paid."
      actions={
        <>
          <label className="flex items-center gap-2 text-caption text-ink-500">
            Month
            <input type="month" className="h-10 rounded-md border border-line-200 bg-white px-2 text-body" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          </label>
          {canPropose && <Button disabled={propose.isPending} onClick={() => propose.mutate()}>{propose.isPending ? 'Proposing…' : 'Propose revaluation'}</Button>}
        </>
      }
    >
      {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading open documents…</p>}
      {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}
      {r && (
        <div className="space-y-3">
          {r.missingRates.length > 0 && <Notice tone="pending">Enter the {r.missingRates.join(', ')} rate for {shortDate(r.date)} under Exchange rates first.</Notice>}
          {r.inReview && <Notice tone="pending">A revaluation for {period} is in the <Link className="underline" href="/review">review queue</Link>.</Notice>}
          {!!r.approved && <Notice tone="success">{period} is revalued; it reverses on the 1st.</Notice>}
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  {['Document', 'Open', 'Booked at', 'Month-end rate', 'Booked ₹', 'Revalued ₹', 'Difference'].map((h, i) => (
                    <th key={h} className={`${th} ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.id} className="border-b border-line-100 last:border-0">
                    <td className={td}>{x.kind === 'invoice' ? 'Invoice' : 'Bill'} <span className="font-mono">{x.number ?? '(draft)'}</span></td>
                    <td className={tdMoney}>{fmtMinor(x.openMinor, x.currency, x.digits)}</td>
                    <td className={tdMoney}>{x.bookedRate}</td>
                    <td className={tdMoney}>{x.rate ?? '—'}</td>
                    <td className={tdMoney}>{formatPaise(x.bookedPaise)}</td>
                    <td className={tdMoney}>{x.revaluedPaise == null ? '—' : formatPaise(x.revaluedPaise)}</td>
                    <td className={tdMoney}>{x.differencePaise == null ? '—' : formatPaise(x.differencePaise)}</td>
                  </tr>
                ))}
                {r.rows.length === 0 && (
                  <tr><td className={`${td} text-ink-500`} colSpan={7}>Nothing open in foreign currencies at {shortDate(r.date)}.</td></tr>
                )}
              </tbody>
            </table>
          </TableCard>
          <p className="text-body text-ink-700">
            On revaluing: receivables <span className="font-mono">{formatPaise(r.receivablesPaise)}</span>, payables <span className="font-mono">{formatPaise(r.payablesPaise)}</span>.
          </p>
        </div>
      )}
    </Section>
  );
}

/** Exchange rates and the month-end revaluation. Foreign invoices and bills stay under Foreign Currency. */
export default function CurrencyAdjustmentsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Currency adjustments"
        subtitle={<>Exchange rates, and revaluing open foreign-currency balances at month-end. Foreign invoices, bills and their payments are under <Link href="/currency" className="underline">Foreign currency</Link>.</>}
      />
      <Rates />
      <RevaluationSection />
    </div>
  );
}
