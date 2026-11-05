'use client';

import { Section, TableCard, th, td, tdMoney } from '@/components/page/page-shell';
import { formatPaise } from '@/lib/gst';
import type { Amounts, DocAdjustment, DocDiscount, DocLine, DocWords } from './sales-data';

/** The lines of a quote, order or challan, read-only. A line's share of the discount shows under its amount. */
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
              <td className={`${td} whitespace-pre-line`}>{l.description}</td>
              <td className={`${td} font-mono text-caption`}>{l.hsnSac ?? '—'}</td>
              <td className={tdMoney}>{l.qty}</td>
              <td className={tdMoney}>{formatPaise(l.ratePaise)}</td>
              <td className={tdMoney}>{l.taxRatePct}%</td>
              <td className={tdMoney}>
                {formatPaise(l.amountPaise)}
                {(l.discountPaise ?? 0) > 0 && <span className="block text-caption text-ink-500">less {formatPaise(l.discountPaise ?? 0)}</span>}
              </td>
              {extra?.cells(l, i).map((c, n) => <td key={n} className={tdMoney}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/**
 * Sub total and discount when there is one, the taxable value, the tax heads
 * that apply, the adjustment, and the total.
 */
export function AmountsList({ amounts, discount, adjustment, subTotalPaise }: {
  amounts: Amounts;
  discount?: DocDiscount | null;
  adjustment?: DocAdjustment | null;
  /** What the lines came to before the discount. */
  subTotalPaise?: number;
}) {
  const adj = adjustment?.paise ?? amounts.total - (amounts.taxableValue + amounts.cgst + amounts.sgst + amounts.igst + amounts.cess);
  const rows: Array<[string, string]> = [];
  if (discount && discount.amountPaise > 0) {
    rows.push(['Sub total', formatPaise(subTotalPaise ?? amounts.taxableValue + discount.amountPaise)]);
    rows.push([discount.percent ? `Discount (${discount.percent}%)` : 'Discount', `− ${formatPaise(discount.amountPaise)}`]);
  }
  rows.push(['Taxable value', formatPaise(amounts.taxableValue)]);
  if (amounts.cgst) rows.push(['CGST', formatPaise(amounts.cgst)]);
  if (amounts.sgst) rows.push(['SGST', formatPaise(amounts.sgst)]);
  if (amounts.igst) rows.push(['IGST', formatPaise(amounts.igst)]);
  if (amounts.cess) rows.push(['Cess', formatPaise(amounts.cess)]);
  if (adj) rows.push([adjustment?.label || 'Adjustment', adj < 0 ? `− ${formatPaise(-adj)}` : formatPaise(adj)]);
  return (
    <dl className="max-w-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-line-100 py-1.5">
          <dt className="text-body text-ink-600">{k}</dt>
          <dd className="font-mono text-body tabular-nums text-ink-900">{v}</dd>
        </div>
      ))}
      <div className="flex justify-between py-1.5 font-semibold">
        <dt className="text-body text-ink-900">Total</dt>
        <dd className="font-mono text-body tabular-nums text-ink-900">{formatPaise(amounts.total)}</dd>
      </div>
    </dl>
  );
}

/** The detail rows a document's words add: reference, subject, salesperson. Only those it has. */
export function wordRows(d: DocWords, referenceLabel = 'Reference'): Array<[string, React.ReactNode]> {
  const rows: Array<[string, React.ReactNode]> = [];
  if (d.referenceNumber) rows.push([referenceLabel, <span key="r" className="font-mono">{d.referenceNumber}</span>]);
  if (d.salespersonName) rows.push(['Salesperson', d.salespersonName]);
  if (d.subject) rows.push(['Subject', d.subject]);
  return rows;
}

/** Customer notes and terms, each in its own part of the page when there is one. */
export function NotesAndTerms({ notes, terms }: { notes?: string | null; terms?: string | null }) {
  if (!notes && !terms) return null;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {notes && (
        <Section title="Customer notes">
          <p className="whitespace-pre-line text-body text-ink-700">{notes}</p>
        </Section>
      )}
      {terms && (
        <Section title="Terms & conditions">
          <p className="whitespace-pre-line text-body text-ink-700">{terms}</p>
        </Section>
      )}
    </div>
  );
}
