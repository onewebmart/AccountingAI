'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getOrNull } from '@/components/sales/sales-data';
import { StatusChip } from '@/components/page/page-shell';
import type { Amounts } from './purchase-data';

export interface PoLine {
  description: string;
  itemId: string | null;
  hsnSac: string | null;
  uqc: string | null;
  qty: number;
  ratePaise: number;
  amountPaise: number;
  taxRatePct: number;
  receivedQty: number;
  billedQty: number;
}

/** GET /orders/purchase-orders — each PO with what has been received and billed against each line. */
export interface PoRow {
  _id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  date: string;
  expectedBy: string | null;
  status: 'open' | 'closed' | 'cancelled';
  sentAt: string | null;
  amountsPaise: Amounts;
  lines: PoLine[];
  notes: string | null;
}

export interface GrnRow {
  _id: string;
  number: string;
  purchaseOrderId: string;
  poNumber: string | null;
  date: string;
  status: 'received' | 'cancelled';
  vendorChallanNo: string | null;
  lines: Array<{ poLine: number; description: string; qty: number; rejectedQty: number }>;
}

/** One PO with its received and billed quantities; null when this org has no such PO. */
export function usePurchaseOrder(id: string) {
  return useQuery({ queryKey: ['orders', 'purchase-orders', id], queryFn: () => getOrNull<PoRow>(`/orders/purchase-orders/${id}`) });
}

export function usePurchaseOrders() {
  return useQuery({ queryKey: ['orders', 'purchase-orders'], queryFn: () => api.get<PoRow[]>('/orders/purchase-orders') });
}

export function useGrns() {
  return useQuery({ queryKey: ['orders', 'grns'], queryFn: () => api.get<GrnRow[]>('/orders/grns') });
}

/** How far a PO has got: nothing in, part in, all in, all billed. */
export function poProgress(po: PoRow): { received: number; billed: number; ordered: number } {
  return po.lines.reduce((s, l) => ({ ordered: s.ordered + l.qty, received: s.received + l.receivedQty, billed: s.billed + l.billedQty }), { ordered: 0, received: 0, billed: 0 });
}

/** What a PO is waiting for, in words. */
export function PoStatusChip({ po }: { po: PoRow }) {
  if (po.status === 'cancelled') return <StatusChip tone="neutral">Cancelled</StatusChip>;
  if (po.status === 'closed') return <StatusChip tone="success">Closed</StatusChip>;
  const p = poProgress(po);
  if (p.received === 0) return <StatusChip tone="pending">{po.sentAt ? 'Sent, awaiting goods' : 'Open, not sent'}</StatusChip>;
  if (p.received < p.ordered) return <StatusChip tone="pending">Part received</StatusChip>;
  return <StatusChip tone="pending">Received, to bill</StatusChip>;
}
