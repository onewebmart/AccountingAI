/**
 * Integration tests — the org's audit trail.
 *
 *  ✓ Newest first, paged by cursor, with each person's name
 *  ✓ Filters by record, person, action and IST date
 *  ✓ System actors and platform impersonation are named as such
 *  ✓ Another org's entries never appear, whatever the filter
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AuditTrailService } from './audit-trail.service';
import { AuditService } from '../gl/audit.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';

let moduleRef: TestingModule;
let trail: AuditTrailService;
let audit: AuditService;
let logs: Model<unknown>;
let users: Model<{ _id: Types.ObjectId; name: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: User.name, schema: UserSchema },
      ]),
    ],
    providers: [AuditTrailService, AuditService],
  }).compile();
  trail = moduleRef.get(AuditTrailService);
  audit = moduleRef.get(AuditService);
  logs = moduleRef.get(getModelToken(AuditLog.name));
  users = moduleRef.get(getModelToken(User.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('audit trail', () => {
  it('lists newest first with names, pages, and filters', async () => {
    const orgId = new Types.ObjectId().toString();
    const other = new Types.ObjectId().toString();
    const [priya] = await users.create([{ email: `priya-${orgId}@example.com`, name: 'Priya Shah' }]);
    const [admin] = await users.create([{ email: `admin-${orgId}@example.com`, name: 'Platform Admin' }]);
    const invoiceId = new Types.ObjectId().toString();

    await audit.record({ orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'CREATE', performedBy: String(priya._id), after: { total: 118000 } });
    await audit.record({ orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'POST', performedBy: String(priya._id), before: { status: 'draft' }, after: { status: 'posted' } });
    await audit.record({ orgId, entityType: 'BankStatement', entityId: 'st-1', action: 'IMPORT', performedBy: 'system:ingest' });
    await audit.record({ orgId, entityType: 'Org', entityId: orgId, action: 'IMPERSONATE', performedBy: String(admin._id), meta: { impersonatedBy: String(admin._id) } });
    await audit.record({ orgId: other, entityType: 'SalesInvoice', entityId: invoiceId, action: 'CREATE', performedBy: String(priya._id) });

    const first = await trail.list(orgId, { limit: 3 });
    expect(first.entries.map((e) => e.action)).toEqual(['IMPERSONATE', 'IMPORT', 'POST']);
    expect(first.entries[0].impersonatedBy).toBe('Platform Admin');
    expect(first.entries[1].actor).toEqual({ id: 'system:ingest', name: 'Statement import', kind: 'system' });
    expect(first.entries[2]).toMatchObject({ actor: { name: 'Priya Shah', kind: 'user' }, before: { status: 'draft' }, after: { status: 'posted' } });

    const second = await trail.list(orgId, { limit: 3, before: first.next! });
    expect(second.entries.map((e) => e.action)).toEqual(['CREATE']);
    expect(second.next).toBeNull();

    // One record's history, in this org only.
    expect((await trail.list(orgId, { entityId: invoiceId })).entries.map((e) => e.action)).toEqual(['POST', 'CREATE']);
    expect((await trail.list(orgId, { actorId: 'system:ingest' })).entries).toHaveLength(1);
    expect((await trail.list(orgId, { action: 'CREATE' })).entries).toHaveLength(1);

    const facets = await trail.facets(orgId);
    expect(facets.entityTypes).toEqual(['BankStatement', 'Org', 'SalesInvoice']);
    expect(facets.actors.map((a) => a.name)).toEqual(['Platform Admin', 'Priya Shah', 'Statement import']);
  });

  it('filters by the IST day, and refuses a bad date', async () => {
    const orgId = new Types.ObjectId().toString();
    // 23:30 IST on 1 Oct is 18:00 UTC on 1 Oct; 00:30 IST on 2 Oct is 19:00 UTC on 1 Oct.
    await logs.create([
      { orgId, entityType: 'Journal', entityId: 'a', action: 'POST', performedBy: 'unknown', createdAt: new Date('2026-10-01T18:00:00Z') },
      { orgId, entityType: 'Journal', entityId: 'b', action: 'POST', performedBy: 'unknown', createdAt: new Date('2026-10-01T19:00:00Z') },
    ]);
    expect((await trail.list(orgId, { from: '2026-10-01', to: '2026-10-01' })).entries.map((e) => e.entityId)).toEqual(['a']);
    expect((await trail.list(orgId, { from: '2026-10-02' })).entries.map((e) => e.entityId)).toEqual(['b']);
    await expect(trail.list(orgId, { from: '1 Oct' })).rejects.toThrow(/from must be a date/);
  });
});
