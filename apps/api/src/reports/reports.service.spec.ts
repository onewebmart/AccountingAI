/**
 * Phase 13 Integration Tests — ReportsService.
 *
 * Done when:
 *  ✓ classifyAccount: INCOME, EXPENSE, ASSETS, LIABILITIES, CAPITAL correctly identified
 *  ✓ Trial Balance: ΣDebit === ΣCredit (isBalanced = true) after posting journals
 *  ✓ P&L: revenue and expense correctly totalled; netIncome accurate
 *  ✓ Balance Sheet: isTiedOut = true (Assets = Liabilities + Equity)
 *  ✓ P&L + BS tie out: netIncome (P&L) === total assets − total liabilities − capital
 *  ✓ Ledger: entries for a specific account filtered and running balance correct
 *  ✓ Day Book: all journals in date range with embedded lines
 *  ✓ Cash Flow: direct method inflows/outflows from Bank / Cash lines
 *  ✓ Tenant isolation: Org B journals never appear in Org A reports
 *  ✓ P&L period filter: only journals in the requested month are included
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { ReportsService, classifyAccount } from './reports.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PostingService } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { AccountType, VoucherType } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();
const FY = '2025-26';

let moduleRef: TestingModule;
let svc: ReportsService;
let postingSvc: PostingService;
let journalModel: Model<JournalDocument>;

// ── Helper: post a balanced journal directly ───────────────────────────────

async function postJournal(
  voucherType: VoucherType,
  date: string,
  narration: string,
  lines: Array<{ description: string; debitPaise: number; creditPaise: number }>,
) {
  return postingSvc.post({
    orgId: ORG_ID,
    voucherType,
    financialYear: FY,
    date,
    narration,
    postedBy: ACTOR_ID,
    lines: lines.map((l) => ({
      accountId: new Types.ObjectId().toString(),
      description: l.description,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

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
      ]),
    ],
    providers: [ReportsService, PostingService],
  }).compile();

  svc = moduleRef.get(ReportsService);
  postingSvc = moduleRef.get(PostingService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
});

afterAll(async () => {
  await moduleRef.close();
});

afterEach(async () => {
  await journalModel.deleteMany({});
});

// ── Unit: account classification ──────────────────────────────────────────

describe('classifyAccount', () => {
  it('classifies income accounts', () => {
    expect(classifyAccount('Sales / Revenue Account')).toBe(AccountType.INCOME);
    expect(classifyAccount('Sales GST Output')).toBe(AccountType.INCOME); // 'sales' wins
    expect(classifyAccount('Other Income')).toBe(AccountType.INCOME);
  });

  it('classifies expense accounts', () => {
    expect(classifyAccount('Purchase / Expense Account')).toBe(AccountType.EXPENSE);
    expect(classifyAccount('Cost of Goods Sold')).toBe(AccountType.EXPENSE);
    expect(classifyAccount('Rent Expense')).toBe(AccountType.EXPENSE);
  });

  it('classifies asset accounts', () => {
    expect(classifyAccount('Accounts Receivable')).toBe(AccountType.ASSETS);
    expect(classifyAccount('Bank / Cash Account')).toBe(AccountType.ASSETS);
    expect(classifyAccount('GST Input Tax Credit')).toBe(AccountType.ASSETS);
  });

  it('classifies liability accounts', () => {
    expect(classifyAccount('Accounts Payable')).toBe(AccountType.LIABILITIES);
    expect(classifyAccount('GST Output Tax')).toBe(AccountType.LIABILITIES);
    expect(classifyAccount('Tax Payable')).toBe(AccountType.LIABILITIES);
  });

  it('classifies capital accounts', () => {
    expect(classifyAccount('Share Capital')).toBe(AccountType.CAPITAL);
    expect(classifyAccount('Retained Earnings')).toBe(AccountType.CAPITAL);
    expect(classifyAccount('Partners Equity')).toBe(AccountType.CAPITAL);
  });
});

// ── Trial Balance ─────────────────────────────────────────────────────────

describe('getTrialBalance', () => {
  it('returns isBalanced=true after posting journals (Invariant 2 guaranteed)', async () => {
    // SALES journal: Dr AR / Cr Sales / Cr GST Output
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale to Rahul Enterprises', [
      { description: 'Accounts Receivable', debitPaise: 1180000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 180000 },
    ]);

    // PURCHASE journal: Dr Expense / Dr GST Input / Cr AP
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase from Sigma Electricals', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'GST Input Tax Credit', debitPaise: 90000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 590000 },
    ]);

    const tb = await svc.getTrialBalance(ORG_ID, FY);

    expect(tb.isBalanced).toBe(true);
    expect(tb.grandTotalDebitPaise).toBe(tb.grandTotalCreditPaise);
    expect(tb.entries.length).toBeGreaterThan(0);

    // Grand totals should equal sum across journals
    // SALES: total debit = 1,180,000; PURCHASE: total debit = 500,000 + 90,000 = 590,000
    // Combined debit = 1,770,000; Combined credit = 1,000,000 + 180,000 + 590,000 = 1,770,000
    expect(tb.grandTotalDebitPaise).toBe(1770000);
    expect(tb.grandTotalCreditPaise).toBe(1770000);
  });

  it('returns empty TB when no journals posted', async () => {
    const tb = await svc.getTrialBalance(ORG_ID, FY);
    expect(tb.entries).toHaveLength(0);
    expect(tb.isBalanced).toBe(true); // 0 === 0
  });
});

// ── P&L ──────────────────────────────────────────────────────────────────────

describe('getProfitAndLoss', () => {
  it('correctly totals revenue and expenses; netIncome is accurate', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 1180000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 180000 },
    ]);
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'GST Input Tax Credit', debitPaise: 90000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 590000 },
    ]);

    const pl = await svc.getProfitAndLoss(ORG_ID, FY);

    expect(pl.totalRevenuePaise).toBe(1000000);
    expect(pl.totalExpensesPaise).toBe(500000);
    expect(pl.netIncomePaise).toBe(500000);
    expect(pl.revenueLines).toHaveLength(1);
    expect(pl.expenseLines).toHaveLength(1);
  });

  it('filters by period — only returns journals in the requested month', async () => {
    await postJournal(VoucherType.SALES, '2025-04-10', 'April sale', [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);
    await postJournal(VoucherType.SALES, '2025-05-05', 'May sale', [
      { description: 'Accounts Receivable', debitPaise: 300000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 300000 },
    ]);

    const aprilPl = await svc.getProfitAndLoss(ORG_ID, FY, '2025-04');
    const mayPl = await svc.getProfitAndLoss(ORG_ID, FY, '2025-05');

    expect(aprilPl.totalRevenuePaise).toBe(500000);
    expect(mayPl.totalRevenuePaise).toBe(300000);
  });
});

// ── Balance Sheet ─────────────────────────────────────────────────────────────

describe('getBalanceSheet', () => {
  it('isTiedOut=true: Assets = Liabilities + Equity (P&L netIncome as retained earnings)', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 1180000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 180000 },
    ]);
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'GST Input Tax Credit', debitPaise: 90000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 590000 },
    ]);

    const bs = await svc.getBalanceSheet(ORG_ID, FY);

    // Assets: AR (1,180,000) + GST Input (90,000) = 1,270,000
    expect(bs.totalAssetsPaise).toBe(1270000);
    // Liabilities: GST Output (180,000) + AP (590,000) = 770,000
    expect(bs.totalLiabilitiesPaise).toBe(770000);
    // Retained earnings (Net Income) = 500,000
    expect(bs.retainedEarningsPaise).toBe(500000);
    // Equity = 0 (capital) + 500,000 (retained) = 500,000
    expect(bs.totalEquityPaise).toBe(500000);
    // 1,270,000 = 770,000 + 500,000 ✓
    expect(bs.isTiedOut).toBe(true);
  });

  it('P&L + BS tie out: netIncome === totalAssets − totalLiabilities − explicit capital', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 1180000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 180000 },
    ]);
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'GST Input Tax Credit', debitPaise: 90000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 590000 },
    ]);

    const pl = await svc.getProfitAndLoss(ORG_ID, FY);
    const bs = await svc.getBalanceSheet(ORG_ID, FY);

    // The core tie-out: netIncome on P&L === residual equity on BS
    expect(pl.netIncomePaise).toBe(bs.retainedEarningsPaise);
    // Assets = Liabilities + Equity (retained)
    expect(bs.totalAssetsPaise).toBe(bs.totalLiabilitiesPaise + bs.totalEquityPaise);
    expect(bs.isTiedOut).toBe(true);
  });

  it('BS with explicit capital entry: capital included in equity', async () => {
    // Capital infusion: Dr Bank / Cr Share Capital
    await postJournal(VoucherType.PAYMENT, '2025-04-01', 'Capital infusion', [
      { description: 'Bank / Cash Account', debitPaise: 1000000, creditPaise: 0 },
      { description: 'Share Capital', debitPaise: 0, creditPaise: 1000000 },
    ]);

    const bs = await svc.getBalanceSheet(ORG_ID, FY);
    expect(bs.totalAssetsPaise).toBe(1000000); // Bank
    expect(bs.totalLiabilitiesPaise).toBe(0);
    expect(bs.totalEquityPaise).toBe(1000000); // Capital (no P&L transactions)
    expect(bs.isTiedOut).toBe(true);
  });
});

// ── Ledger ────────────────────────────────────────────────────────────────────

describe('getLedger', () => {
  it('returns only lines for the requested account, with running balance', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale 1', [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);
    await postJournal(VoucherType.RECEIPT, '2025-04-20', 'Receipt from customer', [
      { description: 'Bank / Cash Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'Accounts Receivable', debitPaise: 0, creditPaise: 500000 },
    ]);

    const ledger = await svc.getLedger(ORG_ID, FY, 'Accounts Receivable');

    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[0].debitPaise).toBe(500000);
    expect(ledger.entries[0].runningBalancePaise).toBe(500000);
    expect(ledger.entries[1].creditPaise).toBe(500000);
    expect(ledger.entries[1].runningBalancePaise).toBe(0); // fully cleared
    expect(ledger.closingBalancePaise).toBe(0);
  });
});

// ── Day Book ──────────────────────────────────────────────────────────────────

describe('getDayBook', () => {
  it('returns all journals in the date range with embedded lines', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 300000 },
    ]);
    // This one is outside the range
    await postJournal(VoucherType.SALES, '2025-05-01', 'May sale', [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);

    const dayBook = await svc.getDayBook(ORG_ID, '2025-04-01', '2025-04-30', FY);

    expect(dayBook).toHaveLength(2);
    expect(dayBook[0].date).toBe('2025-04-15');
    expect(dayBook[0].totalAmountPaise).toBe(500000);
    expect(dayBook[0].lines).toHaveLength(2);
    expect(dayBook[1].date).toBe('2025-04-20');
  });
});

// ── Cash Flow ─────────────────────────────────────────────────────────────────

describe('getCashFlow', () => {
  it('inflows = Bank debits (receipts); outflows = Bank credits (payments)', async () => {
    // Receipt: Dr Bank / Cr AR (cash in = 500,000)
    await postJournal(VoucherType.RECEIPT, '2025-04-18', 'Customer payment', [
      { description: 'Bank / Cash Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'Accounts Receivable', debitPaise: 0, creditPaise: 500000 },
    ]);
    // Payment: Dr AP / Cr Bank (cash out = 300,000)
    await postJournal(VoucherType.PAYMENT, '2025-04-22', 'Vendor payment', [
      { description: 'Accounts Payable', debitPaise: 300000, creditPaise: 0 },
      { description: 'Bank / Cash Account', debitPaise: 0, creditPaise: 300000 },
    ]);

    const cf = await svc.getCashFlow(ORG_ID, FY);
    expect(cf.cashInflowsPaise).toBe(500000);
    expect(cf.cashOutflowsPaise).toBe(300000);
    expect(cf.netCashFlowPaise).toBe(200000);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('Org B journals never appear in Org A Trial Balance', async () => {
    const ORG_B = new Types.ObjectId().toString();

    // Post to Org A
    await postingSvc.post({
      orgId: ORG_ID,
      voucherType: VoucherType.SALES,
      financialYear: FY,
      date: '2025-04-10',
      narration: 'Org A sale',
      postedBy: ACTOR_ID,
      lines: [
        { accountId: new Types.ObjectId().toString(), description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
        { accountId: new Types.ObjectId().toString(), description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
      ],
    });

    // Post to Org B (using direct model insert to bypass tenant isolation in PostingService)
    await postingSvc.post({
      orgId: ORG_B,
      voucherType: VoucherType.SALES,
      financialYear: FY,
      date: '2025-04-10',
      narration: 'Org B sale',
      postedBy: ACTOR_ID,
      lines: [
        { accountId: new Types.ObjectId().toString(), description: 'Accounts Receivable', debitPaise: 999999, creditPaise: 0 },
        { accountId: new Types.ObjectId().toString(), description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 999999 },
      ],
    });

    const tbA = await svc.getTrialBalance(ORG_ID, FY);
    // Org A should only see its own 100,000
    expect(tbA.grandTotalDebitPaise).toBe(100000);
    // Org B's 999,999 must NOT appear
    const arEntry = tbA.entries.find((e) => e.accountDescription === 'Accounts Receivable');
    expect(arEntry?.totalDebitPaise).toBe(100000);
  });
});
