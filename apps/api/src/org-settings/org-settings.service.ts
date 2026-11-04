import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { gstinProblem } from '../extraction/invoice-checks';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '@ai-accounting/shared';
import { OrgSettings, OrgSettingsDocument } from './schemas/org-settings.schema';
import { OrgMembership, OrgMembershipDocument } from '../tenancy/schemas/org-membership.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { AuditLog, AuditLogDocument } from '../gl/schemas/audit-log.schema';

// ── DTOs ────────────────────────────────────────────────────────────────────────

/**
 * The fields an org admin may change. A class, so the global ValidationPipe
 * whitelists it: this used to be an interface, which validates nothing, and
 * the body went straight into `$set` — any schema field, `orgId` included,
 * could be overwritten from the browser.
 */
export class UpdateSettingsDto {
  @IsOptional() @IsString() @Length(1, 200) displayName?: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() pan?: string;
  @IsOptional() @Matches(/^[A-Za-z]{4}\d{5}[A-Za-z]$/, { message: 'A TAN is four letters, five digits and a letter, like MUMK12345A.' }) tan?: string;
  @IsOptional() @IsString() @Length(0, 500) address?: string;
  @IsOptional() @IsString() @Length(0, 100) city?: string;
  @IsOptional() @Matches(/^[1-9]\d{5}$/, { message: 'A pincode is six digits and does not start with 0.' }) pincode?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 200) email?: string;
  @IsOptional() @IsString() @Length(0, 1000) invoiceNotes?: string;
  @IsOptional() @Matches(/^\d{2}$/, { message: 'stateCode must be the two-digit GST state code, e.g. 27' }) stateCode?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(12) financialYearStartMonth?: number;
  @IsOptional() @IsIn(['monthly', 'quarterly']) gstFilingFrequency?: 'monthly' | 'quarterly';
  @IsOptional() @IsString() tallyCompanyName?: string;
  @IsOptional() @IsString() razorpayKeyId?: string;
  @IsOptional() @IsString() awsBucketName?: string;
  @IsOptional() @IsString() brandingLogoUrl?: string;
  @IsOptional() @IsString() brandingAccentColor?: string;
  @IsOptional() @IsString() customDomain?: string;
  @IsOptional() @IsBoolean() clientPortalEnabled?: boolean;
}

/** Exactly the fields above — anything else in a request body is ignored. */
const UPDATABLE_FIELDS = [
  'displayName', 'gstin', 'pan', 'tan', 'address', 'city', 'pincode', 'phone', 'email', 'invoiceNotes', 'stateCode', 'timezone', 'currencyCode',
  'financialYearStartMonth', 'gstFilingFrequency', 'tallyCompanyName', 'razorpayKeyId',
  'awsBucketName', 'brandingLogoUrl', 'brandingAccentColor', 'customDomain', 'clientPortalEnabled',
] as const;

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
  // The format alone passes a mistyped character; the check digit does not.
  const problem = gstinProblem(gstin);
  if (problem) throw new BadRequestException(`GSTIN ${problem}`);
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

    const set: Record<string, unknown> = Object.fromEntries(
      UPDATABLE_FIELDS.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k]]),
    );
    // A GSTIN's first two digits are its state, which decides CGST/SGST versus
    // IGST on every register — so the two cannot disagree.
    if (dto.gstin) {
      const gstinState = dto.gstin.slice(0, 2);
      if (dto.stateCode && dto.stateCode !== gstinState) {
        throw new BadRequestException(
          `GSTIN ${dto.gstin} is registered in state ${gstinState}, but state ${dto.stateCode} was chosen`,
        );
      }
      set.stateCode = gstinState;
    }

    const before = await this.getSettings(orgId);
    const updated = await this.settingsModel
      .findOneAndUpdate({ orgId }, { $set: set }, { new: true, upsert: true })
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
