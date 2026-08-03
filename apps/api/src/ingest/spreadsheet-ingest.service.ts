import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProposedEntryStatus } from '@ai-accounting/shared';
import {
  ParsedSheet,
  SpreadsheetParserService,
  normaliseHeader,
  toIsoDate,
  toPaise,
} from './spreadsheet-parser.service';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { BankAccount, BankAccountDocument } from '../banking/schemas/bank-account.schema';
import { ReconciliationService } from '../banking/reconciliation.service';
import { AccountsService } from '../gl/accounts.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { withOrg } from '../database/tenant.plugin';

export type SheetKind = 'bank_statement' | 'purchase_register' | 'sales_register' | 'unknown';

export interface IngestResult {
  kind: SheetKind;
  sheetName: string;
  rowsRead: number;
  rowsImported: number;
  /** Proposals created (registers) — each awaits human approval, Invariant 4. */
  proposalsCreated: number;
  /** Bank statement created, when the sheet was a statement. */
  statementId?: string;
  bankAccountId?: string;
  warnings: string[];
}

/**
 * Column synonyms seen across HDFC/ICICI/SBI/Axis exports, Tally registers and
 * GST portal downloads. Matching is on normalised headers ("Txn Date" -> "txndate").
 */
const COLUMNS = {
  date: ['date', 'txndate', 'transactiondate', 'valuedate', 'postingdate', 'invoicedate', 'billdate', 'documentdate'],
  description: ['description', 'narration', 'particulars', 'details', 'transactiondetails', 'remarks', 'naration'],
  reference: ['reference', 'refno', 'referenceno', 'chequeno', 'chqno', 'utr', 'utrno', 'refchequeno', 'transactionid'],
  debit: ['debit', 'withdrawal', 'withdrawalamt', 'withdrawals', 'debitamount', 'dr', 'paymentamount', 'withdrawalamount'],
  credit: ['credit', 'deposit', 'depositamt', 'deposits', 'creditamount', 'cr', 'receiptamount', 'depositamount'],
  amount: ['amount', 'txnamount', 'transactionamount'],
  balance: ['balance', 'closingbalance', 'runningbalance', 'balanceamt', 'availablebalance'],
  invoiceNo: ['invoiceno', 'invoicenumber', 'billno', 'billnumber', 'documentno', 'documentnumber', 'voucherno', 'invno'],
  party: ['party', 'partyname', 'vendor', 'vendorname', 'supplier', 'suppliername', 'customer', 'customername', 'buyer', 'seller', 'tradename', 'legalname', 'name'],
  gstin: ['gstin', 'gstno', 'gstinofsupplier', 'suppliergstin', 'customergstin', 'gstinuin', 'gstinofrecipient'],
  taxable: ['taxable', 'taxablevalue', 'taxableamount', 'basicamount', 'netamount', 'assessablevalue', 'subtotal'],
  cgst: ['cgst', 'cgstamount', 'centraltax', 'centraltaxamount'],
  sgst: ['sgst', 'sgstamount', 'statetax', 'statetaxamount', 'sgstutgst'],
  igst: ['igst', 'igstamount', 'integratedtax', 'integratedtaxamount'],
  cess: ['cess', 'cessamount'],
  total: ['total', 'totalamount', 'invoicevalue', 'invoiceamount', 'grandtotal', 'billamount', 'netpayable', 'totalinvoicevalue'],
  placeOfSupply: ['placeofsupply', 'pos', 'stateofsupply'],
} as const;

type ColumnKey = keyof typeof COLUMNS;

/** First header on the sheet that matches one of the synonyms for `key`. */
function findColumn(headers: string[], key: ColumnKey): string | null {
  const synonyms = COLUMNS[key] as readonly string[];
  // Exact match first, so "amount" never steals the "totalamount" column.
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

function has(headers: string[], key: ColumnKey): boolean {
  return findColumn(headers, key) !== null;
}

/** Indian financial year (Apr–Mar) for a YYYY-MM-DD string. */
function financialYearFor(dateStr: string | null): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 4
    ? `${y}-${(y + 1).toString().slice(-2)}`
    : `${y - 1}-${y.toString().slice(-2)}`;
}

