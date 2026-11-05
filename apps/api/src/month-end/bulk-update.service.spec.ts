/**
 * Integration tests — bulk update, through the review queue.
 *
 *  ✓ Finds the posted lines on an account in a date range, by narration or line text; reversed entries and lines elsewhere are left out
 *  ✓ Refuses a line that is not on the account, the same account twice, a group, a party-kept account, another org's entry
 *  ✓ Proposes one balanced reclass that posts on approval; the original journals are untouched; a line is not moved twice
 *  ✓ A net credit moves the other way; a locked month dates the move after the lock
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProposedEntryStatus, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AdjustmentsService } from './adjustments.service';
import { BulkUpdateService } from './bulk-update.service';
import { ProposalsService } from '../proposals/proposals.service';
import { LearningService } from '../proposals/learning.service';
import { SubledgerSyncService } from '../proposals/subledger-sync.service';
import { BillChecksService } from '../proposals/checks/bill-checks.service';
import { ExpenseCategorizerService } from '../proposals/categorisation/expense-categorizer.service';
import { CATEGORY_MODEL } from '../proposals/categorisation/category-model';
import { ProposedEntry, ProposedEntrySchema, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from '../proposals/schemas/vendor-ledger-map.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../extraction/schemas/extracted-document.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema, PeriodLockDocument } from '../gl/schemas/period-lock.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { todayIst } from '../automation/schedule';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let bulk: BulkUpdateService;
let proposals: ProposalsService;
let accounts: AccountsService;
let posting: PostingService;
let journals: Model<JournalDocument>;
let proposalModel: Model<ProposedEntryDocument>;
let locks: Model<PeriodLockDocument>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PeriodLock.name, schema: PeriodLockSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [
      AdjustmentsService, BulkUpdateService,
      ProposalsService, LearningService, SubledgerSyncService, BillChecksService, ExpenseCategorizerService,
      { provide: CATEGORY_MODEL, useValue: { available: false, choose: jest.fn() } },
      { provide: REDIS_CLIENT, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } },
      PostingService, AccountsService, AuditService, PurchaseBillsService, VendorsService, SalesInvoicesService,
    ],
  }).compile();
  bulk = moduleRef.get(BulkUpdateService);
  proposals = moduleRef.get(ProposalsService);
  accounts = moduleRef.get(AccountsService);
  posting = moduleRef.get(PostingService);
  journals = moduleRef.get(getModelToken(Journal.name));
  proposalModel = moduleRef.get(getModelToken(ProposedEntry.name));
  locks = moduleRef.get(getModelToken(PeriodLock.name));
  await journals.init();
  await proposalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const all = await accounts.list(orgId);
  const id = (name: string) => all.find((a) => a.name === name)!._id;
  return { orgId, id };
}

/** A two-line journal: Dr `debit` / Cr `credit`. */
async function post(orgId: string, date: string, narration: string, debit: string, credit: string, paise: number, description = '', projectId: string | null = null) {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return posting.post({
    orgId, voucherType: VoucherType.JOURNAL, financialYear: `${start}-${String(start + 1).slice(-2)}`, date, narration, postedBy: ACTOR,
    lines: [
      { accountId: debit, description, debitPaise: paise, creditPaise: 0, projectId },
      { accountId: credit, description: '', debitPaise: 0, creditPaise: paise },
    ],
  });
}

const snapshot = async (ids: unknown[]) =>
  (await journals.find({ _id: { $in: ids } }).sort({ _id: 1 }).lean().exec()).map((j) => ({ id: String(j._id), status: j.status, narration: j.narration, date: j.date, lines: j.lines.map((l) => ({ ...l, accountId: String(l.accountId), projectId: l.projectId ? String(l.projectId) : null })) }));

