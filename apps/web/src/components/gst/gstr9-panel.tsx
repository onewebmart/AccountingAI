'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Heads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

interface Gstr9 {
  financialYear: string;
  table4: { b2b: Heads; b2c: Heads; creditNotes: Heads; reverseCharge: Heads; net: Heads };
  table5: { nilExempt: number };
  table6: { reverseCharge: Heads; other: Heads; total: Heads };
  table7: { reversed: Heads };
  table6Net: Heads;
  table9: Array<{ head: string; payable: number; paidByCredit: number; paidInCash: number }>;
  table17: Array<Heads & { hsn: string; uqc: string; qty: number; rate: number; description: string }>;
  notCovered: string[];
}

function fyOptions(now = new Date()): string[] {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [0, 1, 2].map((i) => `${y - i}-${String((y - i + 1) % 100).padStart(2, '0')}`);
}

function Row({ label, h }: { label: string; h: Heads }) {
  return (
    <tr className="border-b border-line-100 last:border-0">
      <td className="py-1.5 pr-3 text-body text-ink-700">{label}</td>
      {[h.txval, h.iamt, h.camt, h.samt, h.csamt].map((v, i) => (
        <td key={i} className="py-1.5 pr-3 text-right font-mono text-caption text-ink-900">{formatPaise(v)}</td>
      ))}
    </tr>
  );
}

function Table({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="mb-2 text-h3 font-display text-ink-900">{title}</h3>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line-200">
            {['', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'].map((h) => (
              <th key={h} className={`py-1.5 pr-3 text-caption font-semibold uppercase text-ink-500 ${h ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

/** The annual return, added up from the year's months, with what it leaves to the portal. */
export function Gstr9Panel() {
  const options = fyOptions();
  const [fy, setFy] = useState(options[1]);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['gst', 'gstr9', fy], queryFn: () => api.get<Gstr9>(`/gst/returns/gstr9?fy=${fy}`) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="h-10 rounded-md border border-line-200 bg-white px-3 text-body" value={fy} onChange={(e) => setFy(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>FY {o}</option>)}
        </select>
        <p className="text-caption text-ink-500">GSTR-9 is due by 31 December after the year, and mandatory above ₹2 crore turnover.</p>
      </div>
      {isLoading && <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Adding up the year…</p>}
      {isError && <p className="text-caption text-error-fg">{error instanceof ApiError ? error.message : 'Could not build GSTR-9.'}</p>}
      {data && (
        <>
          <Table title="4 Outward supplies on which tax is payable">
            <Row label="B2B" h={data.table4.b2b} />
            <Row label="B2C" h={data.table4.b2c} />
            <Row label="Inward on reverse charge" h={data.table4.reverseCharge} />
            <Row label="Less credit notes" h={data.table4.creditNotes} />
            <Row label="Net" h={data.table4.net} />
          </Table>
          <p className="text-caption text-ink-600">5 Nil rated and exempt outward supplies: <span className="font-mono">{formatPaise(data.table5.nilExempt)}</span></p>
          <Table title="6 and 7 Input tax credit">
            <Row label="6 Availed on reverse charge" h={data.table6.reverseCharge} />
            <Row label="6 Availed on all else" h={data.table6.other} />
            <Row label="7 Reversed" h={data.table7.reversed} />
            <Row label="Net credit" h={data.table6Net} />
          </Table>
          <section className="rounded-xl border border-line-200 bg-surface-card p-4">
            <h3 className="mb-2 text-h3 font-display text-ink-900">9 Tax payable and paid</h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-200">
                  {['Head', 'Payable', 'Paid by credit', 'Paid in cash'].map((h) => <th key={h} className="py-1.5 pr-3 text-left text-caption font-semibold uppercase text-ink-500">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.table9.map((r) => (
                  <tr key={r.head} className="border-b border-line-100 last:border-0">
                    <td className="py-1.5 pr-3 uppercase text-ink-700">{r.head}</td>
                    {[r.payable, r.paidByCredit, r.paidInCash].map((v, i) => <td key={i} className="py-1.5 pr-3 font-mono text-caption text-ink-900">{formatPaise(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <Table title="17 HSN summary of outward supplies">
            {data.table17.map((r) => <Row key={`${r.hsn}-${r.uqc}-${r.rate}`} label={`${r.hsn || '(no HSN)'} · ${r.uqc} · ${r.rate}%`} h={r} />)}
          </Table>
          <div className="rounded-md bg-surface-sink p-3 text-caption text-ink-600">
            <p className="mb-1 font-medium">Not worked out here</p>
            <ul className="list-disc space-y-0.5 pl-5">{data.notCovered.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}
