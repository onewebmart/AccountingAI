'use client';

import { PageHeader } from '@/components/page/page-shell';
import { BudgetForm } from '@/components/reports/budget-form';

export default function NewBudgetPage() {
  return (
    <div>
      <PageHeader
        guide="budgets"
        title="New budget"
        subtitle="Name it, pick the year and how you will type the amounts, add the accounts, then fill the grid."
        back={{ href: '/accountant/budgets', label: 'Budgets' }}
      />
      <BudgetForm />
    </div>
  );
}
