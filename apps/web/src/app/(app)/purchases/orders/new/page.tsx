'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { PurchaseDocumentForm } from '@/components/purchases/purchase-doc-form';
import { DocumentEntry } from '@/components/documents/document-entry';

/**
 * A purchase order to a vendor, laid out in full: the vendor, where the goods
 * go, the number, terms and shipment, the lines with the account each will be
 * booked to, the discount and adjustment, and the notes and terms. It posts
 * nothing: goods are received against it, and the bill made from it carries
 * its accounts and discount. Opened from a scan (?document=), the file shows
 * beside the form, which starts filled from it.
 */
export default function NewPurchaseOrderPage({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New purchase order" subtitle="Numbered when saved. Send it to the vendor from its page." back={{ href: '/purchases/orders', label: 'Purchase orders' }} />
        <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
          <PurchaseDocumentForm kind="purchase_order" />
        </Suspense>
      </div>
    </DocumentEntry>
  );
}
