'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocForm } from '@/components/sales/doc-form';

export default function Page() {
  return (
    <div>
      <PageHeader title="New quote" subtitle="A quote is not an invoice" back={{ href: '/sales/quotes', label: 'Quotes' }} />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <SalesDocForm kind="quote" />
      </Suspense>
    </div>
  );
}
