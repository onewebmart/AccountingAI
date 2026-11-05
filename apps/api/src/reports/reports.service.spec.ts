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
import { PostingService, financialYearOf } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { ImportBatch, ImportBatchSchema } from '../migration/schemas/import-batch.schema';
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
        { name: ImportBatch.name, schema: ImportBatchSchema },
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

  it('nets a reversed journal to zero', async () => {
    // Found end to end: reversing a ₹10,000 sale left Sales at +₹8,474.58 and
    // AR doubled, because the original dropped out of the posted set while its
    // contra entry stayed in. A reversal is dated today, so post the original
    // in today's financial year to see both in one report.
    const today = new Date().toISOString().slice(0, 10);
    const fy = financialYearOf(today);
    const receivable = new Types.ObjectId().toString();
    const sales = new Types.ObjectId().toString();
    const original = await postingSvc.post({
      orgId: ORG_ID,
      voucherType: VoucherType.SALES,
      financialYear: fy,
      date: today,
      narration: 'Sale entered in error',
      postedBy: ACTOR_ID,
      lines: [
        { accountId: receivable, description: 'Accounts Receivable', debitPaise: 1000000, creditPaise: 0 },
        { accountId: sales, description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      ],
    });

    await postingSvc.reverse(original._id.toString(), ACTOR_ID);

    const tb = await svc.getTrialBalance(ORG_ID, fy);
    expect(tb.entries.map((e) => e.netPaise)).toEqual([0, 0]);
    expect(tb.grandTotalDebitPaise).toBe(2000000);
    expect(tb.isBalanced).toBe(true);
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

// ── Balances that carry across years ─────────────────────────────────────────

describe('balances carried across financial years', () => {
  // Two years of postings for one org: ₹10,000 of sales in 2024-25, ₹5,000 in
  // 2025-26, all still owed by the customer.
  const orgId = new Types.ObjectId().toString();
  let receivableId: string;
  let salesId: string;

  async function sale(date: string, financialYear: string, paise: number) {
    await postingSvc.post({
      orgId,
      voucherType: VoucherType.SALES,
      financialYear,
      date,
      narration: `Sale ${date}`,
      postedBy: ACTOR_ID,
      lines: [
        { accountId: receivableId, description: 'Accounts Receivable', debitPaise: paise, creditPaise: 0 },
        { accountId: salesId, description: 'Sales Revenue', debitPaise: 0, creditPaise: paise },
      ],
    });
  }

  beforeEach(async () => {
    const accounts = moduleRef.get<Model<unknown>>(getModelToken(LedgerAccount.name));
    await accounts.deleteMany({ orgId });
    const [ar, sales] = await accounts.create([
      { orgId, name: 'Accounts Receivable', code: '1200', type: AccountType.ASSETS },
      { orgId, name: 'Sales Revenue', code: '4100', type: AccountType.INCOME },
    ]);
    receivableId = String((ar as { _id: unknown })._id);
    salesId = String((sales as { _id: unknown })._id);
    await sale('2024-06-01', '2024-25', 1000000);
    await sale('2025-05-01', '2025-26', 500000);
  });

  it('a ledger looked up by account id opens with the prior years for a balance-sheet account', async () => {
    const ledger = await svc.getLedger(orgId, '2025-26', receivableId);
    expect(ledger.accountDescription).toBe('Accounts Receivable');
    expect(ledger.openingBalancePaise).toBe(1000000);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.closingBalancePaise).toBe(1500000);
  });

  it('an income account starts every year at zero', async () => {
    const ledger = await svc.getLedger(orgId, '2025-26', salesId);
    expect(ledger.openingBalancePaise).toBe(0);
    expect(ledger.closingBalancePaise).toBe(-500000);
  });

  it('the balance sheet includes earlier years, and profit to date as retained earnings', async () => {
    // It used to read only the selected year: assets ₹5,000, the 2024-25 sale gone.
    const bs = await svc.getBalanceSheet(orgId, '2025-26');
    expect(bs.totalAssetsPaise).toBe(1500000);
    expect(bs.retainedEarningsPaise).toBe(1500000);
    expect(bs.isTiedOut).toBe(true);
  });

  it('the balance sheet stops at asOf', async () => {
    const bs = await svc.getBalanceSheet(orgId, '2025-26', '2025-04-30');
    expect(bs.asOf).toBe('2025-04-30');
    expect(bs.totalAssetsPaise).toBe(1000000);
    expect(bs.isTiedOut).toBe(true);
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

  it('counts bank and cash by account, not by wording; opening balances open the year; transfers move nothing', async () => {
    const orgId = new Types.ObjectId().toString();
    const accounts = moduleRef.get<Model<unknown>>(getModelToken(LedgerAccount.name));
    const batches = moduleRef.get<Model<unknown>>(getModelToken(ImportBatch.name));
    const made = await accounts.create([
      { orgId, name: 'Bank Accounts', code: '1100', type: AccountType.ASSETS, systemKey: 'BANK' },
      { orgId, name: 'Cash in Hand', code: '1110', type: AccountType.ASSETS, systemKey: 'CASH' },
      { orgId, name: "Owner's Capital", code: '3100', type: AccountType.CAPITAL },
      { orgId, name: 'Salaries & Wages', code: '6110', type: AccountType.EXPENSE },
      { orgId, name: 'Bank Charges', code: '6190', type: AccountType.EXPENSE },
      { orgId, name: 'Accounts Receivable', code: '1200', type: AccountType.ASSETS },
    ]);
    const [bank, cash, capital, salaries, charges, receivable] = made.map((a) => String((a as { _id: unknown })._id));
    const post = (date: string, narration: string, lines: Array<[string, string, number, number]>, voucherType = VoucherType.JOURNAL) =>
      postingSvc.post({
        orgId, voucherType, financialYear: FY, date, narration, postedBy: ACTOR_ID,
        lines: lines.map(([accountId, description, debitPaise, creditPaise]) => ({ accountId, description, debitPaise, creditPaise })),
      });

    const opening = await post('2025-04-01', 'Opening balances entered by hand', [[bank, 'Bank', 1_000_000, 0], [cash, 'Cash', 50_000, 0], [capital, 'Capital', 0, 1_050_000]]);
    await batches.create({ orgId, source: 'manual', status: 'committed', journalId: opening._id, createdBy: ACTOR_ID });
    // A journal voucher whose words never say "bank" still moves money.
    await post('2025-04-30', 'Salaries for April', [[salaries, 'Salaries for April', 200_000, 0], [bank, 'Salaries for April', 0, 200_000]]);
    // An expense named "Bank Charges" is not money coming in.
    await post('2025-05-31', 'Account charges', [[charges, 'Bank Charges', 5_900, 0], [bank, 'HDFC charges', 0, 5_900]], VoucherType.PAYMENT);
    await post('2025-06-10', 'Customer paid', [[bank, 'NEFT', 300_000, 0], [receivable, 'Receipt', 0, 300_000]], VoucherType.RECEIPT);
    // Cash taken out of the bank: in and out of our own accounts.
    await post('2025-06-15', 'Cash withdrawn', [[cash, 'Cash', 20_000, 0], [bank, 'Bank', 0, 20_000]], VoucherType.CONTRA);

    const year = await svc.getCashFlow(orgId, FY);
    expect(year).toMatchObject({ openingCashPaise: 1_050_000, cashInflowsPaise: 300_000, cashOutflowsPaise: 205_900, netCashFlowPaise: 94_100, closingCashPaise: 1_144_100 });

    // A month opens with everything before it.
    const june = await svc.getCashFlow(orgId, FY, '2025-06');
    expect(june).toMatchObject({ openingCashPaise: 1_050_000 - 205_900, cashInflowsPaise: 300_000, cashOutflowsPaise: 0, closingCashPaise: 1_144_100 });
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
