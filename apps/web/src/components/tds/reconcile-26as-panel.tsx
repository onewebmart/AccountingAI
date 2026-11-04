'use client';

import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

interface Book { invoiceId: string; invoiceNumber: string | null; customerName: string; paidOn: string; tdsPaise: number }
interface Row { line: number; deductorName: string; tan: string | null; date: string; tdsPaise: number }
interface Result {
  matched: Array<{ book: Book; row: Row }>;
  differs: Array<{ book: Book; row: Row; differencePaise: number }>;
  notIn26as: Book[];
  notInBooks: Row[];
  skipped: Array<{ line: number; reason: string }>;
  totals: { booksPaise: number; in26asPaise: number; matchedPaise: number; atRiskPaise: number };
}

/**
 * TDS customers deducted, against what Form 26AS credits to our PAN. Only
 * what 26AS shows can be claimed, so each leftover says who to chase.
 */
export function Reconcile26asPanel({ financialYear }: { financialYear: string }) {
  const input = useRef<HTMLInputElement>(null);
  const run = useMutation({ mutationFn: (csv: string) => api.post<Result>('/tds/26as/reconcile', { financialYear, csv }) });
  const r = run.data;

  return (
    <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-display text-ink-900">Match with Form 26AS</h2>
          <p className="text-caption text-ink-500">Download 26AS from TRACES or the income-tax portal, save Part I as CSV, and choose it here. Nothing is saved.</p>
        </div>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => input.current?.click()}>
          <Upload size={13} /> {run.isPending ? 'Matching…' : 'Choose 26AS CSV'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) run.mutate(await file.text());
          }}
        />
      </div>
      {run.isError && <p className="text-caption text-error-fg">{run.error instanceof ApiError ? run.error.message : 'Could not read the file.'}</p>}
      {r && (
        <div className="space-y-3 text-caption">
          <p className="text-ink-600">
            Your books: {formatRupees(r.totals.booksPaise)} · 26AS: {formatRupees(r.totals.in26asPaise)} · matched {formatRupees(r.totals.matchedPaise)}
            {r.totals.atRiskPaise > 0 && <span className="ml-2 text-pending-fg">{formatRupees(r.totals.atRiskPaise)} deducted but not credited</span>}
          </p>
          {r.notIn26as.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-pending-fg">Deducted, but not in 26AS: ask the customer to deposit it and file their TDS return</p>
              <ul className="space-y-0.5">{r.notIn26as.map((b) => <li key={`${b.invoiceId}-${b.paidOn}`}>{b.customerName} · {b.invoiceNumber ?? ''} · {b.paidOn} · <span className="font-mono">{formatRupees(b.tdsPaise)}</span></li>)}</ul>
            </div>
          )}
          {r.differs.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-pending-fg">Amounts differ</p>
              <ul className="space-y-0.5">
                {r.differs.map((d) => (
                  <li key={`${d.book.invoiceId}-${d.row.line}`}>
                    {d.book.customerName}: your books <span className="font-mono">{formatRupees(d.book.tdsPaise)}</span>, 26AS <span className="font-mono">{formatRupees(d.row.tdsPaise)}</span> ({d.row.date})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.notInBooks.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-ink-700">In 26AS but not in your books: likely a receipt recorded without its TDS</p>
              <ul className="space-y-0.5">{r.notInBooks.map((x) => <li key={x.line}>{x.deductorName}{x.tan ? ` (${x.tan})` : ''} · {x.date} · <span className="font-mono">{formatRupees(x.tdsPaise)}</span></li>)}</ul>
            </div>
          )}
          {r.matched.length > 0 && <p className="text-success-fg">{r.matched.length} matched.</p>}
          {r.skipped.length > 0 && <p className="text-ink-500">Lines not read: {r.skipped.map((s) => `${s.line} (${s.reason})`).join(', ')}.</p>}
        </div>
      )}
    </section>
  );
}
