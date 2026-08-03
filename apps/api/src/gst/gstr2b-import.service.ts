import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  SpreadsheetParserService,
  normaliseHeader,
  toIsoDate,
  toPaise,
} from '../ingest/spreadsheet-parser.service';
import { ImportGstr2bLineDto } from './gst.service';

export interface Gstr2bParseResult {
  period: string;
  lines: ImportGstr2bLineDto[];
  warnings: string[];
}

/**
 * Header synonyms across the GST portal's GSTR-2B exports. The portal ships both
 * an Excel workbook and a JSON download, and the Excel column labels differ
 * between the B2B, CDNR and ISD sheets.
 */
const COLS = {
  gstin: ['gstinofsupplier', 'suppliergstin', 'gstin', 'gstinuin', 'ctin'],
  name: ['tradelegalname', 'tradename', 'legalname', 'suppliername', 'name'],
  invoiceNo: ['invoicenumber', 'invoiceno', 'documentnumber', 'documentno', 'noteno', 'inum'],
  invoiceDate: ['invoicedate', 'documentdate', 'notedate', 'idt', 'dt'],
  taxable: ['taxablevalue', 'taxablevaluers', 'taxableamount', 'txval'],
  cgst: ['centraltax', 'cgst', 'centraltaxrs', 'camt'],
  sgst: ['stateutterritorytax', 'statetax', 'sgst', 'sgstutgst', 'samt'],
  igst: ['integratedtax', 'igst', 'integratedtaxrs', 'iamt'],
  cess: ['cess', 'cessrs', 'csamt'],
  total: ['invoicevalue', 'totalinvoicevalue', 'val'],
  reverseCharge: ['reversecharge', 'supplyattractreversecharge', 'rchrg'],
} as const;

type ColKey = keyof typeof COLS;

function findColumn(headers: string[], key: ColKey): string | null {
  const synonyms = COLS[key] as readonly string[];
  for (const syn of synonyms) {
    const hit = headers.find((h) => h === syn);
    if (hit) return hit;
  }
  for (const syn of synonyms) {
    const hit = headers.find((h) => h.includes(syn));
    if (hit) return hit;
  }
  return null;
}

/** "2025-04" from a date, used when the file does not state its own period. */
function periodOf(dateStr: string | null): string | null {
  return dateStr ? dateStr.slice(0, 7) : null;
}

@Injectable()
export class Gstr2bImportService {
  private readonly logger = new Logger(Gstr2bImportService.name);

  constructor(private parser: SpreadsheetParserService) {}

  /**
   * Parse a GSTR-2B download into importable lines.
   * Accepts the portal's JSON download or its Excel/CSV export.
   */
  async parse(
    buffer: Buffer,
    fileName: string,
    requestedPeriod?: string,
  ): Promise<Gstr2bParseResult> {
    const isJson = /\.json$/i.test(fileName) || buffer.subarray(0, 1).toString() === '{';
    const result = isJson
      ? this.parseJson(buffer, requestedPeriod)
      : await this.parseSheet(buffer, fileName, requestedPeriod);

    if (result.lines.length === 0) {
      throw new BadRequestException(
        `No GSTR-2B invoice rows found in "${fileName}". Expected supplier GSTIN, invoice number and tax columns.`,
      );
    }

    this.logger.log(
      `Parsed GSTR-2B "${fileName}": ${result.lines.length} lines for period ${result.period}`,
    );
    return result;
  }

  /** The portal's JSON download: docdata.b2b[].inv[] under a common ctin. */
  private parseJson(buffer: Buffer, requestedPeriod?: string): Gstr2bParseResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch (err) {
      throw new BadRequestException(`Could not read the GSTR-2B JSON: ${String(err)}`);
    }

    const root = parsed as Record<string, unknown>;
    const data = (root.data ?? root) as Record<string, unknown>;
    const docdata = (data.docdata ?? data) as Record<string, unknown>;
    const b2b = Array.isArray(docdata.b2b) ? (docdata.b2b as Record<string, unknown>[]) : [];

    const lines: ImportGstr2bLineDto[] = [];
    const warnings: string[] = [];
    let period = requestedPeriod ?? (typeof data.rtnprd === 'string' ? this.fromRtnprd(data.rtnprd) : '');

