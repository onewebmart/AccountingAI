/**
 * Phase 14 Integration Tests — TallyService + ExportsService.
 *
 * Done when:
 *  ✓ toTallyXml: contains GUID, date, voucherType, narration, ledger entries
 *  ✓ toTallyXml: debit lines → ISDEEMEDPOSITIVE=Yes, negative AMOUNT
 *  ✓ toTallyXml: credit lines → ISDEEMEDPOSITIVE=No, positive AMOUNT
 *  ✓ enqueue: creates sync records for all POSTED journals (returns count)
 *  ✓ enqueue: idempotent — re-enqueueing does NOT create duplicate records
 *  ✓ enqueue: journals already synced are not re-enqueued
 *  ✓ markSynced: sets status=SYNCED, tallyGuid, syncedAt
 *  ✓ markSynced: idempotent — calling twice keeps status=SYNCED, same tallyGuid
 *  ✓ markFailed: sets status=FAILED, increments retries
 *  ✓ getPendingVouchers: returns PENDING+FAILED records with journal data
 *  ✓ getStatus: correct pending/synced/failed counts
 *  ✓ ExportsService.trialBalanceCsv: valid CSV with header row and balanced totals
 *  ✓ ExportsService.profitAndLossCsv: net profit line present
 *  ✓ Tenant isolation: Org B sync records never appear in Org A queries
 */
import 'reflect-metadata';
import { Types, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { TallyService, toTallyXml } from './tally.service';
import { ExportsService } from './exports.service';
import { ReportsService } from '../reports/reports.service';
import { TallySyncRecord, TallySyncRecordSchema, TallySyncRecordDocument } from './schemas/tally-sync-record.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PostingService } from '../gl/posting.service';
import { TallySyncStatus, VoucherType } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();
const FY = '2025-26';

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let tallySvc: TallyService;
let exportsSvc: ExportsService;
let postingSvc: PostingService;
let syncModel: Model<TallySyncRecordDocument>;
let journalModel: Model<JournalDocument>;

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

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: TallySyncRecord.name, schema: TallySyncRecordSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [TallyService, ExportsService, ReportsService, PostingService],
  }).compile();

  tallySvc = moduleRef.get(TallyService);
  exportsSvc = moduleRef.get(ExportsService);
  postingSvc = moduleRef.get(PostingService);
  syncModel = moduleRef.get(getModelToken(TallySyncRecord.name));
  journalModel = moduleRef.get(getModelToken(Journal.name));
});

afterAll(async () => {
  await moduleRef.close();
  await replSet.stop();
});

afterEach(async () => {
  await Promise.all([
    journalModel.deleteMany({}),
    syncModel.deleteMany({}),
  ]);
});

// ── toTallyXml unit tests ────────────────────────────────────────────────────

describe('toTallyXml', () => {
  it('contains GUID, date (YYYYMMDD), voucher type, and narration', async () => {
    const j = await postJournal(VoucherType.PURCHASE, '2025-04-10', 'Purchase from Sigma', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 500000 },
    ]);

    const guid = 'TEST-GUID-001';
    const xml = toTallyXml(j as unknown as JournalDocument, guid);

    expect(xml).toContain('<GUID>TEST-GUID-001</GUID>');
    expect(xml).toContain('<DATE>20250410</DATE>');
    expect(xml).toContain('<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>');
    expect(xml).toContain('Purchase from Sigma');
  });

  it('debit lines → ISDEEMEDPOSITIVE=Yes, negative AMOUNT', async () => {
    const j = await postJournal(VoucherType.PURCHASE, '2025-04-10', 'Test', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 500000 },
    ]);

    const xml = toTallyXml(j as unknown as JournalDocument, 'G-001');

    // Debit of ₹5000 → AMOUNT=-5000.00
    expect(xml).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>');
    expect(xml).toContain('<AMOUNT>-5000.00</AMOUNT>');
  });

  it('credit lines → ISDEEMEDPOSITIVE=No, positive AMOUNT', async () => {
    const j = await postJournal(VoucherType.PURCHASE, '2025-04-10', 'Test', [
      { description: 'Purchase / Expense Account', debitPaise: 500000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 500000 },
    ]);

    const xml = toTallyXml(j as unknown as JournalDocument, 'G-001');

    // Credit of ₹5000 → AMOUNT=5000.00
    expect(xml).toContain('<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>');
    expect(xml).toContain('<AMOUNT>5000.00</AMOUNT>');
  });

  it('SALES voucher maps to VOUCHERTYPENAME=Sales', async () => {
    const j = await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 1180000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 180000 },
    ]);

    const xml = toTallyXml(j as unknown as JournalDocument, 'G-002');
    expect(xml).toContain('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>');
    expect(xml).toContain('VCHTYPE="Sales"');
  });
});

