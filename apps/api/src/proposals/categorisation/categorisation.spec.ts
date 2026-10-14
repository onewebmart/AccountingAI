/**
 * Integration tests — expense categorisation and bank-line proposals.
 *
 *  ✓ A scanned bill with SAC 997212 is filed under Rent, with the reason
 *  ✓ The model picks from the org's own accounts, capped below certain
 *  ✓ A model answer naming no real account, or a model failure, falls back safely
 *  ✓ A past choice for the party wins over everything
 *  ✓ An unmatched bank charge becomes a Bank Charges proposal; approving posts and matches the line
 *  ✓ The bank side cannot be changed on approval
 *  ✓ A line is proposed once; matched or excluded lines are not sent
 *  ✓ A confirmed AI pick is learned for the party
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AccountType, MatchStatus, VoucherType } from '@ai-accounting/shared';
import configuration from '../../config/configuration';
import { testMongoUri } from '../../test-utils/mongo';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { ProposalsService } from '../proposals.service';
import { LearningService } from '../learning.service';
import { SubledgerSyncService } from '../subledger-sync.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';
import { BankCategorisationService, CATEGORISE_QUEUE } from './bank-categorisation.service';
import { CATEGORY_MODEL, CategoryChoiceInput } from './category-model';
import { PostingService } from '../../gl/posting.service';
import { AccountsService } from '../../gl/accounts.service';
import { AuditService } from '../../gl/audit.service';
import { ProposedEntry, ProposedEntrySchema } from '../schemas/proposed-entry.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from '../schemas/vendor-ledger-map.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../../extraction/schemas/extracted-document.schema';
import { Journal, JournalSchema } from '../../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../../gl/schemas/ledger-account.schema';
import { Vendor, VendorSchema } from '../../purchase/schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from '../../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerSchema } from '../../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../../sales/schemas/sales-invoice.schema';
import { Document as UploadedDocument, DocumentSchema } from '../../documents/schemas/document.schema';
import { BankStatementLine, BankStatementLineSchema } from '../../banking/schemas/bank-statement-line.schema';

const ACTOR = new Types.ObjectId().toString();
const model = { available: true, choose: jest.fn() };
const queue = { add: jest.fn().mockResolvedValue(undefined) };
const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };

let moduleRef: TestingModule;
let categorizer: ExpenseCategorizerService;
let bankCategorisation: BankCategorisationService;
let proposals: ProposalsService;
let accounts: AccountsService;
let extracted: Model<unknown>;
let lines: Model<{ matchStatus: MatchStatus; matchedJournalId: Types.ObjectId | null }>;
let journals: Model<{ voucherType: string; lines: Array<{ description: string; debitPaise: number; creditPaise: number }> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [
      ProposalsService,
      LearningService,
      SubledgerSyncService,
      ExpenseCategorizerService,
      BankCategorisationService,
      PostingService,
      AccountsService,
      AuditService,
      { provide: CATEGORY_MODEL, useValue: model },
      { provide: getQueueToken(CATEGORISE_QUEUE), useValue: queue },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();

  categorizer = moduleRef.get(ExpenseCategorizerService);
  bankCategorisation = moduleRef.get(BankCategorisationService);
  proposals = moduleRef.get(ProposalsService);
  accounts = moduleRef.get(AccountsService);
  extracted = moduleRef.get(getModelToken(ExtractedDocument.name));
  lines = moduleRef.get(getModelToken(BankStatementLine.name));
  journals = moduleRef.get(getModelToken(Journal.name));
  await moduleRef.get<Model<unknown>>(getModelToken(ProposedEntry.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

beforeEach(() => {
  model.available = true;
  model.choose.mockReset().mockResolvedValue(null);
  redis.get.mockResolvedValue(null);
});

const newOrg = () => new Types.ObjectId().toString();

function bankLine(orgId: string, description: string, money: { out?: number; in?: number }) {
  return lines.create({
    orgId,
    statementId: new Types.ObjectId(),
    bankAccountId: new Types.ObjectId(),
    date: '2026-09-30',
    description,
    reference: 'REF1',
    debitPaise: money.out ?? 0,
    creditPaise: money.in ?? 0,
  });
}

describe('categoriser', () => {
  it('files a scanned bill by its SAC code, and says why', async () => {
    const orgId = newOrg();
    const doc = await extracted.create({
      orgId, documentId: new Types.ObjectId(), ocrResultId: new Types.ObjectId(), status: 'extracted', retryCount: 0,
      documentType: 'purchase_invoice', confidenceOverall: 0.92,
      vendor: { name: 'Shree Estates', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
      invoiceNumber: { value: 'R-09', confidence: 0.98 }, invoiceDate: { value: '2026-09-01', confidence: 0.97 },
      amountsPaise: { taxableValue: 5000000, cgst: 450000, sgst: 450000, igst: 0, cess: 0, total: 5900000, confidence: 0.93 },
      lineItems: [{ description: 'Rent for September', hsnSac: '997212', qty: 1, ratePaise: 5000000, amountPaise: 5000000, taxRatePct: 18 }],
      isReverseCharge: false, rawWarnings: [],
    });
    const proposal = await proposals.createFromExtracted(String(doc._id), orgId);
    expect(proposal.suggestedLines.find((l) => l.debitPaise === 5000000)?.accountName).toBe('Rent');
    expect(proposal.category).toMatchObject({ source: 'rule', accountName: 'Rent', reason: 'HSN/SAC 997212 is renting of property' });
    expect(model.choose).not.toHaveBeenCalled();
  });

  it('lets the model choose among the org’s own accounts, capped below certain', async () => {
    const orgId = newOrg();
    model.choose.mockImplementation(async (input: CategoryChoiceInput) => {
      expect(input.accounts.some((a) => a.name === 'Advertising & Marketing')).toBe(true);
      expect(input.accounts.some((a) => a.name === 'Accounts Payable')).toBe(false);
      return { code: '6180', confidence: 0.97, reason: 'Social media campaign' };
    });
    const pick = await categorizer.suggest(orgId, { kind: 'bill', partyName: 'Pixel Studio', lines: [{ description: 'Campaign creatives' }], amountPaise: 100000 });
    expect(pick).toMatchObject({ accountName: 'Advertising & Marketing', source: 'ai', confidence: 0.8 });
  });

  it('falls back when the model names no real account, or fails', async () => {
    const orgId = newOrg();
    model.choose.mockResolvedValueOnce({ code: '9999', confidence: 0.9, reason: 'made up' });
    expect(await categorizer.suggest(orgId, { kind: 'bill', partyName: 'Mystery Co', amountPaise: 100 })).toMatchObject({
      source: 'default', accountName: 'Purchases',
    });
    model.choose.mockRejectedValueOnce(new Error('quota exceeded'));
    expect(await categorizer.suggest(orgId, { kind: 'withdrawal', narration: 'UPI/DR/1234567/RANDOM/', amountPaise: 100 })).toMatchObject({
      source: 'default', accountName: 'Suspense',
    });
  });

  it('puts a past choice for the party first', async () => {
    const orgId = newOrg();
    const food = await accounts.create({ orgId, name: 'Staff Welfare', type: AccountType.EXPENSE });
    await moduleRef.get(LearningService).upsertMapping(orgId, 'SWIGGY', String(food._id), 'Staff Welfare');
    const pick = await categorizer.suggest(orgId, { kind: 'withdrawal', partyName: 'SWIGGY', narration: 'UPI/SWIGGY rent', amountPaise: 45000 });
    expect(pick).toMatchObject({ source: 'learned', accountName: 'Staff Welfare', confidence: 0.9 });
  });
});

describe('bank-line proposals', () => {
  it('turns a bank charge into a proposal, and approving posts and matches the line', async () => {
    const orgId = newOrg();
    const line = await bankLine(orgId, 'SMS ALERT CHRG FOR QTR SEP26', { out: 1770 });
    expect(await bankCategorisation.queueLines(orgId, [String(line._id)])).toEqual({ queued: 1, skipped: [] });
    expect(queue.add).toHaveBeenCalledWith('bank-line', { orgId, lineId: String(line._id) }, expect.objectContaining({ jobId: `bank-line-${line._id}` }));

    const proposal = (await bankCategorisation.propose(orgId, String(line._id)))!;
    expect(proposal).toMatchObject({ documentType: 'bank_payment', sourceType: 'bank', category: { source: 'rule', accountName: 'Bank Charges' } });
    expect(proposal.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([
      ['Bank Charges', 1770, 0],
      ['Bank Accounts', 0, 1770],
    ]);

    // Sent again while in review: skipped, and a second proposal cannot be written.
    expect((await bankCategorisation.queueLines(orgId, [String(line._id)])).skipped).toEqual([
      { lineId: String(line._id), reason: 'already in the review queue' },
    ]);
    expect(await bankCategorisation.propose(orgId, String(line._id))).toBeNull();

    const approved = await proposals.approve({ proposalId: String(proposal._id), orgId, actorId: ACTOR });
    const journal = await journals.findById(approved.journalId).lean().exec();
    expect(journal?.voucherType).toBe(VoucherType.PAYMENT);
    expect(await lines.findById(line._id).lean().exec()).toMatchObject({ matchStatus: MatchStatus.CONFIRMED, matchedJournalId: approved.journalId });
    expect((await bankCategorisation.queueLines(orgId, [String(line._id)])).skipped[0].reason).toBe('already matched');
  });

  it('refuses an approval that changes what the bank moved', async () => {
    const orgId = newOrg();
    const line = await bankLine(orgId, 'INT.PD 01-07-2026 TO 30-09-2026', { in: 41200 });
    const proposal = (await bankCategorisation.propose(orgId, String(line._id)))!;
    expect(proposal.documentType).toBe('bank_receipt');
    expect(proposal.category?.accountName).toBe('Other Income');
    const [bankLeg, income] = proposal.suggestedLines;
    await expect(
      proposals.approve({
        proposalId: String(proposal._id), orgId, actorId: ACTOR,
        lines: [
          { accountId: String(bankLeg.accountId), accountName: bankLeg.accountName, debitPaise: 40000, creditPaise: 0 },
          { accountId: String(income.accountId), accountName: income.accountName, debitPaise: 0, creditPaise: 40000 },
        ],
      }),
    ).rejects.toThrow(/must stay 412\.00 debit/);
    expect(await lines.findById(line._id).lean().exec()).toMatchObject({ matchStatus: MatchStatus.UNMATCHED, matchedJournalId: null });
  });

  it('learns a confirmed AI pick for the party', async () => {
    const orgId = newOrg();
    model.choose.mockResolvedValue({ code: '6170', confidence: 0.7, reason: 'Office supplies store' });
    const first = await bankLine(orgId, 'UPI/DR/412345678901/KORE OFFICE MART/YESB/kom@ybl/x', { out: 89900 });
    const proposal = (await bankCategorisation.propose(orgId, String(first._id)))!;
    expect(proposal).toMatchObject({ vendorName: 'KORE OFFICE MART', category: { source: 'ai', accountName: 'Office & Stationery' } });
    await proposals.approve({ proposalId: String(proposal._id), orgId, actorId: ACTOR });

    model.choose.mockClear();
    const second = await bankLine(orgId, 'UPI/DR/499999999999/KORE OFFICE MART/YESB/kom@ybl/y', { out: 12000 });
    const next = (await bankCategorisation.propose(orgId, String(second._id)))!;
    expect(next.category).toMatchObject({ source: 'learned', accountName: 'Office & Stationery' });
    expect(model.choose).not.toHaveBeenCalled();
  });
});
