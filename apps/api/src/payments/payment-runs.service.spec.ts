/**
 * Tests — vendor payment runs.
 *
 *  ✓ Ranking: late MSME bills, MSME bills due by the pay date, overdue, then due; not-yet-due left out
 *  ✓ A cash limit includes bills whole, highest priority first
 *  ✓ The bank file is one row per vendor, and needs every vendor's bank account
 *  ✓ Recording a run as paid posts one payment per vendor and settles its bills
 *  ✓ A bill in a draft run is not offered again
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { bankFileCsv, PayableBill, suggestRun } from './payment-run';
import { PaymentRunsService } from './payment-runs.service';
import { PartyPaymentsService } from './party-payments.service';
import { PaymentRun, PaymentRunSchema } from './schemas/payment-run.schema';
import { PartyPayment, PartyPaymentSchema } from './schemas/party-payment.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';

const ACTOR = new Types.ObjectId().toString();
const TODAY = '2026-10-14';

describe('suggestRun', () => {
  const bill = (over: Partial<PayableBill>): PayableBill => ({
    billId: over.billNumber ?? 'x', vendorId: 'v', vendorName: 'V', billNumber: null, billDate: '2026-09-01', dueDate: '2026-10-30', owedPaise: 10000, msmePayBy: null, hasBankAccount: true, ...over,
  });

  it('ranks what must go first, and leaves out what is not yet due', () => {
    const { candidates } = suggestRun(
      [
        bill({ billNumber: 'due', dueDate: '2026-10-20' }),
        bill({ billNumber: 'later', dueDate: '2026-11-30' }),
        bill({ billNumber: 'overdue', dueDate: '2026-10-01' }),
        bill({ billNumber: 'msme-due', msmePayBy: '2026-10-18' }),
        bill({ billNumber: 'msme-late', msmePayBy: '2026-10-05', hasBankAccount: false }),
      ],
      { today: TODAY, payOn: '2026-10-21' },
    );
    expect(candidates.map((c) => [c.billNumber, c.priority])).toEqual([
      ['msme-late', 'msme_late'],
      ['msme-due', 'msme_due'],
      ['overdue', 'overdue'],
      ['due', 'due'],
    ]);
    expect(candidates[0].reason).toMatch(/43B\(h\) day was 05\/10\/2026.*No bank account on file/);
  });

  it('fits whole bills inside a cash limit, highest priority first', () => {
    const { candidates, includedPaise } = suggestRun(
      [bill({ billNumber: 'msme', msmePayBy: '2026-10-10', owedPaise: 60000 }), bill({ billNumber: 'big', dueDate: '2026-10-01', owedPaise: 50000 }), bill({ billNumber: 'small', dueDate: '2026-10-02', owedPaise: 30000 })],
      { today: TODAY, payOn: TODAY, cashLimitPaise: 100000 },
    );
    expect(candidates.filter((c) => c.included).map((c) => c.billNumber)).toEqual(['msme', 'small']);
    expect(includedPaise).toBe(90000);
  });

  it('writes the bank file, quoting what needs it', () => {
    expect(bankFileCsv([{ vendorName: 'Rao, Sons', accountName: null, accountNumber: '123456', ifsc: 'HDFC0001234', amountPaise: 123450, narration: 'Bills PB-1 PB-2' }])).toBe(
      'Beneficiary Name,Account Number,IFSC,Amount,Narration\r\n"Rao, Sons",123456,HDFC0001234,1234.50,Bills PB-1 PB-2\r\n',
    );
  });
});

describe('payment runs', () => {
  let moduleRef: TestingModule;
  let runs: PaymentRunsService;
  let vendors: VendorsService;
  let billsSvc: PurchaseBillsService;
  let bills: Model<{ status: string }>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        MongooseModule.forRoot(testMongoUri()),
        MongooseModule.forFeature([
          { name: PaymentRun.name, schema: PaymentRunSchema },
          { name: PartyPayment.name, schema: PartyPaymentSchema },
          { name: Journal.name, schema: JournalSchema },
          { name: Counter.name, schema: CounterSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
          { name: LedgerAccount.name, schema: LedgerAccountSchema },
          { name: SalesInvoice.name, schema: SalesInvoiceSchema },
          { name: Customer.name, schema: CustomerSchema },
          { name: PurchaseBill.name, schema: PurchaseBillSchema },
          { name: Vendor.name, schema: VendorSchema },
        ]),
      ],
      providers: [PaymentRunsService, PartyPaymentsService, PostingService, AccountsService, AuditService, VendorsService, PurchaseBillsService],
    }).compile();
    runs = moduleRef.get(PaymentRunsService);
    vendors = moduleRef.get(VendorsService);
    billsSvc = moduleRef.get(PurchaseBillsService);
    bills = moduleRef.get(getModelToken(PurchaseBill.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongoose.disconnect();
  });

  it('suggests, drafts, exports and pays a run', async () => {
    const orgId = new Types.ObjectId().toString();
    const micro = await vendors.create({ orgId, actorId: ACTOR, name: 'Shakti Fabricators' });
    await vendors.edit(String(micro._id), orgId, ACTOR, {
      msme: { udyamNumber: 'UDYAM-MH-26-0012345', category: 'micro', activity: 'manufacturing' },
      bankAccount: { accountNumber: '50100012345678', ifsc: 'HDFC0001234', accountName: 'Shakti Fabricators' },
    });
    const plain = await vendors.create({ orgId, actorId: ACTOR, name: 'Sigma Supplies' });
    const bill = async (vendorId: unknown, n: string, billDate: string, dueDate: string, taxable: number) => {
      const b = await billsSvc.create({ orgId, vendorId: String(vendorId), billNumber: n, billDate, dueDate, amountsPaise: { taxableValue: taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, total: taxable } });
      await billsSvc.post(String(b._id), orgId, ACTOR);
      return String(b._id);
    };
    const m1 = await bill(micro._id, 'SF-1', '2026-10-01', '2026-11-30', 40000);
    const s1 = await bill(plain._id, 'SS-1', '2026-09-01', '2026-10-01', 25000);
    await bill(plain._id, 'SS-2', '2026-10-10', '2026-12-31', 99000);

    const suggestion = await runs.suggest(orgId, { payOn: '2026-10-20' }, TODAY);
    expect(suggestion.candidates.map((c) => [c.billNumber, c.priority])).toEqual([
      ['SF-1', 'msme_due'],
      ['SS-1', 'overdue'],
    ]);

    const run = await runs.create(orgId, ACTOR, { payOn: '2026-10-20', items: [{ billId: m1, amountPaise: 40000 }, { billId: s1, amountPaise: 25000 }] });
    expect(run.totalPaise).toBe(65000);
    expect((await runs.suggest(orgId, { payOn: '2026-10-20' }, TODAY)).candidates).toEqual([]);

    await expect(runs.bankFile(orgId, ACTOR, String(run._id))).rejects.toThrow(/Add bank details for Sigma Supplies/);
    await vendors.edit(String(plain._id), orgId, ACTOR, { bankAccount: { accountNumber: '000405001234', ifsc: 'ICIC0000004' } });
    const file = await runs.bankFile(orgId, ACTOR, String(run._id));
    expect(file.csv.split('\r\n').slice(1, 3).sort()).toEqual(['Shakti Fabricators,50100012345678,HDFC0001234,400.00,Bills SF-1', 'Sigma Supplies,000405001234,ICIC0000004,250.00,Bills SS-1']);

    expect(await runs.markPaid(orgId, ACTOR, String(run._id), '2026-10-20')).toEqual({ recorded: 2, failed: [] });
    expect((await bills.find({ orgId, billNumber: { $in: ['SF-1', 'SS-1'] } }).lean().exec()).map((b) => b.status)).toEqual([BillStatus.PAID, BillStatus.PAID]);
    await expect(runs.markPaid(orgId, ACTOR, String(run._id), '2026-10-20')).rejects.toThrow(/This run is paid/);
  });
});
