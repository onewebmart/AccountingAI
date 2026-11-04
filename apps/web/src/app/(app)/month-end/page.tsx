'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { ClosingStockCard } from '@/components/stock/closing-stock-card';

type Tab = 'assistant' | 'assets' | 'schedules' | 'recurring';

interface Account { _id: string; name: string; code: string; type: string; isGroup: boolean; isActive: boolean }
interface Category { id: string; label: string; lifeYears: number; itRatePct: number }

interface Suggestions {
  period: string;
  depreciation: { amountPaise: number; assets: number; reason: string } | null;
  schedules: { entries: number; reason: string } | null;
  accruals: Array<{ vendorId: string; vendorName: string; amountPaise: number; accountName: string; reason: string }>;
  prepaids: Array<{ billId: string; vendorName: string; description: string; amountPaise: number; reason: string }>;
  capitalise: Array<{ billId: string; vendorName: string; date: string; description: string; amountPaise: number; category: string; accountId: string; accountName: string; reason: string; suggestedAssetAccount: { id: string; name: string } | null }>;
}

interface AssetRow {
  _id: string; name: string; categoryLabel: string; costPaise: number; accumulatedPaise: number; pendingPaise: number; bookValuePaise: number;
  depreciatedThrough: string | null; putToUse: string; method: string; lifeYears: number; status: string;
}

interface ScheduleRow {
  _id: string; kind: 'accrual' | 'prepaid'; name: string; amountPaise: number; startPeriod: string; months: number; status: string;
  drafted: Array<{ period: string; status: string }>;
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const label = 'mb-1 block text-caption font-medium text-ink-700';

function lastClosedMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

function useAccounts() {
  return useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<Account[]>('/gl/accounts') });
}

function AccountSelect({ value, onChange, types, placeholder }: { value: string; onChange: (v: string) => void; types: string[]; placeholder: string }) {
  const { data } = useAccounts();
  const options = (data ?? []).filter((a) => !a.isGroup && a.isActive && types.includes(a.type));
  return (
    <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((a) => <option key={a._id} value={a._id}>{a.code} {a.name}</option>)}
    </select>
  );
}

