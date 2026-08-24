/**
 * Firm Isolation Integration Test — CRM Phase 0 acceptance criteria.
 *
 * The CRM introduces a second tenancy axis. Accounting models are scoped by
 * orgId (Invariant 5); CRM models — leads, compliance items, document requests,
 * practice invoices, tasks, conversations — are scoped by firmId, because a CA
 * firm's practice spans its whole client book and a lead has no orgId at all.
 *
 * Proves: a query executed in Firm A's context CANNOT return Firm B documents
 * even when the code "forgets" to filter by firmId.
 *
 * Uses an in-memory MongoDB replica set so transactions work
 * (same requirement as production).
 */
import 'reflect-metadata';
import mongoose, { Schema, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import {
  firmIsolationPlugin,
  tenantIsolationPlugin,
  withFirm,
  withOrg,
  tenantContext,
} from '../database/tenant.plugin';

// ─── Shared RS instance ───────────────────────────────────────────────────────

beforeAll(async () => {
  await mongoose.connect(testMongoUri());
}, 60_000);

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
interface FirmDoc {
  firmId: string;
  value: string;
}

function makeFirmModel(name: string): Model<FirmDoc> {
  const schema = new Schema({
    firmId: { type: String, required: true, index: true },
    value: String,
  });
  schema.plugin(firmIsolationPlugin);
  // Avoid OverwriteModelError between tests
  return (
    (mongoose.models[name] as Model<FirmDoc>) ?? mongoose.model<FirmDoc>(name, schema)
  );
}

const firmAId = new mongoose.Types.ObjectId().toHexString();
const firmBId = new mongoose.Types.ObjectId().toHexString();

// ─── Test 1: query isolation ─────────────────────────────────────────────────
describe('Firm query isolation', () => {
  beforeAll(async () => {
    const Lead = makeFirmModel('IsolationLead');
    await withFirm(firmAId, () => Lead.create({ value: 'Firm-A lead' }));
    await withFirm(firmBId, () => Lead.create({ value: 'Firm-B lead' }));
  });

  it('injects firmId on save from context alone', async () => {
    const Lead = makeFirmModel('IsolationLead');
    // Neither create() call above passed firmId — the plugin must have set it.
    // Read outside any withFirm() so nothing is injected into the filter.
    const all = await Lead.find({}).exec();
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.firmId).sort()).toEqual([firmAId, firmBId].sort());
  });

  it('query with no explicit firmId filter returns only own-firm documents', async () => {
    const Lead = makeFirmModel('IsolationLead');

    const results = await withFirm(firmAId, () =>
      // Deliberately no firmId in the filter — plugin must inject it
      Lead.find({}).exec(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].firmId).toBe(firmAId);
    expect(results.some((r) => r.firmId === firmBId)).toBe(false);
  });

  it('firm B context cannot reach firm A documents', async () => {
    const Lead = makeFirmModel('IsolationLead');

    const results = await withFirm(firmBId, () => Lead.find({}).exec());

    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('Firm-B lead');
  });

  it('countDocuments is scoped too', async () => {
    const Lead = makeFirmModel('IsolationLead');

    const countA = await withFirm(firmAId, () => Lead.countDocuments({}).exec());
    expect(countA).toBe(1);
  });

  it('updates cannot cross firms', async () => {
    const Lead = makeFirmModel('IsolationLead');

    // Firm A tries to blank every lead it can see — must not touch Firm B's.
    await withFirm(firmAId, () => Lead.updateMany({}, { value: 'overwritten' }).exec());

    const firmBLead = await withFirm(firmBId, () => Lead.findOne({}).exec());
    expect(firmBLead?.value).toBe('Firm-B lead');
  });

  it('deletes cannot cross firms', async () => {
    const Lead = makeFirmModel('IsolationLead');

    await withFirm(firmAId, () => Lead.deleteMany({}).exec());

    const firmBCount = await withFirm(firmBId, () => Lead.countDocuments({}).exec());
    expect(firmBCount).toBe(1);
  });
});

// ─── Test 2: the two axes are independent ────────────────────────────────────
describe('Org and firm scopes coexist', () => {
  it('withFirm preserves an outer org scope, and vice versa', async () => {
    const orgId = new mongoose.Types.ObjectId().toHexString();

    const seen = await withOrg(orgId, () =>
      withFirm(firmAId, async () => tenantContext.getStore()),
    );

    expect(seen?.orgId).toBe(orgId);
    expect(seen?.firmId).toBe(firmAId);
  });

  it('an org-scoped model is unaffected by firm context', async () => {
    const schema = new Schema({
      orgId: { type: String, required: true, index: true },
      value: String,
    });
    schema.plugin(tenantIsolationPlugin);
    const Journalish =
      (mongoose.models['IsolationOrgDoc'] as Model<{ orgId: string; value: string }>) ??
      mongoose.model<{ orgId: string; value: string }>('IsolationOrgDoc', schema);

    const orgAId = new mongoose.Types.ObjectId().toHexString();
    const orgBId = new mongoose.Types.ObjectId().toHexString();

    await withOrg(orgAId, () => Journalish.create({ value: 'Org-A row' }));
    await withOrg(orgBId, () => Journalish.create({ value: 'Org-B row' }));

    // Sitting inside Firm A's context must not widen or narrow org scoping.
    const results = await withFirm(firmAId, () =>
      withOrg(orgAId, () => Journalish.find({}).exec()),
    );

    expect(results).toHaveLength(1);
    expect(results[0].orgId).toBe(orgAId);
  });
});

// ─── Test 3: no context — system jobs ────────────────────────────────────────
describe('No firm context', () => {
  it('leaves queries unfiltered so batch jobs can run cross-firm', async () => {
    const Task = makeFirmModel('IsolationTask');

    await withFirm(firmAId, () => Task.create({ value: 'A' }));
    await withFirm(firmBId, () => Task.create({ value: 'B' }));

    // Outside any context — an explicit, justified cross-firm system job.
    const all = await Task.find({}).exec();
    expect(all).toHaveLength(2);
  });
});
