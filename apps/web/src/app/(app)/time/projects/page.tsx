'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { Notice, shortDate } from '@/components/accountant/common';
import { PROJECT_STATUS, hoursText, useProjectList } from '@/components/time/types';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

/** Work for customers: income and costs from tagged lines, time, and what is unbilled. */
export default function ProjectsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const list = useProjectList();
  const nudges = useQuery({ queryKey: ['projects', 'nudges'], queryFn: () => api.get<Array<{ userId: string; userName: string; lastDate: string }>>('/projects/time/nudges'), retry: false });

  const needle = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (p) =>
      (status === 'all' || (status === 'open' ? p.status !== 'completed' : p.status === status)) &&
      (!needle || p.name.toLowerCase().includes(needle) || (p.code ?? '').toLowerCase().includes(needle) || (p.customerName ?? '').toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        guide="projects"
        title="Projects"
        subtitle="Income and costs come from invoice and bill lines tagged with the project once posted; unbilled hours become a draft invoice."
        actions={
          <>
            <Button variant="secondary" asChild><Link href="/time/timesheet">Timesheet</Link></Button>
            <Button asChild><Link href="/time/projects/new"><Plus size={14} /> New project</Link></Button>
          </>
        }
      />
      {!!nudges.data?.length && (
        <Notice tone="pending">
          Nothing logged in the last week by {nudges.data.map((n) => `${n.userName} (last on ${shortDate(n.lastDate)})`).join(', ')}.
        </Notice>
      )}
      <div>
        <ListToolbar
          search={search}
          onSearch={setSearch}
          placeholder="Search project, code or customer"
          filters={{ value: status, onChange: setStatus, options: [['open', 'Open'], ['active', 'Active'], ['on_hold', 'On hold'], ['completed', 'Completed'], ['all', 'All']] }}
        />
        {list.isError && <QueryError error={list.error} onRetry={() => void list.refetch()} />}
        {list.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading projects…</p>
        ) : rows.length === 0 && !list.isError ? (
          <EmptyState
            guide={list.data?.length ? undefined : 'projects'}
            title={list.data?.length ? 'No project matches' : 'No projects yet'}
            body={list.data?.length ? 'Change the search or the status.' : 'Make a project for each piece of customer work, then log time to it.'}
            action={!list.data?.length ? <Button asChild><Link href="/time/projects/new">New project</Link></Button> : undefined}
          />
        ) : (
          <TableCard>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200 bg-surface-sink">
                  <th className={th}>Project</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Income</th>
                  <th className={`${th} text-right`}>Costs</th>
                  <th className={`${th} text-right`}>Profit</th>
                  <th className={`${th} text-right`}>Hours</th>
                  <th className={`${th} text-right`}>Unbilled</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={rowLink} onClick={() => router.push(`/time/projects/${p.id}`)}>
                    <td className={td}>
                      <Link href={`/time/projects/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{p.name}</Link>
                      {p.code && <span className="ml-2 font-mono text-caption text-ink-400">{p.code}</span>}
                      <p className="text-caption text-ink-500">{p.customerName ?? 'Internal work'}</p>
                      {p.alerts.map((a) => <p key={a.text} className="mt-0.5 text-caption text-pending-fg">{a.level === 'over' ? 'Over budget: ' : ''}{a.text}</p>)}
                    </td>
                    <td className={td}><StatusChip tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</StatusChip></td>
                    <td className={tdMoney}>{formatPaise(p.incomePaise)}</td>
                    <td className={tdMoney}>{formatPaise(p.costPaise)}</td>
                    <td className={tdMoney}>{formatPaise(p.profitPaise)}</td>
                    <td className={tdMoney}>{hoursText(p.hours)}</td>
                    <td className={tdMoney}>{p.unbilledPaise ? formatPaise(p.unbilledPaise) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </div>
      <p className="text-caption text-ink-500">
        <Link className="underline" href="/reports/management?report=project_pnl">Profit by project</Link> is also a report you can download or email.
      </p>
    </div>
  );
}
