'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { GuideButton, ModuleGuide } from '@/components/guide/module-guide';

interface Request {
  _id: string;
  docType: 'bill' | 'payment' | 'journal' | 'expense_claim';
  summary: string;
  amountPaise: number;
  required: number;
  approvals: Array<{ userId: string; role: string; at: string; note: string | null }>;
  status: 'pending' | 'approved' | 'rejected';
  policyNames: string[];
  risk: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] };
  lastError: string | null;
  postedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface Policy {
  _id: string;
  name: string;
  docType: Request['docType'];
  minAmountPaise: number;
  newVendorOnly: boolean;
  approvalsRequired: 1 | 2;
  approverRoles: string[];
  active: boolean;
}

const DOC: Record<Request['docType'], string> = { bill: 'Bill', payment: 'Payment', journal: 'Voucher', expense_claim: 'Expense claim' };
const ROLES = ['COMPANY_ADMIN', 'ACCOUNTANT', 'CA_REVIEWER', 'FIRM_ADMIN'];
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900';

function RequestCard({ r, onToast }: { r: Request; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['approvals'] });
  const approve = useMutation({
    mutationFn: () => api.post<{ posted: boolean }>(`/approvals/requests/${r._id}/approve`, {}),
    onSuccess: (res) => { refresh(); onToast(res.posted ? 'Approved and posted to ledger' : 'Approved'); },
  });
  const reject = useMutation({ mutationFn: () => api.post(`/approvals/requests/${r._id}/reject`, { reason }), onSuccess: () => { refresh(); onToast('Sent back to the maker'); } });
  const last = r.approvals.length + 1 >= r.required;
  return (
    <li className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body text-ink-900"><span className="mr-2 rounded-full bg-surface-sink px-2 py-0.5 text-caption text-ink-600">{DOC[r.docType]}</span>{r.summary}</p>
        <span className="font-mono text-body text-ink-900">{formatPaise(r.amountPaise)}</span>
      </div>
      <p className="mt-1 text-caption text-ink-500">{r.policyNames.join(', ')} · {r.approvals.length} of {r.required} approval{r.required === 1 ? '' : 's'}</p>
      {r.risk.reasons.length > 0 && (
        <ul className={`mt-2 space-y-0.5 rounded-md p-2 text-caption ${r.risk.level === 'high' ? 'bg-pending-bg text-pending-fg' : 'bg-surface-sink text-ink-600'}`}>
          <li className="font-medium">{r.risk.level === 'high' ? 'High risk: two people must approve' : 'Worth a look'}</li>
          {r.risk.reasons.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      {r.lastError && <p className="mt-2 text-caption text-error-fg">Approved, but it could not post: {r.lastError}</p>}
      {r.status === 'pending' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? 'Approving…' : last ? 'Approve & post' : 'Approve'}</Button>
          {!rejecting ? (
            <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>Send back</Button>
          ) : (
            <>
              <input className="h-9 w-64 rounded-md border border-line-200 px-2 text-caption" placeholder="What needs fixing" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate()}>Send back</Button>
            </>
          )}
          {(approve.error || reject.error) && <span className="text-caption text-error-fg">{message(approve.error ?? reject.error)}</span>}
        </div>
      )}
      {r.status === 'rejected' && <p className="mt-2 text-caption text-ink-500">Sent back: {r.rejectionReason}</p>}
    </li>
  );
}

