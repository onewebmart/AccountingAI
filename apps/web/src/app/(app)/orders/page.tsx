'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileText, Loader2, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { EditLine, LineEditor, emptyLine, toApiLines } from '@/components/orders/line-editor';

type Tab = 'quotes' | 'orders' | 'challans';

interface Customer { _id: string; name: string }
interface Line { description: string; qty: number; ratePaise: number; amountPaise: number; taxRatePct: number; invoicedQty?: number; deliveredQty?: number }
interface QuoteRow { _id: string; number: string; customerName: string; customerId: string; date: string; validUntil: string; status: string; expired: boolean; amountsPaise: { total: number }; lines: Line[]; drafted: { source: string; unread: string[] } | null; convertedTo: { kind: string; id: string } | null }
interface OrderRow { _id: string; number: string; customerName: string; customerId: string; date: string; status: string; customerPoNumber: string | null; amountsPaise: { total: number }; lines: Line[]; fullyInvoiced: boolean }
interface ChallanRow { _id: string; number: string; customerName: string; date: string; reason: string; status: string; lines: Array<{ line: Line }> }
interface FollowUp { quoteId: string; number: string; customerName: string; sentOn: string | null; totalPaise: number; message: string }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900';
const label = 'mb-1 block text-caption font-medium text-ink-700';
const th = 'px-3 py-2 text-left text-caption font-semibold uppercase tracking-wide text-ink-500';
const td = 'px-3 py-2 text-body text-ink-900';

