/**
 * Integration tests — bank feeds through an Account Aggregator (the mock).
 *
 *  ✓ A consent needs a proper AA handle and starts pending; nothing pulls until approved
 *  ✓ Approving links the account to a bank account by its masked number
 *  ✓ A pull imports the lines with the bank's ids, and the statement adds up
 *  ✓ Later pulls bring only the new days; pulling again brings nothing twice
 *  ✓ A revoked consent pulls nothing
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { BankFeedsService } from './bank-feeds.service';
import { BANK_FEED_PROVIDER } from './provider';
import { MockAccountAggregator } from './mock-aa.provider';
import { BankFeedConsent, BankFeedConsentSchema } from './schemas/bank-feed-consent.schema';
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

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let feeds: BankFeedsService;
let lines: Model<{ externalId: string | null; statementId: Types.ObjectId; debitPaise: number; creditPaise: number; runningBalancePaise: number | null; date: string }>;
let statements: Model<{ openingBalancePaise: number; closingBalancePaise: number }>;
let bankAccounts: Model<{ accountNumber: string | null; bankName: string | null }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: BankFeedConsent.name, schema: BankFeedConsentSchema },
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
      BankFeedsService, ReconciliationService, PostingService, AuditService, AccountsService, SalesInvoicesService, PurchaseBillsService,
      { provide: BANK_FEED_PROVIDER, useClass: MockAccountAggregator },
    ],
  }).compile();
  feeds = moduleRef.get(BankFeedsService);
  lines = moduleRef.get(getModelToken(BankStatementLine.name));
  statements = moduleRef.get(getModelToken(BankStatement.name));
  bankAccounts = moduleRef.get(getModelToken(BankAccount.name));
  await lines.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('bank feeds', () => {
  it('connects, pulls, pulls again without repeats, and stops when revoked', async () => {
    const orgId = new Types.ObjectId().toString();
    await expect(feeds.requestConsent(orgId, ACTOR, { customerVua: 'not a handle' }, '2026-10-14')).rejects.toThrow(/AA handle/);
    await expect(feeds.requestConsent(orgId, ACTOR, { customerVua: '9876543210@onemoney', fromDate: '2025-01-01' }, '2026-10-14')).rejects.toThrow(/at most a year/);

    const consent = await feeds.requestConsent(orgId, ACTOR, { customerVua: '9876543210@onemoney', fromDate: '2026-09-01' }, '2026-10-14');
    expect(consent).toMatchObject({ status: 'PENDING', redirectUrl: expect.stringContaining('https://aa.example/consent/') });
    await expect(feeds.sync(orgId, consent._id, ACTOR, '2026-10-14')).rejects.toThrow(/consent is pending/);

    const approved = await feeds.approveMock(orgId, consent._id);
    expect(approved.status).toBe('ACTIVE');
    const linked = approved.accounts[0];
    const account = await bankAccounts.findById(linked.bankAccountId).lean().exec();
    expect(account).toMatchObject({ accountNumber: linked.maskedAccountNumber, bankName: 'HDFC Bank' });

    // First pull: 1 Sep to 30 Sep.
    const first = await feeds.sync(orgId, consent._id, ACTOR, '2026-09-30');
    expect(first.accounts[0]).toMatchObject({ through: '2026-09-30', error: null });
    expect(first.accounts[0].imported).toBeGreaterThan(5);
    const september = await lines.find({ orgId }).sort({ date: 1 }).lean().exec();
    expect(september.every((l) => l.externalId && l.date >= '2026-09-01' && l.date <= '2026-09-30')).toBe(true);
    const statement = await statements.findById(september[0].statementId).lean().exec();
    const moved = september.reduce((s, l) => s + l.creditPaise - l.debitPaise, 0);
    expect(statement!.openingBalancePaise + moved).toBe(statement!.closingBalancePaise);
    expect(september[september.length - 1].runningBalancePaise).toBe(statement!.closingBalancePaise);

    // The same day again: nothing new.
    expect((await feeds.sync(orgId, consent._id, ACTOR, '2026-09-30')).accounts[0].imported).toBe(0);

    // Two weeks on: only October, and it carries on from September's balance.
    const second = await feeds.sync(orgId, consent._id, ACTOR, '2026-10-14');
    const october = await lines.find({ orgId, date: { $gte: '2026-10-01' } }).sort({ date: 1 }).lean().exec();
    expect(second.accounts[0].imported).toBe(october.length);
    const octStatement = await statements.findById(october[0].statementId).lean().exec();
    expect(octStatement!.openingBalancePaise).toBe(statement!.closingBalancePaise);

    // Revoked: nothing more.
    await feeds.revoke(orgId, ACTOR, consent._id);
    await expect(feeds.sync(orgId, consent._id, ACTOR, '2026-10-20')).rejects.toThrow(/revoked/);
    const all = await lines.countDocuments({ orgId });
    expect(new Set((await lines.find({ orgId }).lean().exec()).map((l) => l.externalId)).size).toBe(all);
  });

  it('skips transactions already imported when a pull overlaps', async () => {
    const orgId = new Types.ObjectId().toString();
    const consent = await feeds.requestConsent(orgId, ACTOR, { customerVua: 'acme@finvu', fromDate: '2026-09-01' }, '2026-10-14');
    await feeds.approveMock(orgId, consent._id);
    const first = await feeds.sync(orgId, consent._id, ACTOR, '2026-09-20');

    // Wind the bookmark back, as a crash between import and save would.
    const consents = moduleRef.get<Model<{ accounts: Array<{ syncedThrough: string | null }> }>>(getModelToken(BankFeedConsent.name));
    await consents.updateOne({ _id: consent._id }, { $set: { 'accounts.0.syncedThrough': '2026-09-10' } });
    const again = await feeds.sync(orgId, consent._id, ACTOR, '2026-09-20');
    expect(again.accounts[0].imported).toBe(0);
    expect(again.accounts[0].skipped).toBeGreaterThan(0);
    expect(await lines.countDocuments({ orgId })).toBe(first.accounts[0].imported);
  });
});
