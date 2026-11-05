'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page/page-shell';
import { ItemForm } from '@/components/items/item-form';

export default function NewItemPage() {
  const router = useRouter();
  return (
    <div>
      <PageHeader
        title="New item"
        subtitle="Something you sell or buy. Pick it on a line and its code, unit, GST rate, price and account fill in."
        back={{ href: '/items', label: 'Items' }}
      />
      <ItemForm onDone={() => router.push('/items')} />
    </div>
  );
}
