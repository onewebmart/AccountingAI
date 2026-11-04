'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError, downloadFile } from '@/lib/api';
import { formatRupees } from '@/lib/utils';

type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

interface Form26q {
  quarter: Quarter;
  dueDate: string;
  deductor: { name: string; tan: string | null };
  deductees: Array<{ pan: string; name: string; section: string; paidOn: string; amountPaise: number; tdsPaise: number; challanNumber: string | null; remark: string }>;
  totals: { amountPaise: number; tdsPaise: number; depositedPaise: number; interestPaise: number };
  certificates: Array<{ name: string; pan: string; section: string; amountPaise: number; tdsPaise: number; depositedPaise: number }>;
  issues: Array<{ level: 'block' | 'warn'; message: string }>;
  ready: boolean;
}

const QUARTERS: Array<{ q: Quarter; label: string }> = [
  { q: 'Q1', label: 'Q1 · Apr–Jun' },
  { q: 'Q2', label: 'Q2 · Jul–Sep' },
  { q: 'Q3', label: 'Q3 · Oct–Dec' },
  { q: 'Q4', label: 'Q4 · Jan–Mar' },
];

/**
 * The quarter's 26Q, checked, and what each vendor's Form 16A will show.
 * The CSV is keyed into Protean's RPU, which makes the file the FVU checks;
 * the certificates themselves come from TRACES.
 */
export function Form26qPanel({ financialYear }: { financialYear: string }) {
  const [quarter, setQuarter] = useState<Quarter>('Q1');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tds', '26q', financialYear, quarter],
    queryFn: () => api.get<Form26q>(`/tds/26q?financialYear=${financialYear}&quarter=${quarter}`),
  });
  const th = 'px-3 py-2 text-left text-caption font-semibold uppercase tracking-wide text-ink-500';
  const td = 'px-3 py-2 text-body text-ink-900';

  return (
    <section className="space-y-3 rounded-xl border border-line-200 bg-surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-display text-ink-900">Form 26Q</h2>
          <p className="text-caption text-ink-500">The quarterly statement of TDS on payments to residents.{data ? ` Due ${data.dueDate}.` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-9 rounded-md border border-line-200 bg-white px-2 text-caption" value={quarter} onChange={(e) => setQuarter(e.target.value as Quarter)}>
            {QUARTERS.map((x) => <option key={x.q} value={x.q}>{x.label}</option>)}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!data || data.deductees.length === 0}
            onClick={async () => {
              setDownloadError(null);
              try {
                await downloadFile(`/tds/26q/csv?financialYear=${financialYear}&quarter=${quarter}`, `26Q-${financialYear}-${quarter}.csv`);
              } catch (err) {
                setDownloadError(err instanceof Error ? err.message : 'Could not download.');
              }
            }}
          >
            <Download size={13} /> Download 26Q (CSV)
          </Button>
        </div>
      </div>
      {downloadError && <p className="text-caption text-error-fg">{downloadError}</p>}
      {isLoading && <p className="text-caption text-ink-400">Loading…</p>}
      {isError && <p className="text-caption text-error-fg">{error instanceof ApiError ? error.message : 'Could not build the statement.'}</p>}
      {data && (
        <>
          {data.issues.length > 0 && (
            <ul className="space-y-1">
              {data.issues.map((i, n) => (
                <li key={n} className={`rounded-md p-2 text-caption ${i.level === 'block' ? 'bg-error-bg text-error-fg' : 'bg-pending-bg text-pending-fg'}`}>{i.message}</li>
              ))}
            </ul>
          )}
          {data.deductees.length === 0 ? (
            <p className="text-caption text-ink-500">No TDS deducted this quarter: a nil statement still needs filing if you have a TAN.</p>
          ) : (
            <>
              <p className="text-caption text-ink-600">
                {data.deductees.length} deduction{data.deductees.length === 1 ? '' : 's'} · paid {formatRupees(data.totals.amountPaise)} · TDS {formatRupees(data.totals.tdsPaise)} · deposited {formatRupees(data.totals.depositedPaise)}
                {data.ready && <span className="ml-2 text-success-fg">Ready to prepare in the RPU.</span>}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-200">
                      <th className={th}>Vendor (Form 16A)</th>
                      <th className={th}>PAN</th>
                      <th className={th}>Section</th>
                      <th className={th}>Paid or credited</th>
                      <th className={th}>TDS</th>
                      <th className={th}>Deposited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.certificates.map((c) => (
                      <tr key={`${c.pan}-${c.name}-${c.section}`} className="border-b border-line-100 last:border-0">
                        <td className={td}>{c.name}</td>
                        <td className={`${td} font-mono text-caption`}>{c.pan === 'PANNOTAVBL' ? <span className="text-error-fg">No PAN</span> : c.pan}</td>
                        <td className={`${td} font-mono text-caption`}>{c.section}</td>
                        <td className={`${td} font-mono`}>{formatRupees(c.amountPaise)}</td>
                        <td className={`${td} font-mono`}>{formatRupees(c.tdsPaise)}</td>
                        <td className={`${td} font-mono ${c.depositedPaise < c.tdsPaise ? 'text-error-fg' : ''}`}>{formatRupees(c.depositedPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-caption text-ink-500">
                After the statement is processed, download each vendor&apos;s Form 16A from TRACES: only that certificate is valid. It will show the figures above.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