function Policies({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['approvals', 'policies'], queryFn: () => api.get<Policy[]>('/approvals/policies') });
  const [form, setForm] = useState({ name: '', docType: 'bill' as Request['docType'], min: '', newVendorOnly: false, approvalsRequired: 1 as 1 | 2, roles: [] as string[] });
  const create = useMutation({
    mutationFn: () => api.post('/approvals/policies', { name: form.name.trim(), docType: form.docType, minAmountPaise: form.min.trim() ? parseRupees(form.min) ?? 0 : 0, newVendorOnly: form.newVendorOnly, approvalsRequired: form.approvalsRequired, approverRoles: form.roles }),
    onSuccess: () => { setForm({ ...form, name: '', min: '' }); void qc.invalidateQueries({ queryKey: ['approvals'] }); onToast('Policy saved'); },
  });
  const toggle = useMutation({ mutationFn: (p: Policy) => api.post(`/approvals/policies/${p._id}/${p.active ? 'disable' : 'enable'}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['approvals'] }) });
  return (
    <section className="space-y-3">
      <h2 className="text-h3 font-display text-ink-900">Policies</h2>
      <p className="text-caption text-ink-500">With no policy for a kind of document, it posts as it always has. Under one, whoever made it cannot approve it, and a high-risk one always needs two people.</p>
      <ul className="space-y-1">
        {(list.data ?? []).map((p) => (
          <li key={p._id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-200 bg-surface-card px-3 py-2 text-caption ${p.active ? '' : 'opacity-60'}`}>
            <span>
              <span className="font-medium text-ink-900">{p.name}</span> · {DOC[p.docType]}s{p.minAmountPaise ? ` from ${formatPaise(p.minAmountPaise)}` : ''}{p.newVendorOnly ? ', first bill from a vendor' : ''} · {p.approvalsRequired} approver{p.approvalsRequired === 1 ? '' : 's'}{p.approverRoles.length ? ` (${p.approverRoles.join(', ')})` : ''}
            </span>
            <button className="text-ink-600 hover:underline" onClick={() => toggle.mutate(p)}>{p.active ? 'Turn off' : 'Turn on'}</button>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 rounded-xl border border-line-200 bg-surface-card p-4 md:grid-cols-3">
        <input className={field} placeholder="Bills over ₹50,000" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className={field} value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value as Request['docType'] })}>
          {Object.entries(DOC).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
        </select>
        <input className={`${field} font-mono`} inputMode="decimal" placeholder="From ₹ (blank: all)" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} />
        <select className={field} value={form.approvalsRequired} onChange={(e) => setForm({ ...form, approvalsRequired: Number(e.target.value) as 1 | 2 })}>
          <option value={1}>One approver</option>
          <option value={2}>Two approvers</option>
        </select>
        <div className="flex flex-wrap gap-2 text-caption">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1">
              <input type="checkbox" checked={form.roles.includes(role)} onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, role] : form.roles.filter((x) => x !== role) })} />
              {role.replace('_', ' ').toLowerCase()}
            </label>
          ))}
        </div>
        {form.docType === 'bill' && (
          <label className="flex items-center gap-2 text-caption text-ink-600">
            <input type="checkbox" checked={form.newVendorOnly} onChange={(e) => setForm({ ...form, newVendorOnly: e.target.checked })} /> Only a vendor&apos;s first bill
          </label>
        )}
        <div className="md:col-span-3">
          {create.isError && <p className="mb-2 text-caption text-error-fg">{message(create.error)}</p>}
          <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Save policy'}</Button>
          <span className="ml-3 text-caption text-ink-500">No roles ticked: anyone who may approve postings.</span>
        </div>
      </div>
    </section>
  );
}

export default function ApprovalsPage() {
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const pending = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => api.get<Request[]>('/approvals/requests?status=pending') });
  const done = useQuery({ queryKey: ['approvals', 'done'], queryFn: () => api.get<Request[]>('/approvals/requests') });
  const history = (done.data ?? []).filter((r) => r.status !== 'pending').slice(0, 20);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 font-display text-navy-900">Approvals</h1>
          <p className="text-body text-ink-500">Bills, payments and vouchers waiting for someone other than their maker. The last approval posts it, in that person&apos;s name.</p>
        </div>
        <GuideButton guide="approvals" />
      </div>
      <section className="space-y-3">
        <h2 className="text-h3 font-display text-ink-900">Waiting</h2>
        {(pending.data ?? []).length === 0 ? <p className="text-body text-ink-500">Nothing is waiting for approval.</p> : <ul className="space-y-3">{pending.data!.map((r) => <RequestCard key={r._id} r={r} onToast={showToast} />)}</ul>}
      </section>
      {/* Nothing has ever needed approval: show how maker-checker works. */}
      {pending.data?.length === 0 && done.data?.length === 0 && <ModuleGuide guide="approvals" />}
      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-h3 font-display text-ink-900">Decided</h2>
          <ul className="space-y-1">
            {history.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-200 bg-surface-card px-3 py-2 text-caption">
                <span>{DOC[r.docType]} · {r.summary}</span>
                <span className={r.status === 'approved' ? 'text-success-fg' : 'text-ink-500'}>{r.status === 'approved' ? (r.postedAt ? 'Approved, posted' : 'Approved') : `Sent back: ${r.rejectionReason}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Policies onToast={showToast} />
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
