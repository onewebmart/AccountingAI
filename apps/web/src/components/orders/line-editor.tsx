'use client';

import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { ItemSelect, type ItemSide } from '@/components/items/item-picker';

export interface EditLine {
  itemId: string;
  description: string;
  hsnSac: string;
  qty: string;
  rate: string;
  taxRatePct: number;
}

export const emptyLine = (): EditLine => ({ itemId: '', description: '', hsnSac: '', qty: '1', rate: '', taxRatePct: 18 });

/** Lines as the API takes them: rupees to paise once, here. Null when one cannot be read. */
export function toApiLines(lines: EditLine[]) {
  const out = [];
  for (const l of lines) {
    if (!l.description.trim()) continue;
    const ratePaise = parseRupees(l.rate || '0');
    const qty = Number(l.qty);
    if (ratePaise === null || !(qty > 0)) return null;
    out.push({ description: l.description.trim(), itemId: l.itemId || null, hsnSac: l.hsnSac || null, qty, ratePaise, taxRatePct: l.taxRatePct });
  }
  return out;
}

const RATES = [0, 3, 5, 12, 18, 28, 40];
const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900';

/**
 * Lines of a quote, order or challan. Picking an item fills it; the
 * customer's last price fills the rate. On the purchase side it offers bought
 * items and fills their purchase description and cost price.
 */
export function LineEditor({ lines, onChange, customerId, side = 'sale' }: { lines: EditLine[]; onChange: (lines: EditLine[]) => void; customerId: string; side?: ItemSide }) {
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Math.round(Number(l.qty || 0) * (parseRupees(l.rate || '0') ?? 0)), 0);
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-2">
          <div className="col-span-3">
            <ItemSelect
              className={cell}
              value={l.itemId}
              side={side}
              onPick={async (item) => {
                if (!item) return set(i, { itemId: '' });
                const description = side === 'purchase' ? item.purchaseDescription || item.name : item.name;
                const price = side === 'purchase' ? item.purchasePricePaise : item.salePricePaise;
                set(i, { itemId: item._id, description, hsnSac: item.hsnSac ?? '', taxRatePct: item.gstRatePct ?? l.taxRatePct, rate: price != null ? String(price / 100) : l.rate });
                if (customerId) {
                  const price = await api.get<{ ratePaise: number } | null>(`/orders/price?customerId=${customerId}&itemId=${item._id}`).catch(() => null);
                  if (price) set(i, { itemId: item._id, description: item.name, hsnSac: item.hsnSac ?? '', taxRatePct: item.gstRatePct ?? l.taxRatePct, rate: String(price.ratePaise / 100) });
                }
              }}
            />
          </div>
          <input className={`${cell} col-span-4`} placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          <input className={`${cell} col-span-1 font-mono`} inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          <input className={`${cell} col-span-2 font-mono`} inputMode="decimal" placeholder="Rate ₹" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
          <select className={`${cell} col-span-1`} value={l.taxRatePct} onChange={(e) => set(i, { taxRatePct: Number(e.target.value) })}>
            {RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </select>
          <button type="button" className="col-span-1 text-ink-400 hover:text-error-fg" aria-label="Remove line" onClick={() => onChange(lines.filter((_, n) => n !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline" onClick={() => onChange([...lines, emptyLine()])}>
          <Plus size={12} /> Add a line
        </button>
        <span className="font-mono text-caption text-ink-600">Before tax {formatPaise(total)}</span>
      </div>
    </div>
  );
}
