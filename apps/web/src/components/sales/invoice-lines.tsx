'use client';

import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { GST_RATES, formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { ItemSelect } from '@/components/items/item-picker';
import { ProjectSelect, useProjects } from '@/components/projects/project-select';
import { th } from '@/components/page/page-shell';
import { toMinor, formatMinor, type Amounts } from './sales-data';

/** One line as it is typed: text until it is saved, so nothing is rounded under the person's fingers. */
export interface InvoiceLine {
  key: number;
  itemId: string;
  description: string;
  hsnSac: string;
  uqc: string;
  qty: string;
  /** Rupees for an INR invoice; the currency's own units for an export. */
  rate: string;
  taxRatePct: number;
  projectId: string;
}

let nextKey = 1;
export const emptyInvoiceLine = (): InvoiceLine => ({ key: nextKey++, itemId: '', description: '', hsnSac: '', uqc: '', qty: '1', rate: '', taxRatePct: 18, projectId: '' });

/** In rupees (INR) or in a foreign currency's minor units, with that currency's digits. */
export type LineMoney = { kind: 'inr' } | { kind: 'foreign'; currency: string; digits: number };

const isBlank = (l: InvoiceLine) => !l.description.trim() && !l.rate.trim() && !l.itemId;
const qtyOk = (q: number) => q > 0 && Math.round(q * 1000) === q * 1000;

/** What a line comes to before tax: paise for INR, minor units for a foreign currency. Null when it cannot be read. */
export function lineValue(l: InvoiceLine, money: LineMoney): number | null {
  const qty = Number(l.qty);
  const rate = money.kind === 'inr' ? parseRupees(l.rate || '0') : toMinor(l.rate || '0', money.digits);
  if (rate === null || rate < 0 || !qtyOk(qty)) return null;
  return Math.round(qty * rate);
}

/**
 * The amounts the server will work out, worked out the same way for the
 * preview: tax per line at its slab, split in halves within a state. The
 * server's figures are the ones stored.
 */
export function invoiceAmounts(lines: InvoiceLine[], interState: boolean): Amounts {
  const a: Amounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const l of lines) {
    if (isBlank(l)) continue;
    const taxable = lineValue(l, { kind: 'inr' }) ?? 0;
    const tax = Math.round((taxable * (l.taxRatePct || 0)) / 100);
    a.taxableValue += taxable;
    if (interState) a.igst += tax;
    else {
      const half = Math.round(tax / 2);
      a.cgst += half;
      a.sgst += tax - half;
    }
  }
  a.total = a.taxableValue + a.cgst + a.sgst + a.igst + a.cess;
  return a;
}

export interface ApiInvoiceLine {
  description: string;
  itemId?: string;
  hsnSac?: string;
  uqc?: string;
  qty: number;
  ratePaise: number;
  taxRatePct: number;
  projectId?: string;
}

export interface ApiForeignLine {
  description: string;
  itemId?: string;
  hsnSac?: string;
  uqc?: string;
  qty: number;
  rateMinor: number;
  projectId?: string;
}

/** Lines as the API takes them: rupees to paise once, here. A problem names the line. */
export function toApiLines(lines: InvoiceLine[], money: { kind: 'inr' }): { lines: ApiInvoiceLine[]; problem: string | null };
export function toApiLines(lines: InvoiceLine[], money: { kind: 'foreign'; currency: string; digits: number }): { lines: ApiForeignLine[]; problem: string | null };
export function toApiLines(lines: InvoiceLine[], money: LineMoney): { lines: Array<ApiInvoiceLine | ApiForeignLine>; problem: string | null } {
  const out: Array<ApiInvoiceLine | ApiForeignLine> = [];
  let n = 0;
  for (const l of lines) {
    if (isBlank(l)) continue;
    n += 1;
    const at = `Line ${n}`;
    if (!l.description.trim()) return { lines: [], problem: `${at} needs a description.` };
    const qty = Number(l.qty);
    if (!qtyOk(qty)) return { lines: [], problem: `${at}: the quantity is more than nothing, to three decimals at most.` };
    const common = {
      description: l.description.trim(),
      ...(l.itemId ? { itemId: l.itemId } : {}),
      ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}),
      ...(l.uqc ? { uqc: l.uqc } : {}),
      ...(l.projectId ? { projectId: l.projectId } : {}),
      qty,
    };
    if (money.kind === 'inr') {
      const ratePaise = parseRupees(l.rate || '0');
      if (ratePaise === null || ratePaise < 0) return { lines: [], problem: `${at}: the rate is an amount in rupees, like 1250.50.` };
      out.push({ ...common, ratePaise, taxRatePct: l.taxRatePct });
    } else {
      const rateMinor = toMinor(l.rate || '0', money.digits);
      if (rateMinor === null) return { lines: [], problem: `${at}: the price is an amount in ${money.currency}, to ${money.digits} decimals at most.` };
      out.push({ ...common, rateMinor });
    }
  }
  if (out.length === 0) return { lines: [], problem: 'Add at least one line.' };
  return { lines: out, problem: null };
}

