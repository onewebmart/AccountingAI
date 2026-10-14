/**
 * Integration tests — the cash forecast and P&L projection from real books.
 *
 * One org, worked by hand (all paise):
 *   Bank 98,80,000 today: 1,00,00,000 opening + 11,80,000 received − 13,00,000 salary.
 *   Rao pays 14 days late (INV-H, due 31 Jul, paid 14 Aug), so INV-O due 20 Oct
 *   is expected 3 Nov. Old invoice due 31 May is 136 days late: doubtful, left out.
 *   Bills: 11,70,000 overdue (11,80,000 less 10,000 TDS) and 5,90,000 due 18 Oct.
 *   GST on the books: output 5,40,000 − input 2,70,000 = 2,70,000 due 20 Oct.
 *   TDS 10,000 due 7 Nov. Rent 20,00,000 recurring from 1 Nov, due 5 days later.
 *   Salary 13,00,000 in the last 90 days → 1,01,111 a week.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { ForecastService } from './forecast.service';
import { ReportsService } from '../reports/reports.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { RecurringTemplate, RecurringTemplateSchema } from '../automation/schemas/recurring-template.schema';

const ACTOR = new Types.ObjectId().toString();
const TODAY = '2026-10-14';
const GST = (taxable: number) => ({ taxableValue: taxable, cgst: taxable * 0.09, sgst: taxable * 0.09, igst: 0, cess: 0, total: taxable * 1.18 });

let moduleRef: TestingModule;
let forecast: ForecastService;
let orgId: string;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
      ]),
    ],
    providers: [ForecastService, ReportsService, PostingService, AccountsService, AuditService, SalesInvoicesService, PurchaseBillsService],
  }).compile();
  forecast = moduleRef.get(ForecastService);

  // ── The books ────────────────────────────────────────────────────────────
  orgId = new Types.ObjectId().toString();
  const posting = moduleRef.get(PostingService);
  const accounts = moduleRef.get(AccountsService);
  const invoices = moduleRef.get(SalesInvoicesService);
  const bills = moduleRef.get(PurchaseBillsService);
  const sys = await accounts.resolveSystemAccounts(orgId, [SystemAccountKey.BANK, SystemAccountKey.RETAINED_EARNINGS]);
  const bank = sys.get(SystemAccountKey.BANK)!;
  const salaries = await moduleRef.get<Model<{ _id: Types.ObjectId; name: string }>>(getModelToken(LedgerAccount.name)).findOne({ orgId, code: '6110' }).lean().exec();

  const leg = (a: { _id: Types.ObjectId; name: string }, debitPaise: number, creditPaise: number) => ({ accountId: a._id.toString(), description: a.name, debitPaise, creditPaise });
  await posting.post({
    orgId, voucherType: VoucherType.JOURNAL, financialYear: '2026-27', date: '2026-04-01', postedBy: ACTOR,
    lines: [leg(bank, 10000000, 0), leg(sys.get(SystemAccountKey.RETAINED_EARNINGS)!, 0, 10000000)],
  });
  await posting.post({
    orgId, voucherType: VoucherType.PAYMENT, financialYear: '2026-27', date: '2026-09-30', postedBy: ACTOR,
    lines: [leg(salaries!, 1300000, 0), leg(bank, 0, 1300000)],
  });

  const customers = moduleRef.get<Model<unknown>>(getModelToken(Customer.name));
  const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
  const [old] = await customers.create([{ orgId, name: 'Gone Quiet Ltd' }]);
  const invoice = async (customerId: unknown, number: string, invoiceDate: string, dueDate: string) => {
    const inv = await invoices.create({ orgId, customerId: String(customerId), invoiceNumber: number, invoiceDate, dueDate, amountsPaise: GST(1000000) });
    await invoices.post(String(inv._id), orgId, ACTOR);
    return String(inv._id);
  };
  const history = await invoice(rao._id, 'INV-H', '2026-07-01', '2026-07-31');
  await invoices.markPaid(history, orgId, ACTOR, '2026-08-14');
  await invoice(rao._id, 'INV-O', '2026-10-01', '2026-10-20');
  await invoice(old._id, 'INV-OLD', '2026-05-01', '2026-05-31');

  const vendors = moduleRef.get<Model<unknown>>(getModelToken(Vendor.name));
  const [vendor] = await vendors.create([{ orgId, name: 'Sigma Supplies' }]);
  const bill = async (number: string, billDate: string, dueDate: string, taxable: number, tds: Record<string, unknown>) => {
    const b = await bills.create({ orgId, vendorId: String(vendor._id), billNumber: number, billDate, dueDate, amountsPaise: GST(taxable), ...tds });
    await bills.post(String(b._id), orgId, ACTOR);
  };
  await bill('PB-TDS', '2026-09-15', '2026-09-30', 1000000, { tdsSection: '194C', tdsRateBps: 100 });
  await bill('PB-1', '2026-10-05', '2026-10-18', 500000, { tdsSection: 'none' });

  await moduleRef.get<Model<unknown>>(getModelToken(RecurringTemplate.name)).create({
    orgId, kind: 'bill', name: 'Office rent', partyId: vendor._id, frequency: 'monthly', dayOfMonth: 1,
    startDate: '2026-11-01', nextRunDate: '2026-11-01', dueInDays: 5,
    amountsPaise: { taxableValue: 2000000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 2000000 },
    status: 'active', createdBy: ACTOR,
  });
}, 120_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('cash forecast', () => {
  it('starts from the bank, dates each item, and runs the balance forward', async () => {
    const f = await forecast.cashForecast(orgId, 13, TODAY);
    expect(f.openingCashPaise).toBe(9880000);
    expect(f.runRate).toEqual({ weeklyInPaise: 0, weeklyOutPaise: 101111, basedOnDays: 90 });
    expect(f.doubtful).toEqual({ count: 1, amountPaise: 1180000 });

    const [week0, week1, week2, week3] = f.weeks;
    expect(week0.items.map((i) => [i.label, i.date, i.amountPaise])).toEqual([
      ['Sigma Supplies · PB-TDS', TODAY, 1170000],
      ['Sigma Supplies · PB-1', '2026-10-18', 590000],
      ['GST (GSTR-3B)', '2026-10-20', 270000],
      ['Usual spending without a bill', '2026-10-20', 101111],
    ]);
    expect(week0.closingPaise).toBe(7748889);
    expect(week1.closingPaise).toBe(7647778);

    const inv = week2.items.find((i) => i.kind === 'receivable');
    expect(inv).toMatchObject({ label: 'Rao Traders · INV-O', date: '2026-11-03', amountPaise: 1180000, note: 'pays about 14 days after the due date' });
    expect(week2.closingPaise).toBe(8726667);

    expect(week3.items.map((i) => [i.kind, i.date, i.amountPaise])).toEqual([
      ['recurring_out', '2026-11-06', 2000000],
      ['tds', '2026-11-07', 10000],
      ['run_rate_out', '2026-11-10', 101111],
    ]);
    expect(f.weeks.at(-1)?.closingPaise).toBe(1705557);
    expect(f.lowestPaise).toBe(1705557);
  });

  it('refuses a silly horizon', async () => {
    await expect(forecast.cashForecast(orgId, 0, TODAY)).rejects.toThrow(/1 to 26/);
  });
});

describe('P&L projection', () => {
  it('shows six booked months and projects three from the first active one', async () => {
    const p = await forecast.plProjection(orgId, TODAY);
    expect(p.months.map((m) => [m.period, m.revenuePaise, m.expensesPaise, m.projected])).toEqual([
      ['2026-04', 0, 0, false],
      ['2026-05', 1000000, 0, false],
      ['2026-06', 0, 0, false],
      ['2026-07', 1000000, 0, false],
      ['2026-08', 0, 0, false],
      ['2026-09', 0, 2300000, false],
      ['2026-10', 0, 1840000, true],
      ['2026-11', 0, 2300000, true],
      ['2026-12', 0, 2760000, true],
    ]);
  });
});
