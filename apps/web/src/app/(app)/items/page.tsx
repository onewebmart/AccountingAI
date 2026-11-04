'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Package, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { api, ApiError } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { formatPaise } from '@/lib/gst';
import { ItemOption, useItems } from '@/components/items/item-picker';

const UQC = ['NOS', 'PCS', 'KGS', 'GMS', 'LTR', 'MLT', 'MTR', 'SQM', 'SQF', 'BOX', 'PAC', 'SET', 'BAG', 'BTL', 'DOZ', 'TON', 'QTL', 'ROL', 'UNT', 'OTH'];
const RATES = [0, 3, 5, 12, 18, 28, 40];

interface Account {
  _id: string;
  name: string;
  code: string;
  type: 'ASSETS' | 'LIABILITIES' | 'INCOME' | 'EXPENSE' | 'CAPITAL';
  isGroup: boolean;
  isActive: boolean;
}

interface Suggestion {
  hsnSac: string;
  kind: 'goods' | 'service';
  gstRatePct: number | null;
  uqc: string;
  reason: string;
  source: 'history' | 'rule' | 'model';
  confidence: number;
}

interface SuggestionView {
  id: string | null;
  status: 'done' | 'queued' | 'none' | 'failed';
  suggestion: Suggestion | null;
  message: string | null;
}

const SOURCE_LABEL: Record<Suggestion['source'], string> = {
  history: 'from your past invoices and bills',
  rule: 'from a rule',
  model: 'from AI',
};

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const rupees = (paise: number | null) => (paise === null ? '' : (paise / 100).toFixed(2).replace(/\.00$/, ''));

