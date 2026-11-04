'use client';

import { formatPaise } from '@/lib/gst';

export type ColumnKind = 'text' | 'money' | 'number' | 'pct';

export interface ReportTable {
  key: string;
  title: string;
  subtitle: string;
  columns: Array<{ key: string; label: string; kind: ColumnKind }>;
  rows: Array<{ cells: Array<string | number | null>; style?: 'group' | 'total' | 'grand'; indent?: number }>;
  notes: string[];
}

function cell(kind: ColumnKind, v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (kind === 'money') return formatPaise(v);
  if (kind === 'pct') return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  return Number.isInteger(v) ? v.toLocaleString('en-IN') : String(Math.round(v * 1000) / 1000);
}

/** Any report as a table: money in mono, subtotals in bold, the rows an answer used marked. */
export function ReportTableView({ table, highlight = [], compact = false }: { table: ReportTable; highlight?: number[]; compact?: boolean }) {
  const marked = new Set(highlight);
  const pad = compact ? 'px-2 py-1' : 'px-3 py-2';
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-line-200 bg-surface-card">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-line-200 bg-surface-sink">
              {table.columns.map((c) => (
                <th key={c.key} className={`${pad} text-caption font-medium text-ink-500 ${c.kind === 'text' ? 'text-left' : 'text-right'} whitespace-nowrap`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr
                key={i}
                className={[
                  'border-b border-line-100 last:border-0',
                  r.style === 'group' ? 'bg-surface-sink/60' : '',
                  r.style === 'grand' ? 'bg-surface-sink font-semibold' : '',
                  r.style === 'total' ? 'font-semibold' : '',
                  marked.has(i) ? 'bg-pending-bg' : '',
                ].join(' ')}
              >
                {r.cells.map((v, c) => {
                  const kind = table.columns[c]?.kind ?? 'text';
                  return (
                    <td
                      key={c}
                      className={`${pad} ${kind === 'text' ? 'text-left text-ink-900' : 'text-right font-mono tabular-nums text-ink-900'} ${c === 0 && r.indent ? 'pl-7' : ''} ${r.style === 'group' ? 'text-caption uppercase tracking-wide text-ink-500' : ''}`}
                    >
                      {cell(kind, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.rows.length === 0 && <tr><td className={`${pad} text-ink-500`} colSpan={table.columns.length}>Nothing in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      {table.notes.map((n) => <p key={n} className="text-caption text-ink-500">{n}</p>)}
    </div>
  );
}
