'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader } from '@/components/page/page-shell';
import { CustomerForm } from '@/components/sales/customer-form';
import type { CustomerRecord } from '@/components/sales/sales-data';
import { api } from '@/lib/api';

export default function EditCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const customer = useQuery({ queryKey: ['sales', 'customer', id], queryFn: () => api.get<CustomerRecord>(`/sales/customers/${id}`) });

  return (
    <div>
      <PageHeader title={customer.data ? `Edit ${customer.data.name}` : 'Edit customer'} back={{ href: `/sales/customers/${id}`, label: customer.data?.name ?? 'Customer' }} />
      {customer.isLoading && <p className="text-caption text-ink-400">Loading…</p>}
      {customer.isError && <QueryError error={customer.error} onRetry={() => void customer.refetch()} />}
      {/* Keyed so the form starts from the saved details, not an earlier load. */}
      {customer.data && <CustomerForm key={customer.data._id} customer={customer.data} />}
    </div>
  );
}
