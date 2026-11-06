'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { PurchaseDocumentForm } from '@/components/purchases/purchase-doc-form';

/**
 * A bill that repeats, laid out as a bill: the vendor, the profile, how often
 * and from when, the terms, and the lines with their accounts, discounts and
 * customers. Each bill is drafted on its date, priced on the server as a
 * typed bill is, for you to check and post. Nothing posts on its own.
 */
export default function NewRecurringBillPage() {
  return (
    <div>
      <PageHeader title="New recurring bill" subtitle="Drafted on its date for you to check and post. Nothing posts on its own." back={{ href: '/purchases/recurring-bills', label: 'Recurring bills' }} />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <PurchaseDocumentForm kind="recurring_bill" />
      </Suspense>
    </div>
  );
}
