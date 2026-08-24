/**
 * Tenant Isolation Integration Test — Phase 1 acceptance criteria.
 *
 * Proves: a query executed in Org A's context CANNOT return Org B
 * documents even when the code "forgets" to filter by orgId.
 *
 * Uses an in-memory MongoDB replica set so transactions work
 * (same requirement as production).
 */
import 'reflect-metadata';
import mongoose, { Schema, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { tenantIsolationPlugin, withOrg } from '../database/tenant.plugin';
import { UserRole } from '@ai-accounting/shared';

// ─── Shared RS instance ───────────────────────────────────────────────────────

beforeAll(async () => {
  const uri = testMongoUri();
  await mongoose.connect(uri);
}, 60_000);

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ─── Helper: build a scoped model with the isolation plugin ───────────────────
function makeTenantModel(name: string): Model<{ orgId: string; value: string }> {
  const schema = new Schema({ orgId: { type: String, required: true, index: true }, value: String });
  schema.plugin(tenantIsolationPlugin);
  // Avoid OverwriteModelError between tests
  return (mongoose.models[name] as Model<{ orgId: string; value: string }>) ??
    mongoose.model<{ orgId: string; value: string }>(name, schema);
}

// ─── Test 1: basic query isolation ───────────────────────────────────────────
describe('Basic query isolation', () => {
  const orgAId = new mongoose.Types.ObjectId().toHexString();
  const orgBId = new mongoose.Types.ObjectId().toHexString();

  beforeAll(async () => {
    const Doc = makeTenantModel('IsolationDoc');
    // Seed both orgs — bypass plugin by directly using the raw collection
    // (simulates an admin/seeder that uses withOrg explicitly)
    await withOrg(orgAId, () => Doc.create({ orgId: orgAId, value: 'Org-A document' }));
    await withOrg(orgBId, () => Doc.create({ orgId: orgBId, value: 'Org-B document' }));
  });

  it('query with no explicit orgId filter returns only own-org documents', async () => {
    const Doc = makeTenantModel('IsolationDoc');

    const results = await withOrg(orgAId, () =>
      // Deliberately no orgId in the filter — plugin must inject it
      Doc.find({}).exec(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].orgId).toBe(orgAId);
    expect(results.some((r) => r.orgId === orgBId)).toBe(false);
  });

  it('org B context cannot reach org A documents', async () => {
    const Doc = makeTenantModel('IsolationDoc');

    const results = await withOrg(orgBId, () => Doc.find({}).exec());

    expect(results).toHaveLength(1);
    expect(results[0].orgId).toBe(orgBId);
    expect(results.some((r) => r.orgId === orgAId)).toBe(false);
  });

  it('findOne respects tenant context', async () => {
    const Doc = makeTenantModel('IsolationDoc');

    // Org A searching for "Org-B document" by value — should find nothing
    const result = await withOrg(orgAId, () =>
      Doc.findOne({ value: 'Org-B document' }).exec(),
    );

    expect(result).toBeNull();
  });

  it('countDocuments respects tenant context', async () => {
    const Doc = makeTenantModel('IsolationDoc');

    const countA = await withOrg(orgAId, () => Doc.countDocuments({}).exec());
    const countB = await withOrg(orgBId, () => Doc.countDocuments({}).exec());

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});

// ─── Test 2: OrgMembership isolation ─────────────────────────────────────────
describe('OrgMembership tenant isolation', () => {
  const orgAId = new mongoose.Types.ObjectId().toHexString();
  const orgBId = new mongoose.Types.ObjectId().toHexString();
  const userIdA = new mongoose.Types.ObjectId();
  const userIdB = new mongoose.Types.ObjectId();

  const membershipSchema = new Schema({
    orgId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  });
  membershipSchema.plugin(tenantIsolationPlugin);

  let Membership: Model<{
    orgId: string;
    userId: mongoose.Types.ObjectId;
    role: string;
    isActive: boolean;
  }>;

  beforeAll(async () => {
    Membership = (mongoose.models['TestMembership'] as typeof Membership) ??
      mongoose.model('TestMembership', membershipSchema);

    await withOrg(orgAId, () =>
      Membership.create({ orgId: orgAId, userId: userIdA, role: UserRole.ACCOUNTANT }),
    );
    await withOrg(orgBId, () =>
      Membership.create({ orgId: orgBId, userId: userIdB, role: UserRole.COMPANY_ADMIN }),
    );
  });

  it('OrgA context only sees OrgA memberships', async () => {
    const members = await withOrg(orgAId, () => Membership.find({}).exec());

    expect(members).toHaveLength(1);
    expect(members[0].orgId).toBe(orgAId);
    expect(members[0].role).toBe(UserRole.ACCOUNTANT);
  });

  it('querying by userId across orgs is blocked by tenant context', async () => {
    // Org A context — querying for a userId that belongs to org B
    const found = await withOrg(orgAId, () =>
      // Even explicitly passing orgB's userId, the plugin restricts to orgA
      Membership.findOne({ userId: userIdB }).exec(),
    );

    expect(found).toBeNull();
  });
});

// ─── Test 3: withOrg() for system jobs ───────────────────────────────────────
describe('withOrg() helper for system jobs', () => {
  const orgAId = new mongoose.Types.ObjectId().toHexString();
  const orgBId = new mongoose.Types.ObjectId().toHexString();

  it('withOrg() can legitimately cross orgs when called explicitly', async () => {
    const Doc = makeTenantModel('SystemJobDoc');

    await withOrg(orgAId, () => Doc.create({ orgId: orgAId, value: 'system-A' }));
    await withOrg(orgBId, () => Doc.create({ orgId: orgBId, value: 'system-B' }));

    // A system job that legitimately needs cross-org access must call withOrg explicitly
    const orgACount = await withOrg(orgAId, () => Doc.countDocuments({}).exec());
    const orgBCount = await withOrg(orgBId, () => Doc.countDocuments({}).exec());

    expect(orgACount).toBe(1);
    expect(orgBCount).toBe(1);
  });

  it('outside of any context, no orgId is injected (system boundary)', async () => {
    const Doc = makeTenantModel('SystemJobDoc');

    // Outside withOrg — plugin has no context so it doesn't inject orgId.
    // This is the system boundary: admin/migration scripts MUST call withOrg explicitly.
    const allDocs = await Doc.find({}).exec();
    expect(allDocs.length).toBeGreaterThanOrEqual(2); // can see everything — must be used carefully
  });
});
