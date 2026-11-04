'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { useItems } from '@/components/items/item-picker';

type Tab = 'projects' | 'time';
interface Alert { level: 'warn' | 'over'; text: string }
interface Project {
  id: string; name: string; code: string | null; status: 'active' | 'on_hold' | 'completed'; billing: 'time' | 'fixed';
  customerId: string | null; customerName: string | null; budgetPaise: number | null; budgetHours: number | null; ratePaise: number | null; serviceItemId: string | null;
  incomePaise: number; costPaise: number; profitPaise: number; hours: number; unbilledHours: number; unbilledPaise: number; alerts: Alert[]; notes: string | null;
}
interface Entry { id: string; projectId: string; projectName: string; userId: string; userName: string; date: string; hours: number; task: string; notes: string | null; billable: boolean; ratePaise: number | null; status: 'unbilled' | 'billing' | 'billed'; invoiceId: string | null }
interface Customer { _id: string; name: string }

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const label = 'mb-1 block text-caption font-medium text-ink-700';
const today = () => new Date().toISOString().slice(0, 10);
const STATUS: Record<Project['status'], { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success-bg text-success-fg' },
  on_hold: { label: 'On hold', className: 'bg-surface-sink text-ink-600' },
  completed: { label: 'Completed', className: 'bg-surface-sink text-ink-500' },
};

