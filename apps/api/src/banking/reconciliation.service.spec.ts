/**
 * Phase 11 Integration Tests — ReconciliationService.
 *
 * Done when:
 *  ✓ Bank account can be created and listed
 *  ✓ Statement import stores lines with UNMATCHED status
 *  ✓ autoMatch: bank debit ↔ PAYMENT journal (same amount, ±3 days)
 *  ✓ autoMatch: bank credit ↔ RECEIPT journal (same amount, ±3 days)
 *  ✓ autoMatch does not double-match a journal to multiple bank lines
 *  ✓ confirmMatches: AUTO_MATCHED → CONFIRMED (chips turn green)
 *  ✓ manualMatch: explicitly match a bank line to a journal
 *  ✓ getDiffReport: matched/unmatched counts are correct
 *  ✓ getDiffReport: GL balance reconciles to bank closing balance when fully matched
 *  ✓ getDiffReport: difference = net of unmatched lines when partially matched
 *  ✓ isReconciled = true only when differencePaise === 0 AND unmatchedLines === 0
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { ReconciliationService } from './reconciliation.service';
import { BankAccount, BankAccountSchema, BankAccountDocument } from './schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema, BankStatementLineDocument } from './schemas/bank-statement-line.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PostingService } from '../gl/posting.service';
import { MatchStatus, VoucherType } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let svc: ReconciliationService;
let postingSvc: PostingService;
let lineModel: Model<BankStatementLineDocument>;
let accountModel: Model<BankAccountDocument>;
let journalModel: Model<JournalDocument>;

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: BankAccount.name, schema: BankAccountSchema },
        { name: BankStatement.name, schema: BankStatementSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [ReconciliationService, PostingService],
  }).compile();

  svc = moduleRef.get(ReconciliationService);
  postingSvc = moduleRef.get(PostingService);
  lineModel = moduleRef.get<Model<BankStatementLineDocument>>(getModelToken(BankStatementLine.name));
  accountModel = moduleRef.get<Model<BankAccountDocument>>(getModelToken(BankAccount.name));
  journalModel = moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function seedAccount(openingBalance = 10000000 /* ₹1,00,000 */) {
  return svc.createAccount({
    orgId: ORG_ID,
    name: 'HDFC Current Account',
    accountNumber: 'XXXX1234',
    bankName: 'HDFC Bank',
    openingBalancePaise: openingBalance,
    openingBalanceDate: '2025-04-01',
  });
}

async function postPayment(amountPaise: number, date: string) {
  return postingSvc.post({
    orgId: ORG_ID,
    voucherType: VoucherType.PAYMENT,
    financialYear: '2025-26',
    date,
    narration: `Payment ${amountPaise} on ${date}`,
    postedBy: ACTOR_ID,
    lines: [
      { accountId: new Types.ObjectId().toString(), description: 'Accounts Payable', debitPaise: amountPaise, creditPaise: 0 },
      { accountId: new Types.ObjectId().toString(), description: 'Bank Account', debitPaise: 0, creditPaise: amountPaise },
    ],
  });
}

async function postReceipt(amountPaise: number, date: string) {
  return postingSvc.post({
    orgId: ORG_ID,
    voucherType: VoucherType.RECEIPT,
    financialYear: '2025-26',
    date,
    narration: `Receipt ${amountPaise} on ${date}`,
    postedBy: ACTOR_ID,
    lines: [
      { accountId: new Types.ObjectId().toString(), description: 'Bank Account', debitPaise: amountPaise, creditPaise: 0 },
      { accountId: new Types.ObjectId().toString(), description: 'Accounts Receivable', debitPaise: 0, creditPaise: amountPaise },
    ],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Bank accounts', () => {
  it('creates and lists a bank account', async () => {
    const account = await seedAccount();
    expect(account.name).toBe('HDFC Current Account');
    expect(account.openingBalancePaise).toBe(10000000);

    const accounts = await svc.listAccounts(ORG_ID);
    expect(accounts.some((a) => a._id.toString() === account._id.toString())).toBe(true);
  });
});

describe('Statement import', () => {
  it('imports statement lines with UNMATCHED status', async () => {
    const account = await seedAccount();

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-04-01',
      periodEnd: '2025-04-30',
      openingBalancePaise: 10000000,
      closingBalancePaise: 9500000,
      lines: [
        { date: '2025-04-05', description: 'NEFT OUT — Vendor A', debitPaise: 200000, creditPaise: 0 },
        { date: '2025-04-10', description: 'NEFT IN — Customer B', debitPaise: 0, creditPaise: 100000 },
        { date: '2025-04-15', description: 'NEFT OUT — Vendor C', debitPaise: 400000, creditPaise: 0 },
      ],
    });

    expect(statement.totalLines).toBe(3);
    expect(statement.matchedLines).toBe(0);

    const lines = await lineModel.find({ statementId: statement._id }).exec();
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.matchStatus === MatchStatus.UNMATCHED)).toBe(true);
  });
});

