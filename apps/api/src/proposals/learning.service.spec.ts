/**
 * Phase 9 Integration Tests — LearningService (VendorLedgerMap).
 *
 * Done when:
 *  ✓ getMapping returns null when no mapping exists
 *  ✓ upsertMapping writes a new entry to MongoDB
 *  ✓ getMapping returns the stored mapping (DB path, cache miss)
 *  ✓ upsertMapping increments count and strength on repeat call
 *  ✓ getMapping returns updated mapping after second correction
 *  ✓ vendor normalization: "Acme Pvt Ltd" and "  ACME PVT LTD  " resolve to same mapping
 *  ✓ mappings are tenant-scoped: Org A's mapping is invisible to Org B
 */
import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import configuration from '../config/configuration';
import { LearningService } from './learning.service';
import { VendorLedgerMap, VendorLedgerMapSchema, VendorLedgerMapDocument } from './schemas/vendor-ledger-map.schema';
import { REDIS_CLIENT } from '../redis/redis.module';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();
const ACCOUNT_ID = new Types.ObjectId().toString();

const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
};

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let svc: LearningService;
let mapModel: Model<VendorLedgerMapDocument>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
      ]),
    ],
    providers: [
      LearningService,
      { provide: REDIS_CLIENT, useValue: redisMock },
    ],
  }).compile();

  svc = moduleRef.get(LearningService);
  mapModel = moduleRef.get<Model<VendorLedgerMapDocument>>(getModelToken(VendorLedgerMap.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(() => {
  jest.clearAllMocks();
  redisMock.get.mockResolvedValue(null); // default: cache miss
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('getMapping', () => {
  it('returns null when no mapping exists for vendor', async () => {
    const result = await svc.getMapping(ORG_A, 'Unknown Vendor');
    expect(result).toBeNull();
  });

  it('returns mapping from DB when cache misses', async () => {
    await svc.upsertMapping(ORG_A, 'Acme Pvt Ltd', ACCOUNT_ID, 'Office Supplies');
    redisMock.get.mockResolvedValue(null); // force DB path

    const result = await svc.getMapping(ORG_A, 'Acme Pvt Ltd');
    expect(result).not.toBeNull();
    expect(result!.ledgerAccountId).toBe(ACCOUNT_ID);
    expect(result!.accountName).toBe('Office Supplies');
  });

  it('returns mapping from Redis cache when hit (cache-first)', async () => {
    const cached = JSON.stringify({ ledgerAccountId: ACCOUNT_ID, accountName: 'Cached Account' });
    redisMock.get.mockResolvedValue(cached);

    const result = await svc.getMapping(ORG_A, 'Any Vendor');
    expect(result).not.toBeNull();
    expect(result!.accountName).toBe('Cached Account');
    expect(result!.ledgerAccountId).toBe(ACCOUNT_ID);
  });
});

describe('upsertMapping', () => {
  it('creates a new mapping in MongoDB', async () => {
    const vendorName = 'Swiggy India Pvt Ltd';
    const accountId = new Types.ObjectId().toString();
    await svc.upsertMapping(ORG_A, vendorName, accountId, 'Food Expense');

    const doc = await mapModel.findOne({ orgId: ORG_A, vendor: 'swiggy india pvt ltd' }).exec();
    expect(doc).not.toBeNull();
    expect(doc!.ledgerAccountId).toBe(accountId);
    expect(doc!.accountName).toBe('Food Expense');
    expect(doc!.count).toBe(1);
    expect(doc!.strength).toBe(1);
  });

  it('increments count and strength on repeated corrections', async () => {
    const vendorName = 'Zomato Ltd';
    const accountId = new Types.ObjectId().toString();

    await svc.upsertMapping(ORG_A, vendorName, accountId, 'Food Expense');
    await svc.upsertMapping(ORG_A, vendorName, accountId, 'Food Expense');
    await svc.upsertMapping(ORG_A, vendorName, accountId, 'Food Expense');

    const doc = await mapModel.findOne({ orgId: ORG_A, vendor: 'zomato ltd' }).exec();
    expect(doc!.count).toBe(3);
    expect(doc!.strength).toBe(3);
  });

  it('updates to a new account when human re-corrects', async () => {
    const vendorName = 'Flipkart Internet Pvt Ltd';
    const oldId = new Types.ObjectId().toString();
    const newId = new Types.ObjectId().toString();

    await svc.upsertMapping(ORG_A, vendorName, oldId, 'IT Hardware');
    await svc.upsertMapping(ORG_A, vendorName, newId, 'Office Supplies');

    const doc = await mapModel.findOne({ orgId: ORG_A, vendor: 'flipkart internet pvt ltd' }).exec();
    expect(doc!.ledgerAccountId).toBe(newId);
    expect(doc!.accountName).toBe('Office Supplies');
  });

  it('updates Redis cache after upsert', async () => {
    await svc.upsertMapping(ORG_A, 'Cache Test Vendor', ACCOUNT_ID, 'Test Account');
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('vlm:'),
      expect.stringContaining('Test Account'),
      'EX',
      86400,
    );
  });
});

describe('vendor normalization', () => {
  it('treats "Acme Pvt Ltd" and "  ACME PVT LTD  " as the same vendor', async () => {
    const accountId = new Types.ObjectId().toString();
    await svc.upsertMapping(ORG_A, 'Acme Pvt Ltd', accountId, 'Purchase Account');

    redisMock.get.mockResolvedValue(null);
    const result = await svc.getMapping(ORG_A, '  ACME PVT LTD  ');
    expect(result).not.toBeNull();
    expect(result!.ledgerAccountId).toBe(accountId);
  });
});

describe('tenant isolation', () => {
  it('Org B cannot see Org A mapping for same vendor', async () => {
    const accountId = new Types.ObjectId().toString();
    await svc.upsertMapping(ORG_A, 'Shared Vendor', accountId, 'Org A Account');

    redisMock.get.mockResolvedValue(null);
    const result = await svc.getMapping(ORG_B, 'Shared Vendor');
    expect(result).toBeNull();
  });
});
