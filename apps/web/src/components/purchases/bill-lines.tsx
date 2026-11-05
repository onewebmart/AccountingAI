'use client';

import { Plus, X } from 'lucide-react';
import { ItemSelect } from '@/components/items/item-picker';
import { ProjectSelect, useProjects } from '@/components/projects/project-select';
import { formatPaise } from '@/lib/gst';
import { parseRupees } from '@/lib/money';
import { GST_SLABS, formatMinor, parseMinor, type Amounts } from './purchase-data';

/** One line of a bill or purchase order as typed: text until it is sent. */
export interface BillEditLine {
  itemId: string;
  description: string;
  hsnSac: string;
  qty: string;
  /** Rupees, or the foreign currency's units on a foreign bill. */
  rate: string;
  taxRatePct: number;
  projectId: string;
}

export const emptyBillLine = (): BillEditLine => ({ itemId: '', description: '', hsnSac: '', qty: '1', rate: '', taxRatePct: 18, projectId: '' });

const isBlank = (l: BillEditLine) => !l.description.trim() && !l.rate.trim() && !l.itemId;

/** Up to three decimals: 2.5 kg. */
function readQty(text: string): number | null {
  const s = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/**
 * Lines as the API takes them: rupees to paise once, here (Invariant 1).
 * Blank rows are left out. Says which line it cannot read.
 */
export function billLinesToApi(lines: BillEditLine[]):
  | { ok: true; lines: Array<{ itemId: string | null; description: string; hsnSac: string | null; qty: number; ratePaise: number; taxRatePct: number; projectId: string | null }> }
  | { ok: false; problem: string } {
  const out = [];
  const typed = lines.filter((l) => !isBlank(l));
  if (typed.length === 0) return { ok: false, problem: 'Add at least one line.' };
  for (const [i, l] of typed.entries()) {
    const at = `Line ${i + 1}`;
    if (!l.description.trim()) return { ok: false, problem: `${at} needs a description.` };
    const qty = readQty(l.qty);
    if (qty === null) return { ok: false, problem: `${at}: the quantity is more than nothing, to three decimals at most.` };
    const ratePaise = parseRupees(l.rate || '0');
    if (ratePaise === null || ratePaise < 0) return { ok: false, problem: `${at}: enter the rate in rupees, like 1,250.50.` };
    out.push({ itemId: l.itemId || null, description: l.description.trim(), hsnSac: l.hsnSac.trim() || null, qty, ratePaise, taxRatePct: l.taxRatePct, projectId: l.projectId || null });
  }
  return { ok: true, lines: out };
}

/** Lines of a foreign bill: the rate in the currency's minor units; GST is the bill's reverse charge, not the line's. */
export function foreignLinesToApi(lines: BillEditLine[], digits: number):
  | { ok: true; lines: Array<{ itemId: string | null; description: string; hsnSac: string | null; qty: number; rateMinor: number; projectId: string | null }> }
  | { ok: false; problem: string } {
  const out = [];
  const typed = lines.filter((l) => !isBlank(l));
  if (typed.length === 0) return { ok: false, problem: 'Add at least one line.' };
  for (const [i, l] of typed.entries()) {
    const at = `Line ${i + 1}`;
    if (!l.description.trim()) return { ok: false, problem: `${at} needs a description.` };
    const qty = readQty(l.qty);
    if (qty === null) return { ok: false, problem: `${at}: the quantity is more than nothing, to three decimals at most.` };
    const rateMinor = parseMinor(l.rate || '0', digits);
    if (rateMinor === null) return { ok: false, problem: `${at}: enter the price in the bill's currency, to ${digits} decimals at most.` };
    out.push({ itemId: l.itemId || null, description: l.description.trim(), hsnSac: l.hsnSac.trim() || null, qty, rateMinor, projectId: l.projectId || null });
  }
  return { ok: true, lines: out };
}

/** The preview of what the server will work out: the same rounding as orders/doc-lines.ts. The server decides. */
export function previewAmounts(lines: BillEditLine[], interState: boolean): Amounts {
  const a: Amounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const l of lines) {
    if (isBlank(l)) continue;
    const qty = readQty(l.qty) ?? 0;
    const rate = parseRupees(l.rate || '0') ?? 0;
    const taxable = Math.round(qty * rate);
    const tax = Math.round((taxable * l.taxRatePct) / 100);
    a.taxableValue += taxable;
    if (interState) a.igst += tax;
    else {
      const half = Math.round(tax / 2);
      a.cgst += half;
      a.sgst += tax - half;
    }
  }
  a.total = a.taxableValue + a.cgst + a.sgst + a.igst;
  return a;
}

const cell = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';
const head = 'px-1.5 pb-1 text-left text-caption font-medium text-ink-500';

/**
 * The lines of a bill or purchase order. Picking an item fills the line
 * (its purchase price, HSN/SAC and GST rate); anything typed after stays.
 * A foreign bill's rates are in its currency and carry no GST of their own.
 */
