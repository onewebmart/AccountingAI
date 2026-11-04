/**
 * Any report table as a PDF: the org and the report on every page, the
 * column heads repeated, subtotals in bold, and its notes at the end. Pure:
 * the same table always gives the same file.
 */
import { MARGIN, PAGE_H, PAGE_W, Page, assemble, displayDate, money, widthOf, wrap } from '../common/pdf';
import { ReportTable, cellText } from './report-table';

const SIZE = 8;
const ROW_H = 13;

/** Text cut to a width, with an ellipsis when it does not fit. */
function fit(text: string, max: number, bold = false): string {
  if (widthOf(text, SIZE, bold) <= max) return text;
  let s = text;
  while (s.length > 1 && widthOf(`${s}...`, SIZE, bold) > max) s = s.slice(0, -1);
  return `${s}...`;
}

export function renderReportPdf(t: ReportTable, org: { name: string; gstin?: string | null }, generatedOn: string): Buffer {
  const landscape = t.columns.length > 6;
  const W = landscape ? PAGE_H : PAGE_W;
  const H = landscape ? PAGE_W : PAGE_H;
  const left = MARGIN;
  const right = W - MARGIN;
  const usable = right - left;
  // The first column names things; the rest share what is left.
  const first = t.columns.length <= 3 ? usable * 0.5 : Math.max(usable * 0.24, Math.min(usable * 0.36, 190));
  const rest = (usable - first) / Math.max(1, t.columns.length - 1);
  const x = t.columns.map((_, i) => (i === 0 ? left : left + first + rest * (i - 1)));
  const width = (i: number) => (i === 0 ? first : rest);
  const numeric = (i: number) => t.columns[i].kind !== 'text';
  const heads = t.columns.map((c, i) => wrap(c.label, SIZE, width(i) - 6, true).slice(0, 2));
  const headH = Math.max(...heads.map((h) => h.length)) * 10 + 6;

  const pages: Page[] = [];
  let page!: Page;
  let y = 0;
  const start = () => {
    page = new Page(W, H);
    pages.push(page);
    y = H - MARGIN;
    page.text(left, y - 10, org.name, 12, true);
    if (org.gstin) page.right(right, y - 10, `GSTIN ${org.gstin}`, 8);
    page.text(left, y - 26, t.title, 11, true);
    page.text(left, y - 39, `${t.subtitle}. Amounts in Rs.`, 8.5);
    y -= 52;
    page.box(left, y - headH, usable, headH, 0.92);
    heads.forEach((lines, i) =>
      lines.forEach((l, n) => (numeric(i) ? page.right(x[i] + width(i) - 3, y - 11 - n * 10, l, SIZE, true) : page.text(x[i] + 3, y - 11 - n * 10, l, SIZE, true))),
    );
    y -= headH + 2;
  };
  start();

  for (const row of t.rows) {
    if (y - ROW_H < MARGIN + 20) start();
    const bold = row.style === 'group' || row.style === 'total' || row.style === 'grand';
    if (row.style === 'grand') page.box(left, y - ROW_H + 3, usable, ROW_H, 0.95);
    if (row.style === 'total' || row.style === 'grand') page.line(left, y + 2, right, y + 2, 0.6);
    row.cells.forEach((v, i) => {
      const kind = t.columns[i]?.kind ?? 'text';
      if (v === null || v === undefined || v === '') return;
      if (numeric(i)) {
        const s = kind === 'money' && typeof v === 'number' ? money(v) : cellText(kind, v);
        page.right(x[i] + width(i) - 3, y - 8, fit(s, width(i) - 6, bold), SIZE, bold);
      } else {
        const indent = i === 0 ? (row.indent ?? 0) * 10 : 0;
        page.text(x[i] + 3 + indent, y - 8, fit(String(v), width(i) - 6 - indent, bold), SIZE, bold);
      }
    });
    y -= ROW_H;
    if (!row.style) page.line(left, y + 2, right, y + 2, 0.92);
  }

  if (t.notes.length) {
    y -= 8;
    for (const note of t.notes) {
      for (const l of wrap(note, 7.5, usable)) {
        if (y - 10 < MARGIN + 10) start();
        page.text(left, y - 8, l, 7.5);
        y -= 10;
      }
    }
  }

  pages.forEach((p, i) => {
    p.text(left, MARGIN - 14, `Generated on ${displayDate(generatedOn)} from the books. Figures computed, not estimated.`, 7);
    p.right(right, MARGIN - 14, `Page ${i + 1} of ${pages.length}`, 7);
  });
  return assemble(pages);
}
