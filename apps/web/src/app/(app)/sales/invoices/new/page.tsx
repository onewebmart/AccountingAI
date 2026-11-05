'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { SalesDocumentForm } from '@/components/sales/doc-form';
import { DocumentEntry } from '@/components/documents/document-entry';

/**
 * A new invoice, line by line, with its terms, discount and adjustment. In
 * rupees it is taxed on the server for the customer's state; in a foreign
 * currency it is an export under LUT, with no GST. Either way it is saved as
 * a draft: the ledger moves only when someone posts it. Opened from a scan
 * (?document=), the file shows beside the form, which starts filled from it.
 */
export default function NewInvoicePage({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New invoice" subtitle="Saved as a draft for you to check and post." back={{ href: '/sales/invoices', label: 'Invoices' }} />
        <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
          <SalesDocumentForm kind="invoice" />
        </Suspense>
      </div>
    </DocumentEntry>
  );
}
