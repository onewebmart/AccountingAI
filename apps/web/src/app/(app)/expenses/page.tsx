'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';

interface Account { _id: string; name: string; code: string; type: string; isGroup: boolean; isActive: boolean }
interface ClaimLine { date: string; kind: 'expense' | 'mileage'; merchant: string | null; description: string; expenseAccountId: string; amountPaise: number; gstPaise: number; merchantGstin: string | null; km: number | null; receiptId: string | null }
interface Claim { _id: string; number: string; employeeName: string; employeeId: string; title: string; status: 'draft' | 'submitted' | 'approved' | 'posted' | 'paid'; lines: ClaimLine[]; totalPaise: number; flags: Array<{ line: number; message: string }>; sentBackReason: string | null; paidOn: string | null }

interface EditLine { date: string; kind: 'expense' | 'mileage'; merchant: string; description: string; expenseAccountId: string; amount: string; gst: string; gstin: string; km: string; receiptId: string | null }

const blank = (): EditLine => ({ date: new Date().toISOString().slice(0, 10), kind: 'expense', merchant: '', description: '', expenseAccountId: '', amount: '', gst: '', gstin: '', km: '', receiptId: null });
const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900';
const STATUS: Record<Claim['status'], { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-surface-sink text-ink-600' },
  submitted: { label: 'Waiting for approval', className: 'bg-pending-bg text-pending-fg' },
  approved: { label: 'Approved, to post', className: 'bg-pending-bg text-pending-fg' },
  posted: { label: 'Posted, to reimburse', className: 'bg-success-bg text-success-fg' },
  paid: { label: 'Reimbursed', className: 'bg-success-bg text-success-fg' },
};

function toApi(lines: EditLine[]) {
  return lines.filter((l) => l.description.trim()).map((l) => {
    if (l.kind === 'mileage') return { date: l.date, kind: 'mileage' as const, description: l.description.trim(), expenseAccountId: l.expenseAccountId, km: Number(l.km), receiptId: l.receiptId };
    const amountPaise = parseRupees(l.amount);
    const gstPaise = l.gst.trim() ? parseRupees(l.gst) : 0;
    if (amountPaise === null || gstPaise === null) throw new Error('Enter amounts in rupees, like 1,250.50.');
    return { date: l.date, kind: 'expense' as const, merchant: l.merchant.trim() || null, description: l.description.trim(), expenseAccountId: l.expenseAccountId, amountPaise, gstPaise, merchantGstin: l.gstin.trim() || null, receiptId: l.receiptId };
  });
}

const fromClaim = (c: Claim): EditLine[] => c.lines.map((l) => ({
  date: l.date, kind: l.kind, merchant: l.merchant ?? '', description: l.description, expenseAccountId: l.expenseAccountId, amount: String(l.amountPaise / 100), gst: l.gstPaise ? String(l.gstPaise / 100) : '', gstin: l.merchantGstin ?? '', km: l.km ? String(l.km) : '', receiptId: l.receiptId,
}));

function LinesEditor({ lines, onChange, accounts, claimId }: { lines: EditLine[]; onChange: (l: EditLine[]) => void; accounts: Account[]; claimId: string | null }) {
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const fileFor = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    const i = fileFor.current;
    if (i === null || !claimId) return;
    const body = new FormData();
    body.append('entityType', 'ExpenseClaim');
    body.append('entityId', claimId);
    body.append('file', file);
    const saved = await api.post<{ _id: string }>('/attachments', body);
    set(i, { receiptId: saved._id });
  };
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-2">
          <input type="date" className={`${cell} col-span-2`} value={l.date} onChange={(e) => set(i, { date: e.target.value })} />
          <select className={`${cell} col-span-1`} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as EditLine['kind'] })}>
            <option value="expense">Spent</option>
            <option value="mileage">Km</option>
          </select>
          <input className={`${cell} col-span-3`} placeholder={l.kind === 'mileage' ? 'Trip' : 'What for'} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          <select className={`${cell} col-span-2`} value={l.expenseAccountId} onChange={(e) => set(i, { expenseAccountId: e.target.value })}>
            <option value="">Account…</option>
            {accounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
          {l.kind === 'mileage' ? (
            <input className={`${cell} col-span-2 font-mono`} inputMode="decimal" placeholder="km" value={l.km} onChange={(e) => set(i, { km: e.target.value })} />
          ) : (
            <>
              <input className={`${cell} col-span-1 font-mono`} inputMode="decimal" placeholder="₹ paid" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
              <input className={`${cell} col-span-1 font-mono`} inputMode="decimal" placeholder="₹ GST" value={l.gst} onChange={(e) => set(i, { gst: e.target.value })} />
            </>
          )}
          <div className="col-span-1 flex items-center gap-2">
            {claimId && l.kind === 'expense' && (
              <button type="button" title={l.receiptId ? 'Receipt attached' : 'Attach receipt'} className={l.receiptId ? 'text-success-fg' : 'text-ink-400 hover:text-ink-700'} onClick={() => { fileFor.current = i; input.current?.click(); }}>
                <Paperclip size={14} />
              </button>
            )}
            <button type="button" aria-label="Remove line" className="text-ink-400 hover:text-error-fg" onClick={() => onChange(lines.filter((_, n) => n !== i))}><X size={14} /></button>
          </div>
          {l.kind === 'expense' && Number(l.gst || 0) > 0 && (
            <input className={`${cell} col-span-4 col-start-4 font-mono`} placeholder="Merchant's GSTIN (to claim the GST)" value={l.gstin} onChange={(e) => set(i, { gstin: e.target.value.toUpperCase() })} />
          )}
        </div>
      ))}
      <input ref={input} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline" onClick={() => onChange([...lines, blank()])}><Plus size={12} /> Add a line</button>
    </div>
  );
}

