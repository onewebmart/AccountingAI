'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocForm } from '@/components/sales/doc-form';

export default function Page() {
  return (
    <div>
      <PageHeader title="New delivery challan" subtitle="Goods leaving without a tax invoice: liquid gas, job work, on approval, or invoiced later." back={{ href: '/sales/challans', label: 'Delivery challans' }} />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <SalesDocForm kind="challan" />
      </Suspense>
    </div>
  );
}
