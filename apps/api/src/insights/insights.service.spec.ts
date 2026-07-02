/**
 * Phase 15 Integration Tests — InsightsService.
 *
 * Done when:
 *  ✓ Empty state: no posted journals → getInsights returns []
 *  ✓ Monthly summary insight always present when journals exist
 *  ✓ Health score insight always present when journals exist
 *  ✓ Expense spike: current month expenses >15% above previous month → insight emitted
 *  ✓ Expense spike: <15% change → no expense_spike insight
 *  ✓ Cash flow warning: net cash outflow (Bank debits < Bank credits) → insight emitted
 *  ✓ No cash-flow warning when net cash is positive
 *  ✓ Overdue AP: POSTED bill with dueDate < today → overdue_ap insight with correct amount
 *  ✓ No overdue AP insight when all bills are within due date
 *  ✓ GST due soon: today within 7 days of 20th of next month → gst_due_soon insight
 *  ✓ GST not flagged when due date is > 7 days away
 *  ✓ Insights never write to journals collection (Invariant 4)
 *  ✓ Tenant isolation: Org B overdue bills do not appear in Org A insights
 *  ✓ Health score reflects actual profitability and cash-flow state
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { InsightsService, InsightType } from './insights.service';
import { ReportsService } from '../reports/reports.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { PostingService } from '../gl/posting.service';
import { BillStatus, VoucherType } from '@ai-accounting/shared';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();
const FY = '2025-26';

/** Fixed "today" used across tests — 25 March 2025 (after the 20th so Feb GST due is in the past) */
const TODAY = '2025-03-25';
/** Previous period for today */
const CURR_PERIOD = '2025-03';
const PREV_PERIOD = '2025-02';

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let svc: InsightsService;
let postingSvc: PostingService;
let journalModel: Model<JournalDocument>;
let billModel: Model<PurchaseBillDocument>;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function postJournal(
  orgId: string,
  voucherType: VoucherType,
  date: string,
  lines: Array<{ description: string; debitPaise: number; creditPaise: number }>,
) {
  return postingSvc.post({
    orgId,
    voucherType,
    financialYear: FY,
    date,
    narration: 'Test journal',
    postedBy: ACTOR_ID,
    lines: lines.map((l) => ({
      accountId: new Types.ObjectId().toString(),
      description: l.description,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
    })),
  });
}

async function createOverdueBill(orgId: string, dueDate: string, totalPaise: number) {
  await billModel.create({
    orgId,
    vendorId: new Types.ObjectId(),
    billDate: '2025-01-15',
    dueDate,
    status: BillStatus.POSTED,
    amountsPaise: {
      taxableValue: totalPaise,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      total: totalPaise,
    },
    lineItems: [],
    financialYear: FY,
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
      ]),
    ],
    providers: [InsightsService, ReportsService, PostingService],
  }).compile();

  svc = moduleRef.get(InsightsService);
  postingSvc = moduleRef.get(PostingService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
});

afterAll(async () => {
  await moduleRef.close();
  await replSet.stop();
});

afterEach(async () => {
  await journalModel.deleteMany({});
  await billModel.deleteMany({});
});

// ── 1. Empty state ─────────────────────────────────────────────────────────────

describe('empty state', () => {
  it('returns [] when no posted journals exist', async () => {
    const result = await svc.getInsights(ORG_A, FY, TODAY);
    expect(result).toEqual([]);
  });
});

// ── 2. Always-present insights ─────────────────────────────────────────────────

describe('always-present insights', () => {
  beforeEach(async () => {
    // Post one SALES journal in the current period so there is data
    await postJournal(ORG_A, VoucherType.SALES, `${CURR_PERIOD}-10`, [
      { description: 'Accounts Receivable', debitPaise: 118000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 18000 },
    ]);
  });

  it('always includes monthly_summary', async () => {
    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.MONTHLY_SUMMARY)).toBe(true);
  });

  it('always includes health_score', async () => {
    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.HEALTH_SCORE)).toBe(true);
  });

  it('monthly_summary headline includes revenue and expenses', async () => {
    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    const summary = insights.find((i) => i.type === InsightType.MONTHLY_SUMMARY)!;
    expect(summary.headline).toMatch(/Revenue/);
    expect(summary.headline).toMatch(/Expenses/);
  });
});

