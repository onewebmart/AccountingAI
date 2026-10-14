/**
 * Integration tests — period locks and year-end close.
 *
 *  ✓ A locked period refuses any posting dated in it; later dates still post
 *  ✓ Closing a year moves income and expense to retained earnings in one entry
 *  ✓ The closed year's P&L still shows what happened in it
 *  ✓ The balance sheet ties out with the profit carried in Retained Earnings
 *  ✓ A closed year is locked; the lock cannot be lowered beneath it
 *  ✓ The current year cannot be closed, nor a year closed twice
 *  ✓ Reopening reverses the close on the same date and lifts the lock
 *  ✓ The checklist counts what is still open in the period
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { ClosingService } from './closing.service';
import { ClosingRun, ClosingRunSchema } from './schemas/closing-run.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { ReportsService } from '../reports/reports.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema } from '../gl/schemas/period-lock.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';

const ACTOR_ID = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let closing: ClosingService;
let posting: PostingService;
let accounts: AccountsService;
let reports: ReportsService;
let journalModel: Model<JournalDocument>;
let invoiceModel: Model<unknown>;

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
        { name: PeriodLock.name, schema: PeriodLockSchema },
        { name: ClosingRun.name, schema: ClosingRunSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [ClosingService, PostingService, AccountsService, AuditService, ReportsService],
  }).compile();

  closing = moduleRef.get(ClosingService);
  posting = moduleRef.get(PostingService);
  accounts = moduleRef.get(AccountsService);
  reports = moduleRef.get(ReportsService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  await journalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

/** An org with a ₹10,000 sale and a ₹3,000 expense in FY 2025-26: ₹7,000 profit. */
async function orgWithAYear() {
  const orgId = new Types.ObjectId().toString();
  const sys = await accounts.resolveSystemAccounts(orgId, [
    SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.SALES_REVENUE,
    SystemAccountKey.PURCHASE_EXPENSE, SystemAccountKey.BANK,
  ]);
  const line = (key: SystemAccountKey, dr: number, cr: number) => ({
    accountId: sys.get(key)!._id.toString(), description: sys.get(key)!.name, debitPaise: dr, creditPaise: cr,
  });
  await posting.post({
    orgId, voucherType: VoucherType.SALES, financialYear: '2025-26', date: '2025-12-01', postedBy: ACTOR_ID,
    lines: [line(SystemAccountKey.ACCOUNTS_RECEIVABLE, 1000000, 0), line(SystemAccountKey.SALES_REVENUE, 0, 1000000)],
  });
  await posting.post({
    orgId, voucherType: VoucherType.PAYMENT, financialYear: '2025-26', date: '2026-01-10', postedBy: ACTOR_ID,
    lines: [line(SystemAccountKey.PURCHASE_EXPENSE, 300000, 0), line(SystemAccountKey.BANK, 0, 300000)],
  });
  return { orgId, line };
}

describe('period lock', () => {
  it('refuses anything dated in a locked period, and posts after it', async () => {
    const { orgId, line } = await orgWithAYear();
    await closing.setLock(orgId, ACTOR_ID, '2026-06-30', 'June GST filed');

    const entry = (date: string) => posting.post({
      orgId, voucherType: VoucherType.JOURNAL, financialYear: '2026-27', date, postedBy: ACTOR_ID,
      lines: [line(SystemAccountKey.PURCHASE_EXPENSE, 100, 0), line(SystemAccountKey.BANK, 0, 100)],
    });
    await expect(entry('2026-06-15')).rejects.toThrow(/locked through 2026-06-30, and this entry is dated 2026-06-15/);
    await expect(entry('2026-07-01')).resolves.toBeTruthy();
  });

  it('cannot lock past today', async () => {
    const { orgId } = await orgWithAYear();
    await expect(closing.setLock(orgId, ACTOR_ID, '2999-01-01')).rejects.toThrow(/past today/);
  });
});

