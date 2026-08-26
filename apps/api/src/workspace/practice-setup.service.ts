import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '@ai-accounting/shared';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { Firm, FirmDocument } from '../tenancy/schemas/firm.schema';
import { OrgMembership, OrgMembershipDocument } from '../tenancy/schemas/org-membership.schema';
import { AuditLog, AuditLogDocument } from '../gl/schemas/audit-log.schema';

export interface PracticeSetupResult {
  firm: { id: string; name: string };
  /**
   * True when the caller must obtain a fresh token before the practice routes
   * will admit them — firmId and role are claims, so the one they hold predates
   * this change.
   */
  reauthRequired: boolean;
}

/**
 * Turns on practice management for an organisation.
 *
 * The CRM is firm-scoped, so an org with no Firm has nothing for those screens
 * to read. Rather than hiding the whole side of the product behind a manual
 * database edit, an org can create its own practice: it becomes a Firm, and the
 * person who set it up becomes its admin.
 */
@Injectable()
export class PracticeSetupService {
  private readonly logger = new Logger(PracticeSetupService.name);

  constructor(
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(OrgMembership.name) private membershipModel: Model<OrgMembershipDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  async enable(orgId: string, userId: string, firmName?: string): Promise<PracticeSetupResult> {
    const org = await this.orgModel.findById(orgId).exec();
    if (!org) throw new NotFoundException('Organisation not found');

    if (org.firmId) {
      const existing = await this.firmModel.findById(org.firmId).exec();
      if (existing) {
        // Already set up. Say so plainly rather than creating a second firm.
        return {
          firm: { id: existing._id.toString(), name: existing.name },
          reauthRequired: false,
        };
      }
    }

    const name = (firmName ?? org.name).trim();
    if (!name) throw new BadRequestException('A practice needs a name.');

    const firm = await this.firmModel.create({
      name,
      slug: await this.uniqueSlug(name),
      whiteLabelConfig: { clientPortalEnabled: false },
      isActive: true,
    });

    org.firmId = firm._id as unknown as typeof org.firmId;
    await org.save();

    // The person switching this on runs the practice — recorded as firmRole, a
    // separate axis. Overwriting `role` here is what used to leave a sole
    // practitioner administering a firm whose books they could no longer touch:
    // FIRM_ADMIN holds no POST_JOURNAL, APPROVE_PROPOSAL or MANAGE_COA.
    const membership = await this.membershipModel
      .findOne({ userId: new Types.ObjectId(userId), orgId: org._id })
      .exec();

    const update: Record<string, unknown> = { firmRole: UserRole.FIRM_ADMIN };

    // Repair anyone caught by the old behaviour. Their org role reads FIRM_ADMIN
    // only because a previous run of this method overwrote it; nobody is granted
    // a membership of that role by any other path.
    if (membership?.role === UserRole.FIRM_ADMIN) {
      update.role = UserRole.COMPANY_ADMIN;
    }

    await this.membershipModel
      .updateOne({ userId: new Types.ObjectId(userId), orgId: org._id }, { $set: update })
      .exec();

    await this.auditLogModel.create({
      orgId,
      entityType: 'Firm',
      entityId: firm._id.toString(),
      action: 'practice_enabled',
      performedBy: userId,
      meta: { firmName: name },
    });

    this.logger.log(`Practice management enabled for org ${orgId} as firm "${name}"`);

    // firmId and role live in the access token, so the caller's current one
    // cannot reach the practice routes yet.
    return { firm: { id: firm._id.toString(), name }, reauthRequired: true };
  }

  /** Firm slugs are unique; a second "Sharma & Associates" gets a suffix. */
  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'practice';

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const clash = await this.firmModel.findOne({ slug: candidate }).exec();
      if (!clash) return candidate;
    }

    return `${base}-${Date.now()}`;
  }
}