    for (const supplier of b2b) {
      const gstin = typeof supplier.ctin === 'string' ? supplier.ctin : null;
      const name = typeof supplier.trdnm === 'string' ? supplier.trdnm : null;
      const invoices = Array.isArray(supplier.inv) ? (supplier.inv as Record<string, unknown>[]) : [];

      for (const inv of invoices) {
        const items = Array.isArray(inv.items) ? (inv.items as Record<string, unknown>[]) : [inv];
        const sum = (key: string) =>
          items.reduce((s, it) => s + toRupeePaise(it[key] ?? (inv as Record<string, unknown>)[key]), 0);

        const invoiceDate = toIsoDate(inv.dt);
        if (!period) period = periodOf(invoiceDate) ?? '';

        lines.push({
          supplierGstin: gstin,
          supplierName: name,
          invoiceNumber: typeof inv.inum === 'string' ? inv.inum : null,
          invoiceDate,
          documentType: 'B2B',
          isReverseCharge: inv.rev === 'Y',
          taxableValuePaise: sum('txval'),
          cgstPaise: sum('camt'),
          sgstPaise: sum('samt'),
          igstPaise: sum('iamt'),
          cessPaise: sum('csamt'),
        });
      }
    }

    return { period, lines, warnings };
  }

  /** "042025" (MMYYYY) as the portal writes it -> "2025-04". */
  private fromRtnprd(rtnprd: string): string {
    const m = rtnprd.match(/^(\d{2})(\d{4})$/);
    return m ? `${m[2]}-${m[1]}` : '';
  }

  private async parseSheet(
    buffer: Buffer,
    fileName: string,
    requestedPeriod?: string,
  ): Promise<Gstr2bParseResult> {
    const sheets = await this.parser.parse(buffer, fileName);
    const lines: ImportGstr2bLineDto[] = [];
    const warnings: string[] = [];
    let period = requestedPeriod ?? '';

    for (const sheet of sheets) {
      const h = sheet.headers;
      const cols = {
        gstin: findColumn(h, 'gstin'),
        name: findColumn(h, 'name'),
        invoiceNo: findColumn(h, 'invoiceNo'),
        invoiceDate: findColumn(h, 'invoiceDate'),
        taxable: findColumn(h, 'taxable'),
        cgst: findColumn(h, 'cgst'),
        sgst: findColumn(h, 'sgst'),
        igst: findColumn(h, 'igst'),
        cess: findColumn(h, 'cess'),
        reverseCharge: findColumn(h, 'reverseCharge'),
      };

      // Skip summary/help sheets that carry none of the invoice columns.
      if (!cols.gstin && !cols.invoiceNo) continue;

      for (const [index, row] of sheet.rows.entries()) {
        const gstin = (cols.gstin ? row[cols.gstin] : '') || null;
        const invoiceNumber = (cols.invoiceNo ? row[cols.invoiceNo] : '') || null;
        if (!gstin && !invoiceNumber) continue;

        const taxable = cols.taxable ? toPaise(row[cols.taxable]) : null;
        if (taxable == null) {
          warnings.push(`${sheet.name} row ${index + 2}: no taxable value — skipped.`);
          continue;
        }

        const invoiceDate = toIsoDate(cols.invoiceDate ? row[cols.invoiceDate] : null);
        if (!period) period = periodOf(invoiceDate) ?? '';

        lines.push({
          supplierGstin: gstin ? gstin.toUpperCase() : null,
          supplierName: (cols.name ? row[cols.name] : '') || null,
          invoiceNumber,
          invoiceDate,
          documentType: 'B2B',
          isReverseCharge: /^y/i.test(cols.reverseCharge ? row[cols.reverseCharge] ?? '' : ''),
          taxableValuePaise: taxable,
          cgstPaise: (cols.cgst ? toPaise(row[cols.cgst]) : 0) ?? 0,
          sgstPaise: (cols.sgst ? toPaise(row[cols.sgst]) : 0) ?? 0,
          igstPaise: (cols.igst ? toPaise(row[cols.igst]) : 0) ?? 0,
          cessPaise: (cols.cess ? toPaise(row[cols.cess]) : 0) ?? 0,
        });
      }
    }

    return { period, lines, warnings };
  }
}

/** GST JSON amounts are rupee decimals; the ledger stores integer paise. */
function toRupeePaise(value: unknown): number {
  if (typeof value === 'number') return Math.round(value * 100);
  return toPaise(value) ?? 0;
}

export { normaliseHeader };