describe('autoMatch', () => {
  it('matches bank debit to PAYMENT journal by amount ± date', async () => {
    const account = await seedAccount();

    // Post a payment journal on Apr 3 for ₹20,000
    await postPayment(2000000, '2025-04-03');

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-04-01',
      periodEnd: '2025-04-30',
      openingBalancePaise: 5000000,
      closingBalancePaise: 3000000,
      lines: [
        // Same amount, same date — should match
        { date: '2025-04-03', description: 'NEFT OUT', debitPaise: 2000000, creditPaise: 0 },
        // No matching journal
        { date: '2025-04-20', description: 'ATM withdrawal', debitPaise: 500000, creditPaise: 0 },
      ],
    });

    const result = await svc.autoMatch(statement._id.toString(), ORG_ID);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);

    const lines = await lineModel.find({ statementId: statement._id }).sort({ date: 1 }).exec();
    expect(lines[0].matchStatus).toBe(MatchStatus.AUTO_MATCHED);
    expect(lines[0].matchedJournalId).not.toBeNull();
    expect(lines[1].matchStatus).toBe(MatchStatus.UNMATCHED);
  });

  it('matches bank credit to RECEIPT journal by amount ± date', async () => {
    const account = await seedAccount();

    await postReceipt(1500000, '2025-05-05');

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-05-01',
      periodEnd: '2025-05-31',
      openingBalancePaise: 5000000,
      closingBalancePaise: 6500000,
      lines: [
        { date: '2025-05-05', description: 'NEFT IN — Customer', debitPaise: 0, creditPaise: 1500000 },
      ],
    });

    const result = await svc.autoMatch(statement._id.toString(), ORG_ID);
    expect(result.matched).toBe(1);

    const line = await lineModel.findOne({ statementId: statement._id }).exec();
    expect(line!.matchStatus).toBe(MatchStatus.AUTO_MATCHED);
  });

  it('matches within ±3-day date window', async () => {
    const account = await seedAccount();

    // Journal on Apr 1, bank line on Apr 3 (2 days apart)
    await postPayment(800000, '2025-06-01');

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-06-01',
      periodEnd: '2025-06-30',
      openingBalancePaise: 3000000,
      closingBalancePaise: 2200000,
      lines: [
        { date: '2025-06-03', description: 'NEFT OUT', debitPaise: 800000, creditPaise: 0 },
      ],
    });

    const result = await svc.autoMatch(statement._id.toString(), ORG_ID);
    expect(result.matched).toBe(1);
  });

  it('does not double-match the same journal to two bank lines', async () => {
    const account = await seedAccount();

    // Only one payment journal for ₹300,000
    await postPayment(300000, '2025-07-10');

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-07-01',
      periodEnd: '2025-07-31',
      openingBalancePaise: 2000000,
      closingBalancePaise: 1400000,
      lines: [
        // Two bank lines with same amount — only one should match
        { date: '2025-07-10', description: 'NEFT OUT 1', debitPaise: 300000, creditPaise: 0 },
        { date: '2025-07-10', description: 'NEFT OUT 2', debitPaise: 300000, creditPaise: 0 },
      ],
    });

    const result = await svc.autoMatch(statement._id.toString(), ORG_ID);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);
  });
});

describe('confirmMatches', () => {
  it('promotes AUTO_MATCHED lines to CONFIRMED', async () => {
    const account = await seedAccount();
    await postPayment(500000, '2025-08-01');
    await postReceipt(250000, '2025-08-05');

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-08-01',
      periodEnd: '2025-08-31',
      openingBalancePaise: 5000000,
      closingBalancePaise: 4750000,
      lines: [
        { date: '2025-08-01', description: 'NEFT OUT', debitPaise: 500000, creditPaise: 0 },
        { date: '2025-08-05', description: 'NEFT IN', debitPaise: 0, creditPaise: 250000 },
      ],
    });

    await svc.autoMatch(statement._id.toString(), ORG_ID);
    const { confirmed } = await svc.confirmMatches(statement._id.toString(), ORG_ID);
    expect(confirmed).toBe(2);

    const lines = await lineModel.find({ statementId: statement._id }).exec();
    expect(lines.every((l) => l.matchStatus === MatchStatus.CONFIRMED)).toBe(true);
  });
});