function ItemDialog({ item, onClose, onSaved }: { item: ItemOption | null; onClose: () => void; onSaved: (created: boolean) => void }) {
  const [form, setForm] = useState({
    name: item?.name ?? '',
    code: item?.code ?? '',
    kind: item?.kind ?? ('goods' as 'goods' | 'service'),
    hsnSac: item?.hsnSac ?? '',
    uqc: item?.uqc ?? 'NOS',
    gstRatePct: item?.gstRatePct === null || item?.gstRatePct === undefined ? '' : String(item.gstRatePct),
    sale: rupees(item?.salePricePaise ?? null),
    purchase: rupees(item?.purchasePricePaise ?? null),
    incomeAccountId: item?.incomeAccountId ?? '',
    expenseAccountId: item?.expenseAccountId ?? '',
    description: item?.description ?? '',
  });
  const [hsnSource, setHsnSource] = useState<{ by: Suggestion['source']; reason: string; confidence: number } | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<Account[]>('/gl/accounts') });
  const postable = (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive);
  const incomeAccounts = postable.filter((a) => a.type === 'INCOME');
  const expenseAccounts = postable.filter((a) => a.type === 'EXPENSE' || a.type === 'ASSETS');

  const ask = useMutation({
    mutationFn: () => api.post<SuggestionView>('/items/suggest-hsn', { name: form.name.trim(), description: form.description.trim() || null, kind: form.kind }),
    onSuccess: setSuggestion,
  });
  // The model answers in a background job: check back until it has.
  const pending = suggestion?.status === 'queued' && suggestion.id ? suggestion.id : null;
  const poll = useQuery({
    queryKey: ['items', 'suggestion', pending],
    queryFn: () => api.get<SuggestionView>(`/items/suggestions/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') setSuggestion(poll.data);
  }, [poll.data]);

  const take = (s: Suggestion) => {
    setForm((f) => ({ ...f, hsnSac: s.hsnSac, kind: s.kind, uqc: s.uqc, gstRatePct: s.gstRatePct === null ? f.gstRatePct : String(s.gstRatePct) }));
    setHsnSource({ by: s.source, reason: s.reason, confidence: s.confidence });
    setSuggestion(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const sale = form.sale.trim() ? parseRupees(form.sale) : null;
      const purchase = form.purchase.trim() ? parseRupees(form.purchase) : null;
      if ((form.sale.trim() && sale === null) || (form.purchase.trim() && purchase === null)) throw new Error('Enter prices in rupees, like 1,250.50.');
      const body = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        kind: form.kind,
        hsnSac: form.hsnSac.trim() || null,
        uqc: form.kind === 'service' ? 'NA' : form.uqc,
        gstRatePct: form.gstRatePct === '' ? null : Number(form.gstRatePct),
        salePricePaise: sale,
        purchasePricePaise: purchase,
        incomeAccountId: form.incomeAccountId || null,
        expenseAccountId: form.expenseAccountId || null,
        description: form.description.trim() || null,
        // Kept only while the code is the one suggested.
        hsnSource: hsnSource && hsnSource.by && form.hsnSac.trim() ? hsnSource : null,
      };
      return item ? api.patch(`/items/${item._id}`, body) : api.post('/items', body);
    },
    onSuccess: () => onSaved(!item),
    onError: (err) => setError(err instanceof Error ? err.message : message(err)),
  });

  const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
  const label = 'mb-1 block text-caption font-medium text-ink-700';
  const shown = suggestion?.suggestion;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line-200 bg-surface-card p-6 shadow-xl">
        <h2 className="mb-5 text-h3 font-display text-ink-900">{item ? 'Edit item' : 'New item'}</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!form.name.trim()) return setError('Give the item a name.');
            save.mutate();
          }}
        >
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <div>
              <label className={label}>Name <span className="text-error-fg">*</span></label>
              <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dell Latitude laptop" />
            </div>
            <div>
              <label className={label}>Code</label>
              <input className={`${field} font-mono`} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="SKU" />
            </div>
          </div>

          <div className="flex gap-2">
            {(['goods', 'service'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setForm((f) => ({ ...f, kind: k, uqc: k === 'service' ? 'NA' : f.uqc === 'NA' ? 'NOS' : f.uqc }))}
                className={`rounded-full border px-3 py-1.5 text-caption font-medium ${form.kind === k ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600'}`}
              >
                {k === 'goods' ? 'Goods' : 'Service'}
              </button>
            ))}
          </div>

          <div>
            <label className={label}>{form.kind === 'service' ? 'SAC code' : 'HSN code'}</label>
            <div className="flex gap-2">
              <input
                className={`${field} font-mono`}
                inputMode="numeric"
                value={form.hsnSac}
                onChange={(e) => {
                  setForm((f) => ({ ...f, hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) }));
                  setHsnSource(null);
                }}
                placeholder={form.kind === 'service' ? '998314' : '8471'}
              />
              <Button type="button" variant="secondary" disabled={!form.name.trim() || ask.isPending || !!pending} onClick={() => ask.mutate()}>
                {ask.isPending || pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Suggest code
              </Button>
            </div>
            {hsnSource && <p className="mt-1 text-caption text-ink-500">Suggested {SOURCE_LABEL[hsnSource.by]}: {hsnSource.reason}.</p>}
            {ask.isError && <p className="mt-1 text-caption text-error-fg">{message(ask.error)}</p>}
            {pending && <p className="mt-1 text-caption text-ink-500">Asking AI…</p>}
            {suggestion && suggestion.status !== 'queued' && !shown && suggestion.message && <p className="mt-1 text-caption text-ink-500">{suggestion.message}</p>}
            {shown && (
              <div className="mt-2 rounded-md border border-pending-fg/20 bg-pending-bg p-3 text-caption text-pending-fg">
                <p>
                  <span className="font-mono font-semibold">{shown.hsnSac}</span>
                  {shown.gstRatePct !== null ? ` · ${shown.gstRatePct}% GST` : ' · rate depends on details: set it yourself'}
                  {shown.kind === 'goods' ? ` · ${shown.uqc}` : ''}
                </p>
                <p className="mt-0.5">
                  {shown.reason}, {SOURCE_LABEL[shown.source]} ({Math.round(shown.confidence * 100)}% sure). Check it before you use it.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => take(shown)}>Use this code</Button>
                  <button type="button" className="text-ink-500 hover:underline" onClick={() => setSuggestion(null)}>Dismiss</button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Unit</label>
              {form.kind === 'service' ? (
                <input className={`${field} bg-surface-sink`} value="NA (services have no unit)" disabled />
              ) : (
                <select className={field} value={form.uqc} onChange={(e) => setForm((f) => ({ ...f, uqc: e.target.value }))}>
                  {UQC.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className={label}>GST rate</label>
              <select className={field} value={form.gstRatePct} onChange={(e) => setForm((f) => ({ ...f, gstRatePct: e.target.value }))}>
                <option value="">Not set</option>
                {RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Sale price (₹)</label>
              <input className={`${field} font-mono`} inputMode="decimal" value={form.sale} onChange={(e) => setForm((f) => ({ ...f, sale: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className={label}>Purchase price (₹)</label>
              <input className={`${field} font-mono`} inputMode="decimal" value={form.purchase} onChange={(e) => setForm((f) => ({ ...f, purchase: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className={label}>Income account</label>
              <select className={field} value={form.incomeAccountId} onChange={(e) => setForm((f) => ({ ...f, incomeAccountId: e.target.value }))}>
                <option value="">Sales (default)</option>
                {incomeAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Expense or asset account</label>
              <select className={field} value={form.expenseAccountId} onChange={(e) => setForm((f) => ({ ...f, expenseAccountId: e.target.value }))}>
                <option value="">Purchases (default)</option>
                {expenseAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} {a.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Description</label>
            <input className={field} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Shown to help pick the right code" />
          </div>

          {error && <p className="text-caption text-error-fg">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : item ? 'Save changes' : 'Create item'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ItemsPage() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ItemOption | null | 'new'>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useItems(showArchived);

  const toggle = useMutation({
    mutationFn: (item: ItemOption) => api.post(`/items/${item._id}/${item.isActive ? 'archive' : 'restore'}`),
    onSuccess: (_d, item) => {
      setToast(item.isActive ? 'Item archived' : 'Item restored');
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter((i) => !needle || i.name.toLowerCase().includes(needle) || (i.hsnSac ?? '').startsWith(needle) || (i.code ?? '').toLowerCase().startsWith(needle));
  const missingCode = (data ?? []).filter((i) => i.isActive && !i.hsnSac).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 font-display text-ink-900">Items</h1>
        <Button onClick={() => setEditing('new')}><Plus size={15} /> New item</Button>
      </div>
      <p className="max-w-2xl text-body text-ink-500">
        What you sell and buy. Pick an item on an invoice or bill line and its HSN/SAC code, unit, rate and account fill in; the GSTR-1 HSN summary groups by them.
      </p>
      {missingCode > 0 && (
        <p className="text-caption text-pending-fg">
          {missingCode} item{missingCode === 1 ? ' has' : 's have'} no HSN/SAC code. Lines that use {missingCode === 1 ? 'it' : 'them'} will be flagged on the GSTR-1.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input className="h-10 w-64 rounded-md border border-line-200 bg-white px-3 text-body" placeholder="Search name, code or HSN" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-caption text-ink-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {isError && <QueryError error={error} onRetry={() => void refetch()} />}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-ink-400"><Loader2 size={20} className="mr-2 animate-spin" /> Loading items…</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-line-200 bg-surface-card py-20 text-center">
          <Package size={36} className="mb-4 text-ink-300" />
          <p className="mb-1 text-h3 font-display text-ink-900">{data?.length ? 'No items match.' : 'No items yet.'}</p>
          <p className="text-body text-ink-500">Add what you sell or buy most often first.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-200 bg-surface-sink">
                {['Item', 'HSN/SAC', 'Unit', 'GST', 'Sale price', 'Purchase price', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-caption font-semibold uppercase tracking-wide text-ink-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i._id} className={`border-b border-line-100 last:border-0 ${i.isActive ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3">
                    <p className="text-body text-ink-900">{i.name}</p>
                    <p className="text-caption text-ink-500">{i.kind === 'goods' ? 'Goods' : 'Service'}{i.code ? ` · ${i.code}` : ''}{i.isActive ? '' : ' · archived'}</p>
                  </td>
                  <td className="px-4 py-3">
                    {i.hsnSac ? <span className="font-mono text-caption text-ink-900">{i.hsnSac}</span> : <span className="text-caption text-pending-fg">Not set</span>}
                    {i.hsnSource && i.hsnSource.by !== 'person' && <p className="text-[0.7rem] text-ink-400">{SOURCE_LABEL[i.hsnSource.by]}</p>}
                  </td>
                  <td className="px-4 py-3 font-mono text-caption text-ink-600">{i.uqc}</td>
                  <td className="px-4 py-3 font-mono text-caption text-ink-900">{i.gstRatePct === null ? <span className="text-ink-300">—</span> : `${i.gstRatePct}%`}</td>
                  <td className="px-4 py-3 font-mono text-body text-ink-900">{i.salePricePaise === null ? <span className="text-ink-300">—</span> : formatPaise(i.salePricePaise)}</td>
                  <td className="px-4 py-3 font-mono text-body text-ink-900">{i.purchasePricePaise === null ? <span className="text-ink-300">—</span> : formatPaise(i.purchasePricePaise)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button className="mr-3 text-caption text-ink-600 hover:text-ink-900 hover:underline" onClick={() => setEditing(i)}>Edit</button>
                    <button className="text-caption text-ink-500 hover:underline disabled:opacity-50" disabled={toggle.isPending} onClick={() => toggle.mutate(i)}>
                      {i.isActive ? 'Archive' : 'Restore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toggle.isError && <p className="text-caption text-error-fg">{message(toggle.error)}</p>}

      {editing && (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            setToast(created ? 'Item created' : 'Item saved');
            void queryClient.invalidateQueries({ queryKey: ['items'] });
          }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>
      )}
    </div>
  );
}
