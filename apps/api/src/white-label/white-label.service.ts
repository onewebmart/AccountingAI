import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, ProposedEntryStatus } from '@ai-accounting/shared';
import { Firm, FirmDocument } from '../tenancy/schemas/firm.schema';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { AuditLog, AuditLogDocument } from '../gl/schemas/audit-log.schema';

// ── DTOs ────────────────────────────────────────────────────────────────────────

export interface UpdateWhiteLabelDto {
  logoUrl?: string | null;
  accentColor?: string | null;
  customDomain?: string | null;
  clientPortalEnabled?: boolean;
  contactEmail?: string | null;
  tagline?: string | null;
}

export interface AddClientDto {
  name: string;
  gstin?: string;
  pan?: string;
  state?: string;
  financialYearStart?: number;
  currency?: string;
  timezone?: string;
}

export interface ClientSummary {
  orgId: string;
  orgName: string;
  /** Proposals awaiting human review. */
  pendingReviewCount: number;
  /** Purchase bills past their due date. */
  overdueApCount: number;
  /** Days until next GSTR-3B filing deadline (monthly filers). */
  gstDueDays: number;
}

// ── Date helper ────────────────────────────────────────────────────────────────

function nextGstDueDate(today: string): string {
  // Monthly filers: GSTR-3B for the previous month is due on 20th of current month
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return `${nextY}-${String(nextM).padStart(2, '0')}-20`;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class WhiteLabelService {
  constructor(
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  // ── White-label configuration ─────────────────────────────────────────────────

  async getWhiteLabelConfig(firmId: string): Promise<FirmDocument | null> {
    return this.firmModel.findById(firmId).exec();
  }

  async updateWhiteLabelConfig(
    firmId: string,
    dto: UpdateWhiteLabelDto,
    actorId: string,
  ): Promise<FirmDocument> {
    const before = await this.firmModel.findById(firmId).lean().exec();

    // Build $set payload only for provided fields
    const $set: Record<string, unknown> = {};
    if (dto.logoUrl !== undefined) $set['whiteLabelConfig.logoUrl'] = dto.logoUrl;
    if (dto.accentColor !== undefined) $set['whiteLabelConfig.accentColor'] = dto.accentColor;
    if (dto.customDomain !== undefined) $set['whiteLabelConfig.customDomain'] = dto.customDomain;
    if (dto.clientPortalEnabled !== undefined) $set['whiteLabelConfig.clientPortalEnabled'] = dto.clientPortalEnabled;

    const updated = await this.firmModel
      .findByIdAndUpdate(firmId, { $set }, { new: true })
      .exec();

    await this.auditLogModel.create({
      orgId: firmId,
      entityType: 'Firm',
      entityId: firmId,
      action: 'white_label_update',
      performedBy: actorId,
      meta: { before: (before as { whiteLabelConfig?: unknown })?.whiteLabelConfig ?? null, after: dto },
    });

    return updated!;
  }

  async resolveByDomain(domain: string): Promise<FirmDocument | null> {
    return this.firmModel.findOne({ 'whiteLabelConfig.customDomain': domain }).exec();
  }

  // ── Client management ─────────────────────────────────────────────────────────

  async getClients(firmId: string): Promise<OrganizationDocument[]> {
    return this.orgModel
      .find({ firmId: new Types.ObjectId(firmId) })
      .sort({ name: 1 })
      .exec();
  }

  async addClient(
    firmId: string,
    dto: AddClientDto,
    actorId: string,
  ): Promise<OrganizationDocument> {
    const org = await this.orgModel.create({
      ...dto,
      firmId: new Types.ObjectId(firmId),
    });

    await this.auditLogModel.create({
      orgId: org._id.toString(),
      entityType: 'Organization',
      entityId: org._id.toString(),
      action: 'client_added',
      performedBy: actorId,
      meta: { firmId, orgName: dto.name },
    });

    return org;
  }

  // ── Client summaries (the "dashboard" pill data) ──────────────────────────────

  async getClientSummaries(firmId: string, today?: string): Promise<ClientSummary[]> {
    const todayStr = today ?? new Date().toISOString().slice(0, 10);
    const orgs = await this.getClients(firmId);
    if (orgs.length === 0) return [];

    const orgIds = orgs.map((o) => (o as unknown as { _id: { toString(): string } })._id.toString());

    // Batch aggregate across all client orgs in two queries (efficient)
    type AggRow = { _id: string; count: number };

    const [proposalCounts, overdueCounts] = await Promise.all([
      this.proposalModel.aggregate<AggRow>([
        { $match: { orgId: { $in: orgIds }, status: ProposedEntryStatus.PROPOSED } },
        { $group: { _id: '$orgId', count: { $sum: 1 } } },
      ]).exec(),
      this.billModel.aggregate<AggRow>([
        {
          $match: {
            orgId: { $in: orgIds },
            status: BillStatus.POSTED,
            dueDate: { $ne: null, $lt: todayStr },
          },
        },
        { $group: { _id: '$orgId', count: { $sum: 1 } } },
      ]).exec(),
    ]);

    const proposalMap = new Map(proposalCounts.map((r) => [r._id, r.count]));
    const overdueMap = new Map(overdueCounts.map((r) => [r._id, r.count]));

    const gstDueDays = Math.ceil(
      (new Date(nextGstDueDate(todayStr)).getTime() - new Date(todayStr).getTime()) / 86_400_000,
    );

    return orgs.map((org) => {
      const oid = (org as unknown as { _id: { toString(): string } })._id.toString();
      return {
        orgId: oid,
        orgName: org.name,
        pendingReviewCount: proposalMap.get(oid) ?? 0,
        overdueApCount: overdueMap.get(oid) ?? 0,
        gstDueDays,
      };
    });
  }
}
