/**
 * Integration tests — PDF bank statements into reconciliation.
 *
 *  ✓ The text pdf.js reads off a statement PDF imports as a statement
 *  ✓ The printed account number picks the account; a second upload is flagged as duplicates
 *  ✓ An account with no number yet is taken to be this one
 *  ✓ A layout the parser cannot read goes to the model, whose answer must add up
 *  ✓ A statement that adds up neither way is not imported, and says why
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { StatementPdfIngestService } from './statement-pdf-ingest.service';
import { STATEMENT_MODEL } from './statement-model';
import { ReconciliationService } from '../banking/reconciliation.service';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { BankAccount, BankAccountSchema } from '../banking/schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from '../banking/schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';

const model = { available: false, read: jest.fn() };

let moduleRef: TestingModule;
let ingest: StatementPdfIngestService;
let accounts: Model<{ name: string; accountNumber: string | null; bankName: string | null }>;
let lines: Model<{ statementId: Types.ObjectId; possibleDuplicate: boolean; debitPaise: number; description: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: BankAccount.name, schema: BankAccountSchema },
        { name: BankStatement.name, schema: BankStatementSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
      ]),
    ],
    providers: [
      StatementPdfIngestService,
      ReconciliationService,
      PostingService,
      AuditService,
      AccountsService,
      SalesInvoicesService,
      PurchaseBillsService,
      { provide: STATEMENT_MODEL, useValue: model },
    ],
  }).compile();
  ingest = moduleRef.get(StatementPdfIngestService);
  accounts = moduleRef.get(getModelToken(BankAccount.name));
  lines = moduleRef.get(getModelToken(BankStatementLine.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

beforeEach(() => {
  model.available = false;
  model.read.mockReset();
});

const STATEMENT = [
  'HDFC BANK LTD',
  'Statement of account',
  'Account No : 50100123456789',
  'Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance',
  'Opening Balance : 1,00,000.00',
  '01/09/26 UPI-SWIGGY LIMITED-SWIGGY@YBL-412345678901-PAYMENT 01/09/26 450.00 99,550.00',
  '03/09/26 NEFT CR-HDFC0000001-ACME CORP-INV 101 03/09/26 1,18,000.00 2,17,550.00',
  '05/09/26 SMS ALERT CHRG FOR QTR 05/09/26 17.70 2,17,532.30',
  'Closing Balance : 2,17,532.30',
];

/**
 * Exactly what pdf.js (pdf-parse, as the upload pipeline uses) returns for a
 * one-page PDF of the lines above, page marker and all. Read once outside
 * Jest: pdf.js loads its worker by dynamic import, which Jest refuses
 * without --experimental-vm-modules.
 */
const PDF_TEXT = `${STATEMENT.join('\n')}\n\n-- 1 of 1 --\n\n`;

describe('PDF statements', () => {
  it('imports a PDF statement into a new account named by its number, and flags a second upload', async () => {
    const orgId = new Types.ObjectId().toString();
    const text = PDF_TEXT;

    const first = await ingest.ingest({ orgId, documentId: 'd1', fileName: 'sep.pdf', text });
    expect(first).toMatchObject({ kind: 'bank_statement', rowsImported: 3, warnings: [] });
    const account = await accounts.findById(first.bankAccountId).lean().exec();
    expect(account).toMatchObject({ name: 'HDFC Bank ··6789', accountNumber: '50100123456789', bankName: 'HDFC Bank' });
    const imported = await lines.find({ statementId: first.statementId }).sort({ date: 1 }).lean().exec();
    expect(imported.map((l) => l.debitPaise)).toEqual([45000, 0, 1770]);
    expect(imported.at(-1)?.description).toBe('SMS ALERT CHRG FOR QTR'); // not "… -- 1 of 1 --"

    const again = await ingest.ingest({ orgId, documentId: 'd2', fileName: 'sep-again.pdf', text });
    expect(again.bankAccountId).toBe(first.bankAccountId);
    const dupes = await lines.find({ statementId: again.statementId }).lean().exec();
    expect(dupes.every((l) => l.possibleDuplicate)).toBe(true);
  });

  it('takes an account with no number to be this one', async () => {
    const orgId = new Types.ObjectId().toString();
    const existing = await accounts.create({ orgId, name: 'Current account', accountNumber: null, bankName: null });
    const result = await ingest.ingest({ orgId, documentId: 'd3', fileName: 's.pdf', text: STATEMENT.join('\n') });
    expect(result.bankAccountId).toBe(String(existing._id));
    expect(await accounts.findById(existing._id).lean().exec()).toMatchObject({ accountNumber: '50100123456789', bankName: 'HDFC Bank' });
  });

  it('asks the model when the layout defeats the parser, and checks its answer', async () => {
    const orgId = new Types.ObjectId().toString();
    const jumbled = 'IDFC FIRST Bank statement. Opening balance 5,000.00 then on 2 Sept a card spend of 1,200.00 and on 9 Sept salary of 40,000.00, ending at 43,800.00.';
    model.available = true;
    model.read.mockResolvedValueOnce({
      openingBalancePaise: 500000, closingBalancePaise: 4380000, accountNumber: null, bankName: 'IDFC FIRST Bank',
      lines: [
        { date: '2026-09-02', description: 'Card spend', reference: null, debitPaise: 120000, creditPaise: 0, runningBalancePaise: 380000 },
        { date: '2026-09-09', description: 'Salary', reference: null, debitPaise: 0, creditPaise: 4000000, runningBalancePaise: 4380000 },
      ],
    });
    const result = await ingest.ingest({ orgId, documentId: 'd4', fileName: 'idfc.pdf', text: jumbled });
    expect(result.rowsImported).toBe(2);
    expect(result.warnings.at(-1)).toBe('Read by AI and checked against the balances.');

    model.read.mockResolvedValueOnce({
      openingBalancePaise: 500000, closingBalancePaise: 4380000, accountNumber: null, bankName: null,
      lines: [{ date: '2026-09-02', description: 'Card spend', reference: null, debitPaise: 120000, creditPaise: 0, runningBalancePaise: 380000 }],
    });
    const wrong = await ingest.ingest({ orgId, documentId: 'd5', fileName: 'idfc.pdf', text: jumbled });
    expect(wrong.rowsImported).toBe(0);
    expect(wrong.warnings.at(-1)).toMatch(/comes to 3800\.00, not the closing 43800\.00/);
  });

  it('imports nothing it cannot make add up, and says why', async () => {
    const orgId = new Types.ObjectId().toString();
    const broken = STATEMENT.map((l) => l.replace('2,17,550.00', '2,17,500.00')).join('\n');
    const result = await ingest.ingest({ orgId, documentId: 'd6', fileName: 'x.pdf', text: broken });
    expect(result.rowsImported).toBe(0);
    expect(result.warnings[0]).toMatch(/dated 2026-09-03 does not add up/);
    expect(await accounts.countDocuments({ orgId })).toBe(0);
  });
});
