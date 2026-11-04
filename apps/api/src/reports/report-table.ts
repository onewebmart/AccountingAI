/**
 * One shape for every report, so a page, a PDF, a CSV, a scheduled email and
 * an answer to a question all read the same rows. Money stays integer paise
 * in the cells; only the renderer formats it.
 */

export type ColumnKind = 'text' | 'money' | 'number' | 'pct';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
}

export interface ReportRow {
  cells: Array<string | number | null>;
  /** group: a heading row; total: a subtotal; grand: the bottom line. */
  style?: 'group' | 'total' | 'grand';
  indent?: number;
}

export interface ReportTable {
  key: string;
  title: string;
  /** The period or date it covers, in words. */
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** What the figures leave out or how they were worked out. */
  notes: string[];
}

export const rupees = (paise: number) =>
  `${paise < 0 ? '-' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One cell as text: ₹1,25,000.00, 12.5%, 40. */
export function cellText(kind: ColumnKind, v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (kind === 'money') return rupees(v);
  if (kind === 'pct') return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

export function toCsv(t: ReportTable): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = t.columns.map((c) => esc(c.label)).join(',');
  // Money in rupees with two decimals, no symbol or grouping, so a spreadsheet reads it as a number.
  const body = t.rows.map((r) =>
    r.cells
      .map((v, i) => {
        const kind = t.columns[i]?.kind ?? 'text';
        if (v === null || v === undefined) return '';
        if (typeof v === 'number' && kind === 'money') return (v / 100).toFixed(2);
        if (typeof v === 'number' && kind === 'pct') return v.toFixed(1);
        return esc(String(v));
      })
      .join(','),
  );
  return [esc(t.title), esc(t.subtitle), '', head, ...body, '', ...t.notes.map(esc)].join('\n');
}

/** Change as a percentage of the base, one decimal; null when there is no base. */
export const pctChange = (now: number, base: number) => (base === 0 ? null : Math.round(((now - base) / Math.abs(base)) * 1000) / 10);
