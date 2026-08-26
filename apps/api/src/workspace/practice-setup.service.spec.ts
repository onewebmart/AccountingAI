/**
 * Practice setup must not cost the owner their books.
 *
 * `role` and `firmRole` sit on different tenancy axes: `role` says what you may
 * do to one org's books, `firmRole` says whether you run the practice those
 * books belong to. They used to be one field, so switching on practice
 * management overwrote the org role with FIRM_ADMIN — which holds no
 * POST_JOURNAL, APPROVE_PROPOSAL or MANAGE_COA. A sole practitioner ended up
 * administering a firm whose ledger they could no longer touch, with nothing in
 * the UI explaining why.
 *
 * These tests pin that behaviour down so it cannot regress quietly.
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { UserRole, Permission } from '@ai-accounting/shared';
import { ROLE_PERMISSIONS } from '@ai-accounting/shared';
import { testMongoUri } from '../test-utils/mongo';
import { PracticeSetupService } from './practice-setup.service';
import { Organization, OrganizationSchema } from '../tenancy/schemas/organization.schema';
import { Firm, FirmSchema } from '../tenancy/schemas/firm.schema';
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';

describe('PracticeSetupService — the org role survives', () => {
  let moduleRef: TestingModule;
  let service: PracticeSetupService;
  let orgModel: Model<Organization>;
  let membershipModel: Model<OrgMembership>;
  // The Nest DI connection, not mongoose.connection — the global default is a
  // different, unconnected object here, and awaiting it just buffers until the
  // 10s timeout.
  let connection: Connection;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(testMongoUri()),
        MongooseModule.forFeature([
          { name: Organization.name, schema: OrganizationSchema },
          { name: Firm.name, schema: FirmSchema },
          { name: OrgMembership.name, schema: OrgMembershipSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [PracticeSetupService],
    }).compile();

    service = moduleRef.get(PracticeSetupService);
    orgModel = moduleRef.get(getModelToken(Organization.name));
    membershipModel = moduleRef.get(getModelToken(OrgMembership.name));
    connection = moduleRef.get(getConnectionToken());
  }, 60_000);

  afterAll(async () => {
    await connection.dropDatabase();
    await moduleRef.close();
  });

  /** A fresh org plus its owner, as signup would leave them. */
  async function seedOrg(name: string, role = UserRole.COMPANY_ADMIN) {
    const org = await orgModel.create({ name });
    const userId = new Types.ObjectId();
    await membershipModel.create({
      userId,
      orgId: org._id.toString(),
      role,
      isActive: true,
    });
    return { orgId: org._id.toString(), userId: userId.toString() };
  }

  const membershipFor = (orgId: string, userId: string) =>
    membershipModel.findOne({ orgId, userId: new Types.ObjectId(userId) }).exec();

  it('records practice administration without touching the org role', async () => {
    const { orgId, userId } = await seedOrg('Kaveri Traders');

    await service.enable(orgId, userId, 'Kaveri & Co');

    const membership = await membershipFor(orgId, userId);
    expect(membership?.role).toBe(UserRole.COMPANY_ADMIN);
    expect(membership?.firmRole).toBe(UserRole.FIRM_ADMIN);
  });

  it('leaves the owner able to run the books they just kept', async () => {
    const { orgId, userId } = await seedOrg('Sharma Textiles');

    await service.enable(orgId, userId, 'Sharma & Co');

    const membership = await membershipFor(orgId, userId);
    const permissions = ROLE_PERMISSIONS[membership!.role];

    // The exact permissions whose loss was the original bug.
    expect(permissions).toContain(Permission.POST_JOURNAL);
    expect(permissions).toContain(Permission.APPROVE_PROPOSAL);
    expect(permissions).toContain(Permission.MANAGE_COA);
    expect(permissions).toContain(Permission.UPLOAD_DOCUMENT);
  });

  it('repairs a membership left as FIRM_ADMIN by the old behaviour', async () => {
    // Exactly the shape the previous implementation wrote.
    const { orgId, userId } = await seedOrg('Legacy Practice', UserRole.FIRM_ADMIN);

    await service.enable(orgId, userId, 'Legacy & Co');

    const membership = await membershipFor(orgId, userId);
    expect(membership?.role).toBe(UserRole.COMPANY_ADMIN);
    expect(membership?.firmRole).toBe(UserRole.FIRM_ADMIN);
  });

  it('does not downgrade a role that was never FIRM_ADMIN', async () => {
    const { orgId, userId } = await seedOrg('Accountant Led', UserRole.ACCOUNTANT);

    await service.enable(orgId, userId, 'Accountant & Co');

    const membership = await membershipFor(orgId, userId);
    expect(membership?.role).toBe(UserRole.ACCOUNTANT);
    expect(membership?.firmRole).toBe(UserRole.FIRM_ADMIN);
  });

  it('is idempotent — a second call returns the same firm and creates no other', async () => {
    const { orgId, userId } = await seedOrg('Twice Enabled');

    const first = await service.enable(orgId, userId, 'Twice & Co');
    const second = await service.enable(orgId, userId, 'Twice & Co');

    expect(second.firm.id).toBe(first.firm.id);
    expect(second.reauthRequired).toBe(false);
  });

  it('asks the caller to re-authenticate, since firmRole is a token claim', async () => {
    const { orgId, userId } = await seedOrg('Needs Reauth');

    const result = await service.enable(orgId, userId, 'Reauth & Co');

    expect(result.reauthRequired).toBe(true);
  });
});
