'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Field, ListToolbar, PageHeader, Section, StatusChip, TableCard, inputClass, td, tdMoney, th } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { Notice, errorText, shortDate, todayIso } from '@/components/accountant/common';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Currency { code: string; name: string; digits: number }
interface Rate { id: string; currency: string; date: string; rate: number; source: string | null }
interface Adjustment {
  proposalId: string; kind: 'currency' | 'month_end'; date: string; period: string | null; currency: string | null; rate: number | null; notes: string | null;
  documents: number | null; gainPaise: number; status: 'in_review' | 'posted' | 'reversed'; journalId: string | null; reversalJournalId: string | null; reverseOn: string | null; narration: string | null;
}
interface Revaluation {
  period: string; date: string; missingRates: string[]; receivablesPaise: number; payablesPaise: number; inReview: boolean; approved: number; adjustedCurrencies: string[];
  rows: Array<{ kind: 'invoice' | 'bill'; id: string; number: string | null; currency: string; digits: number; openMinor: number; bookedRate: number; rate: number | null; bookedPaise: number; revaluedPaise: number | null; differencePaise: number | null }>;
}

const lastMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7);
};
const fmtMinor = (minor: number, code: string, digits: number) =>
  `${code} ${(minor / 10 ** digits).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const fyOf = (d: string) => {
  const y = Number(d.slice(0, 4));
  const start = Number(d.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
};

/** The periods the list can be filtered by, worked out from today. */
function periods(): Array<[string, string, { from?: string; to?: string }]> {
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const prev = lastMonth();
  const fy = fyOf(today);
  const lastFy = fyOf(`${Number(fy.from.slice(0, 4)) - 1}-04-01`);
  return [
    ['all', 'All', {}],
    ['this_month', 'This month', { from: `${thisMonth}-01`, to: monthEnd(thisMonth) }],
    ['last_month', 'Last month', { from: `${prev}-01`, to: monthEnd(prev) }],
    ['this_fy', 'This financial year', fy],
    ['last_fy', 'Last financial year', lastFy],
  ];
}

const STATUS: Record<Adjustment['status'], { tone: 'pending' | 'success' | 'neutral'; label: string }> = {
  in_review: { tone: 'pending', label: 'In review' },
  posted: { tone: 'success', label: 'Posted' },
  reversed: { tone: 'neutral', label: 'Reversed' },
};

function GainOrLoss({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-ink-500">Nil</span>;
  return <span className={paise > 0 ? 'text-success-fg' : 'text-error-fg'}>{paise > 0 ? 'Gain' : 'Loss'} {formatPaise(Math.abs(paise))}</span>;
}

function AdjustmentsList() {
  const currencies = useQuery({ queryKey: ['currency', 'list'], queryFn: () => api.get<Currency[]>('/currency/currencies') }).data ?? [];
  const [currency, setCurrency] = useState('');
  const [period, setPeriod] = useState('all');
  const range = periods().find(([v]) => v === period)?.[2] ?? {};
  const params = new URLSearchParams();
  if (currency) params.set('currency', currency);
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const list = useQuery({ queryKey: ['currency', 'adjustments', currency, period], queryFn: () => api.get<Adjustment[]>(`/currency/adjustments?${params.toString()}`) });
  const rows = list.data ?? [];

  return (
    <Section title="Base currency adjustments" description="Open foreign-currency invoices and bills revalued at a new rate. Each is unrealised: it reverses itself on the 1st of the next month, and the real gain or loss posts when each is paid.">
      <ListToolbar filters={{ value: period, onChange: setPeriod, options: periods().map(([v, l]) => [v, l]) }}>
        <select className="h-10 rounded-md border border-line-200 bg-white px-2 text-body" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
          <option value="">Every currency</option>
          {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
        </select>
      </ListToolbar>
      {list.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading adjustments…</p>}
      {list.isError && <Notice tone="error">{errorText(list.error)}</Notice>}
      {list.data && rows.length === 0 && (
        <EmptyState
          guide={currency || period !== 'all' ? undefined : 'currencyAdjustments'}
          title={currency || period !== 'all' ? 'No adjustments match' : 'No currency adjustments yet'}
          body="Revalue what is open in a currency at a new rate: New adjustment, then Continue to see each invoice and bill."
          action={<Link href="/accountant/currency-adjustments/new"><Button><Plus size={14} /> New adjustment</Button></Link>}
        />
      )}
      {rows.length > 0 && (
        <TableCard>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                <th className={th}>Date</th>
                <th className={th}>Currency</th>
                <th className={`${th} text-right`}>Exchange rate</th>
                <th className={`${th} text-right`}>Gain or loss</th>
                <th className={th}>Status</th>
                <th className={th}>Notes</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.proposalId} className="border-b border-line-100 last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{shortDate(r.date)}</td>
                  <td className={`${td} font-mono`}>{r.currency ?? <span className="font-body text-ink-600">Every open currency</span>}</td>
                  <td className={tdMoney}>{r.rate != null && r.currency ? `1 ${r.currency} = ₹${r.rate}` : <span className="text-ink-500">Month-end rates</span>}</td>
                  <td className={tdMoney}><GainOrLoss paise={r.gainPaise} /></td>
                  <td className={td}><StatusChip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusChip></td>
                  <td className={`${td} max-w-[280px]`}>
                    <p className="truncate text-ink-700">{r.notes ?? (r.kind === 'month_end' ? 'Month-end revaluation' : '—')}</p>
                    {r.documents != null && <p className="text-caption text-ink-500">{r.documents} open document{r.documents === 1 ? '' : 's'}</p>}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right text-caption`}>
                    {r.status === 'in_review' && <Link href="/review" className="text-ink-600 hover:underline">Open in Review</Link>}
                    {r.journalId && <Link href={`/accountant/manual-journals/${r.journalId}`} className="text-ink-600 hover:underline">Entry</Link>}
                    {r.reversalJournalId && <> · <Link href={`/accountant/manual-journals/${r.reversalJournalId}`} className="text-ink-600 hover:underline">Reversal</Link></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </Section>
  );
}

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
      description="Rates are entered, never guessed: the RBI/FBIL reference rate or your bank's. A document takes the latest rate on or before its date unless you give it one. A currency adjustment saves its rate here too."
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
        <Button type="submit" variant="secondary" disabled={!(Number(f.rate) > 0) || save.isPending}>{save.isPending ? 'Saving…' : 'Save rate'}</Button>
      </form>
      {rates.isError && <Notice tone="error">{errorText(rates.error)}</Notice>}
      {rates.data?.length === 0 ? (
        <p className="text-body text-ink-500">No rates yet. Save the rate for each currency you invoice or are billed in.</p>
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
              {(rates.data ?? []).slice(0, 30).map((r) => (
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
      description="Every open foreign-currency invoice and bill at the month-end rate, in one entry. A currency already given its own adjustment that month is left out. Unrealised: it reverses on the 1st of the next month."
      actions={
        <>
          <label className="flex items-center gap-2 text-caption text-ink-500">
            Month
            <input type="month" className="h-10 rounded-md border border-line-200 bg-white px-2 text-body" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          </label>
          {canPropose && <Button variant="secondary" disabled={propose.isPending} onClick={() => propose.mutate()}>{propose.isPending ? 'Proposing…' : 'Propose revaluation'}</Button>}
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
          {(r.adjustedCurrencies ?? []).length > 0 && <p className="text-caption text-ink-500">Left out: {r.adjustedCurrencies.join(', ')}, adjusted on its own this month.</p>}
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

/** Base currency adjustments first; the month-end revaluation of every currency and the rates below. */
export default function CurrencyAdjustmentsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        guide="currencyAdjustments"
        title="Currency adjustments"
        subtitle={<>Revalue open foreign-currency balances at a new rate. Foreign invoices, bills and their payments are under <Link href="/currency" className="underline">Foreign currency</Link>.</>}
        actions={<Link href="/accountant/currency-adjustments/new"><Button><Plus size={14} /> New adjustment</Button></Link>}
      />
      <AdjustmentsList />
      <RevaluationSection />
      <Rates />
    </div>
  );
}
