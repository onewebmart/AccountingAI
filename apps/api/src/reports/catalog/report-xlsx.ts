/**
 * Any report table as an Excel workbook: the org and the report on top,
 * the column heads frozen, money as numbers in rupees (two decimals) so the
 * sheet can add them up, subtotals in bold and the notes underneath.
 */
import * as ExcelJS from 'exceljs';
import { ReportTable } from '../report-table';

export async function renderReportXlsx(t: ReportTable, org: { name: string; gstin?: string | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AiBooks';
  wb.created = new Date();
  const sheet = wb.addWorksheet(t.title.replace(/[*?:\\/[\]]/g, '').slice(0, 31) || 'Report');
  sheet.addRow([org.name]).font = { bold: true, size: 13 };
  sheet.addRow([t.title]).font = { bold: true, size: 12 };
  sheet.addRow([`${t.subtitle}${org.gstin ? ` · GSTIN ${org.gstin}` : ''}. Amounts in rupees.`]);
  sheet.addRow([]);
  const head = sheet.addRow(t.columns.map((c) => c.label));
  head.font = { bold: true };
  head.eachCell((cell, i) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6EFE3' } };
    cell.alignment = { horizontal: t.columns[i - 1]?.kind === 'text' ? 'left' : 'right', wrapText: true };
  });
  const headRow = head.number;
  for (const r of t.rows) {
    const row = sheet.addRow(
      r.cells.map((v, i) => {
        const kind = t.columns[i]?.kind ?? 'text';
        if (v === null || v === undefined) return null;
        if (typeof v === 'number' && kind === 'money') return Math.round(v) / 100;
        if (typeof v === 'number' && kind === 'pct') return v / 100;
        return v;
      }),
    );
    row.eachCell((cell, i) => {
      const kind = t.columns[i - 1]?.kind ?? 'text';
      if (kind === 'money') cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      if (kind === 'pct') cell.numFmt = '0.0%';
      if (kind !== 'text') cell.alignment = { horizontal: 'right' };
      else if (i === 1 && r.indent) cell.alignment = { indent: r.indent };
    });
    if (r.style) row.font = { bold: true };
    if (r.style === 'grand') row.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
  }
  if (t.notes.length) {
    sheet.addRow([]);
    for (const n of t.notes) sheet.addRow([n]).font = { italic: true, size: 9 };
  }
  sheet.columns.forEach((col, i) => {
    let widest = i === 0 ? 24 : 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      if (Number(cell.row) <= headRow - 1 || Number(cell.row) > headRow + t.rows.length) return;
      widest = Math.max(widest, String(cell.value ?? '').length + 2);
    });
    col.width = Math.min(widest, 48);
  });
  sheet.views = [{ state: 'frozen', ySplit: headRow }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
