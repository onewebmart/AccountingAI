'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page/page-shell';
import { DraftDueButton, RecurringTable } from '@/components/purchases/recurring';

/** Expenses paid from the bank each period, drafted on their date for a person to post. */
export default function RecurringExpensesPage() {
  return (
    <div>
      <PageHeader
        guide="recurringExpenses"
        title="Recurring expenses"
        subtitle={<>A subscription, a fixed fee, paid straight from the bank. Each is drafted on its date at 6:30, ready to check and post on <Link href="/purchases/expenses" className="underline">Expenses</Link>. Nothing posts on its own.</>}
        actions={
          <>
            <DraftDueButton where="Expenses" />
            <Button asChild><Link href="/purchases/recurring-expenses/new"><Plus size={14} /> New recurring expense</Link></Button>
          </>
        }
      />
      <RecurringTable kind="expense" guide="recurringExpenses" empty="Nothing repeats yet. Add a subscription or a fixed monthly fee, and its expense drafts itself." />
    </div>
  );
}