export function BillLineEditor({
  lines,
  onChange,
  foreign,
  showProject = true,
}: {
  lines: BillEditLine[];
  onChange: (lines: BillEditLine[]) => void;
  foreign?: { currency: string; digits: number } | null;
  showProject?: boolean;
}) {
  const projects = useProjects();
  const withProject = showProject && (projects.data?.length ?? 0) > 0;
  const set = (i: number, patch: Partial<BillEditLine>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const amountOf = (l: BillEditLine) => {
    const qty = readQty(l.qty) ?? 0;
    if (foreign) return formatMinor(Math.round(qty * (parseMinor(l.rate || '0', foreign.digits) ?? 0)), foreign.currency, foreign.digits);
    return formatPaise(Math.round(qty * (parseRupees(l.rate || '0') ?? 0)));
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={`${head} w-44`}>Item</th>
              <th className={head}>Description</th>
              <th className={`${head} w-24`}>HSN/SAC</th>
              <th className={`${head} w-20`}>Qty</th>
              <th className={`${head} w-28`}>Rate {foreign ? `(${foreign.currency})` : '(₹)'}</th>
              {!foreign && <th className={`${head} w-20`}>GST</th>}
              {withProject && <th className={`${head} w-40`}>Project</th>}
              <th className={`${head} w-28 text-right`}>Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-1.5 py-1">
                  <ItemSelect
                    className={cell}
                    value={l.itemId}
                    onPick={(item) => {
                      if (!item) return set(i, { itemId: '' });
                      set(i, {
                        itemId: item._id,
                        description: l.description.trim() ? l.description : item.name,
                        hsnSac: item.hsnSac ?? l.hsnSac,
                        taxRatePct: item.gstRatePct != null && (GST_SLABS as readonly number[]).includes(item.gstRatePct) ? item.gstRatePct : l.taxRatePct,
                        // A price on the item fills an empty rate; one already typed stays. Rupees only.
                        rate: !foreign && !l.rate.trim() && item.purchasePricePaise != null ? String(item.purchasePricePaise / 100) : l.rate,
                      });
                    }}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <input className={cell} placeholder="What was bought" value={l.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                </td>
                <td className="px-1.5 py-1">
                  <input className={`${cell} font-mono`} inputMode="numeric" maxLength={8} value={l.hsnSac} onChange={(e) => set(i, { hsnSac: e.target.value.replace(/\D/g, '') })} aria-label={`Line ${i + 1} HSN or SAC`} />
                </td>
                <td className="px-1.5 py-1">
                  <input className={`${cell} text-right font-mono`} inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                </td>
                <td className="px-1.5 py-1">
                  <input className={`${cell} text-right font-mono`} inputMode="decimal" placeholder="0.00" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} aria-label={`Line ${i + 1} rate`} />
                </td>
                {!foreign && (
                  <td className="px-1.5 py-1">
                    <select className={cell} value={l.taxRatePct} onChange={(e) => set(i, { taxRatePct: Number(e.target.value) })} aria-label={`Line ${i + 1} GST rate`}>
                      {GST_SLABS.map((r) => (
                        <option key={r} value={r}>{r}%</option>
                      ))}
                    </select>
                  </td>
                )}
                {withProject && (
                  <td className="px-1.5 py-1">
                    <ProjectSelect className={cell} value={l.projectId} onChange={(projectId) => set(i, { projectId })} />
                  </td>
                )}
                <td className="px-1.5 py-2 text-right font-mono text-caption tabular-nums text-ink-700">{amountOf(l)}</td>
                <td className="px-1 py-2">
                  <button type="button" className="text-ink-400 hover:text-error-fg disabled:opacity-30" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, n) => n !== i))}>
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:underline" onClick={() => onChange([...lines, emptyBillLine()])}>
        <Plus size={12} /> Add a line
      </button>
    </div>
  );
}

/** Before tax, the tax heads, and the total, as a summary beside the lines. */
export function AmountsSummary({ amounts, note }: { amounts: Amounts; note?: React.ReactNode }) {
  const row = (label: string, paise: number, strong = false) => (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t border-line-200 pt-2 font-semibold text-ink-900' : 'text-ink-600'}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{formatPaise(paise)}</span>
    </div>
  );
  return (
    <div className="ml-auto w-full max-w-xs text-body">
      {row('Before tax', amounts.taxableValue)}
      {amounts.cgst > 0 && row('CGST', amounts.cgst)}
      {amounts.sgst > 0 && row('SGST', amounts.sgst)}
      {amounts.igst > 0 && row('IGST', amounts.igst)}
      {amounts.cess > 0 && row('Cess', amounts.cess)}
      {row('Total', amounts.total, true)}
      {note && <p className="mt-1 text-caption text-ink-500">{note}</p>}
    </div>
  );
}
