'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ItemOption {
  _id: string;
  name: string;
  code: string | null;
  kind: 'goods' | 'service';
  hsnSac: string | null;
  hsnSource: { by: 'person' | 'history' | 'rule' | 'model'; reason: string | null; confidence: number | null } | null;
  uqc: string;
  gstRatePct: number | null;
  salePricePaise: number | null;
  purchasePricePaise: number | null;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  description: string | null;
  isActive: boolean;
}

export function useItems(includeArchived = false) {
  return useQuery({
    queryKey: ['items', { includeArchived }],
    queryFn: () => api.get<ItemOption[]>(`/items${includeArchived ? '?archived=true' : ''}`),
  });
}

/**
 * Pick an item for a line. Optional: a line can still be typed by hand.
 * Picking fills the line; anything the person then changes stays changed.
 */
export function ItemSelect({
  value,
  onPick,
  className,
}: {
  value: string;
  onPick: (item: ItemOption | null) => void;
  className?: string;
}) {
  const { data, isLoading } = useItems();
  const items = data ?? [];
  return (
    <select
      className={className}
      value={value}
      disabled={isLoading}
      onChange={(e) => onPick(items.find((i) => i._id === e.target.value) ?? null)}
    >
      <option value="">{isLoading ? 'Loading items…' : items.length ? 'No item (type the line)' : 'No items yet'}</option>
      {items.map((i) => (
        <option key={i._id} value={i._id}>
          {i.name}
          {i.hsnSac ? ` · ${i.hsnSac}` : ''}
        </option>
      ))}
    </select>
  );
}
