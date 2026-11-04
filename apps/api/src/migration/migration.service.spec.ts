/**
 * Integration tests — importing books from Tally.
 *
 *  ✓ A preview writes nothing to the books
 *  ✓ Committing creates the missing accounts and parties, posts one balanced
 *    opening journal, and opens a document per party balance
 *  ✓ It commits once
 *  ✓ Opening documents stay out of GSTR-1
 *  ✓ Reversing the opening entry takes its documents with it
 *  ✓ Books that do not balance are refused, unless the difference goes to Suspense by choice
 *  ✓ An account nobody has placed is refused until someone says what it is
 */
import { Gstr2bLine, Gstr2bLineSchema } from '../gst/schemas/gstr2b-line.schema';
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { MigrationService } from './migration.service';
import { ImportBatch, ImportBatchSchema } from './schemas/import-batch.schema';
import { TALLY_XML } from './test-fixtures';
import { SpreadsheetParserService } from '../ingest/spreadsheet-parser.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { CustomersService } from '../sales/customers.service';
import { VendorsService } from '../purchase/vendors.service';
import { GstReturnsService } from '../gst/gst-returns.service';
import { JournalReversalService } from '../journals/journal-reversal.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();
const xmlFile = (xml: string) => ({ originalname: 'Master.xml', mimetype: 'text/xml', buffer: Buffer.from(xml, 'utf8') });