const STATUS: Record<string, string> = {
  draft: 'bg-surface-sink text-ink-600', sent: 'bg-pending-bg text-pending-fg', accepted: 'bg-success-bg text-success-fg', declined: 'bg-surface-sink text-ink-500',
  converted: 'bg-success-bg text-success-fg', expired: 'bg-surface-sink text-ink-500', open: 'bg-pending-bg text-pending-fg', closed: 'bg-success-bg text-success-fg',
  cancelled: 'bg-surface-sink text-ink-500', issued: 'bg-pending-bg text-pending-fg', returned: 'bg-surface-sink text-ink-600',
};
const Chip = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${STATUS[s] ?? ''}`}>{s}</span>;

async function openPdf(path: string) {
  window.open(URL.createObjectURL(await api.blob(path)), '_blank', 'noopener');
}

function useCustomers() {
  return useQuery({ queryKey: ['sales', 'customers'], queryFn: () => api.get<Customer[]>('/sales/customers') });
}

function NewDoc({ kind, onDone }: { kind: 'quote' | 'order' | 'challan'; onDone: (m: string) => void }) {
  const customers = useCustomers();
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<EditLine[]>([emptyLine()]);
  const [extra, setExtra] = useState({ validUntil: '', customerPoNumber: '', reason: 'supply', vehicleNo: '' });
  const save = useMutation({
    mutationFn: () => {
      const apiLines = toApiLines(lines);
      if (!apiLines?.length) throw new Error('Each line needs a description, a quantity and a rate in rupees.');
      if (kind === 'quote') return api.post('/orders/quotes', { customerId, lines: apiLines, ...(extra.validUntil ? { validUntil: extra.validUntil } : {}) });
      if (kind === 'order') return api.post('/orders/sales-orders', { customerId, lines: apiLines, customerPoNumber: extra.customerPoNumber || null });
      return api.post('/orders/challans', { customerId, lines: apiLines, reason: extra.reason, vehicleNo: extra.vehicleNo || null });
    },
    onSuccess: () => { setLines([emptyLine()]); onDone(kind === 'quote' ? 'Quote saved as a draft' : kind === 'order' ? 'Sales order created' : 'Challan issued'); },
  });
  return (
    <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="text-h3 font-display text-ink-900">{kind === 'quote' ? 'New quote' : kind === 'order' ? 'New sales order' : 'New delivery challan'}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className={label}>Customer</label>
          <select className={field} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose…</option>
            {(customers.data ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
        {kind === 'quote' && <div><label className={label}>Valid until</label><input type="date" className={field} value={extra.validUntil} onChange={(e) => setExtra({ ...extra, validUntil: e.target.value })} /></div>}
        {kind === 'order' && <div><label className={label}>Customer&apos;s PO no.</label><input className={field} value={extra.customerPoNumber} onChange={(e) => setExtra({ ...extra, customerPoNumber: e.target.value })} /></div>}
        {kind === 'challan' && (
          <>
            <div>
              <label className={label}>Why the goods move</label>
              <select className={field} value={extra.reason} onChange={(e) => setExtra({ ...extra, reason: e.target.value })}>
                <option value="supply">Supply, invoiced later</option>
                <option value="job_work">Job work</option>
                <option value="approval">On approval</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div><label className={label}>Vehicle no.</label><input className={`${field} font-mono`} value={extra.vehicleNo} onChange={(e) => setExtra({ ...extra, vehicleNo: e.target.value })} /></div>
          </>
        )}
      </div>
      <LineEditor lines={lines} onChange={setLines} customerId={customerId} />
      {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
      <Button disabled={!customerId || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : kind === 'quote' ? 'Save quote' : kind === 'order' ? 'Create order' : 'Issue challan'}</Button>
    </section>
  );
}

function FromMessage({ onDone }: { onDone: (m: string) => void }) {
  const qc = useQueryClient();
  const customers = useCustomers();
  const [customerId, setCustomerId] = useState('');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const draft = useMutation({
    mutationFn: () => api.post<{ status: 'done' | 'queued'; suggestionId: string | null; quote: QuoteRow | null }>('/orders/quotes/from-message', { customerId, text }),
    onSuccess: (r) => {
      if (r.status === 'queued') setPending(r.suggestionId);
      else { setText(''); void qc.invalidateQueries({ queryKey: ['orders'] }); onDone('Draft quote made: check it, then send it'); }
    },
  });
  const poll = useQuery({
    queryKey: ['orders', 'drafting', pending],
    queryFn: () => api.get<{ status: string; quoteId: string | null; message: string | null }>(`/orders/quotes/drafting/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') {
      setPending(null);
      if (poll.data.status === 'done') { setText(''); void qc.invalidateQueries({ queryKey: ['orders'] }); onDone('Draft quote made by AI: check every line'); }
    }
  }, [poll.data, qc, onDone]);
  return (
    <section className="space-y-2 rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="text-h3 font-display text-ink-900">Draft from a message</h3>
      <p className="text-caption text-ink-500">Paste the customer&apos;s email or WhatsApp. Quantities and your items are read from it, at this customer&apos;s last prices; you check it and send it.</p>
      <select className={field} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">Which customer?</option>
        {(customers.data ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
      </select>
      <textarea className={field} rows={3} placeholder="Please send 200 cartons of A4 paper and 10 boxes of staples by Friday" value={text} onChange={(e) => setText(e.target.value)} />
      {draft.isError && <p className="text-caption text-error-fg">{message(draft.error)}</p>}
      {poll.data?.status === 'none' && <p className="text-caption text-ink-500">{poll.data.message}</p>}
      <Button variant="secondary" disabled={!customerId || !text.trim() || draft.isPending || !!pending} onClick={() => draft.mutate()}>
        {draft.isPending || pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Draft quote
      </Button>
    </section>
  );
}

function QuotesTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['orders', 'quotes'], queryFn: () => api.get<QuoteRow[]>('/orders/quotes') });
  const followUps = useQuery({ queryKey: ['orders', 'follow-ups'], queryFn: () => api.get<FollowUp[]>('/orders/quotes/follow-ups') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['orders'] });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post<{ emailed?: boolean; kind?: string }>(`/orders/quotes/${id}/${action}`, {}),
    onSuccess: (r, v) => {
      refresh();
      onToast(v.action === 'send' ? (r.emailed ? 'Quote sent' : 'Marked sent: no email was sent') : v.action.startsWith('convert') ? (r.kind === 'invoice' ? 'Draft invoice made: post it from Sales' : 'Sales order created') : `Quote ${v.action}ed`);
    },
  });
  const done = (m: string) => { refresh(); setCreating(false); onToast(m); };
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Button onClick={() => setCreating(!creating)}><Plus size={14} /> New quote</Button></div>
      {creating && <NewDoc kind="quote" onDone={done} />}
      <FromMessage onDone={done} />
      {(followUps.data ?? []).length > 0 && (
        <section className="rounded-xl border border-line-200 bg-surface-card p-4">
          <h3 className="mb-2 text-h3 font-display text-ink-900">No answer after a week</h3>
          <ul className="space-y-2">
            {followUps.data!.map((f) => (
              <li key={f.quoteId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">
                <span>{f.customerName} · {f.number} · {formatPaise(f.totalPaise)} · sent {f.sentOn}</span>
                <button className="inline-flex items-center gap-1 font-medium hover:underline" onClick={() => void navigator.clipboard.writeText(f.message).then(() => onToast('Follow-up copied'))}><Copy size={12} /> Copy follow-up</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {act.isError && <p className="text-caption text-error-fg">{message(act.error)}</p>}
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <thead><tr className="border-b border-line-200 bg-surface-sink">{['Quote', 'Customer', 'Valid until', 'Total', 'Status', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {(list.data ?? []).map((q) => (
              <tr key={q._id} className="border-b border-line-100 last:border-0">
                <td className={td}><span className="font-mono text-caption">{q.number}</span>{q.drafted && <p className="text-[0.7rem] text-pending-fg">Drafted from a message{q.drafted.unread.length ? `; not read: ${q.drafted.unread.join(', ')}` : ''}</p>}</td>
                <td className={td}>{q.customerName}</td>
                <td className={`${td} text-caption`}>{q.validUntil}</td>
                <td className={`${td} font-mono`}>{formatPaise(q.amountsPaise.total)}</td>
                <td className={td}><Chip s={q.expired ? 'expired' : q.status} /></td>
                <td className={`${td} whitespace-nowrap text-right text-caption`}>
                  <button className="mr-2 text-ink-600 hover:underline" onClick={() => void openPdf(`/orders/quotes/${q._id}/pdf`)}><FileText size={12} className="inline" /> PDF</button>
                  {['draft', 'sent'].includes(q.status) && <button className="mr-2 text-ink-600 hover:underline" onClick={() => act.mutate({ id: q._id, action: 'send' })}>Send quote</button>}
                  {['draft', 'sent'].includes(q.status) && <button className="mr-2 text-ink-600 hover:underline" onClick={() => act.mutate({ id: q._id, action: 'accept' })}>Accepted</button>}
                  {['draft', 'sent'].includes(q.status) && <button className="mr-2 text-ink-500 hover:underline" onClick={() => act.mutate({ id: q._id, action: 'decline' })}>Declined</button>}
                  {q.status === 'accepted' && <button className="mr-2 text-ink-600 hover:underline" onClick={() => act.mutate({ id: q._id, action: 'convert/sales_order' })}>Make order</button>}
                  {q.status === 'accepted' && <button className="text-ink-600 hover:underline" onClick={() => act.mutate({ id: q._id, action: 'convert/invoice' })}>Make invoice</button>}
                  {q.convertedTo && <span className="text-ink-500">→ {q.convertedTo.kind === 'invoice' ? <Link className="underline" href="/sales">invoice</Link> : 'order'}</span>}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">No quotes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [invoicing, setInvoicing] = useState<OrderRow | null>(null);
  const [qtys, setQtys] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['orders', 'sales-orders'], queryFn: () => api.get<OrderRow[]>('/orders/sales-orders') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['orders'] });
  const invoice = useMutation({
    mutationFn: () => api.post(`/orders/sales-orders/${invoicing!._id}/invoice`, { lines: qtys.map((q, i) => ({ orderLine: i, qty: Number(q || 0) })).filter((l) => l.qty > 0) }),
    onSuccess: () => { setInvoicing(null); refresh(); onToast('Draft invoice made: post it from Sales'); },
  });
  const status = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/orders/sales-orders/${id}/${action}`), onSuccess: () => { refresh(); onToast('Order updated'); } });
  return (
    <div className="space-y-4">
      <Button onClick={() => setCreating(!creating)}><Plus size={14} /> New sales order</Button>
      {creating && <NewDoc kind="order" onDone={(m) => { refresh(); setCreating(false); onToast(m); }} />}
      {(invoice.error || status.error) && <p className="text-caption text-error-fg">{message(invoice.error ?? status.error)}</p>}
      <div className="space-y-3">
        {(list.data ?? []).map((o) => (
          <section key={o._id} className="rounded-xl border border-line-200 bg-surface-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-body text-ink-900"><span className="font-mono text-caption">{o.number}</span> · {o.customerName}{o.customerPoNumber ? ` · their PO ${o.customerPoNumber}` : ''} · <span className="font-mono">{formatPaise(o.amountsPaise.total)}</span></p>
              <div className="flex items-center gap-2 text-caption">
                <Chip s={o.status} />
                <button className="text-ink-600 hover:underline" onClick={() => void openPdf(`/orders/sales-orders/${o._id}/pdf`)}>PDF</button>
                {o.status === 'open' && <button className="text-ink-600 hover:underline" onClick={() => { setInvoicing(o); setQtys(o.lines.map((l) => String(Math.max(0, l.qty - (l.invoicedQty ?? 0))))); }}>Invoice</button>}
                {o.status === 'open' && <button className="text-ink-500 hover:underline" onClick={() => status.mutate({ id: o._id, action: 'close' })}>Close</button>}
              </div>
            </div>
            <table className="w-full">
              <thead><tr className="border-b border-line-100">{['Line', 'Ordered', 'Invoiced', 'Delivered', invoicing?._id === o._id ? 'Invoice now' : ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {o.lines.map((l, i) => (
                  <tr key={i} className="border-b border-line-100 last:border-0">
                    <td className={`${td} text-caption`}>{l.description}</td>
                    <td className={`${td} font-mono text-caption`}>{l.qty}</td>
                    <td className={`${td} font-mono text-caption`}>{l.invoicedQty ?? 0}</td>
                    <td className={`${td} font-mono text-caption`}>{l.deliveredQty ?? 0}</td>
                    <td className={td}>{invoicing?._id === o._id && <input className="w-24 rounded-md border border-line-200 px-2 py-1 font-mono text-caption" inputMode="decimal" value={qtys[i] ?? ''} onChange={(e) => setQtys(qtys.map((q, n) => (n === i ? e.target.value : q)))} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invoicing?._id === o._id && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={invoice.isPending} onClick={() => invoice.mutate()}>{invoice.isPending ? 'Making…' : 'Make draft invoice'}</Button>
                <Button size="sm" variant="secondary" onClick={() => setInvoicing(null)}>Cancel</Button>
              </div>
            )}
          </section>
        ))}
        {list.data?.length === 0 && <p className="rounded-xl border border-line-200 bg-surface-card p-6 text-body text-ink-500">No sales orders yet. Accept a quote, or enter one.</p>}
      </div>
    </div>
  );
}

function ChallansTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['orders', 'challans'], queryFn: () => api.get<ChallanRow[]>('/orders/challans') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['orders'] });
  const status = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/orders/challans/${id}/${action}`), onSuccess: () => { refresh(); onToast('Challan updated'); } });
  const REASON: Record<string, string> = { supply: 'Supply', job_work: 'Job work', approval: 'On approval', other: 'Other' };
  return (
    <div className="space-y-4">
      <Button onClick={() => setCreating(!creating)}><Plus size={14} /> New challan</Button>
      {creating && <NewDoc kind="challan" onDone={(m) => { refresh(); setCreating(false); onToast(m); }} />}
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <thead><tr className="border-b border-line-200 bg-surface-sink">{['Challan', 'Customer', 'Date', 'Reason', 'Items', 'Status', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {(list.data ?? []).map((c) => (
              <tr key={c._id} className="border-b border-line-100 last:border-0">
                <td className={`${td} font-mono text-caption`}>{c.number}</td>
                <td className={td}>{c.customerName}</td>
                <td className={`${td} text-caption`}>{c.date}</td>
                <td className={`${td} text-caption`}>{REASON[c.reason]}</td>
                <td className={`${td} text-caption`}>{c.lines.map((l) => `${l.line.qty} × ${l.line.description}`).join(', ')}</td>
                <td className={td}><Chip s={c.status} /></td>
                <td className={`${td} whitespace-nowrap text-right text-caption`}>
                  <button className="mr-2 text-ink-600 hover:underline" onClick={() => void openPdf(`/orders/challans/${c._id}/pdf`)}>PDF</button>
                  {c.status === 'issued' && c.reason !== 'supply' && <button className="mr-2 text-ink-600 hover:underline" onClick={() => status.mutate({ id: c._id, action: 'return' })}>Returned</button>}
                  {c.status === 'issued' && <button className="text-ink-500 hover:underline" onClick={() => status.mutate({ id: c._id, action: 'cancel' })}>Cancel</button>}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">No challans yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [tab, setTab] = useState<Tab>('quotes');
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 font-display text-ink-900">Quotes & orders</h1>
        <p className="text-body text-ink-500">What comes before an invoice. None of it posts: an accepted quote or an order becomes a draft invoice you post from Sales.</p>
      </div>
      <div className="flex gap-1 border-b border-line-200">
        {([['quotes', 'Quotes'], ['orders', 'Sales orders'], ['challans', 'Delivery challans']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-body font-medium ${tab === id ? 'border-b-2 border-saffron-600 text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>{l}</button>
        ))}
      </div>
      {tab === 'quotes' && <QuotesTab onToast={showToast} />}
      {tab === 'orders' && <OrdersTab onToast={showToast} />}
      {tab === 'challans' && <ChallansTab onToast={showToast} />}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
