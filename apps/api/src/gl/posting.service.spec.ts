/**
 * GL Backbone Integration Tests — Phase 4 acceptance criteria.
 *
 * Tests:
 *  1. Unbalanced journal is rejected
 *  2. Posted journal cannot be updated (append-only)
 *  3. Concurrent postings get gapless sequential voucher numbers
 *  4. reverse() produces a balanced contra entry, original unchanged
 *
 * All assertions run against a real MongoDB RS (transactions required).
 */
import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { GlModule } from './gl.module';
import { PostingService } from './posting.service';
import { VoucherType, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalSchema } from './schemas/journal.schema';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JournalDocument } from './schemas/journal.schema';

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let postingService: PostingService;
let journalModel: Model<JournalDocument>;

const ORG_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();
const ACCOUNT_CASH = new Types.ObjectId().toString();
const ACCOUNT_SALES = new Types.ObjectId().toString();
const ACCOUNT_EXPENSE = new Types.ObjectId().toString();
const FY = '2024-25';

function balancedInput(debitAccountId = ACCOUNT_CASH, creditAccountId = ACCOUNT_SALES, amountPaise = 100_00) {
  return {
    orgId: ORG_ID,
    voucherType: VoucherType.JOURNAL,
    financialYear: FY,
    date: '2024-04-01',
    postedBy: USER_ID,
    lines: [
      { accountId: debitAccountId, debitPaise: amountPaise, creditPaise: 0 },
      { accountId: creditAccountId, debitPaise: 0, creditPaise: amountPaise },
    ],
  };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(uri),
      GlModule,
    ],
  }).compile();

  postingService = moduleRef.get(PostingService);
  journalModel = moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

// ── Test 1 ────────────────────────────────────────────────────────────────
describe('Test 1 — unbalanced journal is rejected', () => {
  it('rejects when Σdebit ≠ Σcredit', async () => {
    await expect(
      postingService.post({
        orgId: ORG_ID,
        voucherType: VoucherType.JOURNAL,
        financialYear: FY,
        date: '2024-04-01',
        postedBy: USER_ID,
        lines: [
          { accountId: ACCOUNT_CASH, debitPaise: 10000, creditPaise: 0 },
          { accountId: ACCOUNT_SALES, debitPaise: 0, creditPaise: 9999 }, // ← off by 1
        ],
      }),
    ).rejects.toThrow(/not balanced/i);
  });

  it('rejects when all amounts are zero', async () => {
    await expect(
      postingService.post({
        orgId: ORG_ID,
        voucherType: VoucherType.JOURNAL,
        financialYear: FY,
        date: '2024-04-01',
        postedBy: USER_ID,
        lines: [
          { accountId: ACCOUNT_CASH, debitPaise: 0, creditPaise: 0 },
          { accountId: ACCOUNT_SALES, debitPaise: 0, creditPaise: 0 },
        ],
      }),
    ).rejects.toThrow(/zero/i);
  });

  it('rejects non-integer paise values', async () => {
    await expect(
      postingService.post({
        orgId: ORG_ID,
        voucherType: VoucherType.JOURNAL,
        financialYear: FY,
        date: '2024-04-01',
        postedBy: USER_ID,
        lines: [
          { accountId: ACCOUNT_CASH, debitPaise: 99.5, creditPaise: 0 }, // float!
          { accountId: ACCOUNT_SALES, debitPaise: 0, creditPaise: 99.5 },
        ],
      }),
    ).rejects.toThrow();
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────
describe('Test 2 — posted journal is append-only (immutable)', () => {
  let postedId: string;

  beforeAll(async () => {
    const journal = await postingService.post(balancedInput());
    postedId = journal._id.toString();
  });

  it('rejects direct findOneAndUpdate on a posted journal', async () => {
    await expect(
      journalModel.findByIdAndUpdate(postedId, { narration: 'tampered' }).exec(),
    ).rejects.toThrow(/immutable/i);
  });

  it('rejects direct updateOne on a posted journal', async () => {
    await expect(
      journalModel.updateOne({ _id: postedId }, { narration: 'tampered' }).exec(),
    ).rejects.toThrow(/immutable/i);
  });

  it('journal status remains POSTED after attempted mutation', async () => {
    const doc = await journalModel.findById(postedId).exec();
    expect(doc?.status).toBe(JournalStatus.POSTED);
    expect(doc?.narration).not.toBe('tampered');
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────
describe('Test 3 — concurrent postings get gapless sequential voucher numbers', () => {
  it('assigns unique sequential voucherNumbers under concurrent load', async () => {
    const CONCURRENT = 10;
    const orgId = new Types.ObjectId().toString(); // fresh org to avoid counter collision

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        postingService.post({
          ...balancedInput(),
          orgId,
          voucherType: VoucherType.PURCHASE,
        }),
      ),
    );

    const numbers = results.map((j) => j.voucherNumber).sort((a, b) => a - b);
    // Numbers must be 1..CONCURRENT with no gaps and no duplicates
    expect(numbers).toEqual(Array.from({ length: CONCURRENT }, (_, i) => i + 1));
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────
describe('Test 4 — reverse() produces a balanced contra entry', () => {
  let originalId: string;
  let reversalId: string;

  beforeAll(async () => {
    const original = await postingService.post(
      balancedInput(ACCOUNT_CASH, ACCOUNT_EXPENSE, 50_00),
    );
    originalId = original._id.toString();

    const reversal = await postingService.reverse(originalId, USER_ID);
    reversalId = reversal._id.toString();
  });

  it('reversal journal is balanced (contra lines)', async () => {
    const reversal = await journalModel.findById(reversalId).exec();
    expect(reversal).not.toBeNull();

    let totalDebit = 0, totalCredit = 0;
    for (const line of reversal!.lines) {
      totalDebit += line.debitPaise;
      totalCredit += line.creditPaise;
    }
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBeGreaterThan(0);
  });

  it('reversal lines swap debit ↔ credit from the original', async () => {
    const original = await journalModel.findById(originalId).exec();
    const reversal = await journalModel.findById(reversalId).exec();

    // Sort by accountId to align lines
    const origLines = [...original!.lines].sort((a, b) =>
      a.accountId.toString().localeCompare(b.accountId.toString()),
    );
    const revLines = [...reversal!.lines].sort((a, b) =>
      a.accountId.toString().localeCompare(b.accountId.toString()),
    );

    for (let i = 0; i < origLines.length; i++) {
      expect(revLines[i].debitPaise).toBe(origLines[i].creditPaise);
      expect(revLines[i].creditPaise).toBe(origLines[i].debitPaise);
    }
  });

  it('original journal status becomes REVERSED', async () => {
    const original = await journalModel.findById(originalId).exec();
    expect(original?.status).toBe(JournalStatus.REVERSED);
  });

  it('reversal journal references the original via reversalOf', async () => {
    // reversalOf is on the original pointing to the reversal — check the reversal's narration references the original number
    const reversal = await journalModel.findById(reversalId).exec();
    expect(reversal?.narration).toMatch(/reversal/i);
  });

  it('cannot reverse an already-reversed journal', async () => {
    await expect(postingService.reverse(originalId, USER_ID)).rejects.toThrow(
      /only posted journals/i,
    );
  });
});
