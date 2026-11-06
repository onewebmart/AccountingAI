'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormPage, Section, TableCard, inputClass, td, th } from '@/components/page/page-shell';
import { SearchSelect } from '@/components/page/search-select';
import { notify } from '@/components/page/notifier';
import { useItems } from '@/components/items/item-picker';
import { errorText } from '@/components/accountant/common';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { parseRupees } from '@/lib/money';
import { BILLING_METHODS, revenueBudget, useProjectList, usePeople, type BillingMethod, type Project } from './types';

interface Customer { _id: string; name: string }
interface TaskRow { key: string; id: string | null; name: string; description: string; billable: boolean; rate: string }
interface UserRow { key: string; userId: string; rate: string }

const rs = (p: number | null | undefined) => (p == null ? '' : String(p / 100));
let keySeq = 0;
const key = () => `row-${++keySeq}`;
const cell = 'w-full rounded-md border border-line-200 bg-white px-2.5 py-1.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const blankTask = (): TaskRow => ({ key: key(), id: null, name: '', description: '', billable: true, rate: '' });

/**
 * A project's details, as a page: new or edit. The rate the project bills
 * at follows the billing method: one rate for the project, a rate on each
 * task, or a rate for each person. Saving returns the project's id.
 */
export function ProjectForm({ project, cancelHref, onSaved }: { project: Project | null; cancelHref: string; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/sales/customers'), retry: false });
  const people = usePeople();
  const all = useProjectList();
  const services = (useItems().data ?? []).filter((i) => i.kind === 'service' && (i.isActive || i._id === project?.serviceItemId));

  const [f, setF] = useState({
    name: project?.name ?? '',
    code: project?.code ?? '',
    customerId: project?.customerId ?? '',
    // Projects saved before the four methods say 'time': one rate for the project.
    billing: (!project || (project.billing as string) === 'time' ? 'project_hours' : project.billing) as BillingMethod,
    rate: rs(project?.ratePaise),
    serviceItemId: project?.serviceItemId ?? '',
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
    description: project?.description ?? project?.notes ?? '',
    costBudget: rs(project?.costBudgetPaise),
    revenueBudget: rs(project ? revenueBudget(project) : null),
    hoursBudgetOn: project?.budgetHours != null,
    budgetHours: project?.budgetHours == null ? '' : String(project.budgetHours),
    watchlist: !!project?.watchlist,
  });
  // On a new project, the person making it is on it, as Zoho does.
  const [users, setUsers] = useState<UserRow[]>(() =>
    project ? (project.members ?? []).map((m) => ({ key: key(), userId: m.userId, rate: rs(m.ratePaise) })) : user ? [{ key: key(), userId: user.userId, rate: '' }] : [],
  );
  const [tasks, setTasks] = useState<TaskRow[]>(() =>
    project?.tasks?.length ? project.tasks.map((t) => ({ key: key(), id: t.id, name: t.name, description: t.description ?? '', billable: t.billable, rate: rs(t.ratePaise) })) : [blankTask()],
  );
  const [importFrom, setImportFrom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const byTask = f.billing === 'task_hours';
  const byStaff = f.billing === 'staff_hours';
  const fixed = f.billing === 'fixed';
  const personOf = useMemo(() => new Map((people.data ?? []).map((p) => [p.userId, p])), [people.data]);
  const memberName = (id: string) => personOf.get(id)?.name ?? project?.members?.find((m) => m.userId === id)?.name ?? (id === user?.userId ? user.email : 'Someone');
  const memberEmail = (id: string) => personOf.get(id)?.email ?? project?.members?.find((m) => m.userId === id)?.email ?? (id === user?.userId ? user.email : '');
  const others = (all.data ?? []).filter((p) => p.id !== project?.id && (p.tasks?.length ?? 0) > 0);

  const setTask = (k: string, patch: Partial<TaskRow>) => setTasks((ts) => ts.map((t) => (t.key === k ? { ...t, ...patch } : t)));
  const setUser = (k: string, patch: Partial<UserRow>) => setUsers((us) => us.map((u) => (u.key === k ? { ...u, ...patch } : u)));

  const importTasks = () => {
    const from = others.find((p) => p.id === importFrom);
    if (!from) return;
    const have = new Set(tasks.map((t) => t.name.trim().toLowerCase()).filter(Boolean));
    const copied = (from.tasks ?? []).filter((t) => !have.has(t.name.trim().toLowerCase()));
    setTasks((ts) => [...ts.filter((t) => t.name.trim() || t.description.trim()), ...copied.map((t) => ({ key: key(), id: null, name: t.name, description: t.description ?? '', billable: t.billable, rate: rs(t.ratePaise) }))]);
    setImportFrom('');
    notify(copied.length ? `${copied.length} task${copied.length === 1 ? '' : 's'} copied from ${from.name}` : `${from.name} has no tasks this project lacks`, copied.length ? 'success' : 'info');
  };

  const save = useMutation({
    mutationFn: async () => {
      const money = (v: string, what: string) => {
        if (!v.trim()) return null;
        const p = parseRupees(v);
        if (p === null || p < 0) throw new Error(`Enter the ${what} in rupees, like 2,500.`);
        return p;
      };
      const hours = f.hoursBudgetOn && f.budgetHours.trim() ? Number(f.budgetHours) : null;
      if (hours !== null && !(hours >= 0)) throw new Error('Enter the budgeted hours as a number.');
      if (f.startDate && f.endDate && f.startDate > f.endDate) throw new Error('The project ends before it starts.');
      const kept = tasks.filter((t) => t.name.trim() || t.description.trim() || t.rate.trim());
      const names = new Set<string>();
      for (const t of kept) {
        if (!t.name.trim()) throw new Error('Give each task a name, or remove the row.');
        if (names.has(t.name.trim().toLowerCase())) throw new Error(`The task "${t.name.trim()}" is listed twice.`);
        names.add(t.name.trim().toLowerCase());
      }
      const chosen = users.filter((u) => u.userId);
      if (new Set(chosen.map((u) => u.userId)).size !== chosen.length) throw new Error('Each person is on the project once.');
      const body = {
        name: f.name.trim(), code: f.code.trim() || null, customerId: f.customerId || null, billing: f.billing,
        ratePaise: money(f.rate, 'rate per hour'), serviceItemId: f.serviceItemId || null, startDate: f.startDate || null, endDate: f.endDate || null,
        description: f.description.trim() || null,
        costBudgetPaise: money(f.costBudget, 'cost budget'), revenueBudgetPaise: money(f.revenueBudget, fixed ? 'fee' : 'revenue budget'), budgetHours: hours,
        watchlist: f.watchlist,
        members: chosen.map((u) => ({ userId: u.userId, ratePaise: money(u.rate, `rate for ${memberName(u.userId)}`) })),
        tasks: kept.map((t) => ({ ...(t.id ? { id: t.id } : {}), name: t.name.trim(), description: t.description.trim() || null, billable: t.billable, ratePaise: money(t.rate, `rate for ${t.name.trim()}`) })),
      };
      const saved = project ? await api.patch<{ _id: string }>(`/projects/${project.id}`, body) : await api.post<{ _id: string }>('/projects', body);
      return project?.id ?? String(saved._id);
    },
    onMutate: () => setError(null),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onSaved(id);
    },
    onError: (err) => setError(errorText(err, "Couldn't save the project.")),
  });

  const rateCol = byTask || byStaff;
  return (
    <FormPage
      onSubmit={() => save.mutate()}
      error={error}
      actions={
        <>
          <Button type="submit" disabled={!f.name.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Save project'}</Button>
          <Button type="button" variant="secondary" asChild><Link href={cancelHref}>Cancel</Link></Button>
        </>
      }
    >
      <Section title="Project">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Project name" required className="md:col-span-2">
            <input className={inputClass} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Website redesign" autoFocus={!project} />
          </Field>
          <Field label="Project code">
            <input className={`${inputClass} font-mono`} value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="WEB-01" />
          </Field>
          <Field label="Customer name" className="md:col-span-2" hint="Leave it as internal work for time that is never invoiced.">
            <SearchSelect
              value={f.customerId}
              onChange={(v) => setF({ ...f, customerId: v })}
              options={(customers.data ?? []).map((c) => ({ value: c._id, label: c.name }))}
              noneLabel="Internal work (no customer)"
              placeholder="Choose a customer"
              searchPlaceholder="Type a customer's name"
              aria-label="Customer name"
            />
          </Field>
          <Field label="Invoiced as" hint="The service item gives time on an invoice its SAC code, GST rate and income account.">
            <select className={inputClass} value={f.serviceItemId} onChange={(e) => setF({ ...f, serviceItemId: e.target.value })}>
              <option value="">Choose a service item…</option>
              {services.map((i) => <option key={i._id} value={i._id}>{i.name}{i.hsnSac ? ` · SAC ${i.hsnSac}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Billing method" required>
            <select className={inputClass} value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value as BillingMethod })}>
              {BILLING_METHODS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </Field>
          {fixed ? (
            <>
              <Field label="Fee (₹)" hint="The agreed price: also the revenue budget.">
                <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.revenueBudget} onChange={(e) => setF({ ...f, revenueBudget: e.target.value })} placeholder="1,50,000" />
              </Field>
              <Field label="Rate per hour (₹)" hint="Optional: for extra time you mark billable.">
                <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
              </Field>
            </>
          ) : f.billing === 'project_hours' ? (
            <Field label="Rate per hour (₹)" className="md:col-span-2" hint="One rate for every hour on the project.">
              <input className={`${inputClass} font-mono md:max-w-[220px]`} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="2,000" />
            </Field>
          ) : (
            <p className="self-end pb-2.5 text-caption text-ink-500 md:col-span-2">
              {byTask ? 'Each task has its own rate per hour: set it under Project tasks.' : 'Each person has their own rate per hour: set it under Users.'}
            </p>
          )}
          <Field label="Starts">
            <input type="date" className={inputClass} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Ends">
            <input type="date" className={inputClass} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Field label="Description" className="md:col-span-3" hint={<span className="font-mono tabular-nums">{f.description.length}/2000</span>}>
            <textarea className={`${inputClass} min-h-[90px]`} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Scope, contacts, anything the team should know" />
          </Field>
        </div>
      </Section>

      <Section title="Budget" description="Alerts show at 80% of a budget and when it is passed.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Cost budget (₹)" hint="Against bills, expenses and journals tagged with the project.">
            <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.costBudget} onChange={(e) => setF({ ...f, costBudget: e.target.value })} />
          </Field>
          {fixed ? (
            <Field label="Revenue budget (₹)" hint="For a fixed fee, the fee above.">
              <input className={`${inputClass} font-mono`} value={f.revenueBudget} disabled readOnly />
            </Field>
          ) : (
            <Field label="Revenue budget (₹)" hint="Against time billed and not yet billed.">
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.revenueBudget} onChange={(e) => setF({ ...f, revenueBudget: e.target.value })} />
            </Field>
          )}
          <div>
            <label className="mb-1 flex items-center gap-2 pt-6 text-body text-ink-900">
              <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={f.hoursBudgetOn} onChange={(e) => setF({ ...f, hoursBudgetOn: e.target.checked })} /> Add budget for project hours
            </label>
            {f.hoursBudgetOn && (
              <input className={`${inputClass} font-mono`} inputMode="decimal" value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: e.target.value })} placeholder="Hours, like 120" aria-label="Budgeted hours" />
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Users"
        description={byStaff ? 'The people on the project, and the rate each one bills at.' : 'The people on the project. A manager can log time for any of them.'}
        actions={<Button type="button" variant="secondary" size="sm" onClick={() => setUsers((us) => [...us, { key: key(), userId: '', rate: '' }])}><Plus size={13} /> Add user</Button>}
      >
        {users.length === 0 ? (
          <p className="text-body text-ink-500">No one yet. Add the people who will work on it.</p>
        ) : (
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={`${th} w-14`}>S.No</th>
                  <th className={th}>User</th>
                  <th className={th}>Email</th>
                  {byStaff && <th className={`${th} w-44 text-right`}>Rate per hour (₹)</th>}
                  <th className={`${th} w-12`} />
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const taken = new Set(users.filter((x) => x.key !== u.key).map((x) => x.userId));
                  return (
                    <tr key={u.key} className="border-b border-line-100 last:border-0 align-middle">
                      <td className={`${td} font-mono tabular-nums text-ink-500`}>{i + 1}</td>
                      <td className={td}>
                        <SearchSelect
                          value={u.userId}
                          onChange={(v) => setUser(u.key, { userId: v })}
                          options={[
                            ...(people.data ?? []).filter((p) => !taken.has(p.userId)).map((p) => ({ value: p.userId, label: p.name, detail: p.email, keywords: p.email })),
                            ...(u.userId && !personOf.has(u.userId) ? [{ value: u.userId, label: memberName(u.userId) }] : []),
                          ]}
                          placeholder="Choose a person"
                          searchPlaceholder="Type a name or email"
                          aria-label={`User ${i + 1}`}
                        />
                      </td>
                      <td className={`${td} text-ink-600`}>{u.userId ? memberEmail(u.userId) : '—'}</td>
                      {byStaff && (
                        <td className={td}>
                          <input className={`${cell} text-right font-mono`} inputMode="decimal" value={u.rate} onChange={(e) => setUser(u.key, { rate: e.target.value })} aria-label={`Rate per hour for user ${i + 1}`} placeholder="0" />
                        </td>
                      )}
                      <td className={`${td} text-right`}>
                        <button type="button" className="rounded p-1.5 text-ink-400 hover:bg-surface-sink hover:text-ink-900" onClick={() => setUsers((us) => us.filter((x) => x.key !== u.key))} aria-label={`Remove user ${i + 1}`}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        )}
        {people.isError && <p className="mt-2 text-caption text-ink-500">The team list could not load: refresh to choose people.</p>}
      </Section>

      <Section
        title="Project tasks"
        description={byTask ? 'The work on the project, and the rate each task bills at. Time is logged to a task.' : 'The work on the project. Time is logged to a task, and billable time starts as each task says.'}
        actions={<Button type="button" variant="secondary" size="sm" onClick={() => setTasks((ts) => [...ts, blankTask()])}><Plus size={13} /> Add project task</Button>}
      >
        {tasks.length > 0 && (
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={`${th} w-14`}>S.No</th>
                  <th className={th}>Task name</th>
                  <th className={th}>Description</th>
                  {byTask && <th className={`${th} w-40 text-right`}>Rate per hour (₹)</th>}
                  <th className={`${th} w-20 text-center`}>Billable</th>
                  <th className={`${th} w-12`} />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={t.key} className="border-b border-line-100 last:border-0 align-middle">
                    <td className={`${td} font-mono tabular-nums text-ink-500`}>{i + 1}</td>
                    <td className={td}>
                      <input className={cell} value={t.name} maxLength={80} onChange={(e) => setTask(t.key, { name: e.target.value })} placeholder="Design" aria-label={`Task name ${i + 1}`} />
                    </td>
                    <td className={td}>
                      <input className={cell} value={t.description} maxLength={500} onChange={(e) => setTask(t.key, { description: e.target.value })} aria-label={`Task description ${i + 1}`} />
                    </td>
                    {byTask && (
                      <td className={td}>
                        <input className={`${cell} text-right font-mono`} inputMode="decimal" value={t.rate} onChange={(e) => setTask(t.key, { rate: e.target.value })} aria-label={`Rate per hour for task ${i + 1}`} placeholder="0" />
                      </td>
                    )}
                    <td className={`${td} text-center`}>
                      <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={t.billable} onChange={(e) => setTask(t.key, { billable: e.target.checked })} aria-label={`Task ${i + 1} is billable`} />
                    </td>
                    <td className={`${td} text-right`}>
                      <button type="button" className="rounded p-1.5 text-ink-400 hover:bg-surface-sink hover:text-ink-900" onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))} aria-label={`Remove task ${i + 1}`}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
        {others.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-caption text-ink-500">Import project tasks from existing projects</span>
            <SearchSelect
              className="w-64"
              value={importFrom}
              onChange={setImportFrom}
              options={others.map((p) => ({ value: p.id, label: p.name, detail: `${p.tasks?.length ?? 0} tasks` }))}
              placeholder="Choose a project"
              searchPlaceholder="Type a project's name"
              aria-label="Project to import tasks from"
            />
            <Button type="button" variant="secondary" size="sm" disabled={!importFrom} onClick={importTasks}><Download size={13} /> Import tasks</Button>
          </div>
        )}
        {!rateCol && tasks.some((t) => t.rate.trim()) && <p className="mt-2 text-caption text-ink-500">Task rates are kept, and used when the project is billed by task hours.</p>}
      </Section>

      <label className="flex items-center gap-2 px-1 text-body text-ink-900">
        <input type="checkbox" className="h-4 w-4 accent-saffron-600" checked={f.watchlist} onChange={(e) => setF({ ...f, watchlist: e.target.checked })} /> Add to the watchlist on my dashboard
      </label>
    </FormPage>
  );
}
