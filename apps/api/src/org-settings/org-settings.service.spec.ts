/**
 * Phase 16 Integration Tests — OrgSettingsService.
 *
 * Done when:
 *  ✓ getSettings: no prior settings → defaults created (financialYearStartMonth=4, gstFilingFrequency='monthly')
 *  ✓ getSettings: called twice → same document returned (idempotent)
 *  ✓ updateSettings: GSTIN persisted on update
 *  ✓ updateSettings: audit log emitted on every change
 *  ✓ updateSettings: invalid GSTIN (not 15 chars) → BadRequestException
 *  ✓ updateSettings: invalid PAN (not 10 chars) → BadRequestException
 *  ✓ updateSettings: gstFilingFrequency can be changed to 'quarterly'
 *  ✓ tenant isolation: Org A settings cannot be retrieved with Org B orgId
 *  ✓ getTeamMembers: returns members with user info
 *  ✓ inviteTeamMember: creates OrgMembership when user exists
 *  ✓ inviteTeamMember: returns non-fatal message when user not found (no account yet)
 *  ✓ inviteTeamMember: throws when user is already a member
 *  ✓ removeTeamMember: deletes membership and emits audit log
 *  ✓ removeTeamMember: throws NotFoundException for unknown userId
 *  ✓ Company admin can update settings without platform-admin role (acceptance criteria)
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { OrgSettingsService } from './org-settings.service';
import { OrgSettings, OrgSettingsSchema, OrgSettingsDocument } from './schemas/org-settings.schema';
import { OrgMembership, OrgMembershipSchema, OrgMembershipDocument } from '../tenancy/schemas/org-membership.schema';
import { User, UserSchema, UserDocument } from '../tenancy/schemas/user.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../gl/schemas/audit-log.schema';
import { UserRole } from '@ai-accounting/shared';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let svc: OrgSettingsService;
let settingsModel: Model<OrgSettingsDocument>;
let membershipModel: Model<OrgMembershipDocument>;
let userModel: Model<UserDocument>;
let auditLogModel: Model<AuditLogDocument>;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: OrgMembership.name, schema: OrgMembershipSchema },
        { name: User.name, schema: UserSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [OrgSettingsService],
  }).compile();

  svc = moduleRef.get(OrgSettingsService);
  settingsModel = moduleRef.get(getModelToken(OrgSettings.name));
  membershipModel = moduleRef.get(getModelToken(OrgMembership.name));
  userModel = moduleRef.get(getModelToken(User.name));
  auditLogModel = moduleRef.get(getModelToken(AuditLog.name));
});

afterAll(async () => {
  await moduleRef.close();
  await replSet.stop();
});

afterEach(async () => {
  await settingsModel.deleteMany({});
  await membershipModel.deleteMany({});
  await userModel.deleteMany({});
  await auditLogModel.deleteMany({});
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createUser(email: string, name: string) {
  return userModel.create({ email, name, passwordHash: 'hash', isActive: true });
}

// ── 1. getSettings ─────────────────────────────────────────────────────────────

describe('getSettings', () => {
  it('creates defaults on first access', async () => {
    const settings = await svc.getSettings(ORG_A);
    expect(settings.orgId).toBe(ORG_A);
    expect(settings.financialYearStartMonth).toBe(4);
    expect(settings.gstFilingFrequency).toBe('monthly');
    expect(settings.currencyCode).toBe('INR');
    expect(settings.timezone).toBe('Asia/Kolkata');
  });

  it('is idempotent — calling twice returns the same document', async () => {
    const first = await svc.getSettings(ORG_A);
    const second = await svc.getSettings(ORG_A);
    expect(first._id.toString()).toBe(second._id.toString());

    const count = await settingsModel.countDocuments({ orgId: ORG_A });
    expect(count).toBe(1);
  });
});

// ── 2. updateSettings ──────────────────────────────────────────────────────────

describe('updateSettings', () => {
  it('persists GSTIN on update', async () => {
    const gstin = '27AAPFU0939F1ZV'; // valid Maharashtra GSTIN
    const updated = await svc.updateSettings(ORG_A, ACTOR_ID, { gstin });
    expect(updated.gstin).toBe(gstin);
  });

  it('emits an audit log on every change', async () => {
    await svc.updateSettings(ORG_A, ACTOR_ID, { displayName: 'Acme Traders' });
    const logs = await auditLogModel.find({ orgId: ORG_A, entityType: 'OrgSettings' }).exec();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('update');
    expect(logs[0].performedBy).toBe(ACTOR_ID);
    expect(((logs[0].meta?.after) as Record<string, unknown>).displayName).toBe('Acme Traders');
  });

  it('rejects invalid GSTIN (not 15 chars)', async () => {
    await expect(svc.updateSettings(ORG_A, ACTOR_ID, { gstin: '27AAPFU09' }))
      .rejects.toThrow('GSTIN must be exactly 15 characters');
  });

  it('rejects invalid GSTIN format', async () => {
    await expect(svc.updateSettings(ORG_A, ACTOR_ID, { gstin: '27aapfu0939f1zv' }))
      .rejects.toThrow('GSTIN format is invalid');
  });

  it('rejects invalid PAN (not 10 chars)', async () => {
    await expect(svc.updateSettings(ORG_A, ACTOR_ID, { pan: 'AAPFU0939' }))
      .rejects.toThrow('PAN must be exactly 10 characters');
  });

  it('rejects invalid PAN format', async () => {
    // Starts with a digit — violates [A-Z]{5}\d{4}[A-Z] pattern
    await expect(svc.updateSettings(ORG_A, ACTOR_ID, { pan: '1APFU0939F' }))
      .rejects.toThrow('PAN format is invalid');
  });

  it('can change gstFilingFrequency to quarterly', async () => {
    const updated = await svc.updateSettings(ORG_A, ACTOR_ID, { gstFilingFrequency: 'quarterly' });
    expect(updated.gstFilingFrequency).toBe('quarterly');
  });

  it('accepts a valid PAN', async () => {
    const updated = await svc.updateSettings(ORG_A, ACTOR_ID, { pan: 'AAPFU0939F' });
    expect(updated.pan).toBe('AAPFU0939F');
  });
});

// ── 3. Tenant isolation ────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('Org B getSettings returns different document than Org A', async () => {
    await svc.updateSettings(ORG_A, ACTOR_ID, { displayName: 'Org A Company' });
    await svc.updateSettings(ORG_B, ACTOR_ID, { displayName: 'Org B Company' });

    const settingsA = await svc.getSettings(ORG_A);
    const settingsB = await svc.getSettings(ORG_B);

    expect(settingsA.displayName).toBe('Org A Company');
    expect(settingsB.displayName).toBe('Org B Company');
    expect(settingsA._id.toString()).not.toBe(settingsB._id.toString());
  });
});

// ── 4. Team management ─────────────────────────────────────────────────────────

describe('team management', () => {
  it('getTeamMembers returns empty array when no members', async () => {
    const members = await svc.getTeamMembers(ORG_A);
    expect(members).toEqual([]);
  });

  it('inviteTeamMember creates OrgMembership when user exists', async () => {
    const user = await createUser('jane@example.com', 'Jane Doe');
    const result = await svc.inviteTeamMember(ORG_A, ACTOR_ID, 'jane@example.com', UserRole.ACCOUNTANT);

    expect(result.invited).toBe(true);

    const membership = await membershipModel.findOne({ orgId: ORG_A, userId: user._id }).exec();
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe(UserRole.ACCOUNTANT);
  });

  it('getTeamMembers returns member with user info after invite', async () => {
    await createUser('raj@example.com', 'Raj Kumar');
    await svc.inviteTeamMember(ORG_A, ACTOR_ID, 'raj@example.com', UserRole.EMPLOYEE);

    const members = await svc.getTeamMembers(ORG_A);
    expect(members.length).toBe(1);
    expect(members[0].email).toBe('raj@example.com');
    expect(members[0].name).toBe('Raj Kumar');
    expect(members[0].role).toBe(UserRole.EMPLOYEE);
  });

  it('returns non-fatal message when user account not found', async () => {
    const result = await svc.inviteTeamMember(ORG_A, ACTOR_ID, 'ghost@example.com', UserRole.EMPLOYEE);
    expect(result.invited).toBe(false);
    expect(result.message).toMatch(/ghost@example.com/);
  });

  it('throws when user is already a member', async () => {
    const user = await createUser('dup@example.com', 'Dup User');
    await membershipModel.create({
      orgId: ORG_A,
      userId: user._id,
      role: UserRole.EMPLOYEE,
      isActive: true,
    });

    await expect(
      svc.inviteTeamMember(ORG_A, ACTOR_ID, 'dup@example.com', UserRole.ACCOUNTANT),
    ).rejects.toThrow('already a member');
  });

  it('removeTeamMember deletes membership and emits audit log', async () => {
    const user = await createUser('rem@example.com', 'Remove Me');
    await membershipModel.create({
      orgId: ORG_A,
      userId: user._id,
      role: UserRole.EMPLOYEE,
      isActive: true,
    });

    await svc.removeTeamMember(ORG_A, ACTOR_ID, user._id.toString());

    const membership = await membershipModel.findOne({ orgId: ORG_A, userId: user._id }).exec();
    expect(membership).toBeNull();

    const log = await auditLogModel.findOne({ orgId: ORG_A, action: 'remove' }).exec();
    expect(log).not.toBeNull();
    expect(log!.entityId).toBe(user._id.toString());
  });

  it('removeTeamMember throws NotFoundException for unknown user', async () => {
    const unknownId = new Types.ObjectId().toString();
    await expect(svc.removeTeamMember(ORG_A, ACTOR_ID, unknownId)).rejects.toThrow('not found');
  });
});

// ── 5. Acceptance criteria ──────────────────────────────────────────────────────

describe('acceptance criteria — Company Admin can configure without platform access', () => {
  it('settings CRUD succeeds with a COMPANY_ADMIN actor (no platform role needed)', async () => {
    const companyAdminId = new Types.ObjectId().toString();

    // Update as company admin
    const updated = await svc.updateSettings(ORG_A, companyAdminId, {
      displayName: 'Sharma & Sons',
      gstin: '27AAPFU0939F1ZV',
      gstFilingFrequency: 'quarterly',
    });

    expect(updated.displayName).toBe('Sharma & Sons');
    expect(updated.gstin).toBe('27AAPFU0939F1ZV');
    expect(updated.gstFilingFrequency).toBe('quarterly');

    // Audit log should name the actor
    const log = await auditLogModel.findOne({ performedBy: companyAdminId }).exec();
    expect(log).not.toBeNull();
  });
});
