'use client';

import Link from 'next/link';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

export type ExpenseTab = 'expense' | 'mileage' | 'bulk';

const TABS: Array<[ExpenseTab, string]> = [
  ['expense', 'Record Expense'],
  ['mileage', 'Record Mileage'],
  ['bulk', 'Bulk Add Expenses'],
];

export const expenseTabHref = (tab: ExpenseTab, documentId?: string | null) =>
  tab === 'expense' ? (documentId ? `/purchases/expenses/new?document=${documentId}` : '/purchases/expenses/new') : `/purchases/expenses/new?tab=${tab}`;

/** The three ways to enter expenses, as tabs under the page's title. A scan opened beside the form stays with Record Expense. */
export function ExpenseTabs({ active, documentId }: { active: ExpenseTab; documentId?: string | null }) {
  return (
    <div role="tablist" aria-label="How to enter it" className="-mt-2 mb-5 flex gap-6 border-b border-line-200">
      {TABS.map(([key, label]) => (
        <Link
          key={key}
          role="tab"
          aria-selected={active === key}
          href={expenseTabHref(key, documentId)}
          className={cn(
            '-mb-px border-b-2 px-0.5 pb-2.5 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
            active === key ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900',
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

/** Changing the mileage preferences is a settings change: org managers only, as on the server. */
export function useCanManageSettings() {
  const { user } = useAuth();
  return !!user && hasPermission(user.role as UserRole, Permission.MANAGE_ORG);
}
