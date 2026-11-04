/**
 * Integration tests — month-end, through the review queue.
 *
 *  ✓ An accrual schedule drafts each month once; approved, it reverses on the 1st; rejected, it can be drafted again
 *  ✓ A prepaid comes into each month in equal shares that add back to the whole
 *  ✓ Depreciation runs book only what is not booked yet, pending runs included; a disposal posts the gain
 *  ✓ Capitalising waits on the queue: rejected, the asset never was
 *  ✓ The assistant finds a missing regular bill and accrues it, below full confidence
 *  ✓ A recurring journal is drafted into the queue on its date, once
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, ProposedEntryStatus, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AdjustmentsService } from './adjustments.service';
import { SchedulesService } from './schedules.service';
import { AssetsService } from './assets.service';
import { AssistantService } from './assistant.service';
import { FixedAsset, FixedAssetSchema } from './schemas/fixed-asset.schema';
import { AdjustmentSchedule, AdjustmentScheduleSchema } from './schemas/adjustment-schedule.schema';
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
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { RecurringService } from '../automation/recurring.service';
import { RecurringTemplate, RecurringTemplateSchema } from '../automation/schemas/recurring-template.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let adjustments: AdjustmentsService;
let schedules: SchedulesService;
let assets: AssetsService;
let assistant: AssistantService;
let proposals: ProposalsService;
let accounts: AccountsService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let recurring: RecurringService;
let journals: Model<JournalDocument>;
let proposalModel: Model<ProposedEntryDocument>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: FixedAsset.name, schema: FixedAssetSchema },
        { name: AdjustmentSchedule.name, schema: AdjustmentScheduleSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
      ]),
    ],
    providers: [
      AdjustmentsService, SchedulesService, AssetsService, AssistantService,
      ProposalsService, LearningService, SubledgerSyncService, BillChecksService, ExpenseCategorizerService,
      { provide: CATEGORY_MODEL, useValue: { available: false, choose: jest.fn() } },
      { provide: REDIS_CLIENT, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } },
      PostingService, AccountsService, AuditService, PurchaseBillsService, VendorsService, SalesInvoicesService, RecurringService,
    ],
  }).compile();
  adjustments = moduleRef.get(AdjustmentsService);
  schedules = moduleRef.get(SchedulesService);
  assets = moduleRef.get(AssetsService);
  assistant = moduleRef.get(AssistantService);
  proposals = moduleRef.get(ProposalsService);
  accounts = moduleRef.get(AccountsService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  recurring = moduleRef.get(RecurringService);
  journals = moduleRef.get(getModelToken(Journal.name));
  proposalModel = moduleRef.get(getModelToken(ProposedEntry.name));
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
const approve = (orgId: string, p: { _id: unknown }) => proposals.approve({ proposalId: String(p._id), orgId, actorId: ACTOR });
const net = (j: JournalDocument, name: RegExp) => j.lines.filter((l) => name.test(l.description)).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);

describe('accruals and prepaids', () => {
  it('drafts each month once, reverses an approved accrual on the 1st, and redrafts a rejected one', async () => {
    const { orgId, id } = await org();
    const s = await schedules.create(orgId, ACTOR, { kind: 'accrual', name: 'Office rent', expenseAccountId: id('Rent'), amountPaise: 5000000, startPeriod: '2026-10', months: 3 });
    expect(await schedules.draftDue(orgId, ACTOR, '2026-11')).toEqual({ drafted: 2 });
    expect(await schedules.draftDue(orgId, ACTOR, '2026-11')).toEqual({ drafted: 0 });

    const [oct, nov] = (await adjustments.live(orgId, 'accrual', String(s._id))).sort((a, b) => a.adjustment!.period!.localeCompare(b.adjustment!.period!));
    expect(oct).toMatchObject({ sourceType: 'adjustment', invoiceDate: '2026-10-31', adjustment: { reverseOn: '2026-11-01' } });
    const approved = await approve(orgId, oct);
    const journal = (await journals.findById(approved.journalId).exec())!;
    expect(journal).toMatchObject({ voucherType: VoucherType.JOURNAL, date: '2026-10-31', narration: 'Office rent: accrued for 2026-10' });
    expect(net(journal, /^Rent$/)).toBe(5000000);
    expect(net(journal, /Accrued Expenses/)).toBe(-5000000);

    expect(await adjustments.reverseDueAccruals(orgId, '2026-10-31')).toBe(0);
    expect(await adjustments.reverseDueAccruals(orgId, '2026-11-03')).toBe(1);
    const reversal = await journals.findOne({ orgId, reversalOf: journal._id }).exec();
    expect(reversal).toMatchObject({ date: '2026-11-01' });
    expect(await adjustments.reverseDueAccruals(orgId, '2026-11-04')).toBe(0);

    await proposals.reject({ proposalId: String(nov._id), orgId, actorId: ACTOR, reason: 'Wrong amount' });
    expect(await schedules.draftDue(orgId, ACTOR, '2026-11')).toEqual({ drafted: 1 });
  });

  it('brings a prepaid into each month in shares that add up', async () => {
    const { orgId, id } = await org();
    const s = await schedules.create(orgId, ACTOR, { kind: 'prepaid', name: 'Insurance', expenseAccountId: id('Miscellaneous Expenses'), amountPaise: 1000001, startPeriod: '2026-11', months: 3 });
    await schedules.draftDue(orgId, ACTOR, '2027-01');
    const drafted = await adjustments.live(orgId, 'prepaid', String(s._id));
    expect(drafted.map((p) => p.amountsPaise.total).sort()).toEqual([333333, 333334, 333334]);
    expect(drafted[0].suggestedLines.map((l) => l.accountName)).toEqual(['Miscellaneous Expenses', 'Prepaid Expenses']);
  });
});

describe('fixed assets', () => {
  it('books depreciation once, pending runs included, and posts a disposal with its gain', async () => {
    const { orgId, id } = await org();
    const laptop = await assets.create(orgId, ACTOR, { name: 'Dell laptop', category: 'computers', assetAccountId: id('Computers & IT Equipment'), costPaise: 12000000, purchaseDate: '2026-04-01', putToUse: '2026-04-01' });
    expect(laptop.toObject()).toMatchObject({ status: 'active', residualPaise: 600000, lifeYears: 3, method: 'SLM' });

    const april = await assets.run(orgId, ACTOR, '2026-04');
    // The pending run already counts: a second for the month has nothing to add.
    await expect(assets.run(orgId, ACTOR, '2026-04')).rejects.toThrow(/Nothing to depreciate/);
    const may = await assets.run(orgId, ACTOR, '2026-05');
    const yearly = 3800000;
    expect(april.amountsPaise.total).toBe(Math.round((yearly * 30) / 365));
    expect(april.amountsPaise.total + may.amountsPaise.total).toBe(Math.round((yearly * 61) / 365));
    await approve(orgId, april);
    await approve(orgId, may);

    const [row] = await assets.list(orgId, '2026-05-31');
    expect(row.accumulatedPaise).toBe(Math.round((yearly * 61) / 365));
    expect(row.depreciatedThrough).toBe('2026-05-31');

    // Sold on 15 June for ₹1,15,000: 15 more days' depreciation, then the gain.
    const disposal = await assets.dispose(orgId, ACTOR, String(laptop._id), { date: '2026-06-15', proceedsPaise: 11500000 });
    const lines = disposal.suggestedLines;
    expect(lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(lines.reduce((s, l) => s + l.creditPaise, 0));
    const booked = Math.round((yearly * 76) / 365);
    const gain = lines.find((l) => /Gain on Sale/.test(l.accountName))!.creditPaise;
    expect(gain).toBe(11500000 - (12000000 - booked));
    await approve(orgId, disposal);
    const [after] = await assets.list(orgId);
    expect(after).toMatchObject({ status: 'disposed', accumulatedPaise: booked });
    await expect(assets.run(orgId, ACTOR, '2026-07')).rejects.toThrow(/Nothing to depreciate/);
  });

  it('waits on the queue to capitalise; rejected, the asset never was', async () => {
    const { orgId, id } = await org();
    const input = { name: 'Office chairs', category: 'furniture' as const, assetAccountId: id('Furniture & Fixtures'), costPaise: 4000000, purchaseDate: '2026-09-10', putToUse: '2026-09-10', capitaliseFromAccountId: id('Office & Stationery') };
    const pending = await assets.create(orgId, ACTOR, input);
    expect(pending.status).toBe('pending');
    await proposals.reject({ proposalId: String(pending.capitaliseProposalId), orgId, actorId: ACTOR, reason: 'Keep as expense' });
    expect(await assets.list(orgId)).toEqual([]);

    const kept = await assets.create(orgId, ACTOR, { ...input, name: 'Office chairs (kept)' });
    const proposal = await proposalModel.findById(kept.capitaliseProposalId).exec();
    await approve(orgId, proposal!);
    expect((await assets.list(orgId)).map((a) => [a.name, a.status])).toEqual([['Office chairs (kept)', 'active']]);
  });
});

describe('the assistant and recurring journals', () => {
  it('accrues a regular bill that has not come, below full confidence', async () => {
    const { orgId, id } = await org();
    const vendor = await vendors.create({ orgId, name: 'Mehta Estates' });
    for (const month of ['08', '09', '10']) {
      const draft = await bills.create({ orgId, vendorId: String(vendor._id), billNumber: `RENT-${month}`, billDate: `2026-${month}-01`, amountsPaise: { taxableValue: 5000000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 5000000 } });
      await bills.post(String(draft._id), orgId, ACTOR);
    }
    const s = await assistant.suggestions(orgId, '2026-11');
    expect(s.accruals).toEqual([expect.objectContaining({ vendorName: 'Mehta Estates', amountPaise: 5000000 })]);
    void id;
    expect(await assistant.proposeAll(orgId, ACTOR, '2026-11')).toMatchObject({ accruals: 1 });
    const [accrual] = await adjustments.live(orgId, 'accrual');
    expect(accrual).toMatchObject({ confidenceOverall: 0.7, adjustment: { reverseOn: '2026-12-01' } });
    expect((await assistant.suggestions(orgId, '2026-11')).accruals).toEqual([]);
  });

  it('drafts a recurring journal into the queue on its date, once', async () => {
    const { orgId, id } = await org();
    const t = await recurring.create(orgId, ACTOR, {
      kind: 'journal', name: 'Director salary provision', frequency: 'monthly', dayOfMonth: 31, startDate: '2026-10-01',
      journalLines: [
        { accountId: id('Salaries & Wages'), debitPaise: 15000000, creditPaise: 0 },
        { accountId: id('Accrued Expenses'), debitPaise: 0, creditPaise: 15000000 },
      ],
    });
    expect(t.kind).toBe('journal');
    const run = await recurring.runDue(orgId, '2026-10-31');
    expect(run.drafted).toHaveLength(1);
    const [p] = await adjustments.live(orgId, 'recurring_journal', String(t._id));
    expect(p).toMatchObject({ status: ProposedEntryStatus.PROPOSED, invoiceDate: '2026-10-31', narration: 'Director salary provision' });
    expect((await recurring.runDue(orgId, '2026-10-31')).drafted).toHaveLength(0);
    await expect(recurring.create(orgId, ACTOR, { kind: 'journal', name: 'Bad', frequency: 'monthly', dayOfMonth: 1, startDate: '2026-10-01', journalLines: [{ accountId: id('Rent'), debitPaise: 100, creditPaise: 0 }, { accountId: id('Bank Accounts'), debitPaise: 0, creditPaise: 99 }] })).rejects.toThrow(/equal/);
    void AccountType;
  });
});