@Injectable()
export class SpreadsheetIngestService {
  private readonly logger = new Logger(SpreadsheetIngestService.name);

  constructor(
    private parser: SpreadsheetParserService,
    private reconciliation: ReconciliationService,
    private accounts: AccountsService,
    @InjectModel(ProposedEntry.name)
    private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(BankAccount.name)
    private bankAccountModel: Model<BankAccountDocument>,
  ) {}

  /**
   * Read a spreadsheet and turn every row into real data:
   *  - bank statement  -> BankStatement + lines, ready for reconciliation
   *  - purchase/sales  -> one ProposedEntry per invoice, awaiting human approval
   *
   * Nothing here writes to the ledger. Invariant 4 holds for imports exactly as
   * it does for AI extraction: a human still presses Approve & post.
   */
  async ingest(input: {
    orgId: string;
    documentId: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<IngestResult[]> {
    const sheets = await this.parser.parse(input.buffer, input.fileName);
    const results: IngestResult[] = [];

    for (const sheet of sheets) {
      if (sheet.rows.length === 0) continue;

      const kind = this.classify(sheet, input.fileName);
      this.logger.log(
        `Document ${input.documentId}: sheet "${sheet.name}" classified as ${kind} (${sheet.rows.length} rows)`,
      );

      switch (kind) {
        case 'bank_statement':
          results.push(await this.ingestBankStatement(input, sheet));
          break;
        case 'purchase_register':
        case 'sales_register':
          results.push(await this.ingestRegister(input, sheet, kind));
          break;
        default:
          results.push({
            kind: 'unknown',
            sheetName: sheet.name,
            rowsRead: sheet.rows.length,
            rowsImported: 0,
            proposalsCreated: 0,
            warnings: [
              `Could not tell what "${sheet.name}" contains. Expected either a bank statement ` +
                `(date + debit/credit columns) or an invoice register (invoice no + party + amount). ` +
                `Found columns: ${sheet.rawHeaders.filter(Boolean).join(', ')}`,
            ],
          });
      }
    }

    if (results.length === 0) {
      throw new BadRequestException(`No usable rows found in "${input.fileName}".`);
    }

    return results;
  }

  /** Decide what a sheet is from its headers, with the filename as a tie-breaker. */
  classify(sheet: ParsedSheet, fileName = ''): SheetKind {
    const h = sheet.headers;

    const hasDate = has(h, 'date');
    const hasDrCr = has(h, 'debit') && has(h, 'credit');
    const hasBankShape = hasDate && (hasDrCr || (has(h, 'amount') && has(h, 'balance')));
    const hasInvoiceShape = has(h, 'invoiceNo') || (has(h, 'party') && has(h, 'total'));

    // A statement has running balances and no invoice numbers; a register is the reverse.
    if (hasBankShape && !has(h, 'invoiceNo')) return 'bank_statement';

    if (hasInvoiceShape) {
      const name = `${fileName} ${sheet.name}`.toLowerCase();
      if (/purchase|payable|inward|vendor|supplier|2b|2a|bill/.test(name)) return 'purchase_register';
      if (/sales|receivable|outward|customer|invoice|b2b|1\b/.test(name)) return 'sales_register';

      // No hint in the name — a supplier GSTIN column means these are inward supplies.
      const gstinCol = findColumn(h, 'gstin');
      if (gstinCol && /supplier|vendor/.test(gstinCol)) return 'purchase_register';
      return 'sales_register';
    }

    if (hasBankShape) return 'bank_statement';
    return 'unknown';
  }

  // ── Bank statements ────────────────────────────────────────────────────────

  private async ingestBankStatement(
    input: { orgId: string; documentId: string; fileName: string },
    sheet: ParsedSheet,
  ): Promise<IngestResult> {
    const h = sheet.headers;
    const dateCol = findColumn(h, 'date');
    const descCol = findColumn(h, 'description');
    const refCol = findColumn(h, 'reference');
    const debitCol = findColumn(h, 'debit');
    const creditCol = findColumn(h, 'credit');
    const amountCol = findColumn(h, 'amount');
    const balanceCol = findColumn(h, 'balance');

    const warnings: string[] = [];
    const lines: Array<{
      date: string;
      description: string;
      reference: string | null;
      debitPaise: number;
      creditPaise: number;
      runningBalancePaise: number | null;
    }> = [];
    /** Every dated row, including the opening-balance row that carries no amount. */
    const datesSeen: string[] = [];
    let openingRowBalance: number | null = null;

    for (const [index, row] of sheet.rows.entries()) {
      const date = toIsoDate(dateCol ? row[dateCol] : null);
      if (!date) continue; // total rows, footers and blank separators
      datesSeen.push(date);

      let debitPaise = 0;
      let creditPaise = 0;

      if (debitCol || creditCol) {
        debitPaise = Math.abs(toPaise(debitCol ? row[debitCol] : null) ?? 0);
        creditPaise = Math.abs(toPaise(creditCol ? row[creditCol] : null) ?? 0);
      } else if (amountCol) {
        // Single signed amount column: negative means money left the account.
        const amount = toPaise(row[amountCol]) ?? 0;
        if (amount < 0) debitPaise = Math.abs(amount);
        else creditPaise = amount;
      }

      if (debitPaise === 0 && creditPaise === 0) {
        // Statements open with a dated "OPENING BALANCE" row that has a balance but
        // no movement. It is not a transaction, but it does set the period start.
        const balance = balanceCol ? toPaise(row[balanceCol]) : null;
        const description = (descCol ? row[descCol] : '') ?? '';
        if (balance != null && /opening|b\/f|brought forward/i.test(description)) {
          openingRowBalance = balance;
        } else {
          warnings.push(`Row ${index + 2}: no amount found — skipped.`);
        }
        continue;
      }

      lines.push({
        date,
        description: (descCol ? row[descCol] : '') || 'Bank transaction',
        reference: (refCol ? row[refCol] : null) || null,
        debitPaise,
        creditPaise,
        runningBalancePaise: balanceCol ? toPaise(row[balanceCol]) : null,
      });
    }

    if (lines.length === 0) {
      return {
        kind: 'bank_statement',
        sheetName: sheet.name,
        rowsRead: sheet.rows.length,
        rowsImported: 0,
        proposalsCreated: 0,
        warnings: [...warnings, 'No dated transaction rows found in this sheet.'],
      };
    }

    lines.sort((a, b) => a.date.localeCompare(b.date));

    const bankAccount = await this.resolveBankAccount(input.orgId, input.fileName);

    // The bank's own running balance is authoritative when present; otherwise
    // derive the opening balance by unwinding the movements.
    const netPaise = lines.reduce((s, l) => s + l.creditPaise - l.debitPaise, 0);
    const lastBalance = [...lines].reverse().find((l) => l.runningBalancePaise != null)
      ?.runningBalancePaise;
    const closingBalancePaise = lastBalance ?? (openingRowBalance ?? 0) + netPaise;
    const openingBalancePaise = openingRowBalance ?? closingBalancePaise - netPaise;

    // The period spans every dated row, so an opening-balance row dated the 1st is
    // not lost just because it carries no transaction amount.
    const sortedDates = [...datesSeen].sort();

    const statement = await this.reconciliation.importStatement({
      orgId: input.orgId,
      bankAccountId: bankAccount._id.toString(),
      periodStart: sortedDates[0] ?? lines[0].date,
      periodEnd: sortedDates[sortedDates.length - 1] ?? lines[lines.length - 1].date,
      openingBalancePaise,
      closingBalancePaise,
      lines,
    });

    return {
      kind: 'bank_statement',
      sheetName: sheet.name,
      rowsRead: sheet.rows.length,
      rowsImported: lines.length,
      proposalsCreated: 0,
      statementId: statement._id.toString(),
      bankAccountId: bankAccount._id.toString(),
      warnings,
    };
  }

  /** Reuse the org's bank account, or create one named after the uploaded file. */
  private async resolveBankAccount(
    orgId: string,
    fileName: string,
  ): Promise<BankAccountDocument> {
    const existing = await withOrg(orgId, () =>
      this.bankAccountModel.find().sort({ createdAt: 1 }).limit(1).exec(),
    );
    if (existing.length > 0) return existing[0];

    const guessed =
      ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'Yes Bank', 'IndusInd', 'PNB', 'BOB', 'Canara']
        .find((bank) => fileName.toLowerCase().includes(bank.toLowerCase().replace(/\s/g, ''))) ??
      null;

    return this.reconciliation.createAccount({
      orgId,
      name: guessed ? `${guessed} Bank Account` : 'Imported Bank Account',
      bankName: guessed ?? undefined,
    });
  }

  // ── Purchase / sales registers ─────────────────────────────────────────────

  private async ingestRegister(
    input: { orgId: string; documentId: string; fileName: string },
    sheet: ParsedSheet,
    kind: 'purchase_register' | 'sales_register',
  ): Promise<IngestResult> {
    const h = sheet.headers;
    const cols = {
      date: findColumn(h, 'date'),
      invoiceNo: findColumn(h, 'invoiceNo'),
      party: findColumn(h, 'party'),
      gstin: findColumn(h, 'gstin'),
      taxable: findColumn(h, 'taxable'),
      cgst: findColumn(h, 'cgst'),
      sgst: findColumn(h, 'sgst'),
      igst: findColumn(h, 'igst'),
      cess: findColumn(h, 'cess'),
      total: findColumn(h, 'total'),
      placeOfSupply: findColumn(h, 'placeOfSupply'),
    };

    const documentType = kind === 'purchase_register' ? 'purchase_invoice' : 'sales_invoice';
    const warnings: string[] = [];
    let created = 0;

    for (const [index, row] of sheet.rows.entries()) {
      const rowNumber = index + 2;
      const invoiceNumber = (cols.invoiceNo ? row[cols.invoiceNo] : '') || null;
      const party = (cols.party ? row[cols.party] : '') || null;

      const cgst = cols.cgst ? toPaise(row[cols.cgst]) ?? 0 : 0;
      const sgst = cols.sgst ? toPaise(row[cols.sgst]) ?? 0 : 0;
      const igst = cols.igst ? toPaise(row[cols.igst]) ?? 0 : 0;
      const cess = cols.cess ? toPaise(row[cols.cess]) ?? 0 : 0;
      const gstTotal = cgst + sgst + igst + cess;

      let taxable = cols.taxable ? toPaise(row[cols.taxable]) : null;
      let total = cols.total ? toPaise(row[cols.total]) : null;

      // Either of taxable/total can be derived from the other plus tax.
      if (taxable == null && total != null) taxable = total - gstTotal;
      if (total == null && taxable != null) total = taxable + gstTotal;

      if (taxable == null || total == null || total <= 0) {
        if (invoiceNumber || party) {
          warnings.push(`Row ${rowNumber}: could not read an amount — skipped.`);
        }
        continue;
      }

      if (taxable + gstTotal !== total) {
        warnings.push(
          `Row ${rowNumber} (${invoiceNumber ?? 'no invoice no'}): taxable + tax ` +
            `(${(taxable + gstTotal) / 100}) does not equal total (${total / 100}).`,
        );
      }

      const invoiceDate = toIsoDate(cols.date ? row[cols.date] : null);
      const suggestedLines = await this.buildLines(input.orgId, documentType, {
        taxable,
        cgst,
        sgst,
        igst,
        cess,
        total,
      });

      await this.proposalModel.create({
        orgId: input.orgId,
        documentId: new Types.ObjectId(input.documentId),
        extractedDocumentId: null,
        sourceType: 'spreadsheet',
        status: ProposedEntryStatus.PROPOSED,
        documentType,
        vendorName: party,
        vendorGstin: (cols.gstin ? row[cols.gstin] : null) || null,
        invoiceNumber,
        invoiceDate,
        amountsPaise: { taxableValue: taxable, cgst, sgst, igst, cess, total },
        // Spreadsheet cells are read values, not model guesses — but a human still
        // approves, so this is high confidence rather than certainty.
        confidenceOverall: 0.95,
        fieldConfidence: {
          vendor: party ? 0.95 : 0.2,
          invoiceNumber: invoiceNumber ? 0.95 : 0.2,
          invoiceDate: invoiceDate ? 0.95 : 0.2,
          amounts: 0.95,
        },
        rawWarnings: [],
        suggestedLines,
        financialYear: financialYearFor(invoiceDate),
      });

      created++;
    }

    return {
      kind,
      sheetName: sheet.name,
      rowsRead: sheet.rows.length,
      rowsImported: created,
      proposalsCreated: created,
      warnings,
    };
  }

  /** Balanced double-entry lines against the org's real chart of accounts. */
  private async buildLines(
    orgId: string,
    documentType: string,
    a: { taxable: number; cgst: number; sgst: number; igst: number; cess: number; total: number },
  ) {
    const isPurchase = documentType === 'purchase_invoice';

    const taxKeys: Array<[number, SystemAccountKey, string]> = isPurchase
      ? [
          [a.cgst, SystemAccountKey.GST_INPUT_CGST, 'Input CGST'],
          [a.sgst, SystemAccountKey.GST_INPUT_SGST, 'Input SGST'],
          [a.igst, SystemAccountKey.GST_INPUT_IGST, 'Input IGST'],
          [a.cess, SystemAccountKey.GST_INPUT_CESS, 'Input Cess'],
        ]
      : [
          [a.cgst, SystemAccountKey.GST_OUTPUT_CGST, 'Output CGST'],
          [a.sgst, SystemAccountKey.GST_OUTPUT_SGST, 'Output SGST'],
          [a.igst, SystemAccountKey.GST_OUTPUT_IGST, 'Output IGST'],
          [a.cess, SystemAccountKey.GST_OUTPUT_CESS, 'Output Cess'],
        ];

    const lines: Array<{
      accountName: string;
      accountCode: string | null;
      accountId: Types.ObjectId;
      debitPaise: number;
      creditPaise: number;
      confidence: number;
      isAiSuggested: boolean;
    }> = [];

    const push = async (
      key: SystemAccountKey,
      label: string,
      debitPaise: number,
      creditPaise: number,
    ) => {
      const account = await this.accounts.resolveSystemAccount(orgId, key);
      lines.push({
        accountName: account.name || label,
        accountCode: account.code,
        accountId: account._id,
        debitPaise,
        creditPaise,
        confidence: 0.95,
        isAiSuggested: true,
      });
    };

    if (isPurchase) {
      await push(SystemAccountKey.PURCHASE_EXPENSE, 'Purchases', a.taxable, 0);
      for (const [amount, key, label] of taxKeys) {
        if (amount > 0) await push(key, label, amount, 0);
      }
      await push(SystemAccountKey.ACCOUNTS_PAYABLE, 'Accounts Payable', 0, a.total);
    } else {
      await push(SystemAccountKey.ACCOUNTS_RECEIVABLE, 'Accounts Receivable', a.total, 0);
      await push(SystemAccountKey.SALES_REVENUE, 'Sales Revenue', 0, a.taxable);
      for (const [amount, key, label] of taxKeys) {
        if (amount > 0) await push(key, label, 0, amount);
      }
    }

    // Rounding differences in the source file must not produce an unbalanced entry.
    const debit = lines.reduce((s, l) => s + l.debitPaise, 0);
    const credit = lines.reduce((s, l) => s + l.creditPaise, 0);
    if (debit !== credit) {
      const diff = debit - credit;
      const roundOff = await this.accounts.resolveSystemAccount(orgId, SystemAccountKey.ROUND_OFF);
      lines.push({
        accountName: roundOff.name,
        accountCode: roundOff.code,
        accountId: roundOff._id,
        debitPaise: diff < 0 ? Math.abs(diff) : 0,
        creditPaise: diff > 0 ? diff : 0,
        confidence: 0.5,
        isAiSuggested: true,
      });
    }

    return lines;
  }
}

export { normaliseHeader };