describe('year-end close', () => {
  it('moves the year to retained earnings, keeps its P&L, ties out the balance sheet, and locks it', async () => {
    const { orgId, line } = await orgWithAYear();
    const run = await closing.closeYear(orgId, ACTOR_ID, '2025-26');

    expect(run.netIncomePaise).toBe(700000);
    const entry = await journalModel.findById(run.journalId).exec();
    expect(entry?.isClosingEntry).toBe(true);
    expect(entry?.date).toBe('2026-03-31');
    expect(entry?.lines.map((l) => [l.description, l.debitPaise, l.creditPaise])).toEqual([
      ['Sales Revenue', 1000000, 0],
      ['Purchases', 0, 300000],
      ['Retained Earnings', 0, 700000],
    ]);

    // The closed year still reports what happened in it.
    const pl = await reports.getProfitAndLoss(orgId, '2025-26');
    expect(pl.netIncomePaise).toBe(700000);

    // Next year's balance sheet carries the profit in Retained Earnings, once.
    const bs = await reports.getBalanceSheet(orgId, '2026-27', '2026-04-30');
    expect(bs.retainedEarningsPaise).toBe(0);
    expect(bs.capitalLines.find((l) => l.accountDescription === 'Retained Earnings')?.netPaise).toBe(-700000);
    expect(bs.isTiedOut).toBe(true);

    // And it is locked.
    await expect(
      posting.post({
        orgId, voucherType: VoucherType.JOURNAL, financialYear: '2025-26', date: '2026-03-15', postedBy: ACTOR_ID,
        lines: [line(SystemAccountKey.PURCHASE_EXPENSE, 100, 0), line(SystemAccountKey.BANK, 0, 100)],
      }),
    ).rejects.toThrow(/locked through 2026-03-31/);
    await expect(closing.setLock(orgId, ACTOR_ID, '2026-01-31')).rejects.toThrow(/closed through 2026-03-31/);
  });

  it('refuses the current year and a second close', async () => {
    const { orgId } = await orgWithAYear();
    await expect(closing.closeYear(orgId, ACTOR_ID, '2026-27')).rejects.toThrow(/runs until 2027-03-31/);
    await closing.closeYear(orgId, ACTOR_ID, '2025-26');
    await expect(closing.closeYear(orgId, ACTOR_ID, '2025-26')).rejects.toThrow(/already closed/);
  });

  it('reopening reverses the close on the same date and lifts the lock', async () => {
    const { orgId, line } = await orgWithAYear();
    const run = await closing.closeYear(orgId, ACTOR_ID, '2025-26');
    const reopened = await closing.reopenYear(orgId, ACTOR_ID, '2025-26');
    expect(reopened.status).toBe('reopened');

    const reversal = await journalModel.findOne({ orgId, reversalOf: run.journalId }).exec();
    expect(reversal?.date).toBe('2026-03-31');
    expect(reversal?.isClosingEntry).toBe(true);
    expect((await closing.status(orgId)).lockedThrough).toBeNull();

    // The year is open again: P&L unchanged, nothing left in retained earnings, posting allowed.
    expect((await reports.getProfitAndLoss(orgId, '2025-26')).netIncomePaise).toBe(700000);
    const bs = await reports.getBalanceSheet(orgId, '2025-26');
    expect(bs.retainedEarningsPaise).toBe(700000);
    expect(bs.isTiedOut).toBe(true);
    await expect(
      posting.post({
        orgId, voucherType: VoucherType.JOURNAL, financialYear: '2025-26', date: '2026-03-15', postedBy: ACTOR_ID,
        lines: [line(SystemAccountKey.PURCHASE_EXPENSE, 100, 0), line(SystemAccountKey.BANK, 0, 100)],
      }),
    ).resolves.toBeTruthy();

    // And it can be closed again.
    const again = await closing.closeYear(orgId, ACTOR_ID, '2025-26');
    expect(again.netIncomePaise).toBe(699900);
  });
});

describe('closing checklist', () => {
  it('counts what is still open on or before the date', async () => {
    const { orgId } = await orgWithAYear();
    await invoiceModel.create({
      orgId, customerId: new Types.ObjectId(), invoiceDate: '2026-09-20', status: InvoiceStatus.DRAFT,
      amountsPaise: { taxableValue: 100, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 100 },
    });
    const before = await closing.checklist(orgId, '2026-09-30');
    expect(before.items.find((i) => i.key === 'invoices')?.count).toBe(1);
    expect(before.ready).toBe(false);
    expect((await closing.checklist(orgId, '2026-08-31')).ready).toBe(true);
  });
});
