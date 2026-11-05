'use client';

import { PageHeader } from '@/components/page/page-shell';
import { CustomerForm } from '@/components/sales/customer-form';
import { DocumentEntry } from '@/components/documents/document-entry';

type Params = { document?: string; returnTo?: string };

/**
 * A new customer. Opened from a scan (?document=), the file shows beside the
 * form with the name and GSTIN filled from it; opened from an invoice's "Add
 * new customer" (?returnTo=), saving goes back to it with them chosen.
 */
export default function NewCustomerPage({ searchParams }: { searchParams: Params }) {
  return (
    <DocumentEntry documentId={searchParams.document} returnTo={searchParams.returnTo} key={searchParams.document ?? ''}>
      <div>
        <PageHeader title="New customer" subtitle="Their GSTIN or state decides the tax on every invoice to them." back={{ href: '/sales/customers', label: 'Customers' }} />
        <CustomerForm />
      </div>
    </DocumentEntry>
  );
}
