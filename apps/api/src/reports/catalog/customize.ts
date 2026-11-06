/**
 * A built-in report made one's own: its columns chosen and ordered, its
 * rows filtered, grouped with subtotals and sorted. Pure: it reshapes a
 * report table the books already produced and never reads anything else,
 * so the figures it shows are the report's own.
 */
import { BadRequestException } from '@nestjs/common';
import { ReportColumn, ReportRow, ReportTable } from '../report-table';
import type { ReportCondition } from '../schemas/custom-report.schema';
import type { ReportShape } from './types';

export interface Customization {
  columns: string[];
  conditions: ReportCondition[];
  groupBy: string | null;
  groupTotalsOnly: boolean;
  sortBy: string | null;
  sortDir: 'asc' | 'desc';
}

export const TEXT_OPS = ['contains', 'equals', 'not_equals'] as const;
export const NUMBER_OPS = ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte'] as const;

/** A change in the conditions or columns a report no longer has is refused, not quietly ignored. */
export function checkCustomization(columns: ReportColumn[], shape: ReportShape, c: Customization) {
  const keys = new Set(columns.map((x) => x.key));
  const kind = new Map(columns.map((x) => [x.key, x.kind]));
  if (c.columns.length > 40) throw new BadRequestException('Forty columns at most.');
  for (const k of c.columns) if (!keys.has(k)) throw new BadRequestException(`The report has no column ${k}.`);
  if (new Set(c.columns).size !== c.columns.length) throw new BadRequestException('Each column once.');
  if (shape === 'statement') {
    if (c.conditions.length || c.groupBy || c.sortBy) throw new BadRequestException('A statement keeps its rows in order: only its columns can be chosen.');
    return;
  }
  if (c.conditions.length > 10) throw new BadRequestException('Ten conditions at most.');
  for (const cond of c.conditions) {
    const k = kind.get(cond.field);
    if (!k) throw new BadRequestException(`The report has no column ${cond.field}.`);
    const ops: readonly string[] = k === 'text' ? TEXT_OPS : NUMBER_OPS;
    if (!ops.includes(cond.op)) throw new BadRequestException(`${cond.op} does not apply to ${cond.field}.`);
    if (k === 'text' && (typeof cond.value !== 'string' || cond.value.length > 100)) throw new BadRequestException(`The value for ${cond.field} is text, up to 100 letters.`);
    if (k !== 'text' && (typeof cond.value !== 'number' || !Number.isFinite(cond.value))) throw new BadRequestException(`The value for ${cond.field} is a number.`);
    if (k === 'money' && !Number.isInteger(cond.value)) throw new BadRequestException(`The amount for ${cond.field} is in whole paise.`);
  }
  if (c.groupBy && kind.get(c.groupBy) !== 'text') throw new BadRequestException('Group by a text column.');
  if (c.sortBy && !keys.has(c.sortBy)) throw new BadRequestException(`The report has no column ${c.sortBy}.`);
}

type Cell = string | number | null;

function passes(cell: Cell, cond: ReportCondition, isText: boolean): boolean {
  if (isText) {
    const a = String(cell ?? '').toLowerCase();
    const b = String(cond.value ?? '').toLowerCase();
    return cond.op === 'contains' ? a.includes(b) : cond.op === 'equals' ? a === b : a !== b;
  }
  const v = typeof cell === 'number' ? cell : null;
  const b = Number(cond.value);
  if (v === null) return cond.op === 'not_equals';
  switch (cond.op) {
    case 'equals': return v === b;
    case 'not_equals': return v !== b;
    case 'gt': return v > b;
    case 'gte': return v >= b;
    case 'lt': return v < b;
    case 'lte': return v <= b;
    default: return true;
  }
}

const compare = (a: Cell, b: Cell) => {
  if (a === null || a === '') return b === null || b === '' ? 0 : 1;
  if (b === null || b === '') return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en-IN', { numeric: true });
};

