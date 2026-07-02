import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '@ai-accounting/shared';
import { Platform, PlatformDocument } from './schemas/platform.schema';
import { Firm, FirmDocument } from './schemas/firm.schema';
import { Organization, OrganizationDocument } from './schemas/organization.schema';
import { User, UserDocument } from './schemas/user.schema';
import { OrgMembership, OrgMembershipDocument } from './schemas/org-membership.schema';

@Injectable()
export class TenancyService {
  constructor(
    @InjectModel(Platform.name) private platformModel: Model<PlatformDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(OrgMembership.name) private membershipModel: Model<OrgMembershipDocument>,
  ) {}

  // ─── Organization ────────────────────────────────────────────────

  async createOrganization(dto: {
    name: string;
    firmId?: string;
    gstin?: string;
    pan?: string;
    state?: string;
    financialYearStart?: number;
    currency?: string;
    timezone?: string;
  }): Promise<OrganizationDocument> {
    return this.orgModel.create({
      ...dto,
      firmId: dto.firmId ? new Types.ObjectId(dto.firmId) : undefined,
    });
  }

  async findOrgById(orgId: string): Promise<OrganizationDocument | null> {
    return this.orgModel.findById(orgId).exec();
  }

  async findOrgsByFirm(firmId: string): Promise<OrganizationDocument[]> {
    return this.orgModel.find({ firmId: new Types.ObjectId(firmId) }).exec();
  }

  // ─── Firm ─────────────────────────────────────────────────────────

  async createFirm(dto: {
    name: string;
    slug: string;
    platformId?: string;
    gstin?: string;
    pan?: string;
  }): Promise<FirmDocument> {
    const existing = await this.firmModel.findOne({ slug: dto.slug }).exec();
    if (existing) throw new ConflictException(`Firm slug "${dto.slug}" is already taken.`);

    return this.firmModel.create({
      ...dto,
      platformId: dto.platformId ? new Types.ObjectId(dto.platformId) : undefined,
    });
  }

  async findFirmBySlug(slug: string): Promise<FirmDocument | null> {
    return this.firmModel.findOne({ slug }).exec();
  }

  // ─── User ─────────────────────────────────────────────────────────

  async findUserById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).exec();
  }

  async findUserByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findUserByEmailWithSecrets(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash +totpSecret +refreshTokenHash')
      .exec();
  }

  // ─── OrgMembership ────────────────────────────────────────────────

  async createMembership(dto: {
    orgId: string;
    userId: string;
    role: UserRole;
    firmId?: string;
    invitedBy?: string;
  }): Promise<OrgMembershipDocument> {
    const existing = await this.membershipModel
      .findOne({ orgId: dto.orgId, userId: new Types.ObjectId(dto.userId) })
      .exec();
    if (existing) {
      throw new ConflictException('User is already a member of this organization.');
    }

    return this.membershipModel.create({
      orgId: dto.orgId,
      userId: new Types.ObjectId(dto.userId),
      role: dto.role,
      firmId: dto.firmId,
      invitedBy: dto.invitedBy ? new Types.ObjectId(dto.invitedBy) : undefined,
      joinedAt: new Date(),
    });
  }

  async getMembership(userId: string, orgId: string): Promise<OrgMembershipDocument | null> {
    return this.membershipModel.findOne({ orgId, userId: new Types.ObjectId(userId) }).exec();
  }

  async getMemberRole(userId: string, orgId: string): Promise<UserRole | null> {
    const membership = await this.getMembership(userId, orgId);
    return membership?.role ?? null;
  }

  async getOrgMembers(orgId: string): Promise<OrgMembershipDocument[]> {
    return this.membershipModel
      .find({ orgId, isActive: true })
      .populate('userId', 'name email avatarUrl')
      .exec();
  }

  /** Find all active org memberships for a user (cross-org, bypasses tenant plugin). */
  async findUserMemberships(userId: string): Promise<OrgMembershipDocument[]> {
    return this.membershipModel
      .find({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
  }

  async validateOrgAccess(userId: string, orgId: string): Promise<OrgMembershipDocument> {
    const membership = await this.getMembership(userId, orgId);
    if (!membership?.isActive) {
      throw new NotFoundException('You do not have access to this organization.');
    }
    return membership;
  }
}
