import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { UsageMeter, UsageMeterDocument } from '../ocr/schemas/usage-meter.schema';
import { AuditLog, AuditLogDocument } from '../gl/schemas/audit-log.schema';
import { Subscription, SubscriptionDocument, SubscriptionPlan } from './schemas/subscription.schema';
import { FeatureFlag, FeatureFlagDocument } from './schemas/feature-flag.schema';

// ── AI cost formula ────────────────────────────────────────────────────────────
//
// Rates are in paise. These are the platform's internal cost estimates used for
// margin tracking — they are NOT the prices charged to customers.

const COST_PAISE = {
  tier1PerPage: 1,    // ₹0.01 — native PDF (pdf-parse, cheapest)
  tier2PerPage: 10,   // ₹0.10 — machine-print scan (Tesseract/cloud OCR)
  tier3PerPage: 150,  // ₹1.50 — vision LLM / handwritten (most expensive)
  groqInPer1K: 10,    // ₹0.10 per 1,000 input tokens
  groqOutPer1K: 30,   // ₹0.30 per 1,000 output tokens
} as const;

export function computeCostPaise(meter: {
  ocrPagesTier1: number;
  ocrPagesTier2: number;
  ocrPagesTier3: number;
  groqTokensIn: number;
  groqTokensOut: number;
}): number {
  return (
    meter.ocrPagesTier1 * COST_PAISE.tier1PerPage +
    meter.ocrPagesTier2 * COST_PAISE.tier2PerPage +
    meter.ocrPagesTier3 * COST_PAISE.tier3PerPage +
    Math.floor(meter.groqTokensIn / 1000) * COST_PAISE.groqInPer1K +
    Math.floor(meter.groqTokensOut / 1000) * COST_PAISE.groqOutPer1K
  );
}

// ── DTOs ────────────────────────────────────────────────────────────────────────

export interface OrgCostRow {
  orgId: string;
  orgName: string;
  period: string;
  ocrPagesTier1: number;
  ocrPagesTier2: number;
  ocrPagesTier3: number;
  groqTokensIn: number;
  groqTokensOut: number;
  totalCostPaise: number;
  /** Flag if cost exceeds ₹5,000 (500,000 paise) in the period. */
  marginAlert: boolean;
}