function ProjectForm({ project, onDone, onCancel }: { project: Project | null; onDone: () => void; onCancel: () => void }) {
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/sales/customers'), retry: false });
  const services = (useItems().data ?? []).filter((i) => i.kind === 'service' && i.isActive);
  const rs = (p: number | null) => (p == null ? '' : String(p / 100));
  const [f, setF] = useState({
    name: project?.name ?? '', code: project?.code ?? '', customerId: project?.customerId ?? '', billing: project?.billing ?? 'time',
    budget: rs(project?.budgetPaise ?? null), budgetHours: project?.budgetHours == null ? '' : String(project.budgetHours), rate: rs(project?.ratePaise ?? null), serviceItemId: project?.serviceItemId ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const money = (v: string, what: string) => {
        if (!v.trim()) return null;
        const p = parseRupees(v);
        if (p === null) throw new Error(`Enter the ${what} in rupees.`);
        return p;
      };
      const body = {
        name: f.name.trim(), code: f.code.trim() || null, customerId: f.customerId || null, billing: f.billing,
        budgetPaise: money(f.budget, 'budget'), budgetHours: f.budgetHours.trim() ? Number(f.budgetHours) : null, ratePaise: money(f.rate, 'rate per hour'), serviceItemId: f.serviceItemId || null,
      };
      return project ? api.patch(`/projects/${project.id}`, body) : api.post('/projects', body);
    },
    onSuccess: onDone,
  });
  return (
    <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="text-h3 font-display text-ink-900">{project ? 'Edit project' : 'New project'}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2"><label className={label}>Name</label><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Website redesign" /></div>
        <div><label className={label}>Code</label><input className={`${field} font-mono`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div>
          <label className={label}>Customer</label>
          <select className={field} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}>
            <option value="">Internal work</option>
            {(customers.data ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Billed</label>
          <select className={field} value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value as 'time' | 'fixed' })}>
            <option value="time">By the hour, from timesheets</option>
            <option value="fixed">A fixed fee</option>
          </select>
        </div>
        <div><label className={label}>Rate per hour (₹)</label><input className={`${field} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
        <div><label className={label}>{f.billing === 'fixed' ? 'Fee (₹)' : 'Budget cap (₹)'}</label><input className={`${field} font-mono`} inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></div>
        <div><label className={label}>Budgeted hours</label><input className={`${field} font-mono`} inputMode="decimal" value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: e.target.value })} /></div>
        <div>
          <label className={label}>Invoiced as</label>
          <select className={field} value={f.serviceItemId} onChange={(e) => setF({ ...f, serviceItemId: e.target.value })}>
            <option value="">Choose a service item…</option>
            {services.map((i) => <option key={i._id} value={i._id}>{i.name}{i.hsnSac ? ` · SAC ${i.hsnSac}` : ''}</option>)}
          </select>
        </div>
      </div>
      {save.isError && <p className="text-caption text-error-fg">{message(save.error)}</p>}
      <div className="flex gap-2">
        <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : project ? 'Save project' : 'Create project'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-caption text-ink-500">The service item gives time on an invoice its SAC code, GST rate and income account.</p>
    </section>
  );
}

function ProjectDetail({ project, onToast }: { project: Project; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [wording, setWording] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<string | null>(null);
  const unbilled = useQuery({ queryKey: ['projects', project.id, 'unbilled'], queryFn: () => api.get<{ lines: Array<{ description: string; hours: number; ratePaise: number; amountPaise: number; entries: number }>; unpriced: number }>(`/projects/${project.id}/unbilled`) });
  const entries = useQuery({ queryKey: ['projects', project.id, 'time'], queryFn: () => api.get<Entry[]>(`/projects/time/entries?projectId=${project.id}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['projects'] });
  const bill = useMutation({
    mutationFn: () => api.post<{ invoiceId: string; hours: number; lines: number; wording: string | null }>(`/projects/${project.id}/invoice`, {}),
    onSuccess: (r) => { refresh(); setDrafted(r.invoiceId); setWording(r.wording); onToast(`Invoice drafted: ${r.hours} hours on ${r.lines} line${r.lines === 1 ? '' : 's'}`); },
  });
  const status = useMutation({ mutationFn: (s: Project['status']) => api.post(`/projects/${project.id}/status`, { status: s }), onSuccess: () => { refresh(); onToast('Project updated'); } });
  // AI words the lines in a background job: check back until it has.
  const poll = useQuery({
    queryKey: ['projects', 'wording', wording],
    queryFn: () => api.get<{ status: string; reason: string | null }>(`/projects/time/wording/${wording}`),
    enabled: !!wording,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'queued' ? false : 1500),
  });
  useEffect(() => {
    if (poll.data && poll.data.status !== 'queued') setWording(null);
  }, [poll.data]);
  const total = (unbilled.data?.lines ?? []).reduce((s, l) => s + l.amountPaise, 0);

  if (editing) return <ProjectForm project={project} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); refresh(); onToast('Project saved'); }} />;
  return (
    <section className="space-y-4 rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-h3 font-display text-ink-900">{project.name}</h3>
          <p className="text-caption text-ink-500">{project.customerName ?? 'Internal work'} · {project.billing === 'time' ? `by the hour${project.ratePaise ? ` at ${formatPaise(project.ratePaise)}` : ''}` : 'fixed fee'}</p>
        </div>
        <div className="flex gap-3 text-caption">
          <button className="text-ink-600 hover:underline" onClick={() => setEditing(true)}>Edit</button>
          {project.status !== 'active' && <button className="text-ink-600 hover:underline" onClick={() => status.mutate('active')}>Reopen</button>}
          {project.status === 'active' && <button className="text-ink-600 hover:underline" onClick={() => status.mutate('on_hold')}>Put on hold</button>}
          {project.status !== 'completed' && <button className="text-ink-600 hover:underline" onClick={() => status.mutate('completed')}>Mark completed</button>}
        </div>
      </div>

      {project.customerId && (
        <div className="rounded-md border border-line-200 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-body font-medium text-ink-900">Unbilled time</h4>
            <Button size="sm" disabled={!unbilled.data?.lines.length || bill.isPending} onClick={() => bill.mutate()}>{bill.isPending ? 'Drafting…' : 'Draft invoice from time'}</Button>
          </div>
          {unbilled.data?.lines.length ? (
            <table className="w-full text-caption">
              <tbody>
                {unbilled.data.lines.map((l) => (
                  <tr key={l.description} className="border-b border-line-100 last:border-0">
                    <td className="py-1 text-ink-900">{l.description}</td>
                    <td className="py-1 text-right font-mono">{l.hours} h × {formatPaise(l.ratePaise)}</td>
                    <td className="py-1 text-right font-mono text-ink-900">{formatPaise(l.amountPaise)}</td>
                  </tr>
                ))}
                <tr><td className="py-1 font-medium">Before GST</td><td /><td className="py-1 text-right font-mono font-medium">{formatPaise(total)}</td></tr>
              </tbody>
            </table>
          ) : <p className="text-caption text-ink-500">No billable time waiting.</p>}
          {!!unbilled.data?.unpriced && <p className="mt-1 text-caption text-pending-fg">{unbilled.data.unpriced} entr{unbilled.data.unpriced === 1 ? 'y has' : 'ies have'} no rate: give the project a rate per hour.</p>}
          {bill.isError && <p className="mt-1 text-caption text-error-fg">{message(bill.error)}</p>}
          {drafted && (
            <p className="mt-2 flex items-center gap-1 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">
              {wording ? <><Loader2 size={12} className="animate-spin" /> AI is wording the lines from the time notes…</> : poll.data?.status === 'done' ? <><Sparkles size={12} /> {poll.data.reason}</> : 'A draft: check it, then post it.'}
              <Link className="ml-1 underline" href="/sales">Open Sales</Link>
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="mb-1 text-body font-medium text-ink-900">Time</h4>
        <table className="w-full text-caption">
          <tbody>
            {(entries.data ?? []).map((e) => (
              <tr key={e.id} className="border-b border-line-100 last:border-0">
                <td className="py-1 font-mono">{e.date}</td>
                <td className="py-1">{e.userName}</td>
                <td className="py-1">{e.task}{e.notes ? <span className="text-ink-500"> · {e.notes}</span> : null}</td>
                <td className="py-1 text-right font-mono">{e.hours} h</td>
                <td className="py-1 text-right text-ink-500">{e.billable ? (e.status === 'billed' ? 'Invoiced' : 'Unbilled') : 'Not billable'}</td>
              </tr>
            ))}
            {entries.data?.length === 0 && <tr><td className="py-2 text-ink-500">No time logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProjectsTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const nudges = useQuery({ queryKey: ['projects', 'nudges'], queryFn: () => api.get<Array<{ userId: string; userName: string; lastDate: string }>>('/projects/time/nudges') });
  const selected = (list.data ?? []).find((p) => p.id === open) ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {nudges.data?.length ? (
          <p className="rounded-md bg-pending-bg px-3 py-2 text-caption text-pending-fg">Nothing logged in the last week by {nudges.data.map((n) => `${n.userName} (last on ${n.lastDate})`).join(', ')}.</p>
        ) : <span />}
        {!creating && <Button onClick={() => setCreating(true)}><Plus size={14} /> New project</Button>}
      </div>
      {creating && <ProjectForm project={null} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['projects'] }); onToast('Project created'); }} />}
      {list.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <thead><tr className="border-b border-line-200 bg-surface-sink">{['Project', 'Income', 'Costs', 'Profit', 'Hours', 'Unbilled', ''].map((h) => <th key={h} className="px-3 py-2 text-left text-caption font-medium text-ink-500">{h}</th>)}</tr></thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className={`cursor-pointer border-b border-line-100 last:border-0 hover:bg-surface-sink ${open === p.id ? 'bg-surface-sink' : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                <td className="px-3 py-2">
                  <p className="text-body text-ink-900">{p.name} <span className={`ml-1 rounded-full px-2 py-0.5 text-caption ${STATUS[p.status].className}`}>{STATUS[p.status].label}</span></p>
                  <p className="text-caption text-ink-500">{p.customerName ?? 'Internal work'}</p>
                  {p.alerts.map((a) => <p key={a.text} className="mt-0.5 text-caption text-pending-fg">{a.level === 'over' ? 'Over budget: ' : ''}{a.text}</p>)}
                </td>
                <td className="px-3 py-2 font-mono text-body">{formatPaise(p.incomePaise)}</td>
                <td className="px-3 py-2 font-mono text-body">{formatPaise(p.costPaise)}</td>
                <td className="px-3 py-2 font-mono text-body text-ink-900">{formatPaise(p.profitPaise)}</td>
                <td className="px-3 py-2 font-mono text-body">{p.hours}</td>
                <td className="px-3 py-2 font-mono text-body">{p.unbilledPaise ? formatPaise(p.unbilledPaise) : '—'}</td>
                <td className="px-3 py-2 text-right text-caption text-ink-500">{open === p.id ? 'Hide' : 'Open'}</td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500" colSpan={7}>No projects yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <ProjectDetail key={selected.id} project={selected} onToast={onToast} />}
      <p className="text-caption text-ink-500">Income and costs come from invoice and bill lines tagged with the project once posted. <Link className="underline" href="/reports/management?report=project_pnl">Profit by project</Link> is also a report you can download or email.</p>
    </div>
  );
}

function TimeTab({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const mine = useQuery({ queryKey: ['projects', 'time', 'mine'], queryFn: () => api.get<Entry[]>('/projects/time/entries?mine=true') });
  const active = (projects.data ?? []).filter((p) => p.status !== 'completed');
  const [f, setF] = useState({ projectId: '', date: today(), hours: '', task: '', notes: '', billable: true });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['projects'] });
  const log = useMutation({
    mutationFn: () => api.post('/projects/time/entries', { projectId: f.projectId, date: f.date, hours: Number(f.hours), task: f.task.trim(), notes: f.notes.trim() || null, billable: f.billable }),
    onSuccess: () => { refresh(); setF({ ...f, hours: '', notes: '' }); onToast('Time logged'); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/projects/time/entries/${id}`), onSuccess: () => { refresh(); onToast('Time entry removed'); } });
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
        <h3 className="text-h3 font-display text-ink-900">Log time</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className={label}>Project</label>
            <select className={field} value={f.projectId} onChange={(e) => { const p = active.find((x) => x.id === e.target.value); setF({ ...f, projectId: e.target.value, billable: p ? p.billing === 'time' : f.billable }); }}>
              <option value="">Choose a project…</option>
              {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className={label}>Date</label><input type="date" className={field} value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div><label className={label}>Hours</label><input className={`${field} font-mono`} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} placeholder="2.5" /></div>
          <div><label className={label}>Task</label><input className={field} value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })} placeholder="Design" /></div>
          <div className="md:col-span-2"><label className={label}>Notes</label><input className={field} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What was done: the invoice lines are worded from these" /></div>
          <label className="flex items-end gap-2 pb-2 text-body text-ink-900"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable</label>
        </div>
        {log.isError && <p className="text-caption text-error-fg">{message(log.error)}</p>}
        <Button disabled={!f.projectId || !(Number(f.hours) > 0) || !f.task.trim() || log.isPending} onClick={() => log.mutate()}>{log.isPending ? 'Saving…' : 'Log time'}</Button>
      </section>
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full">
          <tbody>
            {(mine.data ?? []).map((e) => (
              <tr key={e.id} className="border-b border-line-100 last:border-0">
                <td className="px-3 py-2 font-mono text-caption">{e.date}</td>
                <td className="px-3 py-2 text-body">{e.projectName}</td>
                <td className="px-3 py-2 text-caption">{e.task}{e.notes ? <span className="text-ink-500"> · {e.notes}</span> : null}</td>
                <td className="px-3 py-2 text-right font-mono text-body">{e.hours} h</td>
                <td className="px-3 py-2 text-right text-caption">{e.status === 'unbilled' ? <button className="text-ink-600 hover:underline" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>Remove</button> : <span className="text-ink-500">Invoiced</span>}</td>
              </tr>
            ))}
            {mine.data?.length === 0 && <tr><td className="px-3 py-6 text-body text-ink-500">You have logged no time yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {remove.isError && <p className="text-caption text-error-fg">{message(remove.error)}</p>}
    </div>
  );
}

export default function ProjectsPage() {
  const [tab, setTab] = useState<Tab>('projects');
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 font-display text-ink-900">Projects</h1>
        <p className="text-body text-ink-500">Work for customers and its time: income and costs from tagged lines, and invoices drafted from unbilled hours.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line-200">
        {([['projects', 'Projects'], ['time', 'My time']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-body font-medium ${tab === id ? 'border-b-2 border-saffron-600 text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>{l}</button>
        ))}
      </div>
      {tab === 'projects' && <ProjectsTab onToast={showToast} />}
      {tab === 'time' && <TimeTab onToast={showToast} />}
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-fg bg-success-bg px-4 py-3 text-body text-success-fg shadow-lg">{toast}</div>}
    </div>
  );
}