export function customize(t: ReportTable, shape: ReportShape, c: Customization, meta: { key: string; title: string }): ReportTable {
  checkCustomization(t.columns, shape, c);
  const chosen = c.columns.length ? c.columns : t.columns.map((x) => x.key);
  // A statement always keeps its first column: it names the rows.
  const order = shape === 'statement' && !chosen.includes(t.columns[0].key) ? [t.columns[0].key, ...chosen] : chosen;
  const idx = order.map((k) => t.columns.findIndex((x) => x.key === k));
  const project = (cells: Cell[]) => idx.map((i) => cells[i] ?? null);
  const columns = idx.map((i) => t.columns[i]);

  if (shape === 'statement') {
    return { ...t, key: meta.key, title: meta.title, columns, rows: t.rows.map((r) => ({ ...r, cells: project(r.cells) })) };
  }

  const data = t.rows.filter((r) => !r.style);
  const grand = t.rows.find((r) => r.style === 'grand');
  // A column adds up if the report's own total line is its sum (no averages, no shares).
  const summable = t.columns.map((col, i) => {
    if (col.kind === 'text' || col.kind === 'pct') return false;
    if (!grand) return col.kind === 'money';
    const g = grand.cells[i];
    if (typeof g !== 'number') return false;
    const s = data.reduce((acc, r) => acc + (typeof r.cells[i] === 'number' ? (r.cells[i] as number) : 0), 0);
    return Math.abs(s - g) < 0.01;
  });
  const sum = (rows: ReportRow[], i: number) => {
    const s = rows.reduce((acc, r) => acc + (typeof r.cells[i] === 'number' ? (r.cells[i] as number) : 0), 0);
    return t.columns[i].kind === 'money' ? Math.round(s) : Math.round(s * 1000) / 1000;
  };
  const totalCells = (rows: ReportRow[]) => t.columns.map((_, i) => (summable[i] ? sum(rows, i) : null)) as Cell[];

  const colIndex = (k: string) => t.columns.findIndex((x) => x.key === k);
  let rows = data.filter((r) => c.conditions.every((cond) => passes(r.cells[colIndex(cond.field)], cond, t.columns[colIndex(cond.field)].kind === 'text')));
  if (c.sortBy) {
    const i = colIndex(c.sortBy);
    rows = [...rows].sort((a, b) => (c.sortDir === 'desc' ? -1 : 1) * compare(a.cells[i], b.cells[i]));
  }

  const out: ReportRow[] = [];
  const withLabel = (cells: Cell[], label: string) => {
    const p = project(cells);
    const first = columns[0];
    if (first && first.kind === 'text') p[0] = label;
    return p;
  };
  if (c.groupBy) {
    const g = colIndex(c.groupBy);
    const groups = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const k = String(r.cells[g] ?? '') || '(blank)';
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    const keys = [...groups.keys()].sort((a, b) => (c.sortBy === c.groupBy && c.sortDir === 'desc' ? -1 : 1) * a.localeCompare(b, 'en-IN', { numeric: true }));
    for (const k of keys) {
      const list = groups.get(k)!;
      if (c.groupTotalsOnly) {
        const cells = totalCells(list);
        cells[g] = k;
        out.push({ cells: project(cells) });
        continue;
      }
      out.push({ cells: columns.map((_, i) => (i === 0 ? k : null)), style: 'group' });
      for (const r of list) out.push({ cells: project(r.cells), indent: 1 });
      out.push({ cells: withLabel(totalCells(list), `Total ${k}`), style: 'total' });
    }
  } else {
    for (const r of rows) out.push({ cells: project(r.cells) });
  }
  if (rows.length && summable.some(Boolean)) out.push({ cells: withLabel(totalCells(rows), 'Total'), style: 'grand' });

  const notes = [...t.notes];
  if (c.conditions.length) notes.unshift(`Filtered: ${c.conditions.map((x) => `${t.columns[colIndex(x.field)].label} ${x.op.replace('_', ' ')} ${typeof x.value === 'number' && t.columns[colIndex(x.field)].kind === 'money' ? (x.value / 100).toFixed(2) : x.value}`).join('; ')}.`);
  return { ...t, key: meta.key, title: meta.title, columns, rows: out, notes };
}