export interface AiCostSummary {
  period: string;
  totalCostPaise: number;
  byOrg: OrgCostRow[];
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(UsageMeter.name) private usageMeterModel: Model<UsageMeterDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(FeatureFlag.name) private featureFlagModel: Model<FeatureFlagDocument>,
  ) {}

  // ── Org list ────────────────────────────────────────────────────────────────

  async getOrgs(): Promise<OrganizationDocument[]> {
    return this.orgModel.find({}).sort({ createdAt: -1 }).lean().exec() as unknown as OrganizationDocument[];
  }

  async getOrgDetail(orgId: string): Promise<{
    org: OrganizationDocument | null;
    subscription: SubscriptionDocument | null;
    flags: FeatureFlagDocument[];
  }> {
    const [org, subscription, flags] = await Promise.all([
      this.orgModel.findById(orgId).lean().exec() as unknown as OrganizationDocument | null,
      this.subscriptionModel.findOne({ orgId }).lean().exec() as unknown as SubscriptionDocument | null,
      this.featureFlagModel.find({ orgId }).lean().exec() as unknown as FeatureFlagDocument[],
    ]);
    return { org, subscription, flags };
  }

  // ── AI cost dashboard ────────────────────────────────────────────────────────

  async getAiCostSummary(period: string): Promise<AiCostSummary> {
    const meters = await this.usageMeterModel.find({ period }).lean().exec() as unknown as UsageMeterDocument[];

    // Get org names for display
    const orgIds = meters.map((m) => m.orgId);
    const orgs = await this.orgModel.find({ _id: { $in: orgIds } }).lean().exec();
    const orgNameMap = new Map(
      orgs.map((o) => [(o as unknown as { _id: { toString(): string } })._id.toString(), (o as { name: string }).name]),
    );

    const byOrg: OrgCostRow[] = meters.map((m) => {
      const totalCostPaise = computeCostPaise(m);
      return {
        orgId: m.orgId,
        orgName: orgNameMap.get(m.orgId) ?? m.orgId,
        period: m.period,
        ocrPagesTier1: m.ocrPagesTier1,
        ocrPagesTier2: m.ocrPagesTier2,
        ocrPagesTier3: m.ocrPagesTier3,
        groqTokensIn: m.groqTokensIn,
        groqTokensOut: m.groqTokensOut,
        totalCostPaise,
        marginAlert: totalCostPaise >= 500_000, // ₹5,000
      };
    }).sort((a, b) => b.totalCostPaise - a.totalCostPaise);

    const totalCostPaise = byOrg.reduce((s, r) => s + r.totalCostPaise, 0);

    return { period, totalCostPaise, byOrg };
  }

  async getUsageByOrg(orgId: string, period: string): Promise<UsageMeterDocument | null> {
    return this.usageMeterModel.findOne({ orgId, period }).lean().exec() as unknown as UsageMeterDocument | null;
  }

  // ── Subscriptions ────────────────────────────────────────────────────────────

  async setSubscription(
    orgId: string,
    plan: SubscriptionPlan,
    actorId: string,
  ): Promise<SubscriptionDocument> {
    const before = await this.subscriptionModel.findOne({ orgId }).lean().exec();

    const updated = await this.subscriptionModel
      .findOneAndUpdate(
        { orgId },
        { $set: { plan, status: 'active', changedBy: actorId } },
        { new: true, upsert: true },
      )
      .exec();

    await this.auditLogModel.create({
      orgId,
      entityType: 'Subscription',
      entityId: orgId,
      action: 'plan_change',
      performedBy: actorId,
      meta: { before: before ? (before as { plan: string }).plan : null, after: plan },
    });

    return updated!;
  }

  async getSubscription(orgId: string): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel.findOne({ orgId }).exec();
  }

  // ── Feature flags ────────────────────────────────────────────────────────────

  async getFeatureFlags(orgId: string): Promise<FeatureFlagDocument[]> {
    return this.featureFlagModel.find({ orgId }).lean().exec() as unknown as FeatureFlagDocument[];
  }

  async setFeatureFlag(
    orgId: string,
    flagName: string,
    enabled: boolean,
    actorId: string,
  ): Promise<FeatureFlagDocument> {
    const flag = await this.featureFlagModel
      .findOneAndUpdate(
        { orgId, flagName },
        { $set: { enabled, overriddenBy: actorId } },
        { new: true, upsert: true },
      )
      .exec();

    await this.auditLogModel.create({
      orgId,
      entityType: 'FeatureFlag',
      entityId: `${orgId}:${flagName}`,
      action: enabled ? 'flag_enabled' : 'flag_disabled',
      performedBy: actorId,
      meta: { flagName, enabled },
    });

    return flag!;
  }

  // ── Impersonation ────────────────────────────────────────────────────────────

  /**
   * Called when a platform admin clicks "View as this org."
   * Creates an audit log entry so every impersonation session is traceable.
   * Per Invariant 6: platform impersonation actions are flagged with impersonatedBy.
   */
  async logImpersonation(targetOrgId: string, actorId: string): Promise<void> {
    await this.auditLogModel.create({
      orgId: targetOrgId,
      entityType: 'Organization',
      entityId: targetOrgId,
      action: 'impersonate',
      performedBy: actorId,
      meta: { impersonatedBy: actorId, note: 'Platform admin impersonation session started' },
    });
  }

  // ── Audit log search (cross-org, platform-admin only) ────────────────────────

  async getAuditLogs(
    orgId?: string,
    limit = 100,
  ): Promise<AuditLogDocument[]> {
    const filter: Record<string, unknown> = {};
    if (orgId) filter.orgId = orgId;
    return this.auditLogModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec() as unknown as AuditLogDocument[];
  }
}
