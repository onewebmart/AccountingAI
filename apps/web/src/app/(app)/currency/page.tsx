'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

type Tab = 'documents' | 'invoice' | 'bill' | 'rates' | 'revaluation';
interface Currency { code: string; name: string; digits: number }
interface Rate { id: string; currency: string; date: string; rate: number; source: string | null }
interface Doc { kind: 'invoice' | 'bill'; id: string; number: string | null; date: string; status: string; party: string; currency: string; rate: number; totalMinor: number; openMinor: number; digits: number; totalPaise: number }
interface Party { _id: string; name: string; currency?: string }
interface Revaluation {
  period: string; date: string; missingRates: string[]; receivablesPaise: number; payablesPaise: number; inReview: boolean; approved: number;
  rows: Array<{ kind: 'invoice' | 'bill'; id: string; number: string | null; currency: string; digits: number; openMinor: number; bookedRate: number; rate: number | null; bookedPaise: number; revaluedPaise: number | null; differencePaise: number | null }>;
}
interface Line { description: string; qty: string; price: string }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const label = 'mb-1 block text-caption font-medium text-ink-700';
const card = 'rounded-xl border border-line-200 bg-surface-card p-4';
const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7); };
const fmt = (minor: number, code: string, digits: number) => `${code} ${(minor / 10 ** digits).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** "1,234.50" in a currency with 2 digits → 123450; null when it is not a number. */
const toMinor = (v: string, digits: number) => {
  const n = Number(v.replace(/,/g, '').trim());
  return v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** digits) : null;
};

function useCurrencies() {
  return useQuery({ queryKey: ['currency', 'list'], queryFn: () => api.get<Currency[]>('/currency/currencies') });
}

/** The day's rate for a currency, filled from the stored rates and editable. */
function useRateOn(currency: string, date: string, setRate: (r: string) => void) {
  const q = useQuery({ queryKey: ['currency', 'on', currency, date], queryFn: () => api.get<{ rate: number; date: string } | null>(`/currency/rates/on?currency=${currency}&date=${date}`), enabled: !!currency && !!date });
  useEffect(() => {
    if (q.data) setRate(String(q.data.rate));
  }, [q.data, setRate]);
  return q.data;
}

function DocumentForm({ kind, onDone }: { kind: 'invoice' | 'bill'; onDone: (m: string) => void }) {
  const currencies = useCurrencies().data ?? [];
  const parties = useQuery({ queryKey: [kind === 'invoice' ? 'customers' : 'vendors'], queryFn: () => api.get<Party[]>(kind === 'invoice' ? '/sales/customers' : '/purchase/vendors') });
  const [f, setF] = useState({ partyId: '', currency: 'USD', number: '', date: today(), rate: '', rcm: '0', sbNumber: '', sbDate: '', sbPort: '' });
  const [lines, setLines] = useState<Line[]>([{ description: '', qty: '1', price: '' }]);
  const setRate = useCallback((rate: string) => setF((x) => ({ ...x, rate })), []);
  const found = useRateOn(f.currency, f.date, setRate);
  const digits = currencies.find((c) => c.code === f.currency)?.digits ?? 2;
  const minors = lines.map((l) => {
    const unit = toMinor(l.price, digits);
    return unit === null || !(Number(l.qty) > 0) ? null : Math.round(Number(l.qty) * unit);
  });
  const totalMinor = minors.reduce<number>((s, m) => s + (m ?? 0), 0);
  const rate = Number(f.rate);
  const save = useMutation({
    mutationFn: () => {
      const body = lines.filter((l) => l.description.trim()).map((l) => {
        const unit = toMinor(l.price, digits);
        if (unit === null || !(Number(l.qty) > 0)) throw new Error('Each line needs a quantity and a price.');
        return { description: l.description.trim(), qty: Number(l.qty), rateMinor: unit };
      });
      const common = { currency: f.currency, rate, lines: body };
      return kind === 'invoice'
        ? api.post('/currency/invoices', { ...common, customerId: f.partyId, invoiceNumber: f.number.trim() || undefined, invoiceDate: f.date, shippingBill: f.sbNumber.trim() ? { number: f.sbNumber.trim(), date: f.sbDate, portCode: f.sbPort.trim().toUpperCase() } : null })
        : api.post('/currency/bills', { ...common, vendorId: f.partyId, billNumber: f.number.trim() || undefined, billDate: f.date, reverseChargeIgstPct: Number(f.rcm) });
    },
    onSuccess: () => { setLines([{ description: '', qty: '1', price: '' }]); onDone(kind === 'invoice' ? 'Export invoice saved as a draft' : 'Bill saved as a draft'); },
  });
  return (
    <section className={`${card} space-y-3`}>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className={label}>{kind === 'invoice' ? 'Customer' : 'Vendor'}</label>
          <select className={field} value={f.partyId} onChange={(e) => { const p = (parties.data ?? []).find((x) => x._id === e.target.value); setF({ ...f, partyId: e.target.value, currency: p?.currency && p.currency !== 'INR' ? p.currency : f.currency }); }}>
            <option value="">Choose…</option>
            {(parties.data ?? []).map((p) => <option key={p._id} value={p._id}>{p.name}{p.currency && p.currency !== 'INR' ? ` · ${p.currency}` : ''}</option>)}
          </select>
        </div>
        <div><label className={label}>Currency</label><select className={field} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value, rate: '' })}>{currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></div>
        <div><label className={label}>{kind === 'invoice' ? 'Invoice number' : 'Bill number'}</label><input className={`${field} font-mono`} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
        <div><label className={label}>Date</label><input type="date" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div>
          <label className={label}>Rate (₹ for 1 {f.currency})</label>
          <input className={`${field} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          <p className="mt-0.5 text-caption text-ink-500">{found ? `From the rate of ${found.date}` : 'No stored rate on or before this date: enter it.'}</p>
        </div>
        {kind === 'bill' && (
          <div>
            <label className={label}>IGST under reverse charge</label>
            <select className={field} value={f.rcm} onChange={(e) => setF({ ...f, rcm: e.target.value })}>{['0', '5', '12', '18', '28'].map((r) => <option key={r} value={r}>{r === '0' ? 'None' : `${r}% (import of services)`}</option>)}</select>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <input className={`${field} col-span-6`} placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, description: e.target.value } : x)))} />
            <input className={`${field} col-span-2 font-mono`} inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, qty: e.target.value } : x)))} />
            <input className={`${field} col-span-3 font-mono`} inputMode="decimal" placeholder={`Price (${f.currency})`} value={l.price} onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, price: e.target.value } : x)))} />
            <button className="col-span-1 text-ink-500 hover:text-ink-900" aria-label="Remove line" onClick={() => setLines(lines.filter((_, n) => n !== i))} disabled={lines.length === 1}><X size={14} /></button>
          </div>
        ))}
        <button className="flex items-center gap-1 text-caption text-ink-600 hover:underline" onClick={() => setLines([...lines, { description: '', qty: '1', price: '' }])}><Plus size={12} /> Add line</button>
      </div>
      {kind === 'invoice' && (
        <div className="grid gap-3 md:grid-cols-3">
          <div><label className={label}>Shipping bill number (goods)</label><input className={`${field} font-mono`} value={f.sbNumber} onChange={(e) => setF({ ...f, sbNumber: e.target.value })} /></div>
          <div><label className={label}>Shipping bill date</label><input type="date" className={field} value={f.sbDate} onChange={(e) => setF({ ...f, sbDate: e.target.value })} /></div>
          <div><label className={label}>Port code</label><input className={`${field} font-mono`} maxLength={6} placeholder="INNSA1" value={f.sbPort} onChange={(e) => setF({ ...f, sbPort: e.target.value })} /></div>
        </div>
      )}
      <p className="font-mono text-body text-ink-900">{fmt(totalMinor, f.currency, digits)}{rate > 0 ? ` ≈ ${formatPaise(Math.round((totalMinor / 10 ** digits) * rate * 100))}` : ''}</p>
      {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
      <Button disabled={!f.partyId || !(rate > 0) || !totalMinor || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : kind === 'invoice' ? 'Save export invoice' : 'Save bill'}</Button>
      <p className="text-caption text-ink-500">
        {kind === 'invoice'
          ? 'Zero-rated under your letter of undertaking (LUT): no GST, reported in GSTR-1 table 6A. '
          : 'The vendor is owed the foreign amount; reverse-charge IGST is yours to pay on the rupee value. '}
        Saved as a draft in rupees at this rate: post it from <Link className="underline" href={kind === 'invoice' ? '/sales' : '/purchase'}>{kind === 'invoice' ? 'Sales' : 'Purchase'}</Link>.
      </p>
    </section>
  );
}