describe('bulk update', () => {
  it('finds posted lines on the account in the range, by narration or line text, leaving out reversed entries', async () => {
    const { orgId, id } = await org();
    const project = new Types.ObjectId().toString();
    const rent = await post(orgId, '2025-10-05', 'Office rent October', id('Rent'), id('Bank Accounts'), 1_000_000, '', project);
    const repair = await post(orgId, '2025-10-20', 'Misc', id('Rent'), id('Cash in Hand'), 500_000, 'Printer repair', project);
    await post(orgId, '2025-09-10', 'Rent September', id('Rent'), id('Bank Accounts'), 200_000); // before the range
    await post(orgId, '2025-10-11', 'Stationery', id('Office & Stationery'), id('Bank Accounts'), 90_000); // another account
    const wrong = await post(orgId, '2025-10-12', 'Rent typed twice', id('Rent'), id('Bank Accounts'), 300_000);
    await posting.reverse(String(wrong._id), ACTOR, undefined, { date: '2025-10-13' });

    const found = await bulk.lines(orgId, { accountId: id('Rent'), from: '2025-10-01', to: '2025-10-31' });
    expect(found.capped).toBe(false);
    expect(found.lines.map((l) => [l.journalId, l.index, l.debitPaise, l.creditPaise])).toEqual([
      [String(rent._id), 0, 1_000_000, 0],
      [String(repair._id), 0, 500_000, 0],
    ]);
    expect(found.lines[0]).toMatchObject({ date: '2025-10-05', narration: 'Office rent October', voucherType: 'journal', projectId: project, movedBy: null });
    expect(found.lines[0].voucherNumber).toMatch(/^JNL\/2025-26\/\d{4}$/);

    const byLine = await bulk.lines(orgId, { accountId: id('Rent'), text: 'printer' });
    expect(byLine.lines.map((l) => l.journalId)).toEqual([String(repair._id)]);
    const byNarration = await bulk.lines(orgId, { accountId: id('Rent'), text: 'RENT oct' });
    expect(byNarration.lines.map((l) => l.journalId)).toEqual([String(rent._id)]);
    // No range: September's too, still not the reversed one.
    expect((await bulk.lines(orgId, { accountId: id('Rent') })).lines).toHaveLength(3);
  });

  it('refuses a line not on the account, the same account twice, a group, a party-kept account and another org entry', async () => {
    const { orgId, id } = await org();
    const j = await post(orgId, '2025-10-05', 'Office rent', id('Rent'), id('Bank Accounts'), 1_000_000);
    const base = { fromAccountId: id('Rent'), toAccountId: id('Repairs & Maintenance') };
    await expect(bulk.propose(orgId, ACTOR, { ...base, lines: [{ journalId: String(j._id), index: 1 }] })).rejects.toThrow(/not on Rent/);
    await expect(bulk.propose(orgId, ACTOR, { ...base, toAccountId: id('Rent'), lines: [{ journalId: String(j._id), index: 0 }] })).rejects.toThrow(BadRequestException);
    await expect(bulk.propose(orgId, ACTOR, { ...base, toAccountId: id('Indirect Expenses'), lines: [{ journalId: String(j._id), index: 0 }] })).rejects.toThrow(/is a group/);
    // Receivables and payables are kept by party from documents: no lump moves on or off them.
    await expect(bulk.propose(orgId, ACTOR, { ...base, toAccountId: id('Accounts Receivable'), lines: [{ journalId: String(j._id), index: 0 }] })).rejects.toThrow(/party by party/);
    await expect(bulk.lines(orgId, { accountId: id('Accounts Payable') })).rejects.toThrow(/party by party/);
    // Another org's journal is not one of yours.
    const other = await org();
    await expect(bulk.propose(other.orgId, ACTOR, { fromAccountId: other.id('Rent'), toAccountId: other.id('Repairs & Maintenance'), lines: [{ journalId: String(j._id), index: 0 }] })).rejects.toThrow(/not one of your entries/);
    expect(await proposalModel.countDocuments({ orgId })).toBe(0);
  });

  it('proposes one balanced reclass that posts on approval, leaving the original journals as they were', async () => {
    const { orgId, id } = await org();
    const project = new Types.ObjectId().toString();
    const a = await post(orgId, '2025-10-05', 'Office rent', id('Rent'), id('Bank Accounts'), 1_000_000, '', project);
    const b = await post(orgId, '2025-10-20', 'Misc', id('Rent'), id('Cash in Hand'), 500_000, 'Printer repair', project);
    const before = await snapshot([a._id, b._id]);

    const result = await bulk.propose(orgId, ACTOR, {
      fromAccountId: id('Rent'), toAccountId: id('Repairs & Maintenance'),
      lines: [{ journalId: String(a._id), index: 0 }, { journalId: String(b._id), index: 0 }],
      reason: 'Booked to rent by mistake',
    });
    expect(result).toMatchObject({ amountPaise: 1_500_000, direction: 'debit', date: '2025-10-31', period: '2025-10', lines: 2, projectId: project });

    const proposal = (await proposalModel.findById(result.proposalId).lean().exec())!;
    expect(proposal).toMatchObject({ sourceType: 'adjustment', status: ProposedEntryStatus.PROPOSED, documentType: 'journal', invoiceDate: '2025-10-31', financialYear: '2025-26' });
    expect(proposal.adjustment).toMatchObject({ kind: 'reclass', period: '2025-10' });
    expect(proposal.adjustment!.reason).toMatch(/Booked to rent by mistake/);
    expect(proposal.adjustment!.reason).toMatch(/JNL\/2025-26\/0001, JNL\/2025-26\/0002/);
    expect(proposal.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([
      ['Repairs & Maintenance', 1_500_000, 0],
      ['Rent', 0, 1_500_000],
    ]);
    // Nothing posted yet: AI or not, a person approves first.
    expect(await journals.countDocuments({ orgId })).toBe(2);

    // The same lines cannot be moved twice while this one is live; the search says so.
    await expect(bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: id('Professional Fees'), lines: [{ journalId: String(b._id), index: 0 }] })).rejects.toThrow(ConflictException);
    const found = await bulk.lines(orgId, { accountId: id('Rent') });
    expect(found.lines.every((l) => l.movedBy?.proposalId === result.proposalId && l.movedBy.status === 'proposed')).toBe(true);

    await proposals.approve({ proposalId: result.proposalId, orgId, actorId: ACTOR });
    const approved = (await proposalModel.findById(result.proposalId).lean().exec())!;
    const reclass = (await journals.findById(approved.journalId).lean().exec())!;
    expect(reclass).toMatchObject({ voucherType: VoucherType.JOURNAL, date: '2025-10-31', status: 'posted' });
    // Both lines keep the project the moved lines shared, so its figures move with the money.
    expect(reclass.lines.map((l) => [String(l.accountId), l.debitPaise, l.creditPaise, l.projectId ? String(l.projectId) : null])).toEqual([
      [id('Repairs & Maintenance'), 1_500_000, 0, project],
      [id('Rent'), 0, 1_500_000, project],
    ]);
    expect(await snapshot([a._id, b._id])).toEqual(before);
    // The originals show as moved; the reclass's own credit to Rent is a line like any other.
    const after = (await bulk.lines(orgId, { accountId: id('Rent') })).lines;
    expect(after.filter((l) => l.movedBy).map((l) => [l.journalId, l.movedBy!.status])).toEqual([[String(a._id), 'approved'], [String(b._id), 'approved']]);
    expect(after.find((l) => l.journalId === String(reclass._id))).toMatchObject({ creditPaise: 1_500_000, movedBy: null });
  });

  it('moves a net credit the other way, and dates the move after a lock on its month', async () => {
    const { orgId, id } = await org();
    const refund = await post(orgId, '2025-08-14', 'Rent deposit refund', id('Bank Accounts'), id('Rent'), 250_000);
    await locks.create({ orgId, lockedThrough: '2025-12-31', history: [] });

    const result = await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: id('Other Income'), lines: [{ journalId: String(refund._id), index: 1 }] });
    const today = todayIst();
    expect(result).toMatchObject({ amountPaise: 250_000, direction: 'credit', date: today, period: today.slice(0, 7) });
    const proposal = (await proposalModel.findById(result.proposalId).lean().exec())!;
    expect(proposal.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([
      ['Rent', 250_000, 0],
      ['Other Income', 0, 250_000],
    ]);
    const posted = await proposals.approve({ proposalId: result.proposalId, orgId, actorId: ACTOR });
    expect(posted.journalId).toBeTruthy();
  });
});
