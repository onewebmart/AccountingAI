'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { useItems } from '@/components/items/item-picker';
import { ClosingStockCard } from '@/components/stock/closing-stock-card';

type Tab = 'summary' | 'lines' | 'moves' | 'entries';

interface Vendor { vendorId: string; vendorName: string; ratePaise: number; date: string; billNumber: string | null }
interface Row {
  itemId: string; name: string; code: string | null; uqc: string; qty: number; valuePaise: number; avgPaise: number; out90: number; onOrder: number; negative: boolean;
  reorder: { suggestQty: number; daysLeft: number | null; reason: string; vendors: Vendor[] } | null;
  priceChange: { pct: number; lastPaise: number; prevPaise: number; reason: string } | null;
}
interface Summary { asOf: string; rows: Row[]; totals: { valuePaise: number; inStock: number; negative: number; reorder: number; priceChanges: number } }
interface LedgerRow { date: string; qty: number; ratePaise: number | null; valuePaise: number; balanceQty: number; balanceValuePaise: number; source: { kind: 'bill' | 'invoice' | 'opening' | 'adjustment'; id: string; number: string | null }; note: string | null }
interface Ledger { item: { id: string; name: string; uqc: string }; opening: { qty: number; valuePaise: number }; rows: LedgerRow[]; closing: { qty: number; valuePaise: number } }
type Suggestion =
  | { by: 'vendor_history' | 'history' | 'name'; itemId: string; itemName: string; confidence: number; reason: string }
  | { by: 'new'; itemId: null; itemName: null; confidence: number; reason: string; newItem: { name: string; kind: 'goods' | 'service'; hsnSac: string | null; gstRatePct: number | null } };
interface Line { docKind: 'bill' | 'invoice'; docId: string; number: string | null; date: string; partyName: string; line: number; description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; suggestion: Suggestion }
interface MoveRow { id: string; itemId: string; itemName: string; uqc: string | null; kind: 'opening' | 'adjustment'; reason: string; reasonLabel: string; date: string; qty: number; ratePaise: number | null; ref: string | null; note: string | null; voided: boolean }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7);
};
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const label = 'mb-1 block text-caption font-medium text-ink-700';
const card = 'rounded-xl border border-line-200 bg-surface-card p-4';
const th = 'px-3 py-2 text-left text-caption font-medium text-ink-500';
const SOURCE: Record<LedgerRow['source']['kind'], string> = { bill: 'Bill', invoice: 'Invoice', opening: 'Opening stock', adjustment: 'Adjustment' };
const REASONS = [
  { id: 'count', label: 'Stock count' },
  { id: 'damaged', label: 'Damaged or lost' },
  { id: 'customer_return', label: 'Returned by a customer' },
  { id: 'vendor_return', label: 'Returned to a vendor' },
  { id: 'own_use', label: 'Taken for own use' },
  { id: 'other', label: 'Other' },
];

