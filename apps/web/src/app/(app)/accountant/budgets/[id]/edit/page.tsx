'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader, StatusChip } from '@/components/page/page-shell';
import { Notice, errorText } from '@/components/accountant/common';
import { BudgetForm, type BudgetDetail } from '@/components/reports/budget-form';
import { budgetReportHref } from '@/components/reports/budgets-list';
import { api } from '@/lib/api';

export default function EditBudgetPage({ params }: { params: { id: string } }) {
  const q = useQuery({ queryKey: ['reports', 'budget', params.id], queryFn: () => api.get<BudgetDetail>(`/reports/budgets/${params.id}`) });
  const b = q.data;
  return (
    <div>
      <PageHeader
        guide="budgets"
        title={b ? `Edit ${b.name}` : 'Edit budget'}
        meta={b?.isDefault ? <StatusChip tone="success">Default for {b.financialYear}</StatusChip> : undefined}
        subtitle={b ? <>FY {b.financialYear}. See it set against the books in <Link href={budgetReportHref(b)} className="underline">Budget against actual</Link>.</> : undefined}
        back={{ href: '/accountant/budgets', label: 'Budgets' }}
      />
      {q.isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Loading the budget…</p>}
      {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}
      {b && b.status === 'archived' && <Notice tone="pending">This budget is archived: restore it from the list to change it.</Notice>}
      {b && b.status === 'active' && <BudgetForm key={b.id} initial={b} />}
    </div>
  );
}
