/**
 * Integration tests — bulk update, through the review queue.
 *
 *  ✓ Finds the posted lines on an account in a date range, by narration or line text; reversed entries and lines elsewhere are left out
 *  ✓ Refuses a line that is not on the account, the same account twice, a group, a party-kept account, another org's entry
 *  ✓ Proposes one balanced reclass that posts on approval; the original journals are untouched; a line is not moved twice
 *  ✓ A net credit moves the other way; a locked month dates the move the day after the lock
 *  ✓ Filters by contact (the vendor or customer of the bill, invoice or receipt that posted the voucher) and by
 *    the line's amount; each line shows its contact; another org's contact is refused
 *  ✓ Lines over several months: one entry per month by default, each dated at its month's end, so the monthly
 *    P&L moves where the lines are; a month netting to nothing is skipped; a locked month goes after the lock;
 *    one entry for all on request; all or none reach the review queue
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
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { VoucherContactsService } from './voucher-contacts.service';
import { NotFoundException } from '@nestjs/common';
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
let bills: PurchaseBillsService;
let vendors: VendorsService;
let invoices: SalesInvoicesService;
let customerModel: Model<{ orgId: string; name: string }>;

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
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: PartyPayment.name, schema: PartyPaymentSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
      ]),
    ],
    providers: [
      AdjustmentsService, BulkUpdateService, VoucherContactsService,
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
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  invoices = moduleRef.get(SalesInvoicesService);
  customerModel = moduleRef.get(getModelToken(Customer.name));
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
    // Both lines are in October: one entry, whatever the split.
    expect(result).toMatchObject({ split: 'single', lines: 2, skipped: [] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ month: '2025-10', amountPaise: 1_500_000, direction: 'debit', date: '2025-10-31', period: '2025-10', lines: 2, projectId: project });

    const proposal = (await proposalModel.findById(result.entries[0].proposalId).lean().exec())!;
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
    expect(found.lines.every((l) => l.movedBy?.proposalId === result.entries[0].proposalId && l.movedBy.status === 'proposed')).toBe(true);

    await proposals.approve({ proposalId: result.entries[0].proposalId, orgId, actorId: ACTOR });
    const approved = (await proposalModel.findById(result.entries[0].proposalId).lean().exec())!;
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

  it('moves a net credit the other way, and dates the move the day after a lock on its month', async () => {
    const { orgId, id } = await org();
    const refund = await post(orgId, '2025-08-14', 'Rent deposit refund', id('Bank Accounts'), id('Rent'), 250_000);
    await locks.create({ orgId, lockedThrough: '2025-12-31', history: [] });

    const result = await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: id('Other Income'), lines: [{ journalId: String(refund._id), index: 1 }] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ amountPaise: 250_000, direction: 'credit', date: '2026-01-01', period: '2026-01' });
    const proposal = (await proposalModel.findById(result.entries[0].proposalId).lean().exec())!;
    expect(proposal.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([
      ['Rent', 250_000, 0],
      ['Other Income', 0, 250_000],
    ]);
    expect(proposal.adjustment!.reason).toMatch(/Dated 2026-01-01: that month is closed or not over/);
    const posted = await proposals.approve({ proposalId: result.entries[0].proposalId, orgId, actorId: ACTOR });
    expect(posted.journalId).toBeTruthy();
  });

  it('filters by contact and by the line’s amount, and shows each line’s contact', async () => {
    const { orgId, id } = await org();
    const sharma = await vendors.create({ orgId, name: 'Sharma Repairs' });
    const verma = await vendors.create({ orgId, name: 'Verma Estates' });
    const rent = new Types.ObjectId(id('Rent'));
    const bill = async (vendorId: string, billNumber: string, billDate: string, paise: number) => {
      const draft = await bills.create({
        orgId, actorId: ACTOR, vendorId, billNumber, billDate,
        amountsPaise: { taxableValue: paise, cgst: 0, sgst: 0, igst: 0, cess: 0, total: paise },
        lineItems: [{ description: 'Work', qty: 1, ratePaise: paise, amountPaise: paise, taxRatePct: 0, accountId: rent }],
      });
      return bills.post(String(draft._id), orgId, ACTOR);
    };
    const v1 = await bill(String(verma._id), 'VE/1', '2025-10-01', 2_500_000);
    const s1 = await bill(String(sharma._id), 'SR/1', '2025-10-05', 400_000);
    const manual = await post(orgId, '2025-10-20', 'Rent by hand', id('Rent'), id('Bank Accounts'), 700_000);
    const s2 = await bill(String(sharma._id), 'SR/2', '2025-11-05', 1_200_000);

    // Every line shows who it was with: the bill's vendor, nobody for a journal typed by hand.
    const all = await bulk.lines(orgId, { accountId: id('Rent') });
    expect(all.lines.map((l) => [l.journalId, l.contact?.name ?? null])).toEqual([
      [String(v1.journalId), 'Verma Estates'],
      [String(s1.journalId), 'Sharma Repairs'],
      [String(manual._id), null],
      [String(s2.journalId), 'Sharma Repairs'],
    ]);
    expect(all.lines[1].contact).toEqual({ id: String(sharma._id), name: 'Sharma Repairs', kind: 'vendor' });

    const bySharma = await bulk.lines(orgId, { accountId: id('Rent'), contactId: String(sharma._id) });
    expect(bySharma.contact).toMatchObject({ name: 'Sharma Repairs', kind: 'vendor' });
    expect(bySharma.lines.map((l) => [l.journalId, l.debitPaise])).toEqual([[String(s1.journalId), 400_000], [String(s2.journalId), 1_200_000]]);

    // ₹5,000 to ₹15,000, on the line's own amount: the hand journal and the second Sharma bill.
    const mid = await bulk.lines(orgId, { accountId: id('Rent'), minPaise: 500_000, maxPaise: 1_500_000 });
    expect(mid.lines.map((l) => l.journalId)).toEqual([String(manual._id), String(s2.journalId)]);
    expect((await bulk.lines(orgId, { accountId: id('Rent'), contactId: String(sharma._id), minPaise: 500_000 })).lines.map((l) => l.journalId)).toEqual([String(s2.journalId)]);
    expect((await bulk.lines(orgId, { accountId: id('Rent'), maxPaise: 400_000 })).lines.map((l) => l.journalId)).toEqual([String(s1.journalId)]);
    // With dates as well.
    expect((await bulk.lines(orgId, { accountId: id('Rent'), contactId: String(sharma._id), from: '2025-11-01', to: '2025-11-30' })).lines.map((l) => l.journalId)).toEqual([String(s2.journalId)]);
    await expect(bulk.lines(orgId, { accountId: id('Rent'), minPaise: 900_000, maxPaise: 100_000 })).rejects.toThrow(/smallest amount is more than the largest/);

    // A customer: the invoice posts to Sales Revenue, its receipt to the bank; both are theirs.
    const asha = await customerModel.create({ orgId, name: 'Asha Traders' });
    const draft = await invoices.create({
      orgId, customerId: String(asha._id), invoiceNumber: 'A/1', invoiceDate: '2025-10-10', dueDate: '2025-10-25',
      lineItems: [{ description: 'Catering', qty: 1, ratePaise: 900_000, amountPaise: 900_000, taxRatePct: 0 }],
      amountsPaise: { taxableValue: 900_000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 900_000 },
    });
    const inv = await invoices.post(String(draft._id), orgId, ACTOR);
    const paid = await invoices.markPaid(String(inv._id), orgId, ACTOR, '2025-10-28');
    const receipt = paid.payments[paid.payments.length - 1].journalId;
    const sales = await bulk.lines(orgId, { accountId: id('Sales Revenue'), contactId: String(asha._id) });
    expect(sales.lines.map((l) => [l.journalId, l.creditPaise, l.contact?.kind])).toEqual([[String(inv.journalId), 900_000, 'customer']]);
    const bank = await bulk.lines(orgId, { accountId: id('Bank Accounts'), contactId: String(asha._id) });
    expect(bank.lines.map((l) => [l.journalId, l.debitPaise])).toEqual([[String(receipt), 900_000]]);
    expect((await bulk.lines(orgId, { accountId: id('Bank Accounts') })).lines.find((l) => l.journalId === String(receipt))!.contact).toMatchObject({ name: 'Asha Traders', kind: 'customer' });

    // A manual journal's line tagged with a contact is theirs, whatever posted the voucher; its own tag wins.
    const tagged = await posting.post({
      orgId, voucherType: VoucherType.JOURNAL, financialYear: '2025-26', date: '2025-11-20', narration: 'Godown rent, Verma', postedBy: ACTOR,
      lines: [
        { accountId: id('Rent'), description: 'Godown', debitPaise: 300_000, creditPaise: 0, contact: { kind: 'vendor', id: String(verma._id), name: 'Verma Estates' } },
        { accountId: id('Bank Accounts'), description: '', debitPaise: 0, creditPaise: 300_000 },
      ],
    });
    const byVerma = await bulk.lines(orgId, { accountId: id('Rent'), contactId: String(verma._id) });
    expect(byVerma.lines.map((l) => [l.journalId, l.contact?.name])).toEqual([[String(v1.journalId), 'Verma Estates'], [String(tagged._id), 'Verma Estates']]);
    expect((await bulk.lines(orgId, { accountId: id('Rent'), contactId: String(sharma._id) })).lines.map((l) => l.journalId)).toEqual([String(s1.journalId), String(s2.journalId)]);
    expect((await bulk.lines(orgId, { accountId: id('Rent'), from: '2025-11-20' })).lines[0].contact).toEqual({ id: String(verma._id), name: 'Verma Estates', kind: 'vendor' });

    // The list to pick from has both kinds; another org's vendor is not one of yours; one with nothing posted finds nothing.
    expect((await bulk.contactList(orgId)).map((c) => [c.name, c.kind])).toEqual([['Asha Traders', 'customer'], ['Sharma Repairs', 'vendor'], ['Verma Estates', 'vendor']]);
    const other = await org();
    await expect(bulk.lines(other.orgId, { accountId: other.id('Rent'), contactId: String(sharma._id) })).rejects.toThrow(NotFoundException);
    const idle = await vendors.create({ orgId, name: 'Idle Supplies' });
    expect(await bulk.lines(orgId, { accountId: id('Rent'), contactId: String(idle._id) })).toMatchObject({ lines: [], capped: false });
  });

  it('makes one entry per month for lines over several months, each at its month’s end', async () => {
    const { orgId, id } = await org();
    const sep1 = await post(orgId, '2025-09-04', 'Plumber', id('Rent'), id('Bank Accounts'), 300_000);
    const sep2 = await post(orgId, '2025-09-18', 'Electrician', id('Rent'), id('Cash in Hand'), 200_000);
    const oct = await post(orgId, '2025-10-09', 'Painter', id('Rent'), id('Bank Accounts'), 500_000);
    const novRefund = await post(orgId, '2025-11-12', 'Painter refund', id('Bank Accounts'), id('Rent'), 100_000);
    const lines = [{ journalId: String(sep1._id), index: 0 }, { journalId: String(sep2._id), index: 0 }, { journalId: String(oct._id), index: 0 }, { journalId: String(novRefund._id), index: 1 }];

    // No split asked: the lines span months, so one entry per month.
    const result = await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: id('Repairs & Maintenance'), lines, reason: 'Repairs booked to rent' });
    expect(result).toMatchObject({ split: 'month', lines: 4, skipped: [] });
    expect(result.entries.map((e) => [e.month, e.date, e.amountPaise, e.direction, e.lines])).toEqual([
      ['2025-09', '2025-09-30', 500_000, 'debit', 2],
      ['2025-10', '2025-10-31', 500_000, 'debit', 1],
      ['2025-11', '2025-11-30', 100_000, 'credit', 1],
    ]);
    const made = await Promise.all(result.entries.map((e) => proposalModel.findById(e.proposalId).lean().exec()));
    expect(made.map((p) => [p!.invoiceDate, p!.adjustment!.period, p!.narration])).toEqual([
      ['2025-09-30', '2025-09', 'Reclassification from Rent to Repairs & Maintenance, September 2025'],
      ['2025-10-31', '2025-10', 'Reclassification from Rent to Repairs & Maintenance, October 2025'],
      ['2025-11-30', '2025-11', 'Reclassification from Rent to Repairs & Maintenance, November 2025'],
    ]);
    // Each entry moves only its own month's lines.
    expect(made.map((p) => (p!.adjustment!.sources ?? []).map((s) => s.journalId))).toEqual([[String(sep1._id), String(sep2._id)], [String(oct._id)], [String(novRefund._id)]]);
    expect(made[2]!.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([['Rent', 100_000, 0], ['Repairs & Maintenance', 0, 100_000]]);
    expect(made[0]!.adjustment!.reason).toMatch(/^2 posted lines of September 2025 on Rent/);
    // Nothing posted until each is approved.
    expect(await journals.countDocuments({ orgId })).toBe(4);

    for (const e of result.entries) await proposals.approve({ proposalId: e.proposalId, orgId, actorId: ACTOR });
    // The month's P&L moves in the month: Repairs per month, from the ledger.
    const repairs = id('Repairs & Maintenance');
    const posted = await journals.find({ orgId, 'lines.accountId': new Types.ObjectId(repairs) }).sort({ date: 1 }).lean().exec();
    expect(posted.map((j) => [j.date, j.lines.reduce((s, l) => s + (String(l.accountId) === repairs ? l.debitPaise - l.creditPaise : 0), 0)])).toEqual([
      ['2025-09-30', 500_000],
      ['2025-10-31', 500_000],
      ['2025-11-30', -100_000],
    ]);
  });

  it('skips a month that nets to nothing, dates a locked month after the lock, and makes one entry when asked', async () => {
    const { orgId, id } = await org();
    const aug = await post(orgId, '2025-08-10', 'Courier', id('Rent'), id('Bank Accounts'), 80_000);
    const sepIn = await post(orgId, '2025-09-03', 'Deposit', id('Rent'), id('Bank Accounts'), 150_000);
    const sepOut = await post(orgId, '2025-09-25', 'Deposit back', id('Bank Accounts'), id('Rent'), 150_000);
    const oct = await post(orgId, '2025-10-15', 'Repairs', id('Rent'), id('Bank Accounts'), 220_000);
    await locks.create({ orgId, lockedThrough: '2025-08-31', history: [] });
    const lines = [{ journalId: String(aug._id), index: 0 }, { journalId: String(sepIn._id), index: 0 }, { journalId: String(sepOut._id), index: 1 }, { journalId: String(oct._id), index: 0 }];
    const to = id('Repairs & Maintenance');

    // One entry for all, when asked: the net, at the latest month's end.
    const single = await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: to, lines, split: 'single' });
    expect(single).toMatchObject({ split: 'single', lines: 4, skipped: [] });
    expect(single.entries.map((e) => [e.month, e.date, e.amountPaise])).toEqual([[null, '2025-10-31', 300_000]]);
    // Those lines are now in review: rejected, they can be moved again.
    await expect(bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: to, lines })).rejects.toThrow(ConflictException);
    await proposals.reject({ proposalId: single.entries[0].proposalId, orgId, actorId: ACTOR, reason: 'By month instead' });

    const monthly = await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: to, lines, split: 'month' });
    // August is locked: its entry goes the day after the lock. September nets to nothing.
    expect(monthly.skipped).toEqual(['2025-09']);
    expect(monthly.entries.map((e) => [e.month, e.date, e.amountPaise])).toEqual([['2025-08', '2025-09-01', 80_000], ['2025-10', '2025-10-31', 220_000]]);
    // A line the skipped month held is not in any entry, so it can still be moved on its own.
    const found = await bulk.lines(orgId, { accountId: id('Rent'), from: '2025-09-01', to: '2025-09-30' });
    expect(found.lines.map((l) => l.movedBy)).toEqual([null, null]);

    const again = await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: to, lines: [{ journalId: String(sepIn._id), index: 0 }] });
    expect(again.entries.map((e) => [e.month, e.date, e.amountPaise])).toEqual([['2025-09', '2025-09-30', 150_000]]);
  });

  it('drafts every month’s entry or none of them', async () => {
    const { orgId, id } = await org();
    const sep = await post(orgId, '2025-09-04', 'Plumber', id('Rent'), id('Bank Accounts'), 300_000);
    const oct = await post(orgId, '2025-10-09', 'Painter', id('Rent'), id('Bank Accounts'), 500_000);
    const lines = [{ journalId: String(sep._id), index: 0 }, { journalId: String(oct._id), index: 0 }];
    // The second entry fails to draft (a fault outside the books, simulated): the first is not left behind.
    const adjustments = moduleRef.get(AdjustmentsService);
    const real = adjustments.propose.bind(adjustments);
    let calls = 0;
    const spy = jest.spyOn(adjustments, 'propose').mockImplementation(async (input, session) => {
      calls++;
      if (calls === 2) throw new Error('The connection dropped');
      return real(input, session);
    });
    try {
      await expect(bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: id('Repairs & Maintenance'), lines })).rejects.toThrow('The connection dropped');
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(await proposalModel.countDocuments({ orgId })).toBe(0);
    expect(await moduleRef.get<Model<unknown>>(getModelToken(AuditLog.name)).countDocuments({ orgId, action: 'PROPOSE_ADJUSTMENT' })).toBe(0);
    // Tried again, both go.
    expect((await bulk.propose(orgId, ACTOR, { fromAccountId: id('Rent'), toAccountId: id('Repairs & Maintenance'), lines })).entries).toHaveLength(2);
  });
});