// ── 3. Expense spike ───────────────────────────────────────────────────────────

describe('expense spike', () => {
  it('emits expense_spike when current month expenses >15% above prior month', async () => {
    // Feb (prev): expenses 100,000 paise
    await postJournal(ORG_A, VoucherType.PURCHASE, `${PREV_PERIOD}-15`, [
      { description: 'Purchase / Expense Account', debitPaise: 100000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 100000 },
    ]);

    // Mar (curr): expenses 130,000 paise (+30%) — revenue too so org has data
    await postJournal(ORG_A, VoucherType.PURCHASE, `${CURR_PERIOD}-10`, [
      { description: 'Purchase / Expense Account', debitPaise: 130000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 130000 },
    ]);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    const spike = insights.find((i) => i.type === InsightType.EXPENSE_SPIKE);
    expect(spike).toBeDefined();
    expect(spike!.changePercent).toBe(30);
    expect(spike!.headline).toMatch(/30%/);
  });

  it('does NOT emit expense_spike when change is under 15%', async () => {
    // Feb: 100,000 paise; Mar: 110,000 paise (+10%)
    await postJournal(ORG_A, VoucherType.PURCHASE, `${PREV_PERIOD}-15`, [
      { description: 'Purchase / Expense Account', debitPaise: 100000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 100000 },
    ]);
    await postJournal(ORG_A, VoucherType.PURCHASE, `${CURR_PERIOD}-10`, [
      { description: 'Purchase / Expense Account', debitPaise: 110000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 110000 },
    ]);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.EXPENSE_SPIKE)).toBe(false);
  });
});

// ── 4. Cash flow warning ────────────────────────────────────────────────────────

describe('cash flow warning', () => {
  it('emits cashflow_warning when cash outflows exceed inflows', async () => {
    // Payment journal: Bank CREDITED (cash going out > receipts)
    await postJournal(ORG_A, VoucherType.PAYMENT, `${CURR_PERIOD}-05`, [
      { description: 'Accounts Payable', debitPaise: 200000, creditPaise: 0 },
      { description: 'Bank / Cash Account', debitPaise: 0, creditPaise: 200000 },
    ]);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.CASHFLOW_WARNING)).toBe(true);
  });

  it('does NOT emit cashflow_warning when net cash is positive', async () => {
    // Receipt journal: Bank DEBITED (cash coming in)
    await postJournal(ORG_A, VoucherType.RECEIPT, `${CURR_PERIOD}-05`, [
      { description: 'Bank / Cash Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Receivable', debitPaise: 0, creditPaise: 300000 },
    ]);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.CASHFLOW_WARNING)).toBe(false);
  });
});

// ── 5. Overdue AP ──────────────────────────────────────────────────────────────

describe('overdue AP', () => {
  beforeEach(async () => {
    // Need at least one posted journal so insights triggers
    await postJournal(ORG_A, VoucherType.SALES, `${CURR_PERIOD}-01`, [
      { description: 'Accounts Receivable', debitPaise: 50000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 50000 },
    ]);
  });

  it('emits overdue_ap insight when posted bills are past due date', async () => {
    await createOverdueBill(ORG_A, '2025-03-01', 180000); // due 1 Mar, today is 14 Mar

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    const overdue = insights.find((i) => i.type === InsightType.OVERDUE_AP);
    expect(overdue).toBeDefined();
    expect(overdue!.amountPaise).toBe(180000);
    expect(overdue!.headline).toMatch(/1 vendor/);
  });

  it('aggregates multiple overdue bills correctly', async () => {
    await createOverdueBill(ORG_A, '2025-02-28', 100000);
    await createOverdueBill(ORG_A, '2025-03-05', 80000);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    const overdue = insights.find((i) => i.type === InsightType.OVERDUE_AP)!;
    expect(overdue.amountPaise).toBe(180000);
    expect(overdue.headline).toMatch(/2 vendors/);
  });

  it('does NOT emit overdue_ap when all bills are within due date', async () => {
    await createOverdueBill(ORG_A, '2025-04-10', 100000); // due 10 Apr, today is 25 Mar — not yet overdue

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.OVERDUE_AP)).toBe(false);
  });
});

