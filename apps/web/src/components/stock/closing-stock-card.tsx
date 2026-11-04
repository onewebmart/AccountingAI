'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatPaise } from '@/lib/gst';

interface Closing {
  period: string;
  date: string;
  stockPaise: number;
  booksPaise: number;
  differencePaise: number;
  items: Array<{ itemId: string; name: string; qty: number; uqc: string; valuePaise: number; avgPaise: number }>;
  negative: Array<{ itemId: string; name: string; qty: number }>;
  blockers: string[];
  inReview: boolean;
}

interface Opening {
  date: string | null;
  itemsPaise: number;
  booksPaise: number;
  differencePaise: number;
  inReview: boolean;
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/**
 * Stock at a month's end against Stock in Hand on the books, and the entry
 * for the difference: proposed to the review queue, posted only on approval.
 */
export function ClosingStockCard({ period, onToast, showItems = false, hideWhenEmpty = false }: { period: string; onToast: (m: string) => void; showItems?: boolean; hideWhenEmpty?: boolean }) {
  const qc = useQueryClient();
  const closing = useQuery({ queryKey: ['stock', 'closing', period], queryFn: () => api.get<Closing>(`/stock/closing?period=${period}`) });
  const opening = useQuery({ queryKey: ['stock', 'opening-entry'], queryFn: () => api.get<Opening>('/stock/opening-entry') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['stock'] });
  const proposeOpening = useMutation({ mutationFn: () => api.post('/stock/opening-entry/propose'), onSuccess: () => { refresh(); onToast('Sent to the review queue'); } });
  const proposeClosing = useMutation({ mutationFn: () => api.post('/stock/closing/propose', { period }), onSuccess: () => { refresh(); onToast('Sent to the review queue'); } });

  const card = 'rounded-xl border border-line-200 bg-surface-card p-4';
  if (closing.isLoading) return hideWhenEmpty ? null : <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={14} className="animate-spin" /> Valuing stock…</p>;
  if (closing.isError || !closing.data) return <p className="text-caption text-error-fg">{message(closing.error)}</p>;
  const c = closing.data;
  const o = opening.data;
  const openingDue = o && o.date && o.differencePaise > 0 && !o.inReview;
  // A business with no stock has nothing to book here.
  if (hideWhenEmpty && c.stockPaise === 0 && c.booksPaise === 0 && !c.items.length && !o?.date) return null;

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-h3 font-display text-ink-900">Closing stock, {c.date}</h3>
          <p className="text-caption text-ink-500">Stock at weighted-average cost against Stock in Hand on the books. Purchases stay expensed; this entry books the change.</p>
        </div>
        {c.differencePaise !== 0 && c.blockers.length === 0 && (
          <Button disabled={proposeClosing.isPending} onClick={() => proposeClosing.mutate()}>
            <Sparkles size={14} /> {proposeClosing.isPending ? 'Proposing…' : 'Propose closing stock'}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-caption">
        <div className="rounded-md bg-surface-sink p-2"><dt className="text-ink-500">Stock at cost</dt><dd className="font-mono text-body text-ink-900">{formatPaise(c.stockPaise)}</dd></div>
        <div className="rounded-md bg-surface-sink p-2"><dt className="text-ink-500">On the books</dt><dd className="font-mono text-body text-ink-900">{formatPaise(c.booksPaise)}</dd></div>
        <div className={`rounded-md p-2 ${c.differencePaise === 0 ? 'bg-success-bg text-success-fg' : 'bg-pending-bg text-pending-fg'}`}>
          <dt>{c.differencePaise === 0 ? 'Books agree' : c.differencePaise > 0 ? 'To book, increase' : 'To book, decrease'}</dt>
          <dd className="font-mono text-body">{formatPaise(Math.abs(c.differencePaise))}</dd>
        </div>
      </dl>

      {openingDue && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">
          <span>Opening stock on the items is {formatPaise(o.itemsPaise)} at {o.date}; the books carry {formatPaise(o.booksPaise)}. Book the {formatPaise(o.differencePaise)} first, so it is not counted as this month&apos;s profit.</span>
          <Button size="sm" variant="secondary" disabled={proposeOpening.isPending} onClick={() => proposeOpening.mutate()}>Propose opening stock</Button>
        </div>
      )}
      {c.blockers.filter((b) => !(openingDue && /opening stock/.test(b))).map((b) => <p key={b} className="mt-3 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">{b}</p>)}
      {c.negative.length > 0 && (
        <p className="mt-3 rounded-md bg-pending-bg p-2 text-caption text-pending-fg">
          Below nothing, counted at nil: {c.negative.map((n) => `${n.name} (${n.qty})`).join(', ')}. A bill may be missing, or a line not linked to its item.
        </p>
      )}
      {(proposeClosing.isError || proposeOpening.isError) && <p className="mt-2 text-caption text-error-fg">{message(proposeClosing.error ?? proposeOpening.error)}</p>}

      {showItems && c.items.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-caption">
            <thead><tr className="border-b border-line-200 text-left text-ink-500">{['Item', 'Quantity', 'Average cost', 'Value'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {c.items.map((i) => (
                <tr key={i.itemId} className="border-b border-line-100 last:border-0">
                  <td className="px-2 py-1.5 text-ink-900">{i.name}</td>
                  <td className="px-2 py-1.5 font-mono">{i.qty} {i.uqc}</td>
                  <td className="px-2 py-1.5 font-mono">{formatPaise(i.avgPaise)}</td>
                  <td className="px-2 py-1.5 font-mono">{formatPaise(i.valuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-caption text-ink-500">It goes to the <Link className="underline" href="/review">review queue</Link>; nothing posts until it is approved.</p>
    </section>
  );
}
