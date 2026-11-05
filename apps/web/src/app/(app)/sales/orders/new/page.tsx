'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocForm } from '@/components/sales/doc-form';

export default function Page() {
  return (
    <div>
      <PageHeader title="New sales order" subtitle="What the customer ordered. Invoice it in parts as you deliver; nothing posts until an invoice is posted." back={{ href: '/sales/orders', label: 'Sales orders' }} />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <SalesDocForm kind="order" />
      </Suspense>
    </div>
  );
}
