'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableError } from '@/components/ui/query-error';
import { EmptyState, ListToolbar, PageHeader, StatusChip, TableCard, rowLink, td, tdMoney, th } from '@/components/page/page-shell';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { CLAIM_STATUS, type Claim } from '@/components/purchases/claim-lines';
import { shortDate } from '@/components/purchases/purchase-data';

/** Employees' claims for what they paid for the business: approved by someone else, posted, reimbursed. */
export default function ClaimsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const claims = useQuery({ queryKey: ['expense-claims'], queryFn: () => api.get<Claim[]>('/expense-claims') });
  const all = claims.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((c) => status === 'all' || c.status === status).filter((c) => !q || [c.number, c.employeeName, c.title].some((s) => s.toLowerCase().includes(q)));
  const count = (s: Claim['status']) => all.filter((c) => c.status === s).length;

  return (
    <div>
      <PageHeader
        title="Employee claims"
        subtitle="What people paid for the business. Someone else approves each claim, an accountant posts it, and the reimbursement clears it."
        actions={<Button asChild><Link href="/purchases/claims/new"><Plus size={14} /> New claim</Link></Button>}
      />
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search number, employee or title"
        filters={{
          value: status,
          onChange: setStatus,
          options: [
            ['all', 'All'],
            ['draft', 'Drafts'],
            ['submitted', `Waiting for approval${count('submitted') ? ` · ${count('submitted')}` : ''}`],
            ['approved', `To post${count('approved') ? ` · ${count('approved')}` : ''}`],
            ['posted', `To reimburse${count('posted') ? ` · ${count('posted')}` : ''}`],
            ['paid', 'Reimbursed'],
          ],
        }}
      />
      {claims.data && all.length === 0 ? (
        <EmptyState title="No claims yet" body="Paid for a taxi, a client lunch or stationery yourself? Claim it here with the receipts." action={<Button asChild><Link href="/purchases/claims/new">New claim</Link></Button>} />
      ) : (
        <TableCard>
          <table className="w-full">
            <thead className="border-b border-line-200 bg-surface-sink">
              <tr>
                <th className={th}>Claim</th>
                <th className={th}>Employee</th>
                <th className={th}>Title</th>
                <th className={th}>Lines</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {claims.isLoading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-400">Loading…</td></tr>
              ) : claims.isError ? (
                <TableError error={claims.error} colSpan={6} onRetry={() => void claims.refetch()} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-caption text-ink-500">No claims here.</td></tr>
              ) : (
                rows.map((c) => {
                  const s = CLAIM_STATUS[c.status];
                  return (
                    <tr key={c._id} className={rowLink} onClick={() => router.push(`/purchases/claims/${c._id}`)}>
                      <td className={`${td} font-mono text-caption`}>
                        <Link href={`/purchases/claims/${c._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{c.number}</Link>
                      </td>
                      <td className={td}>{c.employeeName}</td>
                      <td className={td}>
                        {c.title}
                        {c.sentBackReason && c.status === 'draft' && <span className="block text-caption text-pending-fg">Sent back: {c.sentBackReason}</span>}
                      </td>
                      <td className={`${td} text-caption`}>{c.lines.length}{c.lines[0] ? ` · from ${shortDate(c.lines[0].date)}` : ''}</td>
                      <td className={td}><StatusChip tone={s.tone}>{s.label}</StatusChip></td>
                      <td className={tdMoney}>{formatPaise(c.totalPaise)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  );
}