function PaymentRow({ d, onDone }: { d: Doc; onDone: (m: string) => void }) {
  const [f, setF] = useState({ date: today(), amount: (d.openMinor / 10 ** d.digits).toFixed(d.digits), rate: '' });
  const setRate = useCallback((rate: string) => setF((x) => ({ ...x, rate })), []);
  useRateOn(d.currency, f.date, setRate);
  const pay = useMutation({
    mutationFn: () => {
      const minor = toMinor(f.amount, d.digits);
      if (!minor) throw new Error(`Enter the ${d.currency} amount.`);
      return api.post<{ exchangePaise: number; paidInFull: boolean }>(`/currency/${d.kind === 'invoice' ? 'invoices' : 'bills'}/${d.id}/${d.kind === 'invoice' ? 'receive' : 'pay'}`, { paidOn: f.date, amountMinor: minor, rate: Number(f.rate) });
    },
    onSuccess: (r) => onDone(`Payment recorded${r.exchangePaise ? `: exchange ${r.exchangePaise > 0 ? 'gain' : 'loss'} ${formatPaise(Math.abs(r.exchangePaise))}` : ''}`),
  });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-surface-sink p-2">
      <div><label className={label}>On</label><input type="date" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
      <div><label className={label}>{d.currency}</label><input className={`${field} w-32 font-mono`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
      <div><label className={label}>Rate that day</label><input className={`${field} w-28 font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
      <Button size="sm" disabled={!(Number(f.rate) > 0) || pay.isPending} onClick={() => pay.mutate()}>{d.kind === 'invoice' ? 'Record receipt' : 'Record payment'}</Button>
      {pay.isError && <p className="w-full text-caption text-error-fg">{message(pay.error)}</p>}
    </div>
  );
}

function DocumentsTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const docs = useQuery({ queryKey: ['currency', 'documents'], queryFn: () => api.get<Doc[]>('/currency/documents') });
  return (
    <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
      <table className="w-full">
        <thead><tr className="border-b border-line-200 bg-surface-sink">{['Date', 'Document', 'Party', 'Amount', 'Open', 'Booked in ₹', ''].map((h) => <th key={h} className="px-3 py-2 text-left text-caption font-medium text-ink-500">{h}</th>)}</tr></thead>
        <tbody>
          {(docs.data ?? []).map((d) => (
            <tr key={d.id} className="border-b border-line-100 align-top last:border-0">
              <td className="px-3 py-2 font-mono text-caption">{d.date}</td>
              <td className="px-3 py-2 text-body">{d.kind === 'invoice' ? 'Invoice' : 'Bill'} {d.number ?? '(draft)'}<p className="text-caption text-ink-500">{d.status} · at {d.rate}</p></td>
              <td className="px-3 py-2 text-body">{d.party}</td>
              <td className="px-3 py-2 font-mono text-body">{fmt(d.totalMinor, d.currency, d.digits)}</td>
              <td className="px-3 py-2 font-mono text-body">{d.openMinor ? fmt(d.openMinor, d.currency, d.digits) : '—'}</td>
              <td className="px-3 py-2 font-mono text-body">{formatPaise(d.totalPaise)}</td>
              <td className="px-3 py-2 text-right">
                {d.status === 'posted' && d.openMinor > 0 && <button className="text-caption text-ink-600 hover:underline" onClick={() => setPaying(paying === d.id ? null : d.id)}>{paying === d.id ? 'Cancel' : d.kind === 'invoice' ? 'Record receipt' : 'Record payment'}</button>}
                {paying === d.id && <PaymentRow d={d} onDone={(m) => { setPaying(null); void qc.invalidateQueries({ queryKey: ['currency'] }); onToast(m); }} />}
              </td>
            </tr>
          ))}
          {docs.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500" colSpan={7}>No foreign-currency invoices or bills yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RatesTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const currencies = useCurrencies().data ?? [];
  const rates = useQuery({ queryKey: ['currency', 'rates'], queryFn: () => api.get<Rate[]>('/currency/rates') });
  const [f, setF] = useState({ currency: 'USD', date: today(), rate: '', source: 'RBI reference rate' });
  const save = useMutation({ mutationFn: () => api.post('/currency/rates', { currency: f.currency, date: f.date, rate: Number(f.rate), source: f.source.trim() || null }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['currency'] }); setF({ ...f, rate: '' }); onToast('Rate saved'); } });
  return (
    <div className="space-y-4">
      <section className={`${card} flex flex-wrap items-end gap-3`}>
        <div><label className={label}>Currency</label><select className={field} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
        <div><label className={label}>Date</label><input type="date" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label className={label}>₹ for one unit</label><input className={`${field} w-32 font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="84.1025" /></div>
        <div><label className={label}>Source</label><input className={field} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
        <Button disabled={!(Number(f.rate) > 0) || save.isPending} onClick={() => save.mutate()}>Save rate</Button>
        {save.isError && <p className="w-full text-caption text-error-fg">{message(save.error)}</p>}
      </section>
      <p className="text-caption text-ink-500">Rates are entered, never guessed: the RBI/FBIL reference rate or your bank&apos;s. A document takes the latest rate on or before its date unless you give it one.</p>
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full"><tbody>
          {(rates.data ?? []).map((r) => (
            <tr key={r.id} className="border-b border-line-100 last:border-0"><td className="px-3 py-2 font-mono text-caption">{r.date}</td><td className="px-3 py-2 text-body">{r.currency}</td><td className="px-3 py-2 font-mono text-body">{r.rate}</td><td className="px-3 py-2 text-caption text-ink-500">{r.source}</td></tr>
          ))}
          {rates.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">No rates yet.</td></tr>}
        </tbody></table>
      </div>
    </div>
  );
}

function RevaluationTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(lastMonth());
  const q = useQuery({ queryKey: ['currency', 'revaluation', period], queryFn: () => api.get<Revaluation>(`/currency/revaluation?period=${period}`) });
  const propose = useMutation({ mutationFn: () => api.post('/currency/revaluation/propose', { period }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['currency'] }); onToast('Sent to the review queue'); } });
  const r = q.data;
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-caption text-ink-500">Month <input type="month" className="ml-1 rounded-md border border-line-200 px-2 py-1 text-body" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></label>
        {r && !r.missingRates.length && !r.inReview && !r.approved && (r.receivablesPaise || r.payablesPaise) ? <Button disabled={propose.isPending} onClick={() => propose.mutate()}>Propose revaluation</Button> : null}
      </div>
      {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading open documents…</p>}
      {q.isError && <p className="text-caption text-error-fg">{message(q.error)}</p>}
      {r && (
        <>
          {r.missingRates.length > 0 && <p className="rounded-md bg-pending-bg p-2 text-caption text-pending-fg">Enter the {r.missingRates.join(', ')} rate for {r.date} on the Rates tab first.</p>}
          {r.inReview && <p className="rounded-md bg-pending-bg p-2 text-caption text-pending-fg">A revaluation for {period} is in the <Link className="underline" href="/review">review queue</Link>.</p>}
          {!!r.approved && <p className="rounded-md bg-success-bg p-2 text-caption text-success-fg">{period} is revalued; it reverses on the 1st.</p>}
          <table className="w-full text-caption">
            <thead><tr className="border-b border-line-200 text-left text-ink-500">{['Document', 'Open', 'Booked at', 'Month-end rate', 'Booked ₹', 'Revalued ₹', 'Difference'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.id} className="border-b border-line-100 last:border-0">
                  <td className="px-2 py-1.5">{x.kind === 'invoice' ? 'Invoice' : 'Bill'} {x.number}</td>
                  <td className="px-2 py-1.5 font-mono">{fmt(x.openMinor, x.currency, x.digits)}</td>
                  <td className="px-2 py-1.5 font-mono">{x.bookedRate}</td>
                  <td className="px-2 py-1.5 font-mono">{x.rate ?? '—'}</td>
                  <td className="px-2 py-1.5 font-mono">{formatPaise(x.bookedPaise)}</td>
                  <td className="px-2 py-1.5 font-mono">{x.revaluedPaise == null ? '—' : formatPaise(x.revaluedPaise)}</td>
                  <td className="px-2 py-1.5 font-mono">{x.differencePaise == null ? '—' : formatPaise(x.differencePaise)}</td>
                </tr>
              ))}
              {r.rows.length === 0 && <tr><td className="px-2 py-4 text-ink-500" colSpan={7}>Nothing open in foreign currencies at {r.date}.</td></tr>}
            </tbody>
          </table>
          <p className="text-caption text-ink-500">Receivables {formatPaise(r.receivablesPaise)}, payables {formatPaise(r.payablesPaise)} on revaluing. Unrealised: the entry reverses on the 1st of the next month, and the gain or loss is realised when each is paid.</p>
          {propose.isError && <p className="text-caption text-error-fg">{message(propose.error)}</p>}
        </>
      )}
    </section>
  );
}

export default function CurrencyPage() {
  const [tab, setTab] = useState<Tab>('documents');
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const TABS: Array<[Tab, string]> = [['documents', 'Documents'], ['invoice', 'Export invoice'], ['bill', 'Foreign bill'], ['rates', 'Rates'], ['revaluation', 'Revaluation']];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 font-display text-ink-900">Foreign currency</h1>
        <p className="text-body text-ink-500">Invoices and bills in other currencies. The books stay in rupees at each document&apos;s rate; payments book the exchange gain or loss.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line-200">
        {TABS.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-body font-medium ${tab === id ? 'border-b-2 border-saffron-600 text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>{l}</button>)}
      </div>
      {tab === 'documents' && <DocumentsTab onToast={showToast} />}
      {tab === 'invoice' && <DocumentForm kind="invoice" onDone={(m) => { showToast(m); setTab('documents'); }} />}
      {tab === 'bill' && <DocumentForm kind="bill" onDone={(m) => { showToast(m); setTab('documents'); }} />}
      {tab === 'rates' && <RatesTab onToast={showToast} />}
      {tab === 'revaluation' && <RevaluationTab onToast={showToast} />}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