// ── TallyService.enqueue ─────────────────────────────────────────────────────

describe('TallyService.enqueue', () => {
  it('creates sync records for all posted journals and returns count', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale 1', [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase 1', [
      { description: 'Purchase / Expense Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 300000 },
    ]);

    const count = await tallySvc.enqueue(ORG_ID, FY);
    expect(count).toBe(2);

    const records = await syncModel.find({ orgId: ORG_ID }).lean();
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.status === TallySyncStatus.PENDING)).toBe(true);
  });

  it('is idempotent — re-enqueueing does NOT create duplicate records', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);

    await tallySvc.enqueue(ORG_ID, FY);
    const secondCount = await tallySvc.enqueue(ORG_ID, FY);

    expect(secondCount).toBe(0); // nothing new to create
    const records = await syncModel.find({ orgId: ORG_ID }).lean();
    expect(records).toHaveLength(1); // still exactly 1
  });

  it('does not enqueue journals that are already synced', async () => {
    const j = await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 500000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 500000 },
    ]);

    await tallySvc.enqueue(ORG_ID, FY);
    await tallySvc.markSynced(ORG_ID, (j as unknown as { _id: Types.ObjectId })._id.toString(), 'TALLY-GUID-001');

    // Post another journal and enqueue
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 300000 },
    ]);
    const count = await tallySvc.enqueue(ORG_ID, FY);
    expect(count).toBe(1); // only the new purchase journal

    const records = await syncModel.find({ orgId: ORG_ID }).lean();
    expect(records).toHaveLength(2);
  });
});

// ── TallyService.markSynced ──────────────────────────────────────────────────

describe('TallyService.markSynced', () => {
  it('sets status=SYNCED, tallyGuid, syncedAt', async () => {
    const j = await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);
    await tallySvc.enqueue(ORG_ID, FY);
    const jId = (j as unknown as { _id: Types.ObjectId })._id.toString();

    const result = await tallySvc.markSynced(ORG_ID, jId, 'TALLY-GUID-XYZ');

    expect(result.status).toBe(TallySyncStatus.SYNCED);
    expect(result.tallyGuid).toBe('TALLY-GUID-XYZ');
    expect(result.syncedAt).toBeTruthy();
  });

  it('is idempotent — calling twice keeps status=SYNCED, same tallyGuid', async () => {
    const j = await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);
    await tallySvc.enqueue(ORG_ID, FY);
    const jId = (j as unknown as { _id: Types.ObjectId })._id.toString();

    await tallySvc.markSynced(ORG_ID, jId, 'TALLY-GUID-XYZ');
    const second = await tallySvc.markSynced(ORG_ID, jId, 'TALLY-GUID-XYZ');

    expect(second.status).toBe(TallySyncStatus.SYNCED);
    expect(second.tallyGuid).toBe('TALLY-GUID-XYZ');

    // Exactly 1 record in DB — no duplicate created
    const records = await syncModel.find({ orgId: ORG_ID }).lean();
    expect(records).toHaveLength(1);
  });
});

// ── TallyService.markFailed ──────────────────────────────────────────────────

describe('TallyService.markFailed', () => {
  it('sets status=FAILED and increments retries', async () => {
    const j = await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 300000 },
    ]);
    await tallySvc.enqueue(ORG_ID, FY);
    const jId = (j as unknown as { _id: Types.ObjectId })._id.toString();

    const result = await tallySvc.markFailed(ORG_ID, jId, 'Connection refused to Tally');

    expect(result.status).toBe(TallySyncStatus.FAILED);
    expect(result.errorMessage).toBe('Connection refused to Tally');
    expect(result.retries).toBe(1);
  });
});

// ── TallyService.getPendingVouchers ─────────────────────────────────────────