// ── 6. GST due soon ────────────────────────────────────────────────────────────

describe('GST due soon', () => {
  beforeEach(async () => {
    await postJournal(ORG_A, VoucherType.SALES, `${CURR_PERIOD}-01`, [
      { description: 'Accounts Receivable', debitPaise: 50000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 50000 },
    ]);
  });

  it('emits gst_due_soon when today is within 7 days of the 20th of next month', async () => {
    // TODAY = 2025-03-14; next month 20th = 2025-04-20; days = 37 — NOT within 7 days
    // Use a "today" where we are 4 days before 20 Apr
    const todayNearGst = '2025-04-16';
    const insights = await svc.getInsights(ORG_A, FY, todayNearGst);
    const gstInsight = insights.find((i) => i.type === InsightType.GST_DUE_SOON);
    expect(gstInsight).toBeDefined();
    expect(gstInsight!.headline).toMatch(/GST due in 4 day/);
  });

  it('does NOT emit gst_due_soon when due date is > 7 days away', async () => {
    const insights = await svc.getInsights(ORG_A, FY, TODAY); // 37 days away
    expect(insights.some((i) => i.type === InsightType.GST_DUE_SOON)).toBe(false);
  });
});

// ── 7. Invariant 4: insights never write to GL ────────────────────────────────

describe('Invariant 4 — insights never write to GL', () => {
  it('journal count is unchanged after calling getInsights', async () => {
    await postJournal(ORG_A, VoucherType.SALES, `${CURR_PERIOD}-10`, [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);

    const countBefore = await journalModel.countDocuments({ orgId: ORG_A });
    await svc.getInsights(ORG_A, FY, TODAY);
    const countAfter = await journalModel.countDocuments({ orgId: ORG_A });

    expect(countAfter).toBe(countBefore);
  });
});

// ── 8. Tenant isolation ────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('Org B overdue bills do not appear in Org A insights', async () => {
    // Org A: a posted journal so insights runs
    await postJournal(ORG_A, VoucherType.SALES, `${CURR_PERIOD}-01`, [
      { description: 'Accounts Receivable', debitPaise: 50000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 50000 },
    ]);

    // Org B: overdue bill
    await createOverdueBill(ORG_B, '2025-03-01', 999999);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    expect(insights.some((i) => i.type === InsightType.OVERDUE_AP)).toBe(false);
  });
});

// ── 9. Health score ────────────────────────────────────────────────────────────

describe('health score', () => {
  it('reflects profitable state with high score', async () => {
    // Revenue journal with positive cash flow and no overdue bills
    await postJournal(ORG_A, VoucherType.RECEIPT, `${CURR_PERIOD}-10`, [
      { description: 'Bank / Cash Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'Accounts Receivable', debitPaise: 0, creditPaise: 500000 },
    ]);
    await postJournal(ORG_A, VoucherType.SALES, `${CURR_PERIOD}-10`, [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);

    const insights = await svc.getInsights(ORG_A, FY, TODAY);
    const health = insights.find((i) => i.type === InsightType.HEALTH_SCORE)!;
    const score = parseInt(health.headline.match(/(\d+)\/100/)![1], 10);
    expect(score).toBeGreaterThanOrEqual(50);
  });
});
