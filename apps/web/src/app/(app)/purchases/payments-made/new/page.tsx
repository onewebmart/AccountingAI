'use client';

import { PageHeader } from '@/components/page/page-shell';
import { RecordPaymentForm } from '@/components/payments/record-payment-form';

/**
 * One payment to a vendor, across as many of their open bills as it pays.
 * What is not applied is held as an advance. A payment policy may hold it
 * for approval. Bills in a foreign currency are paid on their own, below.
 */
export default function NewPaymentPage({ searchParams }: { searchParams: { vendorId?: string } }) {
  return (
    <div>
      <PageHeader title="Record payment" subtitle="Money out to a vendor, across as many bills as it pays. What is left over is held as an advance." back={{ href: '/purchases/payments-made', label: 'Payments made' }} />
      <RecordPaymentForm kind="payment" initialPartyId={searchParams.vendorId ?? ''} />
    </div>
  );
}
