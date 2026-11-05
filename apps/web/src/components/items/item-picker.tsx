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
  /** What a purchase line says, when it is not the sales description. */
  purchaseDescription?: string | null;
  preferredVendorId?: string | null;
  /** Sold, bought, or both: an item is offered on the documents of its side. */
  forSale?: boolean;
  forPurchase?: boolean;
  trackStock?: boolean;
  reorderLevel?: number | null;
  reorderQty?: number | null;
  isActive: boolean;
}

export type ItemSide = 'sale' | 'purchase';

/** Whether an item is offered on this side's documents. Older items, saved before the flags, are on both. */
export const onSide = (item: ItemOption, side: ItemSide) => (side === 'sale' ? item.forSale !== false : item.forPurchase !== false);

export function useItems(includeArchived = false) {
  return useQuery({
    queryKey: ['items', { includeArchived }],
    queryFn: () => api.get<ItemOption[]>(`/items${includeArchived ? '?archived=true' : ''}`),
  });
}

/**
 * Pick an item for a line. Optional: a line can still be typed by hand.
 * Picking fills the line; anything the person then changes stays changed.
 * Given a side, it offers only the items sold (invoices, quotes, orders,
 * challans) or bought (bills, purchase orders); the line's own item stays.
 */
export function ItemSelect({
  value,
  onPick,
  className,
  side,
}: {
  value: string;
  onPick: (item: ItemOption | null) => void;
  className?: string;
  side?: ItemSide;
}) {
  const { data, isLoading } = useItems();
  const items = (data ?? []).filter((i) => !side || i._id === value || onSide(i, side));
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
