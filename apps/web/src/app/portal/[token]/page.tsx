'use client';

import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { formatRupees } from '@/lib/utils';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface PortalView {
  business: { name: string; gstin: string | null; address: string | null; email: string | null; phone: string | null };
  customer: { name: string };
  invoices: Array<{ id: string; number: string | null; date: string; dueDate: string | null; totalPaise: number; owedPaise: number; status: 'open' | 'paid'; payUrl: string | null }>;
  owedPaise: number;
  expiresAt: string;
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * A customer's view of what they have been invoiced, by the link the
 * business sent them. No login: the link is the key. Read-only.
 */
export default function CustomerPortalPage({ params }: { params: { token: string } }) {
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/portal/${encodeURIComponent(params.token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.message === 'string' ? body.message : 'This link could not be opened.');
        setView(body as PortalView);
      })
      .catch((e: Error) => setError(e.message || "Can't reach the server. Try again shortly."));
  }, [params.token]);

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-h2 font-display text-ink-900">Link unavailable</h1>
        <p className="mt-2 text-body text-ink-500">{error}</p>
      </main>
    );
  }
  if (!view) return <main className="px-4 py-24 text-center text-caption text-ink-400">Loading…</main>;

  const open = view.invoices.filter((i) => i.status === 'open');
  const paid = view.invoices.filter((i) => i.status === 'paid');
  const row = (i: PortalView['invoices'][number]) => (
    <tr key={i.id}>
      <td className="px-3 py-2 font-mono text-body text-ink-900">{i.number ?? '—'}</td>
      <td className="px-3 py-2 text-caption text-ink-600">{day(i.date)}</td>
      <td className="px-3 py-2 text-caption text-ink-600">{i.dueDate ? day(i.dueDate) : '—'}</td>
      <td className="px-3 py-2 text-right font-mono">{formatRupees(i.totalPaise)}</td>
      <td className="px-3 py-2 text-right font-mono font-medium">{i.status === 'open' ? formatRupees(i.owedPaise) : <span className="text-success-fg">Paid</span>}</td>
      <td className="px-3 py-2 text-right">
        <span className="inline-flex items-center gap-3">
          <a className="inline-flex items-center gap-1 text-caption font-medium text-ink-600 hover:text-ink-900 hover:underline" href={`${API}/portal/${encodeURIComponent(params.token)}/invoices/${i.id}/pdf`} target="_blank" rel="noopener noreferrer">
            <FileDown size={13} /> PDF
          </a>
          {i.payUrl && (
            <a className="rounded-md bg-saffron-600 px-3 py-1 text-caption font-semibold text-white hover:bg-saffron-700" href={i.payUrl} target="_blank" rel="noopener noreferrer">
              Pay now
            </a>
          )}
        </span>
      </td>
    </tr>
  );
  const table = (rows: PortalView['invoices']) => (
    <div className="overflow-x-auto rounded-lg border border-line-200 bg-surface-card">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line-200 text-left">
            {['Invoice', 'Date', 'Due', 'Total', 'Owed', ''].map((h, n) => (
              <th key={n} className={`px-3 py-2 text-caption font-medium text-ink-500 ${n >= 3 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-100">{rows.map(row)}</tbody>
      </table>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header>
        <p className="text-caption uppercase tracking-wide text-ink-500">Invoices from</p>
        <h1 className="text-h1 font-display text-ink-900">{view.business.name}</h1>
        <p className="text-caption text-ink-500">
          {[view.business.address, view.business.gstin && `GSTIN ${view.business.gstin}`, view.business.email, view.business.phone].filter(Boolean).join(' · ')}
        </p>
      </header>

      <section className="rounded-lg border border-line-200 bg-surface-card p-5">
        <p className="text-body text-ink-700">For {view.customer.name}</p>
        <p className="mt-1 text-h2 font-mono text-ink-900">{formatRupees(view.owedPaise)}</p>
        <p className="text-caption text-ink-500">{view.owedPaise > 0 ? 'owed across the open invoices below' : 'Nothing is owed. Thank you.'}</p>
      </section>

      {open.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink-900">Open</h2>
          {table(open)}
        </section>
      )}
      {paid.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink-900">Paid</h2>
          {table(paid)}
        </section>
      )}
      <p className="text-caption text-ink-400">
        This link works until {day(view.expiresAt.slice(0, 10))}. Questions about an invoice? Reply to the email it came with, or contact {view.business.name}.
      </p>
    </main>
  );
}
