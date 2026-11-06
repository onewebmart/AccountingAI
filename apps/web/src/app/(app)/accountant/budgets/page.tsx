'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page/page-shell';
import { BudgetsList } from '@/components/reports/budgets-list';

/** Named budgets, several a year; budget against actual reads the one chosen, or the year's default. */
export default function BudgetsPage() {
  return (
    <div>
      <PageHeader
        guide="budgets"
        title="Budgets"
        subtitle={<>Plans for income and expense accounts, and balance-sheet accounts if you like, by month, quarter, half-year or year. Compare one with what happened in <Link href="/reports/management?report=budget_vs_actual" className="underline">Budget against actual</Link>.</>}
        actions={<Link href="/accountant/budgets/new"><Button><Plus size={14} /> New budget</Button></Link>}
      />
      <BudgetsList />
    </div>
  );
}
