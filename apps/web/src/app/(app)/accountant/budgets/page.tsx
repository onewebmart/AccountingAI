'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/page/page-shell';
import { BudgetsEditor } from '@/components/reports/budgets-editor';

/** The budgets grid, the same one the management reports compare against. */
export default function BudgetsPage() {
  return (
    <div>
      <PageHeader
        guide="budgets"
        title="Budgets"
        subtitle={<>A monthly plan for each income and expense account. Compare it with what happened in <Link href="/reports/management?report=budget_vs_actual" className="underline">Management reports</Link>.</>}
      />
      <BudgetsEditor />
    </div>
  );
}
