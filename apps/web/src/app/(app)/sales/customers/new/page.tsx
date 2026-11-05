'use client';

import { PageHeader } from '@/components/page/page-shell';
import { CustomerForm } from '@/components/sales/customer-form';

export default function NewCustomerPage() {
  return (
    <div>
      <PageHeader title="New customer" subtitle="Their GSTIN or state decides the tax on every invoice to them." back={{ href: '/sales/customers', label: 'Customers' }} />
      <CustomerForm />
    </div>
  );
}
