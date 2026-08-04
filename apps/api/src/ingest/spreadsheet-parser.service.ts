import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';

export interface ParsedSheet {
  name: string;
  /** Normalised header labels, lower-cased and de-spaced for matching. */
  headers: string[];
  /** Header labels exactly as they appear in the file. */
  rawHeaders: string[];
  rows: Array<Record<string, string>>;
}

export const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
]);

export function isSpreadsheet(mimeType: string, fileName: string): boolean {
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) return true;
  return /\.(xlsx|xls|csv)$/i.test(fileName);
}

/** "Txn Date " -> "txndate" — used for tolerant header matching. */
export function normaliseHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Excel serial dates, JS dates and common Indian text formats all land as YYYY-MM-DD. */
export function toIsoDate(value: unknown): string | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();

  // Already ISO
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd/mm/yyyy or dd-mm-yy — the dominant Indian bank/invoice format
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    let year = dmy[3];
    if (year.length === 2) year = Number(year) > 70 ? `19${year}` : `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // dd-Mon-yyyy (e.g. 05-Apr-2025)
  const dMonY = raw.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,})[\s\-/](\d{2,4})$/);
  if (dMonY) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const idx = months.indexOf(dMonY[2].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const day = dMonY[1].padStart(2, '0');
      let year = dMonY[3];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${String(idx + 1).padStart(2, '0')}-${day}`;
    }
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

/**
 * Parse a rupee amount into integer paise (Invariant 1).
 * Handles "₹1,32,000.50", "1320.00 Cr", "(500)" for negatives and blank cells.
 */
export function toPaise(value: unknown): number | null {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return Math.round(value * 100);
  }

  let raw = String(value).trim();
  if (!raw) return null;

  const isParenNegative = /^\(.*\)$/.test(raw);
  const isCredit = /\bcr\b/i.test(raw);
  const isDebit = /\bdr\b/i.test(raw);

  raw = raw
    .replace(/[()]/g, '')
    .replace(/\b(cr|dr)\b/gi, '')
    .replace(/[₹$,\s]/g, '')
    .trim();

  if (!raw || !/^-?\d*\.?\d+$/.test(raw)) return null;

  const rupees = parseFloat(raw);
  if (!isFinite(rupees)) return null;

  const sign = isParenNegative ? -1 : 1;
  const paise = Math.round(Math.abs(rupees) * 100) * sign * (rupees < 0 ? -1 : 1);

  // "Cr"/"Dr" suffixes carry direction, not magnitude — the caller decides the column.
  void isCredit;
  void isDebit;

  return paise;
}

const MAX_ROWS_PER_SHEET = 20000;

@Injectable()
export class SpreadsheetParserService {
  private readonly logger = new Logger(SpreadsheetParserService.name);

  async parse(buffer: Buffer, fileName: string): Promise<ParsedSheet[]> {
    const isCsv = /\.csv$/i.test(fileName);
    const workbook = new ExcelJS.Workbook();

    try {
      if (isCsv) {
        await workbook.csv.read(Readable.from(buffer.toString('utf8')));
      } else {
        await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      }
    } catch (err) {
      throw new BadRequestException(
        `Could not read "${fileName}" as a spreadsheet: ${String(err)}`,
      );
    }

    const sheets: ParsedSheet[] = [];

    workbook.eachSheet((worksheet) => {
      const parsed = this.parseWorksheet(worksheet);
      if (parsed) sheets.push(parsed);
    });

    if (sheets.length === 0) {
      throw new BadRequestException(`No readable data found in "${fileName}".`);
    }

    this.logger.log(
      `Parsed "${fileName}": ${sheets.length} sheet(s), ` +
        sheets.map((s) => `${s.name}=${s.rows.length} rows`).join(', '),
    );

    return sheets;
  }

  private parseWorksheet(worksheet: ExcelJS.Worksheet): ParsedSheet | null {
    const headerRowIndex = this.findHeaderRow(worksheet);
    if (headerRowIndex === null) return null;

    const headerRow = worksheet.getRow(headerRowIndex);
    const rawHeaders: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      rawHeaders[col - 1] = this.cellText(cell);
    });

    const headers = rawHeaders.map((h) => normaliseHeader(h ?? ''));
    const rows: Array<Record<string, string>> = [];

    for (
      let r = headerRowIndex + 1;
      r <= Math.min(worksheet.rowCount, headerRowIndex + MAX_ROWS_PER_SHEET);
      r++
    ) {
      const row = worksheet.getRow(r);
      const record: Record<string, string> = {};
      let hasValue = false;

      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const key = headers[col - 1];
        if (!key) return;
        const text = this.cellText(cell);
        if (text) hasValue = true;
        record[key] = text;
      });

      if (hasValue) rows.push(record);
    }

    return { name: worksheet.name, headers: headers.filter(Boolean), rawHeaders, rows };
  }

  /**
   * Bank exports and GST portal downloads bury the real header under a few title
   * rows, so scan the first 25 rows for the one with the most non-empty text cells.
   */
  private findHeaderRow(worksheet: ExcelJS.Worksheet): number | null {
    let best: { index: number; score: number } | null = null;

    for (let r = 1; r <= Math.min(worksheet.rowCount, 25); r++) {
      const row = worksheet.getRow(r);
      let filled = 0;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = this.cellText(cell);
        // Headers are short labels, not data — long strings and pure numbers score 0.
        if (text && text.length <= 60 && !/^-?[\d,.₹\s]+$/.test(text)) filled++;
      });
      if (filled >= 2 && (!best || filled > best.score)) {
        best = { index: r, score: filled };
      }
    }

    return best?.index ?? null;
  }

  private cellText(cell: ExcelJS.Cell): string {
    const value = cell.value;
    if (value == null) return '';

    if (value instanceof Date) return value.toISOString().slice(0, 10);

    if (typeof value === 'object') {
      const obj = value as unknown as Record<string, unknown>;
      if ('text' in obj) return String(obj.text ?? '').trim();
      if ('result' in obj) return String(obj.result ?? '').trim();
      if ('richText' in obj && Array.isArray(obj.richText)) {
        return (obj.richText as Array<{ text?: string }>)
          .map((t) => t.text ?? '')
          .join('')
          .trim();
      }
      if ('hyperlink' in obj) return String(obj.text ?? obj.hyperlink ?? '').trim();
      return '';
    }

    return String(value).trim();
  }
}
