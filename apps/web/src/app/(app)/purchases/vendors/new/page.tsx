'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page/page-shell';
import { VendorForm } from '@/components/purchases/vendor-form';

export default function NewVendorPage() {
  const router = useRouter();
  return (
    <div>
      <PageHeader title="New vendor" subtitle="Who you buy from: their GSTIN, the TDS on their bills, and where to pay them." back={{ href: '/purchases/vendors', label: 'Vendors' }} />
      <VendorForm onDone={(id) => router.push(`/purchases/vendors/${id}`)} />
    </div>
  );
}