function ClaimCard({ c, accounts, onToast }: { c: Claim; accounts: Account[]; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<EditLine[]>(fromClaim(c));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['expense-claims'] });
  const save = useMutation({ mutationFn: () => api.patch(`/expense-claims/${c._id}`, { lines: toApi(lines) }), onSuccess: () => { refresh(); onToast('Claim saved'); } });
  const act = useMutation({
    mutationFn: async (action: 'submit' | 'post' | 'reimburse') => {
      if (action === 'submit') await api.patch(`/expense-claims/${c._id}`, { lines: toApi(lines) });
      return api.post(`/expense-claims/${c._id}/${action}`, {});
    },
    onSuccess: (_r, action) => { refresh(); onToast(action === 'submit' ? 'Claim submitted for approval' : action === 'post' ? 'Posted to ledger' : 'Reimbursement posted to ledger'); },
  });
  const s = STATUS[c.status];
  return (
    <li className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-ink-900"><span className="font-mono text-caption">{c.number}</span> · {c.employeeName} · {c.title}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-body">{formatPaise(c.totalPaise)}</span>
          <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${s.className}`}>{s.label}</span>
        </div>
      </div>
      {c.sentBackReason && c.status === 'draft' && <p className="mt-2 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">Sent back: {c.sentBackReason}</p>}
      {c.status === 'draft' ? (
        <div className="mt-3 space-y-2">
          <LinesEditor lines={lines} onChange={setLines} accounts={accounts} claimId={c._id} />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('submit')}>Submit claim</Button>
          </div>
        </div>
      ) : (
        <ul className="mt-2 space-y-0.5 text-caption text-ink-600">
          {c.lines.map((l, i) => <li key={i}>{l.date} · {l.kind === 'mileage' ? `${l.km} km` : l.merchant ?? ''} · {l.description} · <span className="font-mono">{formatPaise(l.amountPaise)}</span>{l.receiptId ? ' · receipt' : ''}</li>)}
        </ul>
      )}
      {c.flags.length > 0 && c.status !== 'draft' && (
        <ul className="mt-2 space-y-0.5 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">{c.flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
      )}
      <div className="mt-2 flex gap-2">
        {c.status === 'submitted' && <Link className="text-caption text-ink-600 underline" href="/approvals">Waiting on the Approvals page</Link>}
        {c.status === 'approved' && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('post')}>Post claim</Button>}
        {c.status === 'posted' && <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('reimburse')}>Record reimbursement</Button>}
      </div>
      {(save.error || act.error) && <p className="mt-2 text-caption text-error-fg">{message(save.error ?? act.error)}</p>}
    </li>
  );
}

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blank()]);
  const claims = useQuery({ queryKey: ['expense-claims'], queryFn: () => api.get<Claim[]>('/expense-claims') });
  const accountsQ = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => api.get<Account[]>('/gl/accounts'), retry: false });
  const accounts = (accountsQ.data ?? []).filter((a) => !a.isGroup && a.isActive && a.type === 'EXPENSE');
  const create = useMutation({
    mutationFn: () => api.post('/expense-claims', { title: title.trim(), lines: toApi(lines) }),
    onSuccess: () => { setCreating(false); setTitle(''); setLines([blank()]); void qc.invalidateQueries({ queryKey: ['expense-claims'] }); showToast('Claim saved as a draft: attach receipts, then submit'); },
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h1 font-display text-ink-900">Expense claims</h1>
          <p className="text-body text-ink-500">What you paid for the business. Someone else approves it, an accountant posts it, and the reimbursement clears it.</p>
        </div>
        <Button onClick={() => setCreating(!creating)}><Plus size={14} /> New claim</Button>
      </div>
      {creating && (
        <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
          <input className="w-full rounded-md border border-line-200 px-3 py-2 text-body" placeholder="Client visit, Pune" value={title} onChange={(e) => setTitle(e.target.value)} />
          <LinesEditor lines={lines} onChange={setLines} accounts={accounts} claimId={null} />
          {create.isError && <p className="text-caption text-error-fg">{message(create.error)}</p>}
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Save claim'}</Button>
        </section>
      )}
      <ul className="space-y-3">
        {(claims.data ?? []).map((c) => <ClaimCard key={c._id} c={c} accounts={accounts} onToast={showToast} />)}
      </ul>
      {claims.data?.length === 0 && <p className="text-body text-ink-500">No claims yet.</p>}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
