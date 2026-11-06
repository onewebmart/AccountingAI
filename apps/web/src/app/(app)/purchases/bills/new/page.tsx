'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { PurchaseDocumentForm } from '@/components/purchases/purchase-doc-form';
import { DocumentEntry } from '@/components/documents/document-entry';

/**
 * A bill typed line by line: the vendor's bill number, the order it is
 * against, the terms that give its due date, each line's account, discount
 * and customer, and the adjustment. In rupees it is priced on the server; in
 * a foreign currency it is converted once at the day's rate, with
 * reverse-charge IGST for imported services. Either way it is saved as a
 * draft, to check and then post. Opened from a scanned bill (?document=), the
 * file shows beside the form, which starts filled from it.
 */
export default function NewBillPage({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New bill" subtitle="Saved as a draft. Nothing reaches the ledger until you post it." back={{ href: '/purchases/bills', label: 'Bills' }} />
        <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
          <PurchaseDocumentForm kind="bill" />
        </Suspense>
      </div>
    </DocumentEntry>
  );
}
