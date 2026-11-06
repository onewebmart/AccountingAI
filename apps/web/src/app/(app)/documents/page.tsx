'use client';

import { AllDocuments } from '@/components/documents/all-documents';

/** Every file in the books: uploads read by the inbox, and files kept against records. */
export default function DocumentsPage() {
  return (
    <AllDocuments
      title="All Documents"
      subtitle="Every file in the books: bills, invoices, receipts and statements that came in, and files kept against records. Each says what it became."
    />
  );
}
