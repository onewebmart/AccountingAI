'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page/page-shell';
import { DraftDueButton, RecurringTable } from '@/components/purchases/recurring';

/** Bills that repeat: rent, a subscription, a maintenance contract. Each is drafted on its date, for you to post. */
export default function RecurringBillsPage() {
  return (
    <div>
      <PageHeader
        guide="recurringBills"
        title="Recurring bills"
        subtitle={<>Drafted each morning at 6:30, ready to check and post on <Link href="/purchases/bills" className="underline">Bills</Link>. Nothing posts on its own.</>}
        actions={
          <>
            <DraftDueButton where="Bills" />
            <Button asChild><Link href="/purchases/recurring-bills/new"><Plus size={14} /> New recurring bill</Link></Button>
          </>
        }
      />
      <RecurringTable kind="bill" guide="recurringBills" empty="Nothing repeats yet. Add rent or a subscription, and its bill drafts itself each period." />
    </div>
  );
}
