'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/page/page-shell';
import { RecordPaymentForm } from '@/components/payments/record-payment-form';

function Form() {
  const params = useSearchParams();
  return <RecordPaymentForm kind="receipt" initialPartyId={params.get('customerId') ?? ''} />;
}

export default function NewReceiptPage() {
  return (
    <div>
      <PageHeader
        title="Record receipt"
        subtitle="Money in from a customer, across as many invoices as it pays. What is left over is held as an advance."
        back={{ href: '/sales/payments-received', label: 'Payments received' }}
      />
      <Suspense fallback={<p className="text-caption text-ink-400">Loading…</p>}>
        <Form />
      </Suspense>
    </div>
  );
}
