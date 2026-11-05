'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { EmptyState, PageHeader, StatusChip } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { errorText } from '@/components/accountant/common';
import { ItemForm } from '@/components/items/item-form';
import type { ItemOption } from '@/components/items/item-picker';
import { api, ApiError } from '@/lib/api';

export default function EditItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: ['items', 'one', id], queryFn: () => api.get<ItemOption>(`/items/${id}`), retry: false });

  // Archived items stay on the documents that used them, and can no longer be picked.
  const toggle = useMutation({
    mutationFn: (active: boolean) => api.post<ItemOption>(`/items/${id}/${active ? 'archive' : 'restore'}`),
    onSuccess: (_r, active) => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      notify(active ? 'Item archived' : 'Item restored');
    },
    onError: (e) => notify(errorText(e, "Couldn't change the item. Try again."), 'error'),
  });

  if (item.isError) {
    if (item.error instanceof ApiError && item.error.status === 404) {
      return <EmptyState title="No such item" body="It may have been made in another organisation." action={<Button asChild><Link href="/items">Items</Link></Button>} />;
    }
    return <QueryError error={item.error} onRetry={() => void item.refetch()} />;
  }
  const data = item.data;
  return (
    <div>
      <PageHeader
        title={data ? `Edit ${data.name}` : 'Edit item'}
        back={{ href: '/items', label: 'Items' }}
        meta={data && !data.isActive ? <StatusChip tone="neutral">Archived</StatusChip> : undefined}
        subtitle={data && !data.isActive ? 'Archived: it stays on the documents that used it, and cannot be picked on new ones until restored.' : undefined}
        actions={
          data && (
            <Button type="button" variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(data.isActive)}>
              {data.isActive ? <><Archive size={14} /> Archive item</> : <><ArchiveRestore size={14} /> Restore item</>}
            </Button>
          )
        }
      />
      {data ? (
        <ItemForm key={data._id} item={data} onDone={() => router.push('/items')} />
      ) : (
        <p className="text-caption text-ink-400">Loading…</p>
      )}
    </div>
  );
}