const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

/**
 * The lines of an invoice: item, description, HSN/SAC, quantity, rate, GST
 * slab and project. Picking an item fills the line, and this customer's last
 * price fills the rate; anything the person then changes stays changed.
 * An export carries no GST, so the slab is not asked.
 */
export function InvoiceLinesEditor({
  lines,
  onChange,
  customerId,
  money,
}: {
  lines: InvoiceLine[];
  onChange: (lines: InvoiceLine[]) => void;
  customerId: string;
  money: LineMoney;
}) {
  const projects = useProjects();
  const hasProjects = (projects.data ?? []).length > 0;
  const foreign = money.kind === 'foreign';
  const set = (key: number, patch: Partial<InvoiceLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const show = (v: number | null) => (v === null ? '—' : money.kind === 'inr' ? formatPaise(v) : formatMinor(v, money.currency, money.digits));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px]">
          <thead>
            <tr className="border-b border-line-200">
              <th className={`${th} w-44`}>Item</th>
              <th className={th}>Description</th>
              <th className={`${th} w-24`}>HSN/SAC</th>
              <th className={`${th} w-20`}>Qty</th>
              <th className={`${th} w-28`}>{foreign ? `Price (${money.currency})` : 'Rate (₹)'}</th>
              {!foreign && <th className={`${th} w-20`}>GST</th>}
              {hasProjects && <th className={`${th} w-40`}>Project</th>}
              <th className={`${th} w-32 text-right`}>Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-line-100 align-top last:border-0">
                <td className="px-1 py-1.5">
                  <ItemSelect
                    className={cell}
                    value={l.itemId}
                    side="sale"
                    onPick={async (item) => {
                      if (!item) return set(l.key, { itemId: '' });
                      const filled: Partial<InvoiceLine> = {
                        itemId: item._id,
                        description: item.name,
                        hsnSac: item.hsnSac ?? l.hsnSac,
                        uqc: item.uqc ?? '',
                        taxRatePct: (GST_RATES as readonly number[]).includes(item.gstRatePct ?? -1) ? (item.gstRatePct as number) : l.taxRatePct,
                        rate: !foreign && item.salePricePaise != null ? String(item.salePricePaise / 100) : l.rate,
                      };
                      set(l.key, filled);
                      // This customer's last price beats the list price, in rupees only.
                      if (customerId && !foreign) {
                        const price = await api.get<{ ratePaise: number } | null>(`/orders/price?customerId=${customerId}&itemId=${item._id}`).catch(() => null);
                        if (price) onChange(lines.map((x) => (x.key === l.key ? { ...x, ...filled, rate: String(price.ratePaise / 100) } : x)));
                      }
                    }}
                  />
                </td>
                <td className="px-1 py-1.5">
                  <input className={cell} placeholder="What was sold" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} />
                </td>
                <td className="px-1 py-1.5">
                  <input className={`${cell} font-mono`} inputMode="numeric" placeholder="998314" value={l.hsnSac} onChange={(e) => set(l.key, { hsnSac: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
                </td>
                <td className="px-1 py-1.5">
                  <input className={`${cell} text-right font-mono`} inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                </td>
                <td className="px-1 py-1.5">
                  <input className={`${cell} text-right font-mono`} inputMode="decimal" placeholder="0.00" value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value })} />
                </td>
                {!foreign && (
                  <td className="px-1 py-1.5">
                    <select className={cell} value={l.taxRatePct} onChange={(e) => set(l.key, { taxRatePct: Number(e.target.value) })}>
                      {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </td>
                )}
                {hasProjects && (
                  <td className="px-1 py-1.5">
                    <ProjectSelect className={cell} value={l.projectId} onChange={(projectId) => set(l.key, { projectId })} customerId={customerId} />
                  </td>
                )}
                <td className="px-2 py-1.5 text-right font-mono text-caption text-ink-900">{isBlank(l) ? '—' : show(lineValue(l, money))}</td>
                <td className="py-1.5 text-center">
                  <button
                    type="button"
                    className="mt-1.5 text-ink-400 hover:text-error-fg disabled:opacity-30"
                    aria-label="Remove line"
                    disabled={lines.length === 1}
                    onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline" onClick={() => onChange([...lines, emptyInvoiceLine()])}>
        <Plus size={12} /> Add a line
      </button>
    </div>
  );
}
