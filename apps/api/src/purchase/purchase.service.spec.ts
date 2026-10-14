/**
 * Phase 10 Integration Tests — Purchase (VendorsService + PurchaseBillsService).
 *
 * Done when:
 *  ✓ Vendor can be created and retrieved
 *  ✓ PurchaseBill created as DRAFT, posted via PostingService → POSTED
 *  ✓ Posting creates a balanced journal (Invariant 2)
 *  ✓ Outstanding for vendor = sum of POSTED (unpaid) bills
 *  ✓ After markPaid, outstanding drops to zero
 *  ✓ AP ageing buckets bills by days past due date
 *  ✓ Cannot re-post an already-posted bill
 *  ✓ Outstanding reconciles to GL: sum of unpaid bill totals = sum of journal AP credits
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { VendorsService } from './vendors.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { Vendor, VendorSchema, VendorDocument } from './schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { BillStatus, VoucherType } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let vendorsSvc: VendorsService;
let billsSvc: PurchaseBillsService;
let billModel: Model<PurchaseBillDocument>;
let vendorModel: Model<VendorDocument>;
let journalModel: Model<JournalDocument>;

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Vendor.name, schema: VendorSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        // Posting resolves real accounts by system key, seeding the chart on
        // first use — so these specs need the ledger accounts collection.
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
      ]),
    ],
    providers: [VendorsService, PurchaseBillsService, PostingService, AccountsService, AuditService],
  }).compile();

  vendorsSvc = moduleRef.get(VendorsService);
  billsSvc = moduleRef.get(PurchaseBillsService);
  billModel = moduleRef.get<Model<PurchaseBillDocument>>(getModelToken(PurchaseBill.name));
  vendorModel = moduleRef.get<Model<VendorDocument>>(getModelToken(Vendor.name));
  journalModel = moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function seedVendor(name = 'Acme Suppliers Pvt Ltd') {
  return vendorsSvc.create({ orgId: ORG_ID, name, gstin: '27AAPFU0939F1ZV' });
}

async function seedBill(vendorId: string, overrides: Record<string, unknown> = {}) {
  return billsSvc.create({
    orgId: ORG_ID,
    vendorId,
    billNumber: 'BILL-001',
    billDate: '2025-04-10',
    dueDate: '2025-05-10',
    amountsPaise: {
      taxableValue: 1000000,
      cgst: 90000,
      sgst: 90000,
      igst: 0,
      cess: 0,
      total: 1180000,
    },
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('VendorsService', () => {
  it('creates and retrieves a vendor', async () => {
    const vendor = await seedVendor('Test Vendor Ltd');
    const found = await vendorsSvc.findById(vendor._id.toString(), ORG_ID);
    expect(found.name).toBe('Test Vendor Ltd');
    expect(found.orgId).toBe(ORG_ID);
  });

  it('lists vendors scoped to orgId', async () => {
    await seedVendor('Vendor Alpha');
    await seedVendor('Vendor Beta');
    const vendors = await vendorsSvc.list(ORG_ID);
    expect(vendors.length).toBeGreaterThanOrEqual(2);
    expect(vendors.every((v) => v.orgId === ORG_ID)).toBe(true);
  });
});

describe('PurchaseBillsService — lifecycle', () => {
  it('creates a bill in DRAFT status', async () => {
    const vendor = await seedVendor();
    const bill = await seedBill(vendor._id.toString());
    expect(bill.status).toBe(BillStatus.DRAFT);
    expect(bill.journalId).toBeNull();
    expect(bill.amountsPaise.total).toBe(1180000);
  });

  it('post() transitions bill to POSTED and creates a balanced journal', async () => {
    const vendor = await seedVendor();
    const bill = await seedBill(vendor._id.toString());

    const posted = await billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID);

    expect(posted.status).toBe(BillStatus.POSTED);
    expect(posted.journalId).not.toBeNull();
    expect(posted.postedBy).toBe(ACTOR_ID);

    // Journal must be balanced (Invariant 2)
    const journal = await journalModel.findById(posted.journalId).exec();
    expect(journal).not.toBeNull();
    const totalDebit = journal!.lines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCredit = journal!.lines.reduce((s, l) => s + l.creditPaise, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(1180000);
  });

  it('cannot re-post an already-posted bill', async () => {
    const vendor = await seedVendor();
    const bill = await seedBill(vendor._id.toString(), { billDate: '2025-05-01', dueDate: '2025-06-01' });
    await billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID);
    await expect(billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID)).rejects.toThrow('already');
  });

  it('markPaid() transitions POSTED → PAID and creates a payment journal', async () => {
    const vendor = await seedVendor();
    const bill = await seedBill(vendor._id.toString(), { billDate: '2025-06-01', dueDate: '2025-07-01' });
    await billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID);
    const paid = await billsSvc.markPaid(bill._id.toString(), ORG_ID, ACTOR_ID);
    expect(paid.status).toBe(BillStatus.PAID);

    // Payment journal must also be balanced
    const journals = await journalModel.find({ orgId: ORG_ID }).sort({ createdAt: -1 }).exec();
    const paymentJournal = journals[0];
    const totalDebit = paymentJournal.lines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCredit = paymentJournal.lines.reduce((s, l) => s + l.creditPaise, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});

describe('VendorsService — outstanding & reconciliation', () => {
  it('outstanding equals sum of posted-but-unpaid bills', async () => {
    const vendor = await seedVendor('Outstanding Vendor');

    const bill1 = await billsSvc.create({
      orgId: ORG_ID,
      vendorId: vendor._id.toString(),
      billDate: '2025-07-01',
      amountsPaise: { taxableValue: 500000, cgst: 45000, sgst: 45000, igst: 0, cess: 0, total: 590000 },
    });
    const bill2 = await billsSvc.create({
      orgId: ORG_ID,
      vendorId: vendor._id.toString(),
      billDate: '2025-07-05',
      amountsPaise: { taxableValue: 300000, cgst: 27000, sgst: 27000, igst: 0, cess: 0, total: 354000 },
    });

    await billsSvc.post(bill1._id.toString(), ORG_ID, ACTOR_ID);
    await billsSvc.post(bill2._id.toString(), ORG_ID, ACTOR_ID);

    const outstanding = await vendorsSvc.outstanding(vendor._id.toString(), ORG_ID);
    expect(outstanding).toBe(590000 + 354000); // 944000 paise
  });

  it('outstanding drops to zero after payment', async () => {
    const vendor = await seedVendor('Pay Later Vendor');
    const bill = await billsSvc.create({
      orgId: ORG_ID,
      vendorId: vendor._id.toString(),
      billDate: '2025-08-01',
      amountsPaise: { taxableValue: 200000, cgst: 18000, sgst: 18000, igst: 0, cess: 0, total: 236000 },
    });

    await billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID);
    await billsSvc.markPaid(bill._id.toString(), ORG_ID, ACTOR_ID);

    const outstanding = await vendorsSvc.outstanding(vendor._id.toString(), ORG_ID);
    expect(outstanding).toBe(0);
  });

  it('outstanding reconciles to GL: sum of unpaid bills = AP credit in journals', async () => {
    const vendor = await seedVendor('Recon Vendor');
    const orgId2 = new Types.ObjectId().toString(); // isolated org for this test

    const amounts1 = { taxableValue: 1000000, cgst: 90000, sgst: 90000, igst: 0, cess: 0, total: 1180000 };
    const amounts2 = { taxableValue: 500000, cgst: 45000, sgst: 45000, igst: 0, cess: 0, total: 590000 };

    // Use vendor's orgId for proper isolation
    const bill1 = await billsSvc.create({ orgId: ORG_ID, vendorId: vendor._id.toString(), billDate: '2025-09-01', amountsPaise: amounts1 });
    const bill2 = await billsSvc.create({ orgId: ORG_ID, vendorId: vendor._id.toString(), billDate: '2025-09-05', amountsPaise: amounts2 });

    const posted1 = await billsSvc.post(bill1._id.toString(), ORG_ID, ACTOR_ID);
    const posted2 = await billsSvc.post(bill2._id.toString(), ORG_ID, ACTOR_ID);

    // Outstanding (AP balance from bill side)
    const outstanding = await vendorsSvc.outstanding(vendor._id.toString(), ORG_ID);
    expect(outstanding).toBe(1180000 + 590000);

    // GL side: sum of AP credits from the two purchase journals
    const j1 = await journalModel.findById(posted1.journalId).exec();
    const j2 = await journalModel.findById(posted2.journalId).exec();
    const apCredits =
      j1!.lines.reduce((s, l) => s + l.creditPaise, 0) +
      j2!.lines.reduce((s, l) => s + l.creditPaise, 0);

    // Each journal's credit side = total paise (Accounts Payable)
    expect(apCredits).toBe(outstanding);
  });
});

describe('VendorsService — AP ageing', () => {
  it('buckets overdue bills by days past due date', async () => {
    const vendor = await seedVendor('Ageing Test Vendor');

    // Past due 45 days
    const overdue45 = await billsSvc.create({
      orgId: ORG_ID,
      vendorId: vendor._id.toString(),
      billDate: '2025-04-01',
      dueDate: new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10),
      amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 },
    });
    await billsSvc.post(overdue45._id.toString(), ORG_ID, ACTOR_ID);

    const ageing = await vendorsSvc.apAgeing(ORG_ID);
    expect(ageing.days31_60).toBeGreaterThanOrEqual(118000);
    expect(ageing.total).toBeGreaterThan(0);
  });
});

describe('PurchaseBillsService — a double-click posts once', () => {
  const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
  const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled');
  const reasons = (rs: PromiseSettledResult<unknown>[]) =>
    rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason));

  it('two simultaneous posts create one purchase journal', async () => {
    const vendor = await seedVendor('Race Post Vendor');
    const bill = await seedBill(vendor._id.toString(), { billNumber: 'BILL-RACE-POST' });

    const results = await settle([
      billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID),
      billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    // Either the up-front status check or the atomic claim refuses the loser.
    expect(reasons(results)).toEqual([expect.stringMatching(/already (been )?posted/i)]);
    expect(
      await journalModel.countDocuments({ orgId: ORG_ID, voucherType: VoucherType.PURCHASE, narration: /^Purchase bill BILL-RACE-POST / }),
    ).toBe(1);
  });

  it('two simultaneous payments pay the vendor once', async () => {
    // Found end to end: two quick clicks on "pay" posted two payment journals
    // for one ₹26,786 bill, and cash out showed ₹53,572.
    const vendor = await seedVendor('Race Pay Vendor');
    const bill = await seedBill(vendor._id.toString(), { billNumber: 'BILL-RACE-PAY' });
    await billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID);

    const results = await settle([
      billsSvc.markPaid(bill._id.toString(), ORG_ID, ACTOR_ID),
      billsSvc.markPaid(bill._id.toString(), ORG_ID, ACTOR_ID),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(reasons(results)).toEqual([expect.stringMatching(/already been marked paid|current: paid/i)]);
    expect(
      await journalModel.countDocuments({ orgId: ORG_ID, voucherType: VoucherType.PAYMENT, narration: 'Payment for bill BILL-RACE-PAY' }),
    ).toBe(1);
    expect((await billModel.findById(bill._id).exec())?.status).toBe(BillStatus.PAID);
  });

  it("files a payment under the financial year of its own date, not the bill's", async () => {
    const vendor = await seedVendor('Last Year Vendor');
    const lastYear = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const bill = await seedBill(vendor._id.toString(), { billNumber: 'BILL-LAST-FY', billDate: lastYear });
    await billsSvc.post(bill._id.toString(), ORG_ID, ACTOR_ID);
    await billsSvc.markPaid(bill._id.toString(), ORG_ID, ACTOR_ID);

    const payment = await journalModel
      .findOne({ orgId: ORG_ID, voucherType: VoucherType.PAYMENT, narration: 'Payment for bill BILL-LAST-FY' })
      .exec();
    expect(payment!.financialYear).toBe(financialYearOf(payment!.date));
    expect(payment!.financialYear).not.toBe(financialYearOf(lastYear));
  });
});
