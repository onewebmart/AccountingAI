/**
 * Phase 17 Integration Tests — PlatformAdminService.
 *
 * Done when:
 *  ✓ computeCostPaise: unit — all three OCR tiers and Groq tokens calculated correctly
 *  ✓ getAiCostSummary: aggregates usage_meters across all orgs for a period
 *  ✓ getAiCostSummary: totalCostPaise sums all org costs
 *  ✓ getAiCostSummary: marginAlert set when cost ≥ ₹5,000 (500,000 paise)
 *  ✓ getAiCostSummary: orgs sorted by cost descending (highest spender first)
 *  ✓ getAiCostSummary: returns [] byOrg when no usage data for period
 *  ✓ logImpersonation: creates AuditLog with action=impersonate and impersonatedBy in meta
 *  ✓ logImpersonation: subsequent getAuditLogs returns the impersonation entry
 *  ✓ setSubscription: persists plan update and emits AuditLog
 *  ✓ setSubscription: upserts — second call does not create duplicate
 *  ✓ setFeatureFlag: creates flag with enabled=true and emits AuditLog
 *  ✓ setFeatureFlag: toggling same flag updates enabled in-place (upsert)
 *  ✓ getFeatureFlags: lists all flags for an org
 *  ✓ getAuditLogs: cross-org search returns all entries (platform visibility)
 *  ✓ getAuditLogs: filtered by orgId returns only that org's entries
 *  ✓ PlatformAdminGuard: non-PLATFORM_SUPER_ADMIN role → ForbiddenException
 */
import 'reflect-metadata';
import { Types, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import configuration from '../config/configuration';
import { PlatformAdminService, computeCostPaise } from './platform-admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { Organization, OrganizationSchema, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { UsageMeter, UsageMeterSchema, UsageMeterDocument } from '../ocr/schemas/usage-meter.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../gl/schemas/audit-log.schema';
import { Subscription, SubscriptionSchema, SubscriptionDocument } from './schemas/subscription.schema';
import { FeatureFlag, FeatureFlagSchema, FeatureFlagDocument } from './schemas/feature-flag.schema';
import { UserRole } from '@ai-accounting/shared';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();
const PLATFORM_ADMIN_ID = new Types.ObjectId().toString();
const PERIOD = '2025-03';

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let svc: PlatformAdminService;
let usageMeterModel: Model<UsageMeterDocument>;
let auditLogModel: Model<AuditLogDocument>;
let subscriptionModel: Model<SubscriptionDocument>;
let featureFlagModel: Model<FeatureFlagDocument>;
let orgModel: Model<OrganizationDocument>;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: Organization.name, schema: OrganizationSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Subscription.name, schema: SubscriptionSchema },
        { name: FeatureFlag.name, schema: FeatureFlagSchema },
      ]),
    ],
    providers: [PlatformAdminService, PlatformAdminGuard],
  }).compile();

  svc = moduleRef.get(PlatformAdminService);
  usageMeterModel = moduleRef.get(getModelToken(UsageMeter.name));
  auditLogModel = moduleRef.get(getModelToken(AuditLog.name));
  subscriptionModel = moduleRef.get(getModelToken(Subscription.name));
  featureFlagModel = moduleRef.get(getModelToken(FeatureFlag.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
});

afterAll(async () => {
  await moduleRef.close();
  await replSet.stop();
});