let moduleRef: TestingModule;
let migration: MigrationService;
let journals: Model<{ narration: string; lines: Array<{ description: string; debitPaise: number; creditPaise: number }> }>;
let invoices: Model<{ invoiceNumber: string; status: string; isOpeningBalance: boolean; amountsPaise: { total: number } }>;
let bills: Model<{ billNumber: string; isOpeningBalance: boolean }>;
let accounts: Model<{ name: string; type: string; parentId: unknown }>;
let customers: Model<{ name: string; gstin: string | null; email: string | null }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ImportBatch.name, schema: ImportBatchSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
      ]),
    ],
    providers: [
      MigrationService, SpreadsheetParserService, AccountsService, PostingService, AuditService,
      CustomersService, VendorsService, GstReturnsService, JournalReversalService,
    ],
  }).compile();
  migration = moduleRef.get(MigrationService);
  journals = moduleRef.get(getModelToken(Journal.name));
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
  accounts = moduleRef.get(getModelToken(LedgerAccount.name));
  customers = moduleRef.get(getModelToken(Customer.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('importing from Tally', () => {
  it('previews without touching the books, then commits once', async () => {
    const orgId = new Types.ObjectId().toString();
    const preview = await migration.preview(orgId, ACTOR, [xmlFile(TALLY_XML)]);
    expect(preview).toMatchObject({ source: 'tally', status: 'previewed', unplaced: [], opening: { debitPaise: 43800000, differencePaise: 0 } });
    expect(await journals.countDocuments({ orgId })).toBe(0);
    expect(await customers.countDocuments({ orgId })).toBe(0);

    const done = await migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01' });
    expect(done.status).toBe('committed');
    expect(done.result).toEqual({ accountsCreated: 3, accountsMatched: 0, customersCreated: 1, vendorsCreated: 1, partiesMatched: 0, documentsCreated: 2 });

    const opening = await journals.findOne({ orgId }).lean().exec();
    expect(opening?.narration).toBe('Opening balances imported from Tally');
    const dr = opening!.lines.reduce((s, l) => s + l.debitPaise, 0);
    const cr = opening!.lines.reduce((s, l) => s + l.creditPaise, 0);
    expect([dr, cr]).toEqual([43800000, 43800000]);

    const furniture = await accounts.findOne({ orgId, name: 'Furniture' }).lean().exec();
    const fixedAssets = await accounts.findOne({ orgId, code: '1500' }).lean().exec();
    expect(furniture).toMatchObject({ type: 'ASSETS' });
    expect(String(furniture?.parentId)).toBe(String(fixedAssets?._id));
    expect(await customers.findOne({ orgId }).lean().exec()).toMatchObject({ name: 'Rao & Sons', gstin: '27AAPFU0939F1ZV', email: 'ac@rao.example' });

    const ob = await invoices.findOne({ orgId }).lean().exec();
    expect(ob).toMatchObject({ invoiceNumber: 'OPENING/2026-27/001', status: 'posted', isOpeningBalance: true, amountsPaise: { total: 11800000 } });
    expect(await bills.findOne({ orgId }).lean().exec()).toMatchObject({ billNumber: 'OPENING/2026-27/002', isOpeningBalance: true });

    await expect(migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01' })).rejects.toThrow(/already committed/);

    // Not a supply: GSTR-1 for April has nothing from it.
    const gstr1 = await moduleRef.get(GstReturnsService).gstr1(orgId, '2026-04');
    expect(gstr1.b2b).toHaveLength(0);

    // Reversing the opening entry removes the documents it carried.
    await moduleRef.get(JournalReversalService).reverse(String(opening!._id), orgId, ACTOR);
    expect(await invoices.countDocuments({ orgId })).toBe(0);
    expect(await bills.countDocuments({ orgId })).toBe(0);
  });

  it('refuses books that do not balance, unless the difference goes to Suspense', async () => {
    const orgId = new Types.ObjectId().toString();
    const lopsided = TALLY_XML.replace('<OPENINGBALANCE>370000.00</OPENINGBALANCE>', '<OPENINGBALANCE>369000.00</OPENINGBALANCE>');
    const preview = await migration.preview(orgId, ACTOR, [xmlFile(lopsided)]);
    expect(preview.opening.differencePaise).toBe(100000);
    await expect(migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01' })).rejects.toThrow(/out by 1000\.00 debit/);
    expect((await migration.get(orgId, preview._id)).status).toBe('previewed');

    await migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01', differenceToSuspense: true });
    const opening = await journals.findOne({ orgId }).lean().exec();
    expect(opening?.lines.find((l) => l.description === 'Difference in opening balances')).toMatchObject({ creditPaise: 100000 });
  });

  it('asks what an unrecognised account is before importing it', async () => {
    const orgId = new Types.ObjectId().toString();
    const odd = TALLY_XML.replace('<PARENT>Fixed Assets</PARENT>', '<PARENT>Odds and Ends</PARENT>');
    const preview = await migration.preview(orgId, ACTOR, [xmlFile(odd)]);
    expect(preview.unplaced).toEqual(['Furniture']);
    await expect(migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01' })).rejects.toThrow(/Say what this account is first: Furniture/);
    const done = await migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01', groups: { Furniture: 'fixed_assets' } });
    expect(done.status).toBe('committed');
  });
});

describe('entering opening balances by hand', () => {
  async function chartOf(orgId: string) {
    const svc = moduleRef.get(AccountsService);
    await svc.seedDefaults(orgId);
    const capital = await svc.create({ orgId, actorId: ACTOR, name: "Proprietor's Capital", type: AccountType.CAPITAL });
    const list = await svc.list(orgId);
    const code = (c: string) => list.find((a) => a.code === c)!._id;
    return { code, capitalId: String(capital._id) };
  }

  it('posts what was typed, receivables per customer, through the same commit', async () => {
    const orgId = new Types.ObjectId().toString();
    const { code, capitalId } = await chartOf(orgId);
    const rao = await moduleRef.get(CustomersService).create({ orgId, actorId: ACTOR, name: 'Rao Traders' });
    const sigma = await moduleRef.get(VendorsService).create({ orgId, actorId: ACTOR, name: 'Sigma Supplies' });

    const preview = await migration.manual(orgId, ACTOR, {
      accounts: [
        { accountId: code('1100'), debitPaise: 25000000, creditPaise: 0 },
        { accountId: code('1520'), debitPaise: 6000000, creditPaise: 0 },
        { accountId: capitalId, debitPaise: 0, creditPaise: 36900000 },
        { accountId: code('1110'), debitPaise: 0, creditPaise: 0 },
      ],
      parties: [
        { kind: 'customer', partyId: String(rao._id), balancePaise: 11800000 },
        { kind: 'vendor', partyId: String(sigma._id), balancePaise: 5900000 },
      ],
    });
    expect(preview).toMatchObject({ source: 'manual', status: 'previewed', unplaced: [], warnings: [], opening: { debitPaise: 42800000, differencePaise: 0 } });
    expect(await journals.countDocuments({ orgId })).toBe(0);

    const done = await migration.commit(orgId, ACTOR, preview._id, { openingDate: '2026-04-01' });
    expect(done.result).toMatchObject({ accountsCreated: 0, customersCreated: 0, vendorsCreated: 0, partiesMatched: 2, documentsCreated: 2 });
    const opening = await journals.findOne({ orgId }).lean().exec();
    expect(opening?.narration).toBe('Opening balances entered by hand');
    expect(opening!.lines.map((l) => [l.description, l.debitPaise, l.creditPaise]).sort()).toEqual(
      [
        ['Accounts Payable', 0, 5900000],
        ['Accounts Receivable', 11800000, 0],
        ['Bank Accounts', 25000000, 0],
        ['Furniture & Fixtures', 6000000, 0],
        ["Proprietor's Capital", 0, 36900000],
      ].sort(),
    );
    expect(await invoices.findOne({ orgId }).lean().exec()).toMatchObject({ invoiceNumber: 'OPENING/2026-27/001', isOpeningBalance: true });

    // A second entry adds to the first, says so, and numbers on from it.
    const meera = await moduleRef.get(CustomersService).create({ orgId, actorId: ACTOR, name: 'Meera Stores' });
    const again = await migration.manual(orgId, ACTOR, {
      accounts: [{ accountId: capitalId, debitPaise: 0, creditPaise: 500000 }],
      parties: [{ kind: 'customer', partyId: String(meera._id), balancePaise: 500000 }],
    });
    expect(again.warnings[0]).toMatch(/already brought in as at 2026-04-01/);
    await migration.commit(orgId, ACTOR, again._id, { openingDate: '2026-04-01' });
    expect((await invoices.find({ orgId }).sort({ invoiceNumber: 1 }).lean().exec()).map((i) => i.invoiceNumber)).toEqual([
      'OPENING/2026-27/001',
      'OPENING/2026-27/003',
    ]);
  });

  it('refuses control accounts, groups, both sides, and other orgs’ parties', async () => {
    const orgId = new Types.ObjectId().toString();
    const { code } = await chartOf(orgId);
    await expect(migration.manual(orgId, ACTOR, { accounts: [{ accountId: code('1200'), debitPaise: 100, creditPaise: 0 }] })).rejects.toThrow(
      /receivables per customer/,
    );
    await expect(migration.manual(orgId, ACTOR, { accounts: [{ accountId: code('1000'), debitPaise: 100, creditPaise: 0 }] })).rejects.toThrow(/is a group/);
    await expect(migration.manual(orgId, ACTOR, { accounts: [{ accountId: code('1100'), debitPaise: 100, creditPaise: 100 }] })).rejects.toThrow(/not both/);
    const elsewhere = await moduleRef.get(CustomersService).create({ orgId: new Types.ObjectId().toString(), actorId: ACTOR, name: 'Not yours' });
    await expect(migration.manual(orgId, ACTOR, { parties: [{ kind: 'customer', partyId: String(elsewhere._id), balancePaise: 100 }] })).rejects.toThrow(
      /not one of yours/,
    );
    await expect(migration.manual(orgId, ACTOR, { accounts: [], parties: [] })).rejects.toThrow(/at least one/);
  });
});
