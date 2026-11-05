'use client';

import { TableCard, th, td, tdMoney } from '@/components/page/page-shell';
import { formatPaise } from '@/lib/gst';
import type { Amounts, DocLine } from './sales-data';

/** The lines of a quote, order or challan, read-only. */
export function DocLinesTable({ lines, extra }: { lines: DocLine[]; extra?: { head: string[]; cells: (l: DocLine, i: number) => React.ReactNode[] } }) {
  return (
    <TableCard className="border-line-100">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line-200 bg-surface-sink">
            <th className={th}>Description</th>
            <th className={th}>HSN/SAC</th>
            <th className={`${th} text-right`}>Qty</th>
            <th className={`${th} text-right`}>Rate</th>
            <th className={`${th} text-right`}>GST</th>
            <th className={`${th} text-right`}>Amount</th>
            {extra?.head.map((h) => <th key={h} className={`${th} text-right`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-line-100 last:border-0">
              <td className={td}>{l.description}</td>
              <td className={`${td} font-mono text-caption`}>{l.hsnSac ?? '—'}</td>
              <td className={tdMoney}>{l.qty}</td>
              <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
              <td className={tdMoney}>{l.taxRatePct}%</td>
              <td className={tdMoney}>{formatPaise(l.amountPaise)}</td>
              {extra?.cells(l, i).map((c, n) => <td key={n} className={tdMoney}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/** Taxable value, the tax heads that apply, and the total. */
export function AmountsList({ amounts }: { amounts: Amounts }) {
  const rows: Array<[string, number]> = [
    ['Taxable value', amounts.taxableValue],
    ...(amounts.cgst ? ([['CGST', amounts.cgst]] as Array<[string, number]>) : []),
    ...(amounts.sgst ? ([['SGST', amounts.sgst]] as Array<[string, number]>) : []),
    ...(amounts.igst ? ([['IGST', amounts.igst]] as Array<[string, number]>) : []),
    ...(amounts.cess ? ([['Cess', amounts.cess]] as Array<[string, number]>) : []),
  ];
  return (
    <dl className="max-w-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-line-100 py-1.5">
          <dt className="text-body text-ink-600">{k}</dt>
          <dd className="font-mono text-body text-ink-900">{formatPaise(v)}</dd>
        </div>
      ))}
      <div className="flex justify-between py-1.5 font-semibold">
        <dt className="text-body text-ink-900">Total</dt>
        <dd className="font-mono text-body text-ink-900">{formatPaise(amounts.total)}</dd>
      </div>
    </dl>
  );
}
