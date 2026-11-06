'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/page/page-shell';
import { PurchaseDocumentForm } from '@/components/purchases/purchase-doc-form';
import { DocumentEntry } from '@/components/documents/document-entry';

/**
 * A vendor credit (our debit note) against a posted bill: item by item, taxed
 * as the bill was, each line coming back off its account; or as an amount
 * before tax, with the tax in the bill's own proportions. Posted when it is
 * raised. Opened from a vendor's scanned credit note (?document=), the file
 * shows beside the form, which starts filled from it.
 */
export default function NewVendorCreditPage({ searchParams }: { searchParams: { document?: string } }) {
  return (
    <DocumentEntry documentId={searchParams.document} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New vendor credit" subtitle="Takes part of a posted bill back. Posted to the ledger when you save it." back={{ href: '/purchases/vendor-credits', label: 'Vendor credits' }} />
        <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
          <PurchaseDocumentForm kind="vendor_credit" />
        </Suspense>
      </div>
    </DocumentEntry>
  );
}
