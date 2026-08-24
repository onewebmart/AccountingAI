import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

/**
 * Turns an already-built CSV report into a formatted .xlsx.
 *
 * Deliberately layered on the CSV builders rather than duplicating the report
 * logic: two independent renderings of the same report is two places for the
 * numbers to diverge, and a Trial Balance that balances in one export and not
 * the other is worse than having no Excel export at all.
 */
@Injectable()
export class ExcelExportService {
  async fromCsv(csv: string, sheetName: string, title: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AiBooks';
    workbook.created = new Date();

    // Excel caps sheet names at 31 characters and rejects several punctuation
    // marks outright, so a report title cannot be used verbatim.
    const sheet = workbook.addWorksheet(sheetName.replace(/[*?:\\/\[\]]/g, '').slice(0, 31));

    const rows = parseCsv(csv);

    sheet.addRow([title]);
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.addRow([]);

    const headerRowNumber = 3;

    for (const cells of rows) {
      sheet.addRow(cells);
    }

    const header = sheet.getRow(headerRowNumber);
    header.font = { bold: true };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF6EFE3' },
    };
    header.border = { bottom: { style: 'thin', color: { argb: 'FFEBE3D7' } } };

    // Right-align and format anything that parsed as a number, so amounts read
    // as amounts rather than as text that happens to contain digits.
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        }
      });
    });

    sheet.columns.forEach((column) => {
      let widest = 12;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        widest = Math.max(widest, String(cell.value ?? '').length + 2);
      });
      column.width = Math.min(widest, 48);
    });

    sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

/**
 * Minimal RFC-4180 CSV parse — enough for the reports this service produces,
 * which quote fields containing commas and escape quotes by doubling them.
 * Numeric-looking cells become numbers so Excel can total them.
 */
function parseCsv(csv: string): (string | number)[][] {
  const rows: (string | number)[][] = [];
  let row: (string | number)[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    const trimmed = field.trim();
    // Only treat it as a number when the whole cell is one — "2026-27" and
    // "INV-001" must stay text.
    const asNumber = Number(trimmed.replace(/,/g, ''));
    row.push(trimmed !== '' && Number.isFinite(asNumber) && /^-?[\d,]+(\.\d+)?$/.test(trimmed)
      ? asNumber
      : field);
    field = '';
  };

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];

    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushField();
      rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length) {
    pushField();
    rows.push(row);
  }

  return rows;
}
