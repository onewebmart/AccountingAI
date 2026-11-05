'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocumentForm } from '@/components/sales/doc-form';

/**
 * A recurring invoice: a retainer, a rent, a subscription, every week to
 * every year. Each one is drafted on its date for a person to check and
 * post; nothing posts itself.
 */
export default function NewRecurringInvoicePage() {
  return (
    <div>
      <PageHeader
        title="New recurring invoice"
        subtitle="Each one is drafted on its date for you to check and post. Nothing posts on its own."
        back={{ href: '/sales/recurring-invoices', label: 'Recurring invoices' }}
      />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <SalesDocumentForm kind="recurring" />
      </Suspense>
    </div>
  );
}