describe('TallyService.getPendingVouchers', () => {
  it('returns PENDING and FAILED records (not SYNCED) with journal data', async () => {
    const j1 = await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);
    const j2 = await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 300000 },
    ]);
    await tallySvc.enqueue(ORG_ID, FY);

    // Mark j1 as synced → should not appear in pending
    await tallySvc.markSynced(ORG_ID, (j1 as unknown as { _id: Types.ObjectId })._id.toString(), 'GUID-001');

    const pending = await tallySvc.getPendingVouchers(ORG_ID);

    expect(pending).toHaveLength(1);
    expect((pending[0].journal as unknown as { _id: Types.ObjectId })._id.toString()).toBe(
      (j2 as unknown as { _id: Types.ObjectId })._id.toString(),
    );
  });
});

// ── TallyService.getStatus ───────────────────────────────────────────────────

describe('TallyService.getStatus', () => {
  it('returns correct pending/synced/failed counts', async () => {
    const j1 = await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);
    const j2 = await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 300000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 300000 },
    ]);
    await tallySvc.enqueue(ORG_ID, FY);

    await tallySvc.markSynced(ORG_ID, (j1 as unknown as { _id: Types.ObjectId })._id.toString(), 'G-001');
    await tallySvc.markFailed(ORG_ID, (j2 as unknown as { _id: Types.ObjectId })._id.toString(), 'Error');

    const status = await tallySvc.getStatus(ORG_ID);
    expect(status.pendingCount).toBe(0);
    expect(status.syncedCount).toBe(1);
    expect(status.failedCount).toBe(1);
    expect(status.lastSyncedAt).toBeTruthy();
  });
});

// ── ExportsService CSV generation ─────────────────────────────────────────────

describe('ExportsService CSV generation', () => {
  it('trialBalanceCsv: produces valid CSV with header and balanced footer', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 1180000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
      { description: 'GST Output Tax', debitPaise: 0, creditPaise: 180000 },
    ]);

    const csv = await exportsSvc.trialBalanceCsv(ORG_ID, FY);

    expect(csv).toContain('Account,Type,Debit');
    expect(csv).toContain('Accounts Receivable');
    expect(csv).toContain('11800.00'); // ₹11,800 in rupees
    expect(csv).toContain('YES'); // isBalanced
  });

  it('profitAndLossCsv: includes net profit line', async () => {
    await postJournal(VoucherType.SALES, '2025-04-15', 'Sale', [
      { description: 'Accounts Receivable', debitPaise: 1000000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 1000000 },
    ]);
    await postJournal(VoucherType.PURCHASE, '2025-04-20', 'Purchase', [
      { description: 'Purchase / Expense Account', debitPaise: 400000, creditPaise: 0 },
      { description: 'Accounts Payable', debitPaise: 0, creditPaise: 400000 },
    ]);

    const csv = await exportsSvc.profitAndLossCsv(ORG_ID, FY);

    expect(csv).toContain('NET PROFIT');
    expect(csv).toContain('6000.00'); // ₹6,000 net profit
    expect(csv).toContain('Total Revenue');
    expect(csv).toContain('Total Expenses');
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('Tenant isolation', () => {
  it('Org B sync records never appear in Org A queries', async () => {
    const ORG_B = new Types.ObjectId().toString();

    const jA = await postJournal(VoucherType.SALES, '2025-04-15', 'Org A sale', [
      { description: 'Accounts Receivable', debitPaise: 100000, creditPaise: 0 },
      { description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 100000 },
    ]);

    // Directly insert an Org B journal (bypassing PostingService tenant context)
    const jB = await postingSvc.post({
      orgId: ORG_B,
      voucherType: VoucherType.SALES,
      financialYear: FY,
      date: '2025-04-15',
      narration: 'Org B sale',
      postedBy: ACTOR_ID,
      lines: [
        { accountId: new Types.ObjectId().toString(), description: 'Accounts Receivable', debitPaise: 999999, creditPaise: 0 },
        { accountId: new Types.ObjectId().toString(), description: 'Sales / Revenue Account', debitPaise: 0, creditPaise: 999999 },
      ],
    });

    await tallySvc.enqueue(ORG_ID, FY);
    await tallySvc.enqueue(ORG_B, FY);

    const orgAStatus = await tallySvc.getStatus(ORG_ID);
    const orgBStatus = await tallySvc.getStatus(ORG_B);

    expect(orgAStatus.pendingCount).toBe(1); // only Org A journal
    expect(orgBStatus.pendingCount).toBe(1); // only Org B journal

    const orgAPending = await tallySvc.getPendingVouchers(ORG_ID);
    expect(orgAPending).toHaveLength(1);
    expect(orgAPending[0].journal.narration).toBe('Org A sale');
  });
});
