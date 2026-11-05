'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocForm } from '@/components/sales/doc-form';
import { DocumentEntry } from '@/components/documents/document-entry';

/** Opened from a scan (?document=), the file shows beside the form, which starts filled from it. */
export default function Page({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New quote" subtitle="A quote is not an invoice" back={{ href: '/sales/quotes', label: 'Quotes' }} />
        <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
          <SalesDocForm kind="quote" />
        </Suspense>
      </div>
    </DocumentEntry>
  );
}
