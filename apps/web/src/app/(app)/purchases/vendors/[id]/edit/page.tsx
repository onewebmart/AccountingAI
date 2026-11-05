'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader } from '@/components/page/page-shell';
import { VendorForm } from '@/components/purchases/vendor-form';
import { api } from '@/lib/api';
import type { VendorRecord } from '@/components/purchases/purchase-data';

export default function EditVendorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const vendor = useQuery({ queryKey: ['purchase', 'vendor', id], queryFn: () => api.get<VendorRecord>(`/purchase/vendors/${id}`) });
  return (
    <div>
      <PageHeader title={vendor.data ? `Edit ${vendor.data.name}` : 'Edit vendor'} back={{ href: `/purchases/vendors/${id}`, label: vendor.data?.name ?? 'Vendor' }} />
      {vendor.isError ? (
        <QueryError error={vendor.error} onRetry={() => void vendor.refetch()} />
      ) : vendor.data ? (
        <VendorForm key={vendor.data._id} vendor={vendor.data} onDone={(vid) => router.push(`/purchases/vendors/${vid}`)} />
      ) : (
        <p className="text-caption text-ink-400">Loading…</p>
      )}
    </div>
  );
}