/** Add an asset: by hand, or from a bill the assistant found, its cost moved out of the expense. */
function AssetDialog({ prefill, onClose, onDone }: { prefill?: Suggestions['capitalise'][number]; onClose: () => void; onDone: () => void }) {
  const categories = useQuery({ queryKey: ['month-end', 'categories'], queryFn: () => api.get<Category[]>('/month-end/categories') });
  const [form, setForm] = useState({
    name: prefill?.description ?? '',
    category: prefill?.category ?? 'computers',
    assetAccountId: prefill?.suggestedAssetAccount?.id ?? '',
    cost: prefill ? String(prefill.amountPaise / 100) : '',
    purchaseDate: prefill?.date ?? new Date().toISOString().slice(0, 10),
    putToUse: prefill?.date ?? new Date().toISOString().slice(0, 10),
    method: 'SLM',
  });
  const save = useMutation({
    mutationFn: () => {
      const cost = parseRupees(form.cost);
      if (!cost) throw new Error('Enter the cost in rupees.');
      return api.post('/month-end/assets', {
        name: form.name.trim(), category: form.category, assetAccountId: form.assetAccountId, costPaise: cost,
        purchaseDate: form.purchaseDate, putToUse: form.putToUse, method: form.method,
        ...(prefill ? { billId: prefill.billId, capitaliseFromAccountId: prefill.accountId } : {}),
      });
    },
    onSuccess: onDone,
  });
  const cat = categories.data?.find((c) => c.id === form.category);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line-200 bg-surface-card p-6 shadow-xl">
        <h2 className="mb-1 text-h3 font-display text-ink-900">{prefill ? 'Capitalise' : 'Add an asset'}</h2>
        {prefill && <p className="mb-4 text-caption text-ink-500">Its cost moves out of {prefill.accountName} through the review queue; depreciation starts once that is approved.</p>}
        <div className="space-y-3">
          <div><label className={label}>Name</label><input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Category</label>
              <select className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div><label className={label}>Cost (₹)</label><input className={`${field} font-mono`} inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
          </div>
          <div><label className={label}>Asset account</label><AccountSelect value={form.assetAccountId} onChange={(v) => setForm({ ...form, assetAccountId: v })} types={['ASSETS']} placeholder="Choose the asset account…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Bought on</label><input type="date" className={field} value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></div>
            <div><label className={label}>Put to use</label><input type="date" className={field} value={form.putToUse} onChange={(e) => setForm({ ...form, putToUse: e.target.value })} /></div>
          </div>
          <div>
            <label className={label}>Method</label>
            <select className={field} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="SLM">Straight line (SLM)</option>
              <option value="WDV">Written down value (WDV)</option>
            </select>
            {cat && <p className="mt-1 text-caption text-ink-500">Schedule II life {cat.lifeYears} years, 5% residual; tax block rate {cat.itRatePct}%.</p>}
          </div>
          {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={!form.name.trim() || !form.assetAccountId || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : prefill ? 'Capitalise' : 'Add asset'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantTab({ period, onToast }: { period: string; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [capitalising, setCapitalising] = useState<Suggestions['capitalise'][number] | null>(null);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['month-end', 'assistant', period], queryFn: () => api.get<Suggestions>(`/month-end/assistant?period=${period}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['month-end'] });
  const propose = useMutation({ mutationFn: () => api.post<{ scheduled: number; accruals: number; depreciation: boolean }>('/month-end/assistant/propose', { period }), onSuccess: () => { refresh(); onToast('Sent to the review queue'); } });
  const spread = useMutation({ mutationFn: (billId: string) => api.post('/month-end/assistant/spread', { period, billId }), onSuccess: () => { refresh(); onToast('Sent to the review queue'); } });

  if (isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the month…</p>;
  if (isError || !data) return <p className="text-caption text-error-fg">{message(error)}</p>;
  const nothing = !data.depreciation && !data.schedules && !data.accruals.length && !data.prepaids.length && !data.capitalise.length;
  const card = 'rounded-xl border border-line-200 bg-surface-card p-4';

  return (
    <div className="space-y-4">
      {nothing ? (
        <p className="rounded-xl border border-line-200 bg-surface-card p-6 text-body text-success-fg">Nothing left for {period}: no accruals, spreads, depreciation or assets to adjust.</p>
      ) : (
        <>
          {(data.depreciation || data.schedules || data.accruals.length > 0) && (
            <section className={card}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-h3 font-display text-ink-900">To propose</h3>
                <Button disabled={propose.isPending} onClick={() => propose.mutate()}>
                  <Sparkles size={14} /> {propose.isPending ? 'Proposing…' : 'Propose entries'}
                </Button>
              </div>
              <ul className="space-y-2 text-caption">
                {data.depreciation && <li className="rounded-md bg-pending-bg p-2 text-pending-fg">Depreciation on {data.depreciation.assets} asset{data.depreciation.assets === 1 ? '' : 's'}: <span className="font-mono">{formatPaise(data.depreciation.amountPaise)}</span>. {data.depreciation.reason}</li>}
                {data.schedules && <li className="rounded-md bg-pending-bg p-2 text-pending-fg">{data.schedules.reason}</li>}
                {data.accruals.map((a) => (
                  <li key={a.vendorId} className="rounded-md bg-pending-bg p-2 text-pending-fg">Accrue <span className="font-mono">{formatPaise(a.amountPaise)}</span> for {a.vendorName}. {a.reason}</li>
                ))}
              </ul>
              {propose.isError && <p className="mt-2 text-caption text-error-fg">{message(propose.error)}</p>}
              <p className="mt-2 text-caption text-ink-500">Each becomes a proposal in the <Link className="underline" href="/review">review queue</Link>; nothing posts until it is approved.</p>
            </section>
          )}
          {data.prepaids.length > 0 && (
            <section className={card}>
              <h3 className="mb-2 text-h3 font-display text-ink-900">A year paid in one month</h3>
              <ul className="space-y-2">
                {data.prepaids.map((p) => (
                  <li key={p.billId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">
                    <span>{p.reason}</span>
                    <Button size="sm" variant="secondary" disabled={spread.isPending} onClick={() => spread.mutate(p.billId)}>Spread over 12 months</Button>
                  </li>
                ))}
              </ul>
              {spread.isError && <p className="mt-2 text-caption text-error-fg">{message(spread.error)}</p>}
            </section>
          )}
          {data.capitalise.length > 0 && (
            <section className={card}>
              <h3 className="mb-2 text-h3 font-display text-ink-900">Assets booked as expenses</h3>
              <ul className="space-y-2">
                {data.capitalise.map((c) => (
                  <li key={`${c.billId}-${c.description}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">
                    <span>{c.reason}</span>
                    <Button size="sm" variant="secondary" onClick={() => setCapitalising(c)}>Capitalise</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <ClosingStockCard period={period} onToast={onToast} hideWhenEmpty />
      <Link href="/review" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline">Open the review queue <ChevronRight size={13} /></Link>
      {capitalising && <AssetDialog prefill={capitalising} onClose={() => setCapitalising(null)} onDone={() => { setCapitalising(null); refresh(); onToast('Sent to the review queue'); }} />}
    </div>
  );
}

function AssetsTab({ period, onToast }: { period: string; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [disposing, setDisposing] = useState<AssetRow | null>(null);
  const [disposal, setDisposal] = useState({ date: new Date().toISOString().slice(0, 10), proceeds: '' });
  const [taxFy, setTaxFy] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['month-end', 'assets'], queryFn: () => api.get<AssetRow[]>('/month-end/assets') });
  const tax = useQuery({
    queryKey: ['month-end', 'tax', taxFy],
    queryFn: () => api.get<{ blocks: Array<{ block: string; ratePct: number; openingPaise: number; additionsPaise: number; disposalsPaise: number; depreciationPaise: number; closingPaise: number }>; note: string }>(`/month-end/assets/tax-report?fy=${taxFy}`),
    enabled: !!taxFy,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['month-end'] });
  const run = useMutation({ mutationFn: () => api.post('/month-end/assets/depreciation-run', { period }), onSuccess: () => { refresh(); onToast('Depreciation sent to the review queue'); } });
  const dispose = useMutation({
    mutationFn: () => api.post(`/month-end/assets/${disposing!._id}/dispose`, { date: disposal.date, proceedsPaise: parseRupees(disposal.proceeds || '0') ?? 0 }),
    onSuccess: () => { setDisposing(null); refresh(); onToast('Disposal sent to the review queue'); },
  });
  const fy = (() => { const [y, m] = period.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; })();
  const th = 'px-3 py-2 text-left text-caption font-semibold uppercase tracking-wide text-ink-500';
  const td = 'px-3 py-2 text-body text-ink-900';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAdding(true)}><Plus size={14} /> Add asset</Button>
        <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Working out…' : `Run depreciation to the end of ${period}`}</Button>
        <Button variant="secondary" onClick={() => setTaxFy(taxFy ? null : fy)}>{taxFy ? 'Hide tax depreciation' : `Tax depreciation ${fy}`}</Button>
      </div>
      {(run.error || dispose.error) && <p className="text-caption text-error-fg">{message(run.error ?? dispose.error)}</p>}
      {list.data && list.data.length === 0 ? (
        <p className="rounded-xl border border-line-200 bg-surface-card p-6 text-body text-ink-500">No assets yet. Add them, or capitalise one the assistant finds in your bills.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
          <table className="w-full">
            <thead><tr className="border-b border-line-200 bg-surface-sink">{['Asset', 'Cost', 'Depreciation', 'Book value', 'Booked to', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {(list.data ?? []).map((a) => (
                <tr key={a._id} className="border-b border-line-100 last:border-0">
                  <td className={td}>
                    <p>{a.name}</p>
                    <p className="text-caption text-ink-500">{a.categoryLabel} · {a.method} {a.lifeYears}y · from {a.putToUse}{a.status !== 'active' ? ` · ${a.status === 'pending' ? 'waiting to be capitalised' : a.status}` : ''}</p>
                  </td>
                  <td className={`${td} font-mono`}>{formatPaise(a.costPaise)}</td>
                  <td className={`${td} font-mono`}>{formatPaise(a.accumulatedPaise)}{a.pendingPaise > 0 && <span className="block text-caption text-pending-fg">+ {formatPaise(a.pendingPaise)} in review</span>}</td>
                  <td className={`${td} font-mono`}>{formatPaise(a.bookValuePaise)}</td>
                  <td className={`${td} text-caption text-ink-600`}>{a.depreciatedThrough ?? '—'}</td>
                  <td className={`${td} text-right`}>{a.status === 'active' && <button className="text-caption text-ink-600 hover:underline" onClick={() => setDisposing(a)}>Sell or scrap</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {disposing && (
        <div className="space-y-2 rounded-xl border border-line-200 bg-surface-card p-4">
          <p className="text-body font-medium text-ink-900">Sell or scrap {disposing.name}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className={label}>On</label><input type="date" className={field} value={disposal.date} onChange={(e) => setDisposal({ ...disposal, date: e.target.value })} /></div>
            <div><label className={label}>Sold for (₹, 0 if scrapped)</label><input className={`${field} font-mono`} inputMode="decimal" value={disposal.proceeds} onChange={(e) => setDisposal({ ...disposal, proceeds: e.target.value })} /></div>
            <Button disabled={dispose.isPending} onClick={() => dispose.mutate()}>{dispose.isPending ? 'Working out…' : 'Propose disposal'}</Button>
            <Button variant="secondary" onClick={() => setDisposing(null)}>Cancel</Button>
          </div>
          <p className="text-caption text-ink-500">Depreciation to the date, the asset out of the books and the gain or loss go to the review queue as one entry.</p>
        </div>
      )}
      {taxFy && tax.data && (
        <section className="rounded-xl border border-line-200 bg-surface-card p-4">
          <h3 className="mb-2 text-h3 font-display text-ink-900">Income Tax depreciation, {taxFy}</h3>
          <table className="w-full">
            <thead><tr className="border-b border-line-200">{['Block', 'Opening', 'Additions', 'Sales', 'Depreciation', 'Closing'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {tax.data.blocks.map((b) => (
                <tr key={b.block} className="border-b border-line-100 last:border-0">
                  <td className={td}>{b.block}</td>
                  {[b.openingPaise, b.additionsPaise, b.disposalsPaise, b.depreciationPaise, b.closingPaise].map((v, i) => <td key={i} className={`${td} font-mono text-caption`}>{formatPaise(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-caption text-ink-500">{tax.data.note} Additions in use under 180 days in the year take half the rate.</p>
        </section>
      )}
      {adding && <AssetDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); onToast('Asset added'); }} />}
    </div>
  );
}

function SchedulesTab({ period, onToast }: { period: string; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ kind: 'accrual' as 'accrual' | 'prepaid', name: '', expenseAccountId: '', amount: '', startPeriod: period, months: '12' });
  const list = useQuery({ queryKey: ['month-end', 'schedules'], queryFn: () => api.get<ScheduleRow[]>('/month-end/schedules') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['month-end'] });
  const create = useMutation({
    mutationFn: () => {
      const amount = parseRupees(form.amount);
      if (!amount) throw new Error('Enter the amount in rupees.');
      return api.post('/month-end/schedules', { kind: form.kind, name: form.name.trim(), expenseAccountId: form.expenseAccountId, amountPaise: amount, startPeriod: form.startPeriod, months: Number(form.months) });
    },
    onSuccess: () => { refresh(); setForm({ ...form, name: '', amount: '' }); onToast('Schedule created'); },
  });
  const draft = useMutation({ mutationFn: () => api.post<{ drafted: number }>('/month-end/schedules/draft', { through: period }), onSuccess: (r) => { refresh(); onToast(`${r.drafted} sent to the review queue`); } });
  const stop = useMutation({ mutationFn: (id: string) => api.post(`/month-end/schedules/${id}/stop`), onSuccess: () => { refresh(); onToast('Schedule stopped'); } });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
        <h3 className="text-h3 font-display text-ink-900">New schedule</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={label}>Kind</label>
            <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'accrual' | 'prepaid' })}>
              <option value="accrual">Accrual: a month&apos;s cost before its bill</option>
              <option value="prepaid">Prepaid: paid ahead, spread over months</option>
            </select>
          </div>
          <div><label className={label}>Name</label><input className={field} placeholder={form.kind === 'accrual' ? 'Office rent' : 'Annual insurance'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className={label}>Expense account</label><AccountSelect value={form.expenseAccountId} onChange={(v) => setForm({ ...form, expenseAccountId: v })} types={['EXPENSE']} placeholder="Choose…" /></div>
          <div><label className={label}>{form.kind === 'accrual' ? 'Each month (₹)' : 'Whole amount (₹)'}</label><input className={`${field} font-mono`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label className={label}>From</label><input type="month" className={field} value={form.startPeriod} onChange={(e) => setForm({ ...form, startPeriod: e.target.value })} /></div>
          <div><label className={label}>Months</label><input className={`${field} font-mono`} inputMode="numeric" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value.replace(/\D/g, '') })} /></div>
        </div>
        {create.isError && <p className="text-caption text-error-fg">{message(create.error)}</p>}
        <Button disabled={!form.name.trim() || !form.expenseAccountId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Create schedule'}</Button>
        <p className="text-caption text-ink-500">{form.kind === 'accrual' ? 'Each month: the expense against Accrued Expenses, reversed on the 1st of the next month.' : 'Each month: a share of the amount from Prepaid Expenses into the expense.'} Drafted into the review queue after each month ends.</p>
      </section>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={draft.isPending} onClick={() => draft.mutate()}>{draft.isPending ? 'Drafting…' : `Draft entries due to ${period}`}</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s._id} className="border-b border-line-100 last:border-0">
                <td className="px-3 py-2"><p className="text-body text-ink-900">{s.name}</p><p className="text-caption text-ink-500">{s.kind === 'accrual' ? 'Accrual' : 'Prepaid'} · from {s.startPeriod} for {s.months} months · {s.drafted.length} drafted{s.status === 'stopped' ? ' · stopped' : ''}</p></td>
                <td className="px-3 py-2 font-mono text-body text-ink-900">{formatPaise(s.amountPaise)}</td>
                <td className="px-3 py-2 text-right">{s.status === 'active' && <button className="text-caption text-ink-600 hover:underline" onClick={() => stop.mutate(s._id)}>Stop</button>}</td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">No schedules yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecurringJournalTab({ onToast }: { onToast: (m: string) => void }) {
  const [form, setForm] = useState({ name: '', frequency: 'monthly', dayOfMonth: '31', startDate: new Date().toISOString().slice(0, 10), debitAccount: '', creditAccount: '', amount: '' });
  const save = useMutation({
    mutationFn: () => {
      const amount = parseRupees(form.amount);
      if (!amount) throw new Error('Enter the amount in rupees.');
      return api.post('/recurring/journals', {
        name: form.name.trim(), frequency: form.frequency, dayOfMonth: Number(form.dayOfMonth), startDate: form.startDate,
        journalLines: [
          { accountId: form.debitAccount, debitPaise: amount, creditPaise: 0 },
          { accountId: form.creditAccount, debitPaise: 0, creditPaise: amount },
        ],
      });
    },
    onSuccess: () => { setForm({ ...form, name: '', amount: '' }); onToast('Recurring journal created'); },
  });
  const all = ['ASSETS', 'LIABILITIES', 'INCOME', 'EXPENSE', 'CAPITAL'];
  return (
    <section className="max-w-xl space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="text-h3 font-display text-ink-900">New recurring journal</h3>
      <p className="text-caption text-ink-500">A provision or allocation that repeats. On each date it is drafted into the review queue; it never posts by itself. Bills and invoices that repeat are on the <Link className="underline" href="/recurring">Recurring</Link> page.</p>
      <div><label className={label}>Name</label><input className={field} placeholder="Director salary provision" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={label}>Every</label><select className={field} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="monthly">Month</option><option value="quarterly">Quarter</option><option value="yearly">Year</option></select></div>
        <div><label className={label}>On day</label><input className={`${field} font-mono`} inputMode="numeric" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value.replace(/\D/g, '') })} /></div>
        <div><label className={label}>Starting</label><input type="date" className={field} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
      </div>
      <div><label className={label}>Debit</label><AccountSelect value={form.debitAccount} onChange={(v) => setForm({ ...form, debitAccount: v })} types={all} placeholder="Account to debit…" /></div>
      <div><label className={label}>Credit</label><AccountSelect value={form.creditAccount} onChange={(v) => setForm({ ...form, creditAccount: v })} types={all} placeholder="Account to credit…" /></div>
      <div><label className={label}>Amount (₹)</label><input className={`${field} font-mono`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
      {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
      <Button disabled={!form.name.trim() || !form.debitAccount || !form.creditAccount || form.debitAccount === form.creditAccount || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Create recurring journal'}</Button>
      <p className="text-caption text-ink-500">Day 31 means the last day of the month.</p>
    </section>
  );
}

export default function MonthEndPage() {
  const [tab, setTab] = useState<Tab>('assistant');
  const [period, setPeriod] = useState(lastClosedMonth());
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };
  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'assistant', label: 'Assistant' },
    { id: 'assets', label: 'Fixed assets' },
    { id: 'schedules', label: 'Accruals & prepaids' },
    { id: 'recurring', label: 'Recurring journals' },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Month-end</h1>
          <p className="text-body text-ink-500">Adjustments before the books close. Every entry goes to the review queue first.</p>
        </div>
        <input type="month" className="h-10 rounded-md border border-line-200 bg-white px-3 text-body" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-body font-medium ${tab === t.id ? 'border-b-2 border-saffron-600 text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'assistant' && <AssistantTab period={period} onToast={showToast} />}
      {tab === 'assets' && <AssetsTab period={period} onToast={showToast} />}
      {tab === 'schedules' && <SchedulesTab period={period} onToast={showToast} />}
      {tab === 'recurring' && <RecurringJournalTab onToast={showToast} />}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
