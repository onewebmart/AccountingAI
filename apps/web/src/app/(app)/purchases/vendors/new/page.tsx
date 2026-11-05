'use client';

import { PageHeader } from '@/components/page/page-shell';
import { VendorForm } from '@/components/purchases/vendor-form';
import { DocumentEntry, useDocumentEntry } from '@/components/documents/document-entry';

type Params = { document?: string; returnTo?: string };

/**
 * A new vendor. Opened from a scan (?document=), the file shows beside the
 * form with the name and GSTIN filled from it; opened from a bill's "Add new
 * vendor" (?returnTo=), saving goes back to that bill with them chosen.
 */
export default function NewVendorPage({ searchParams }: { searchParams: Params }) {
  return (
    <DocumentEntry documentId={searchParams.document} returnTo={searchParams.returnTo} key={searchParams.document ?? ''}>
      <NewVendor />
    </DocumentEntry>
  );
}

function NewVendor() {
  const entry = useDocumentEntry();
  return (
    <div>
      <PageHeader
        title="New vendor"
        subtitle="Who you buy from: their GSTIN, the TDS on their bills, and where to pay them."
        back={entry.returnTo ? { href: entry.returnTo, label: 'Back to the form' } : { href: '/purchases/vendors', label: 'Vendors' }}
      />
      <VendorForm onDone={(id, name) => entry.finish({ entityType: 'Vendor', entityId: id, label: `Vendor ${name}` }, `/purchases/vendors/${id}`)} />
    </div>
  );
}