function ItemLedger({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-04-01`);
  const [to, setTo] = useState(today());
  const q = useQuery({ queryKey: ['stock', 'ledger', itemId, from, to], queryFn: () => api.get<Ledger>(`/stock/items/${itemId}/ledger?from=${from}&to=${to}`), enabled: from <= to });
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h3 font-display text-ink-900">{q.data?.item.name ?? 'Item ledger'}</h3>
        <div className="flex items-center gap-2 text-caption">
          <input type="date" className="rounded-md border border-line-200 px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-ink-500">to</span>
          <input type="date" className="rounded-md border border-line-200 px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="text-ink-600 hover:underline" onClick={onClose}>Close</button>
        </div>
      </div>
      {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the moves…</p>}
      {q.isError && <p className="text-caption text-error-fg">{message(q.error)}</p>}
      {q.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-caption">
            <thead><tr className="border-b border-line-200">{['Date', 'From', 'In / out', 'Rate', 'Value', 'Balance', 'Balance value'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              <tr className="border-b border-line-100 bg-surface-sink"><td className="px-3 py-1.5 text-ink-500" colSpan={5}>Before {from}</td><td className="px-3 py-1.5 font-mono">{q.data.opening.qty}</td><td className="px-3 py-1.5 font-mono">{formatPaise(q.data.opening.valuePaise)}</td></tr>
              {q.data.rows.map((r, i) => (
                <tr key={i} className="border-b border-line-100">
                  <td className="px-3 py-1.5 font-mono">{r.date}</td>
                  <td className="px-3 py-1.5">{SOURCE[r.source.kind]}{r.source.number ? ` ${r.source.number}` : ''}{r.note && r.source.kind === 'adjustment' ? ` · ${r.note}` : ''}</td>
                  <td className={`px-3 py-1.5 font-mono ${r.qty < 0 ? 'text-ink-600' : 'text-ink-900'}`}>{r.qty > 0 ? `+${r.qty}` : r.qty}</td>
                  <td className="px-3 py-1.5 font-mono">{r.ratePaise === null ? <span className="text-ink-300">average</span> : formatPaise(r.ratePaise)}</td>
                  <td className="px-3 py-1.5 font-mono">{formatPaise(r.valuePaise)}</td>
                  <td className="px-3 py-1.5 font-mono">{r.balanceQty}</td>
                  <td className="px-3 py-1.5 font-mono">{formatPaise(r.balanceValuePaise)}</td>
                </tr>
              ))}
              {q.data.rows.length === 0 && <tr><td className="px-3 py-4 text-ink-500" colSpan={7}>No moves between these dates.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState(today());
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['stock', 'summary', asOf], queryFn: () => api.get<Summary>(`/stock/summary?asOf=${asOf}`) });
  const order = useMutation({
    mutationFn: (v: { vendorId: string; lines: Array<{ itemId: string; qty: number }> }) => api.post<{ number: string }>('/stock/reorder', v),
    onSuccess: (po) => { void qc.invalidateQueries({ queryKey: ['stock'] }); onToast(`Purchase order ${po.number} drafted`); },
  });

  if (q.isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Valuing stock…</p>;
  if (q.isError || !q.data) return <p className="text-caption text-error-fg">{message(q.error)}</p>;
  const s = q.data;
  // Short items, grouped by the vendor last bought from.
  const byVendor = new Map<string, { vendor: Vendor; rows: Row[] }>();
  const noVendor: Row[] = [];
  for (const r of s.rows.filter((x) => x.reorder)) {
    const v = r.reorder!.vendors[0];
    if (!v) { noVendor.push(r); continue; }
    byVendor.set(v.vendorId, { vendor: v, rows: [...(byVendor.get(v.vendorId)?.rows ?? []), r] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-caption text-ink-500">As at <input type="date" className="ml-1 rounded-md border border-line-200 px-2 py-1 text-body" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>
        <span className="text-body text-ink-900">Stock value <span className="font-mono">{formatPaise(s.totals.valuePaise)}</span></span>
        <span className="text-caption text-ink-500">{s.totals.inStock} item{s.totals.inStock === 1 ? '' : 's'} in stock</span>
      </div>

      {(byVendor.size > 0 || noVendor.length > 0) && (
        <section className={card}>
          <h3 className="mb-2 text-h3 font-display text-ink-900">Running low</h3>
          <ul className="space-y-3">
            {[...byVendor.values()].map(({ vendor, rows }) => (
              <li key={vendor.vendorId} className="rounded-md bg-pending-bg p-3 text-caption text-pending-fg">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{vendor.vendorName}</span>
                  <Button size="sm" variant="secondary" disabled={order.isPending} onClick={() => order.mutate({ vendorId: vendor.vendorId, lines: rows.map((r) => ({ itemId: r.itemId, qty: r.reorder!.suggestQty })) })}>
                    <ShoppingCart size={13} /> Make purchase order
                  </Button>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {rows.map((r) => <li key={r.itemId}>{r.name}: order {r.reorder!.suggestQty} {r.uqc} at <span className="font-mono">{formatPaise(r.reorder!.vendors[0].ratePaise)}</span>. {r.reorder!.reason}</li>)}
                </ul>
              </li>
            ))}
            {noVendor.map((r) => <li key={r.itemId} className="rounded-md bg-pending-bg p-3 text-caption text-pending-fg">{r.name}: order {r.reorder!.suggestQty} {r.uqc}. {r.reorder!.reason} No bill from a vendor yet: raise one under <Link className="underline" href="/purchases/orders/new">Purchase Orders</Link>.</li>)}
          </ul>
          {order.isError && <p className="mt-2 text-caption text-error-fg">{message(order.error)}</p>}
          <p className="mt-2 text-caption text-ink-500">A purchase order is a draft; it posts nothing and goes out when you send it.</p>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <thead><tr className="border-b border-line-200 bg-surface-sink">{['Item', 'In stock', 'Average cost', 'Value', 'On order', 'Sold, 90 days', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.itemId} className="cursor-pointer border-b border-line-100 last:border-0 hover:bg-surface-sink" onClick={() => setOpen(r.itemId)}>
                <td className="px-3 py-2"><p className="text-body text-ink-900">{r.name}</p>{r.code && <p className="font-mono text-caption text-ink-500">{r.code}</p>}</td>
                <td className="px-3 py-2 font-mono text-body text-ink-900">{r.qty} {r.uqc}</td>
                <td className="px-3 py-2 font-mono text-body">{formatPaise(r.avgPaise)}</td>
                <td className="px-3 py-2 font-mono text-body text-ink-900">{formatPaise(r.valuePaise)}</td>
                <td className="px-3 py-2 font-mono text-body text-ink-600">{r.onOrder || '—'}</td>
                <td className="px-3 py-2 font-mono text-body text-ink-600">{r.out90}</td>
                <td className="px-3 py-2 text-caption">
                  <div className="flex flex-wrap gap-1">
                    {r.negative && <span className="rounded-full bg-pending-bg px-2 py-0.5 text-pending-fg">Below nothing: a bill may be missing</span>}
                    {r.priceChange && <span className="rounded-full bg-pending-bg px-2 py-0.5 text-pending-fg" title={r.priceChange.reason}>Price {r.priceChange.pct > 0 ? 'up' : 'down'} {Math.abs(r.priceChange.pct)}%</span>}
                    {r.reorder && <span className="rounded-full bg-pending-bg px-2 py-0.5 text-pending-fg">Reorder</span>}
                  </div>
                </td>
              </tr>
            ))}
            {s.rows.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500" colSpan={7}>No goods counted in stock yet. Add goods on the <Link className="underline" href="/items">items page</Link>, then link bill lines to them.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <ItemLedger itemId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LineRow({ l, onDone }: { l: Line; onDone: (m: string) => void }) {
  const items = useItems();
  const goods = (items.data ?? []).filter((i) => i.kind === 'goods' && i.isActive);
  const s = l.suggestion;
  const [pick, setPick] = useState<string>(s.itemId ?? '');
  const [name, setName] = useState(s.by === 'new' ? s.newItem.name : l.description);
  const [creating, setCreating] = useState(s.by === 'new');
  const link = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/stock/lines/link', { docKind: l.docKind, docId: l.docId, line: l.line, ...body }),
    onSuccess: (_r, body) => onDone(body.notStock ? 'Marked not stock' : body.newItem ? 'Item created and linked' : 'Line linked'),
  });
  const newItem = s.by === 'new' ? s.newItem : { name, hsnSac: l.hsnSac, gstRatePct: null };
  return (
    <li className="rounded-md border border-line-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body text-ink-900">{l.description}</p>
        <p className="text-caption text-ink-500">{l.partyName} · {l.number ?? 'no number'} · {l.date} · {l.qty} at <span className="font-mono">{formatPaise(l.ratePaise)}</span>{l.hsnSac ? ` · HSN ${l.hsnSac}` : ''}</p>
      </div>
      <p className="mt-1 rounded-md bg-pending-bg px-2 py-1 text-caption text-pending-fg">
        {s.by === 'new' ? s.reason : `Looks like ${s.itemName} (${Math.round(s.confidence * 100)}% sure): ${s.reason}`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {creating ? (
          <>
            <input className={`${field} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" disabled={!name.trim() || link.isPending} onClick={() => link.mutate({ newItem: { ...newItem, name: name.trim() } })}>Create item and link</Button>
            <button className="text-caption text-ink-600 hover:underline" onClick={() => setCreating(false)}>Pick an item instead</button>
          </>
        ) : (
          <>
            <select className={`${field} max-w-xs`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose an item…</option>
              {goods.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
            </select>
            <Button size="sm" disabled={!pick || link.isPending} onClick={() => link.mutate({ itemId: pick })}>Link line</Button>
            <button className="text-caption text-ink-600 hover:underline" onClick={() => setCreating(true)}>Create a new item</button>
          </>
        )}
        <button className="text-caption text-ink-600 hover:underline" disabled={link.isPending} onClick={() => link.mutate({ notStock: true })}>Not stock</button>
      </div>
      {link.isError && <p className="mt-1 text-caption text-error-fg">{message(link.error)}</p>}
    </li>
  );
}

function LinesTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'bill' | 'invoice'>('bill');
  const q = useQuery({ queryKey: ['stock', 'lines', kind], queryFn: () => api.get<Line[]>(`/stock/lines?kind=${kind}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['stock'] });
  const fromHistory = useMutation({ mutationFn: () => api.post<{ linked: number }>('/stock/lines/link-from-history', { kind }), onSuccess: (r) => { refresh(); onToast(`${r.linked} line${r.linked === 1 ? '' : 's'} linked`); } });
  const historyCount = (q.data ?? []).filter((l) => l.suggestion.by === 'vendor_history').length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['bill', 'invoice'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1.5 text-caption font-medium ${kind === k ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600'}`}>{k === 'bill' ? 'Bill lines' : 'Invoice lines'}</button>
          ))}
        </div>
        {historyCount > 0 && (
          <Button variant="secondary" disabled={fromHistory.isPending} onClick={() => fromHistory.mutate()}>Link {historyCount} as before</Button>
        )}
      </div>
      <p className="text-caption text-ink-500">Posted lines not yet linked to an item, so not in stock. Each has a suggestion; linking changes only the link, never an amount. Services are left out.</p>
      {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading lines…</p>}
      {q.isError && <p className="text-caption text-error-fg">{message(q.error)}</p>}
      <ul className="space-y-2">{(q.data ?? []).map((l) => <LineRow key={`${l.docId}:${l.line}`} l={l} onDone={(m) => { refresh(); onToast(m); }} />)}</ul>
      {q.data?.length === 0 && <p className="rounded-xl border border-line-200 bg-surface-card p-6 text-body text-success-fg">Every {kind} line is linked or marked not stock.</p>}
    </div>
  );
}

function MovesTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const items = useItems();
  const goods = (items.data ?? []).filter((i) => i.kind === 'goods' && i.trackStock !== false && i.isActive);
  const moves = useQuery({ queryKey: ['stock', 'moves'], queryFn: () => api.get<MoveRow[]>('/stock/moves') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['stock'] });
  const [opening, setOpening] = useState({ itemId: '', qty: '', rate: '', date: `${new Date().getFullYear()}-04-01` });
  const [adj, setAdj] = useState({ itemId: '', date: today(), reason: 'count', mode: 'count' as 'count' | 'qty', qty: '', rate: '', ref: '', note: '' });

  const saveOpening = useMutation({
    mutationFn: () => {
      const ratePaise = parseRupees(opening.rate);
      if (ratePaise === null) throw new Error('Enter the cost per unit in rupees.');
      return api.post('/stock/opening', { itemId: opening.itemId, qty: Number(opening.qty), ratePaise, date: opening.date });
    },
    onSuccess: () => { refresh(); setOpening({ ...opening, itemId: '', qty: '', rate: '' }); onToast('Opening stock saved'); },
  });
  const saveAdj = useMutation({
    mutationFn: () => {
      const ratePaise = adj.rate.trim() ? parseRupees(adj.rate) : null;
      if (adj.rate.trim() && ratePaise === null) throw new Error('Enter the rate in rupees.');
      const amount = Number(adj.qty);
      return api.post('/stock/adjustments', {
        itemId: adj.itemId, date: adj.date, reason: adj.mode === 'count' ? 'count' : adj.reason,
        ...(adj.mode === 'count' ? { countedQty: amount } : { qty: amount }), ratePaise, ref: adj.ref.trim() || null, note: adj.note.trim() || null,
      });
    },
    onSuccess: () => { refresh(); setAdj({ ...adj, qty: '', rate: '', ref: '', note: '' }); onToast('Adjustment recorded'); },
  });
  const voidMove = useMutation({ mutationFn: (id: string) => api.post(`/stock/moves/${id}/void`), onSuccess: () => { refresh(); onToast('Move voided'); } });
  const pickItem = (value: string, onChange: (v: string) => void) => (
    <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose an item…</option>
      {goods.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${card} space-y-3`}>
          <h3 className="text-h3 font-display text-ink-900">Opening stock</h3>
          <p className="text-caption text-ink-500">What each item held when these books began, at cost. Entering an item again replaces its last opening.</p>
          <div><label className={label}>Item</label>{pickItem(opening.itemId, (v) => setOpening({ ...opening, itemId: v }))}</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Quantity</label><input className={`${field} font-mono`} inputMode="decimal" value={opening.qty} onChange={(e) => setOpening({ ...opening, qty: e.target.value })} /></div>
            <div><label className={label}>Cost a unit (₹)</label><input className={`${field} font-mono`} inputMode="decimal" value={opening.rate} onChange={(e) => setOpening({ ...opening, rate: e.target.value })} /></div>
            <div><label className={label}>As at</label><input type="date" className={field} value={opening.date} onChange={(e) => setOpening({ ...opening, date: e.target.value })} /></div>
          </div>
          {saveOpening.isError && <p className="text-caption text-error-fg">{message(saveOpening.error)}</p>}
          <Button disabled={!opening.itemId || !(Number(opening.qty) > 0) || !opening.rate.trim() || saveOpening.isPending} onClick={() => saveOpening.mutate()}>{saveOpening.isPending ? 'Saving…' : 'Save opening stock'}</Button>
        </section>

        <section className={`${card} space-y-3`}>
          <h3 className="text-h3 font-display text-ink-900">Adjust stock</h3>
          <div className="flex gap-2">
            {([['count', 'Enter a count'], ['qty', 'In or out']] as const).map(([m, t]) => (
              <button key={m} onClick={() => setAdj({ ...adj, mode: m })} className={`rounded-full border px-3 py-1.5 text-caption font-medium ${adj.mode === m ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-200 bg-surface-card text-ink-600'}`}>{t}</button>
            ))}
          </div>
          <div><label className={label}>Item</label>{pickItem(adj.itemId, (v) => setAdj({ ...adj, itemId: v }))}</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>{adj.mode === 'count' ? 'Counted' : 'Quantity (− for out)'}</label><input className={`${field} font-mono`} inputMode="decimal" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} /></div>
            <div><label className={label}>On</label><input type="date" className={field} value={adj.date} onChange={(e) => setAdj({ ...adj, date: e.target.value })} /></div>
            {adj.mode === 'qty' ? (
              <div><label className={label}>Why</label><select className={field} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })}>{REASONS.filter((r) => r.id !== 'count').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
            ) : <div />}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Rate for stock in (₹)</label><input className={`${field} font-mono`} inputMode="decimal" placeholder="Average" value={adj.rate} onChange={(e) => setAdj({ ...adj, rate: e.target.value })} /></div>
            <div><label className={label}>Reference</label><input className={field} placeholder="CN/2026-27/0004" value={adj.ref} onChange={(e) => setAdj({ ...adj, ref: e.target.value })} /></div>
            <div><label className={label}>Note</label><input className={field} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></div>
          </div>
          {saveAdj.isError && <p className="text-caption text-error-fg">{message(saveAdj.error)}</p>}
          <Button disabled={!adj.itemId || adj.qty.trim() === '' || saveAdj.isPending} onClick={() => saveAdj.mutate()}>{saveAdj.isPending ? 'Saving…' : 'Record adjustment'}</Button>
          <p className="text-caption text-ink-500">A count records the difference from the books. Goods a customer returns or you send back go here, with the note&apos;s number: credit and debit notes carry amounts, not quantities.</p>
        </section>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <thead><tr className="border-b border-line-200 bg-surface-sink">{['Date', 'Item', 'Why', 'Quantity', 'Rate', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {(moves.data ?? []).map((m) => (
              <tr key={m.id} className={`border-b border-line-100 last:border-0 ${m.voided ? 'text-ink-300 line-through' : ''}`}>
                <td className="px-3 py-2 font-mono text-caption">{m.date}</td>
                <td className="px-3 py-2 text-body">{m.itemName}</td>
                <td className="px-3 py-2 text-caption">{m.reasonLabel}{m.ref ? ` · ${m.ref}` : ''}{m.note ? ` · ${m.note}` : ''}</td>
                <td className="px-3 py-2 font-mono text-body">{m.qty > 0 ? `+${m.qty}` : m.qty} {m.uqc ?? ''}</td>
                <td className="px-3 py-2 font-mono text-body">{m.ratePaise === null ? '—' : formatPaise(m.ratePaise)}</td>
                <td className="px-3 py-2 text-right">{!m.voided && <button className="text-caption text-ink-600 hover:underline" disabled={voidMove.isPending} onClick={() => voidMove.mutate(m.id)}>Void</button>}</td>
              </tr>
            ))}
            {moves.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500" colSpan={6}>No opening stock or adjustments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {voidMove.isError && <p className="text-caption text-error-fg">{message(voidMove.error)}</p>}
    </div>
  );
}

export default function StockPage() {
  const [tab, setTab] = useState<Tab>('summary');
  const [period, setPeriod] = useState(lastMonth());
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'summary', label: 'Stock on hand' },
    { id: 'lines', label: 'Link lines' },
    { id: 'moves', label: 'Opening & adjustments' },
    { id: 'entries', label: 'Stock entries' },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 font-display text-ink-900">Stock</h1>
        <p className="text-body text-ink-500">Goods in from bills, out on invoices, valued at weighted-average cost. The books take it once a month, through the closing-stock entry.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-body font-medium ${tab === t.id ? 'border-b-2 border-saffron-600 text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab onToast={showToast} />}
      {tab === 'lines' && <LinesTab onToast={showToast} />}
      {tab === 'moves' && <MovesTab onToast={showToast} />}
      {tab === 'entries' && (
        <div className="space-y-4">
          <label className="text-caption text-ink-500">Month <input type="month" className="ml-1 rounded-md border border-line-200 px-2 py-1 text-body" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></label>
          <ClosingStockCard period={period} onToast={showToast} showItems />
        </div>
      )}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
