'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { EditLine, LineEditor, emptyLine, toApiLines } from './line-editor';

interface Vendor { _id: string; name: string }
interface PoLine { description: string; qty: number; ratePaise: number; receivedQty: number; billedQty: number }
interface PoRow { _id: string; number: string; vendorName: string; date: string; expectedBy: string | null; status: string; sentAt: string | null; amountsPaise: { total: number }; lines: PoLine[] }
interface GrnRow { _id: string; number: string; poNumber: string | null; date: string; status: string; vendorChallanNo: string | null; lines: Array<{ description: string; qty: number; rejectedQty: number }> }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900';
const th = 'px-3 py-2 text-left text-caption font-semibold uppercase tracking-wide text-ink-500';
const td = 'px-3 py-2 text-body text-ink-900';
const small = 'w-24 rounded-md border border-line-200 px-2 py-1 font-mono text-caption';

async function openPdf(path: string) {
  window.open(URL.createObjectURL(await api.blob(path)), '_blank', 'noopener');
}

/** Purchase orders: raise, send, receive against, bill. None of it posts. */
export function PurchaseOrdersTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [newLines, setNewLines] = useState<EditLine[]>([emptyLine()]);
  const [expectedBy, setExpectedBy] = useState('');
  const [working, setWorking] = useState<{ id: string; mode: 'receive' | 'bill' } | null>(null);
  const [qtys, setQtys] = useState<string[]>([]);
  const [ref, setRef] = useState('');
  const vendors = useQuery({ queryKey: ['purchase', 'vendors'], queryFn: () => api.get<Vendor[]>('/purchase/vendors') });
  const list = useQuery({ queryKey: ['orders', 'purchase-orders'], queryFn: () => api.get<PoRow[]>('/orders/purchase-orders') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['orders'] });

  const create = useMutation({
    mutationFn: () => {
      const lines = toApiLines(newLines);
      if (!lines?.length) throw new Error('Each line needs a description, a quantity and a rate in rupees.');
      return api.post('/orders/purchase-orders', { vendorId, lines, expectedBy: expectedBy || null });
    },
    onSuccess: () => { setCreating(false); setNewLines([emptyLine()]); refresh(); onToast('Purchase order raised'); },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post<{ emailed?: boolean }>(`/orders/purchase-orders/${id}/${action}`, {}),
    onSuccess: (r, v) => { refresh(); onToast(v.action === 'send' ? (r.emailed ? 'PO sent' : 'Marked sent: no email was sent') : 'PO updated'); },
  });
  const submit = useMutation({
    mutationFn: () => {
      const lines = qtys.map((q, poLine) => ({ poLine, qty: Number(q || 0) })).filter((l) => l.qty > 0);
      return working!.mode === 'receive'
        ? api.post(`/orders/purchase-orders/${working!.id}/receive`, { lines, vendorChallanNo: ref || null })
        : api.post(`/orders/purchase-orders/${working!.id}/bill`, { lines, billNumber: ref });
    },
    onSuccess: () => { const mode = working!.mode; setWorking(null); refresh(); onToast(mode === 'receive' ? 'Goods received' : 'Draft bill made: post it from Purchase'); },
  });
  const start = (po: PoRow, mode: 'receive' | 'bill') => {
    setWorking({ id: po._id, mode });
    setRef('');
    setQtys(po.lines.map((l) => String(Math.max(0, mode === 'receive' ? l.qty - l.receivedQty : l.receivedQty - l.billedQty))));
  };

  return (
    <div className="space-y-4">
      <Button onClick={() => setCreating(!creating)}><Plus size={14} /> New purchase order</Button>
      {creating && (
        <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <select className={field} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Which vendor?</option>
              {(vendors.data ?? []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </select>
            <input type="date" className={field} value={expectedBy} onChange={(e) => setExpectedBy(e.target.value)} title="Needed by" />
          </div>
          <LineEditor lines={newLines} onChange={setNewLines} customerId="" side="purchase" />
          {create.isError && <p className="text-caption text-error-fg">{message(create.error)}</p>}
          <Button disabled={!vendorId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Raise purchase order'}</Button>
        </section>
      )}
      {(act.error || submit.error) && <p className="text-caption text-error-fg">{message(act.error ?? submit.error)}</p>}
      {(list.data ?? []).map((po) => (
        <section key={po._id} className="rounded-xl border border-line-200 bg-surface-card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-body text-ink-900"><span className="font-mono text-caption">{po.number}</span> · {po.vendorName} · <span className="font-mono">{formatPaise(po.amountsPaise.total)}</span>{po.expectedBy ? ` · needed by ${po.expectedBy}` : ''}</p>
            <div className="flex items-center gap-3 text-caption">
              <span className="rounded-full bg-surface-sink px-2 py-0.5 text-ink-600">{po.status}{po.sentAt ? ', sent' : ''}</span>
              <button className="text-ink-600 hover:underline" onClick={() => void openPdf(`/orders/purchase-orders/${po._id}/pdf`)}>PDF</button>
              {po.status === 'open' && <button className="text-ink-600 hover:underline" onClick={() => act.mutate({ id: po._id, action: 'send' })}>Send PO</button>}
              {po.status === 'open' && <button className="text-ink-600 hover:underline" onClick={() => start(po, 'receive')}>Receive goods</button>}
              {po.lines.some((l) => l.receivedQty > l.billedQty) && <button className="text-ink-600 hover:underline" onClick={() => start(po, 'bill')}>Bill</button>}
              {po.status === 'open' && <button className="text-ink-500 hover:underline" onClick={() => act.mutate({ id: po._id, action: 'close' })}>Close</button>}
            </div>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-line-100">{['Line', 'Ordered', 'Received', 'Billed', working?.id === po._id ? (working.mode === 'receive' ? 'Received now' : 'Bill now') : ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={i} className="border-b border-line-100 last:border-0">
                  <td className={`${td} text-caption`}>{l.description} <span className="text-ink-400">@ {formatPaise(l.ratePaise)}</span></td>
                  <td className={`${td} font-mono text-caption`}>{l.qty}</td>
                  <td className={`${td} font-mono text-caption`}>{l.receivedQty}</td>
                  <td className={`${td} font-mono text-caption`}>{l.billedQty}</td>
                  <td className={td}>{working?.id === po._id && <input className={small} inputMode="decimal" value={qtys[i] ?? ''} onChange={(e) => setQtys(qtys.map((q, n) => (n === i ? e.target.value : q)))} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {working?.id === po._id && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className="h-9 w-48 rounded-md border border-line-200 px-2 text-caption" placeholder={working.mode === 'receive' ? "Vendor's challan no. (optional)" : "Vendor's bill no."} value={ref} onChange={(e) => setRef(e.target.value)} />
              <Button size="sm" disabled={submit.isPending || (working.mode === 'bill' && !ref.trim())} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Saving…' : working.mode === 'receive' ? 'Record goods received' : 'Make draft bill'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setWorking(null)}>Cancel</Button>
            </div>
          )}
        </section>
      ))}
      {list.data?.length === 0 && <p className="rounded-xl border border-line-200 bg-surface-card p-6 text-body text-ink-500">No purchase orders yet.</p>}
    </div>
  );
}

export function GoodsReceivedTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['orders', 'grns'], queryFn: () => api.get<GrnRow[]>('/orders/grns') });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/orders/grns/${id}/cancel`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['orders'] }); onToast('Goods note cancelled'); } });
  return (
    <div className="space-y-2">
      {cancel.isError && <p className="text-caption text-error-fg">{message(cancel.error)}</p>}
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <thead><tr className="border-b border-line-200 bg-surface-sink">{['Goods note', 'PO', 'Date', 'Received', 'Status', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {(list.data ?? []).map((g) => (
              <tr key={g._id} className="border-b border-line-100 last:border-0">
                <td className={`${td} font-mono text-caption`}>{g.number}{g.vendorChallanNo ? <span className="block text-ink-400">their challan {g.vendorChallanNo}</span> : null}</td>
                <td className={`${td} font-mono text-caption`}>{g.poNumber}</td>
                <td className={`${td} text-caption`}>{g.date}</td>
                <td className={`${td} text-caption`}>{g.lines.map((l) => `${l.qty} × ${l.description}`).join(', ')}</td>
                <td className={`${td} text-caption`}>{g.status}</td>
                <td className={`${td} text-right text-caption`}>{g.status === 'received' && <button className="text-ink-500 hover:underline" onClick={() => cancel.mutate(g._id)}>Cancel</button>}</td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">Nothing received yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
