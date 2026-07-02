import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '@ai-accounting/shared';
import { OrgSettings, OrgSettingsDocument } from './schemas/org-settings.schema';
import { OrgMembership, OrgMembershipDocument } from '../tenancy/schemas/org-membership.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { AuditLog, AuditLogDocument } from '../gl/schemas/audit-log.schema';

// ── DTOs ────────────────────────────────────────────────────────────────────────

export interface UpdateSettingsDto {
  displayName?: string;
  gstin?: string;
  pan?: string;
  stateCode?: string;
  timezone?: string;
  currencyCode?: string;
  financialYearStartMonth?: number;
  gstFilingFrequency?: 'monthly' | 'quarterly';
  tallyCompanyName?: string;
  razorpayKeyId?: string;
  awsBucketName?: string;
  brandingLogoUrl?: string;
  brandingAccentColor?: string;
  customDomain?: string;
  clientPortalEnabled?: boolean;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  joinedAt: Date | null;
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateGstin(gstin: string): void {
  if (gstin.length !== 15) {
    throw new BadRequestException('GSTIN must be exactly 15 characters');
  }
  const pattern = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]$/;
  if (!pattern.test(gstin)) {
    throw new BadRequestException('GSTIN format is invalid');
  }
}

function validatePan(pan: string): void {
  if (pan.length !== 10) {
    throw new BadRequestException('PAN must be exactly 10 characters');
  }
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
    throw new BadRequestException('PAN format is invalid');
  }
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class OrgSettingsService {
  constructor(
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(OrgMembership.name) private membershipModel: Model<OrgMembershipDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  // ── Company settings ─────────────────────────────────────────────────────────

  async getSettings(orgId: string): Promise<OrgSettingsDocument> {
    const existing = await this.settingsModel.findOne({ orgId }).exec();
    if (existing) return existing;
    // First access — create defaults
    return this.settingsModel.create({ orgId });
  }

  async updateSettings(
    orgId: string,
    actorId: string,
    dto: UpdateSettingsDto,
  ): Promise<OrgSettingsDocument> {
    if (dto.gstin) validateGstin(dto.gstin);
    if (dto.pan) validatePan(dto.pan);

    const before = await this.getSettings(orgId);
    const updated = await this.settingsModel
      .findOneAndUpdate({ orgId }, { $set: dto }, { new: true, upsert: true })
      .exec();

    await this.auditLogModel.create({
      orgId,
      entityType: 'OrgSettings',
      entityId: orgId,
      action: 'update',
      performedBy: actorId,
      meta: { before: before.toObject(), after: updated!.toObject() },
    });

    return updated!;
  }

  // ── Team management ───────────────────────────────────────────────────────────

  async getTeamMembers(orgId: string): Promise<TeamMember[]> {
    // OrgMembership is tenant-scoped via plugin but we query with explicit orgId here
    // since tests don't run with AsyncLocalStorage context
    const memberships = await this.membershipModel.find({ orgId }).lean().exec();
    if (memberships.length === 0) return [];

    const userIds = memberships.map((m) => m.userId);
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .lean()
      .exec();

    const userMap = new Map(users.map((u) => [(u as unknown as { _id: { toString(): string } })._id.toString(), u]));

    return memberships.map((m) => {
      const user = userMap.get(m.userId.toString());
      return {
        userId: m.userId.toString(),
        email: (user as unknown as { email: string })?.email ?? '',
        name: (user as unknown as { name: string })?.name ?? '',
        role: m.role,
        isActive: m.isActive,
        joinedAt: m.joinedAt ?? null,
      };
    });
  }

  async inviteTeamMember(
    orgId: string,
    actorId: string,
    email: string,
    role: UserRole,
  ): Promise<{ invited: boolean; message: string }> {
    // Find the user by email; in production this would also trigger an invitation email
    const user = await this.userModel.findOne({ email }).lean().exec();
    if (!user) {
      // In production: create a pending invitation. For now return a message.
      return {
        invited: false,
        message: `No account found for ${email}. They must sign up first.`,
      };
    }

    const userId = (user as unknown as { _id: Types.ObjectId })._id;
    const existing = await this.membershipModel.findOne({ orgId, userId }).exec();
    if (existing) {
      throw new BadRequestException('User is already a member of this organisation');
    }

    await this.membershipModel.create({
      orgId,
      userId,
      role,
      isActive: true,
      invitedBy: new Types.ObjectId(actorId),
      joinedAt: new Date(),
    });

    await this.auditLogModel.create({
      orgId,
      entityType: 'OrgMembership',
      entityId: userId.toString(),
      action: 'invite',
      performedBy: actorId,
      meta: { email, role },
    });

    return { invited: true, message: `${email} added to organisation.` };
  }

  async removeTeamMember(
    orgId: string,
    actorId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.membershipModel.findOne({ orgId, userId: new Types.ObjectId(userId) }).exec();
    if (!membership) {
      throw new NotFoundException('Team member not found');
    }

    await this.membershipModel.deleteOne({ orgId, userId: new Types.ObjectId(userId) }).exec();

    await this.auditLogModel.create({
      orgId,
      entityType: 'OrgMembership',
      entityId: userId,
      action: 'remove',
      performedBy: actorId,
      meta: { removedRole: membership.role },
    });
  }
}