describe('getDiffReport — reconciliation', () => {
  it('GL balance reconciles to bank closing balance when fully matched', async () => {
    const account = await seedAccount(10000000); // ₹1,00,000 opening

    // Post 2 payments and 1 receipt
    await postPayment(2000000, '2025-09-03'); // ₹20,000 out
    await postReceipt(1500000, '2025-09-07'); // ₹15,000 in
    await postPayment(800000,  '2025-09-12'); // ₹8,000 out

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-09-01',
      periodEnd: '2025-09-30',
      openingBalancePaise:  10000000,
      // closing = 100,000 - 20,000 + 15,000 - 8,000 = 87,000
      closingBalancePaise:   8700000,
      lines: [
        { date: '2025-09-03', description: 'NEFT OUT — Vendor', debitPaise: 2000000, creditPaise: 0 },
        { date: '2025-09-07', description: 'NEFT IN — Customer', debitPaise: 0, creditPaise: 1500000 },
        { date: '2025-09-12', description: 'NEFT OUT — Vendor', debitPaise: 800000, creditPaise: 0 },
      ],
    });

    await svc.autoMatch(statement._id.toString(), ORG_ID);
    await svc.confirmMatches(statement._id.toString(), ORG_ID);

    const report = await svc.getDiffReport(statement._id.toString(), ORG_ID);

    expect(report.matchedLines).toBe(3);
    expect(report.unmatchedLines).toBe(0);
    // GL balance = 100,000 - 20,000 + 15,000 - 8,000 = 87,000
    expect(report.glBalancePaise).toBe(8700000);
    expect(report.differencePaise).toBe(0);
    expect(report.isReconciled).toBe(true);
  });

  it('difference equals net of unmatched lines when partially matched', async () => {
    const account = await seedAccount(5000000); // ₹50,000 opening

    await postPayment(1000000, '2025-10-05'); // ₹10,000 — will be matched

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-10-01',
      periodEnd: '2025-10-31',
      openingBalancePaise: 5000000,
      // closing = 50,000 - 10,000 + 30,000 - 5,000 = 65,000
      closingBalancePaise: 6500000,
      lines: [
        { date: '2025-10-05', description: 'NEFT OUT', debitPaise: 1000000, creditPaise: 0 }, // matched
        { date: '2025-10-15', description: 'NEFT IN — unknown', debitPaise: 0, creditPaise: 3000000 }, // unmatched
        { date: '2025-10-22', description: 'ATM withdrawal', debitPaise: 500000, creditPaise: 0 },     // unmatched
      ],
    });

    await svc.autoMatch(statement._id.toString(), ORG_ID);

    const report = await svc.getDiffReport(statement._id.toString(), ORG_ID);

    expect(report.matchedLines).toBe(1);
    expect(report.unmatchedLines).toBe(2);
    // GL = 50,000 - 10,000 (matched payment) = 40,000
    expect(report.glBalancePaise).toBe(4000000);
    // Bank closing = 65,000; difference = 65,000 - 40,000 = 25,000
    expect(report.differencePaise).toBe(2500000);
    expect(report.isReconciled).toBe(false);
    // Net of unmatched: +30,000 - 5,000 = +25,000
    expect(report.unmatchedAmountPaise).toBe(2500000);
  });

  it('unmatched lines are clearly surfaced in the report', async () => {
    const account = await seedAccount(2000000);

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-11-01',
      periodEnd: '2025-11-30',
      openingBalancePaise: 2000000,
      closingBalancePaise: 1000000,
      lines: [
        { date: '2025-11-10', description: 'Unknown debit', debitPaise: 1000000, creditPaise: 0, reference: 'UTR123456' },
      ],
    });

    await svc.autoMatch(statement._id.toString(), ORG_ID);
    const report = await svc.getDiffReport(statement._id.toString(), ORG_ID);

    expect(report.unmatchedLines).toBe(1);
    expect(report.lines[0].matchStatus).toBe(MatchStatus.UNMATCHED);
    expect(report.lines[0].reference).toBe('UTR123456');
  });
});

describe('manualMatch', () => {
  it('manually matches a bank line to a specific journal', async () => {
    const account = await seedAccount();

    // Post a payment — won't auto-match due to date mismatch (>3 days)
    const journal = await postPayment(999000, '2025-12-01');

    const statement = await svc.importStatement({
      orgId: ORG_ID,
      bankAccountId: account._id.toString(),
      periodStart: '2025-12-01',
      periodEnd: '2025-12-31',
      openingBalancePaise: 3000000,
      closingBalancePaise: 2001000,
      lines: [
        // 5 days after the journal — outside auto-match window
        { date: '2025-12-06', description: 'NEFT OUT (delayed)', debitPaise: 999000, creditPaise: 0 },
      ],
    });

    // Auto-match won't work (outside date window)
    const autoResult = await svc.autoMatch(statement._id.toString(), ORG_ID);
    expect(autoResult.matched).toBe(0);

    // Manual match
    const lines = await lineModel.find({ statementId: statement._id }).exec();
    const updated = await svc.manualMatch(lines[0]._id.toString(), journal._id.toString(), ORG_ID);
    expect(updated.matchStatus).toBe(MatchStatus.MANUALLY_MATCHED);
    expect(updated.matchedJournalId!.toString()).toBe(journal._id.toString());
  });
});