afterEach(async () => {
  await usageMeterModel.deleteMany({});
  await auditLogModel.deleteMany({});
  await subscriptionModel.deleteMany({});
  await featureFlagModel.deleteMany({});
  await orgModel.deleteMany({});
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function seedUsageMeter(orgId: string, overrides: Partial<{
  ocrPagesTier1: number;
  ocrPagesTier2: number;
  ocrPagesTier3: number;
  groqTokensIn: number;
  groqTokensOut: number;
}> = {}) {
  return usageMeterModel.create({
    orgId,
    period: PERIOD,
    ocrPagesTier1: overrides.ocrPagesTier1 ?? 0,
    ocrPagesTier2: overrides.ocrPagesTier2 ?? 0,
    ocrPagesTier3: overrides.ocrPagesTier3 ?? 0,
    groqTokensIn: overrides.groqTokensIn ?? 0,
    groqTokensOut: overrides.groqTokensOut ?? 0,
  });
}

// ── 1. computeCostPaise (pure unit) ───────────────────────────────────────────

describe('computeCostPaise', () => {
  it('computes tier 1 cost at 1 paise per page', () => {
    expect(computeCostPaise({ ocrPagesTier1: 100, ocrPagesTier2: 0, ocrPagesTier3: 0, groqTokensIn: 0, groqTokensOut: 0 }))
      .toBe(100);
  });

  it('computes tier 2 cost at 10 paise per page', () => {
    expect(computeCostPaise({ ocrPagesTier1: 0, ocrPagesTier2: 50, ocrPagesTier3: 0, groqTokensIn: 0, groqTokensOut: 0 }))
      .toBe(500);
  });

  it('computes tier 3 cost at 150 paise per page', () => {
    expect(computeCostPaise({ ocrPagesTier1: 0, ocrPagesTier2: 0, ocrPagesTier3: 10, groqTokensIn: 0, groqTokensOut: 0 }))
      .toBe(1500);
  });

  it('computes Groq token cost', () => {
    // 5,000 tokens in @ 10 paise/1K = 50; 2,000 tokens out @ 30 paise/1K = 60
    expect(computeCostPaise({ ocrPagesTier1: 0, ocrPagesTier2: 0, ocrPagesTier3: 0, groqTokensIn: 5000, groqTokensOut: 2000 }))
      .toBe(50 + 60);
  });

  it('combines all cost components correctly', () => {
    const cost = computeCostPaise({
      ocrPagesTier1: 100, // 100 paise
      ocrPagesTier2: 20,  // 200 paise
      ocrPagesTier3: 5,   // 750 paise
      groqTokensIn: 10000,  // 100 paise
      groqTokensOut: 3000,  // 90 paise
    });
    expect(cost).toBe(100 + 200 + 750 + 100 + 90); // 1240 paise
  });
});

// ── 2. getAiCostSummary ────────────────────────────────────────────────────────

describe('getAiCostSummary', () => {
  it('returns empty byOrg when no usage data for period', async () => {
    const summary = await svc.getAiCostSummary('2099-01');
    expect(summary.byOrg).toEqual([]);
    expect(summary.totalCostPaise).toBe(0);
  });

  it('aggregates usage_meters across all orgs for the period', async () => {
    await seedUsageMeter(ORG_A, { ocrPagesTier1: 100 }); // 100 paise
    await seedUsageMeter(ORG_B, { ocrPagesTier2: 10 });  // 100 paise

    const summary = await svc.getAiCostSummary(PERIOD);
    expect(summary.byOrg.length).toBe(2);
    expect(summary.totalCostPaise).toBe(200);
  });

  it('sets marginAlert when cost >= 500,000 paise (₹5,000)', async () => {
    // 3,334 tier-3 pages @ 150 paise = 500,100 paise > threshold
    await seedUsageMeter(ORG_A, { ocrPagesTier3: 3334 });

    const summary = await svc.getAiCostSummary(PERIOD);
    const row = summary.byOrg[0];
    expect(row.marginAlert).toBe(true);
  });

  it('does not set marginAlert below threshold', async () => {
    await seedUsageMeter(ORG_A, { ocrPagesTier1: 100 }); // 100 paise — well under

    const summary = await svc.getAiCostSummary(PERIOD);
    expect(summary.byOrg[0].marginAlert).toBe(false);
  });

  it('sorts byOrg descending by cost (highest spender first)', async () => {
    await seedUsageMeter(ORG_A, { ocrPagesTier1: 10 });   // 10 paise
    await seedUsageMeter(ORG_B, { ocrPagesTier3: 100 });  // 15,000 paise

    const summary = await svc.getAiCostSummary(PERIOD);
    expect(summary.byOrg[0].orgId).toBe(ORG_B);
    expect(summary.byOrg[1].orgId).toBe(ORG_A);
  });
});

// ── 3. Impersonation logging ────────────────────────────────────────────────────

describe('logImpersonation', () => {
  it('creates an AuditLog with action=impersonate', async () => {
    await svc.logImpersonation(ORG_A, PLATFORM_ADMIN_ID);

    const log = await auditLogModel.findOne({ orgId: ORG_A, action: 'impersonate' }).exec();
    expect(log).not.toBeNull();
    expect(log!.performedBy).toBe(PLATFORM_ADMIN_ID);
    expect((log!.meta as Record<string, unknown>).impersonatedBy).toBe(PLATFORM_ADMIN_ID);
  });

  it('appears in getAuditLogs cross-org search', async () => {
    await svc.logImpersonation(ORG_A, PLATFORM_ADMIN_ID);
    await svc.logImpersonation(ORG_B, PLATFORM_ADMIN_ID);

    // No orgId filter → all logs returned
    const logs = await svc.getAuditLogs(undefined, 10);
    const impersonations = logs.filter((l) => l.action === 'impersonate');
    expect(impersonations.length).toBe(2);
  });

  it('getAuditLogs filtered by orgId returns only that org', async () => {
    await svc.logImpersonation(ORG_A, PLATFORM_ADMIN_ID);
    await svc.logImpersonation(ORG_B, PLATFORM_ADMIN_ID);

    const logs = await svc.getAuditLogs(ORG_A, 10);
    expect(logs.every((l) => l.orgId === ORG_A)).toBe(true);
    expect(logs.length).toBe(1);
  });
});

// ── 4. Subscriptions ───────────────────────────────────────────────────────────

describe('setSubscription', () => {
  it('persists plan and emits AuditLog', async () => {
    const sub = await svc.setSubscription(ORG_A, 'business', PLATFORM_ADMIN_ID);
    expect(sub.plan).toBe('business');

    const log = await auditLogModel.findOne({ orgId: ORG_A, action: 'plan_change' }).exec();
    expect(log).not.toBeNull();
    expect((log!.meta as Record<string, unknown>).after).toBe('business');
  });

  it('upserts — second call updates in-place, no duplicate', async () => {
    await svc.setSubscription(ORG_A, 'starter', PLATFORM_ADMIN_ID);
    await svc.setSubscription(ORG_A, 'enterprise', PLATFORM_ADMIN_ID);

    const count = await subscriptionModel.countDocuments({ orgId: ORG_A });
    expect(count).toBe(1);

    const sub = await svc.getSubscription(ORG_A);
    expect(sub!.plan).toBe('enterprise');
  });
});

// ── 5. Feature flags ───────────────────────────────────────────────────────────

describe('feature flags', () => {
  it('creates flag with enabled=true and emits AuditLog', async () => {
    const flag = await svc.setFeatureFlag(ORG_A, 'vision_ocr_enabled', true, PLATFORM_ADMIN_ID);
    expect(flag.enabled).toBe(true);
    expect(flag.overriddenBy).toBe(PLATFORM_ADMIN_ID);

    const log = await auditLogModel.findOne({ action: 'flag_enabled' }).exec();
    expect(log).not.toBeNull();
  });

  it('toggling same flag updates in-place (upsert)', async () => {
    await svc.setFeatureFlag(ORG_A, 'white_label', true, PLATFORM_ADMIN_ID);
    await svc.setFeatureFlag(ORG_A, 'white_label', false, PLATFORM_ADMIN_ID);

    const count = await featureFlagModel.countDocuments({ orgId: ORG_A, flagName: 'white_label' });
    expect(count).toBe(1);

    const flags = await svc.getFeatureFlags(ORG_A);
    expect(flags[0].enabled).toBe(false);
  });

  it('getFeatureFlags lists all flags for an org', async () => {
    await svc.setFeatureFlag(ORG_A, 'vision_ocr_enabled', true, PLATFORM_ADMIN_ID);
    await svc.setFeatureFlag(ORG_A, 'tally_sync', false, PLATFORM_ADMIN_ID);
    await svc.setFeatureFlag(ORG_B, 'white_label', true, PLATFORM_ADMIN_ID);

    const flagsA = await svc.getFeatureFlags(ORG_A);
    expect(flagsA.length).toBe(2);
    expect(flagsA.every((f) => f.orgId === ORG_A)).toBe(true);
  });
});

// ── 6. PlatformAdminGuard ──────────────────────────────────────────────────────

describe('PlatformAdminGuard', () => {
  let guard: PlatformAdminGuard;

  beforeAll(() => {
    guard = moduleRef.get(PlatformAdminGuard);
  });

  function mockContext(role: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows PLATFORM_SUPER_ADMIN role', () => {
    expect(guard.canActivate(mockContext(UserRole.PLATFORM_SUPER_ADMIN))).toBe(true);
  });

  it('throws ForbiddenException for COMPANY_ADMIN role', () => {
    expect(() => guard.canActivate(mockContext(UserRole.COMPANY_ADMIN)))
      .toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for ACCOUNTANT role', () => {
    expect(() => guard.canActivate(mockContext(UserRole.ACCOUNTANT)))
      .toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is missing', () => {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
