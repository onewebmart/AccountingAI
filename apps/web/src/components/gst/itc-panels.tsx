'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Explanation {
  kind: string;
  lineId: string | null;
  billId: string | null;
  supplier: string;
  invoiceNumber: string | null;
  explanation: string;
  action: string;
  vendorMessage: string | null;
  itcPaise: number;
}

interface Heads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

interface WatchRow {
  billId: string;
  number: string | null;
  vendorName: string;
  billDate: string;
  payBy: string;
  unpaidPaise: number;
  heads: Heads;
  daysLeft: number;
}

const KIND_LABEL: Record<string, string> = {
  number_typed_differently: 'Number typed differently',
  tax_differs_rate: 'Different rate',
  igst_vs_cgst_sgst: 'IGST vs CGST + SGST',
  taxable_differs_tax_same: 'Taxable value differs',
  amount_differs: 'Amounts differ',
  already_claimed_by_date: 'Already claimed',
  other_registration: 'Another GSTIN of the vendor',
  number_differs: 'Number differs',
  not_in_books: 'Not in your books',
  not_in_2b: 'Not in 2B yet',
  no_gstin: 'Vendor has no GSTIN',
};

// Nothing to chase: kept apart from the ones that cost credit.
const QUIET = new Set(['number_typed_differently', 'taxable_differs_tax_same', 'already_claimed_by_date']);

const gst = (h: Heads) => h.iamt + h.camt + h.samt + h.csamt;

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked: the message is on screen to select.
        }
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy message for vendor'}
    </button>
  );
}

/**
 * Every difference between the month's GSTR-2B and the books, in plain
 * words, with what to do and a message for the vendor where they must act.
 */
export function TwoBExplanations({ period }: { period: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['gst', '2b-explanations', period],
    queryFn: () => api.get<{ period: string; has2b: boolean; items: Explanation[] }>(`/gst/2b/explanations?period=${period}`),
  });
  if (isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Reading the 2B against your bills…</p>;
  if (isError) return <p className="text-caption text-error-fg">{error instanceof ApiError ? error.message : 'Could not explain the 2B.'}</p>;
  if (!data) return null;
  const items = data.items;
  const chase = items.filter((e) => !QUIET.has(e.kind));
  const quiet = items.filter((e) => QUIET.has(e.kind));
  const atStake = chase.reduce((s, e) => s + e.itcPaise, 0);

  return (
    <section className="rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 font-display text-ink-900">What doesn&apos;t match, and why</h3>
        {chase.length > 0 && <p className="text-caption text-pending-fg">{chase.length} to sort out · {formatPaise(atStake)} of GST credit at stake</p>}
      </div>
      {!data.has2b && <p className="mb-2 text-caption text-ink-500">No GSTR-2B imported for this month yet: only bills are listed. Import it above to see what your vendors reported.</p>}
      {items.length === 0 ? (
        <p className="text-caption text-success-fg">Everything in the 2B matches your bills.</p>
      ) : (
        <ul className="divide-y divide-line-100">
          {[...chase, ...quiet].map((e, i) => (
            <li key={`${e.lineId ?? ''}-${e.billId ?? ''}-${i}`} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-caption">
                <span className={`rounded-full px-2 py-0.5 font-medium ${QUIET.has(e.kind) ? 'bg-surface-sink text-ink-500' : 'bg-pending-bg text-pending-fg'}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                <span className="font-medium text-ink-900">{e.supplier}</span>
                {e.invoiceNumber && <span className="font-mono text-ink-500">{e.invoiceNumber}</span>}
                {e.itcPaise > 0 && !QUIET.has(e.kind) && <span className="ml-auto font-mono text-ink-700">{formatPaise(e.itcPaise)}</span>}
              </div>
              <p className="mt-1 text-body text-ink-700">{e.explanation}</p>
              <p className="mt-0.5 text-caption text-ink-500">{e.action}</p>
              {e.vendorMessage && (
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <button type="button" className="text-caption text-ink-500 hover:underline" onClick={() => setOpen(open === i ? null : i)}>
                    {open === i ? 'Hide message' : 'Show message for vendor'}
                  </button>
                  <CopyMessage text={e.vendorMessage} />
                </div>
              )}
              {open === i && e.vendorMessage && (
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-sink p-3 font-sans text-caption text-ink-700">{e.vendorMessage}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Bills to pay before 180 days pass, or their credit is reversed until they are (rule 37). */
export function Rule37Watchlist() {
  const { data, isLoading } = useQuery({ queryKey: ['gst', 'rule37'], queryFn: () => api.get<WatchRow[]>('/gst/itc/rule37') });
  if (isLoading || !data) return null;
  return (
    <section className="rounded-xl border border-line-200 bg-surface-card p-4">
      <h3 className="mb-1 text-h3 font-display text-ink-900">Pay before 180 days</h3>
      <p className="mb-3 text-caption text-ink-500">GST credit on a bill not paid within 180 days of its date is reversed in your next 3B, with interest, until you pay.</p>
      {data.length === 0 ? (
        <p className="text-caption text-success-fg">No bills are near 180 days unpaid.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line-200">
              {['Bill', 'Pay by', 'Unpaid', 'Credit at stake'].map((h) => (
                <th key={h} className="py-2 pr-3 text-caption font-semibold uppercase tracking-wide text-ink-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.billId} className="border-b border-line-100 last:border-0">
                <td className="py-2 pr-3 text-body text-ink-900">{r.vendorName} <span className="font-mono text-caption text-ink-500">{r.number ?? ''}</span></td>
                <td className={`py-2 pr-3 font-mono text-caption ${r.daysLeft < 0 ? 'text-error-fg' : 'text-pending-fg'}`}>
                  {r.payBy} {r.daysLeft < 0 ? `(${-r.daysLeft} days ago)` : `(${r.daysLeft} days)`}
                </td>
                <td className="py-2 pr-3 font-mono text-body text-ink-900">{formatPaise(r.unpaidPaise)}</td>
                <td className="py-2 pr-3 font-mono text-body text-ink-900">{formatPaise(gst(r.heads))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
