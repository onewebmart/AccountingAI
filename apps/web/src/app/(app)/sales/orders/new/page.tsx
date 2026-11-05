'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocForm } from '@/components/sales/doc-form';
import { DocumentEntry } from '@/components/documents/document-entry';

/** Opened from a customer's scanned purchase order (?document=), the file shows beside the form, which starts filled from it. */
export default function Page({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New sales order" subtitle="What the customer ordered. Invoice it in parts as you deliver; nothing posts until an invoice is posted." back={{ href: '/sales/orders', label: 'Sales orders' }} />
        <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
          <SalesDocForm kind="order" />
        </Suspense>
      </div>
    </DocumentEntry>
  );
}
