import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../gl/schemas/audit-log.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  /** YYYY-MM-DD, inclusive, in IST. */
  from?: string;
  to?: string;
  /** The last entry id of the previous page. */
  before?: string;
  limit?: number;
}

export interface AuditRow {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: { id: string; name: string; kind: 'user' | 'system' };
  /** Set when a platform admin acted while signed in as this org. */
  impersonatedBy: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE = 200;

/** What a system actor id means to a person reading the trail. */
const SYSTEM_ACTORS: Record<string, string> = {
  'system:ingest': 'Statement import',
  'system:bank-feeds': 'Bank feed',
  'system:automation': 'Scheduled job',
  unknown: 'Unknown',
};

/**
 * The org's audit trail, read-only (Invariant 6): who changed what, when,
 * and what it was before. The audit collection is not tenant-isolated (the
 * platform admin reads across orgs), so every query here names the org from
 * the caller's JWT itself.
 */
@Injectable()
export class AuditTrailService {
  constructor(
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLogDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async list(orgId: string, q: AuditQuery): Promise<{ entries: AuditRow[]; next: string | null }> {
    const limit = q.limit === undefined ? 50 : q.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new BadRequestException(`limit must be 1 to ${MAX_PAGE}`);
    for (const [name, value] of [['from', q.from], ['to', q.to]] as const) {
      if (value !== undefined && !DATE.test(value)) throw new BadRequestException(`${name} must be a date like 2026-10-01`);
    }

    const filter: FilterQuery<AuditLogDocument> = { orgId };
    if (q.entityType) filter.entityType = q.entityType;
    if (q.entityId) filter.entityId = q.entityId;
    if (q.actorId) filter.performedBy = q.actorId;
    if (q.action) filter.action = q.action;
    const createdAt: Record<string, Date> = {};
    // Dates are the IST calendar day the change was made.
    if (q.from) createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) createdAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000);
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    if (q.before) {
      if (!Types.ObjectId.isValid(q.before)) throw new BadRequestException('before must be an entry id');
      filter._id = { $lt: new Types.ObjectId(q.before) };
    }

    const docs = await this.auditModel.find(filter).sort({ _id: -1 }).limit(limit + 1).lean().exec();
    const page = docs.slice(0, limit);
    const names = await this.userNames(page.map((d) => d.performedBy));

    return {
      entries: page.map((d) => {
        const meta = (d.meta as Record<string, unknown> | undefined) ?? null;
        const impersonator = typeof meta?.impersonatedBy === 'string' ? meta.impersonatedBy : null;
        return {
          id: d._id.toString(),
          at: ((d as unknown as { createdAt?: Date }).createdAt ?? d._id.getTimestamp()).toISOString(),
          entityType: d.entityType,
          entityId: d.entityId,
          action: d.action,
          actor: this.actor(d.performedBy, names),
          impersonatedBy: impersonator ? names.get(impersonator) ?? 'Platform admin' : null,
          before: (d.before as Record<string, unknown> | null) ?? null,
          after: (d.after as Record<string, unknown> | null) ?? null,
          meta,
        };
      }),
      next: docs.length > limit ? page[page.length - 1]._id.toString() : null,
    };
  }

  /** The record types, actions and people that appear in this org's trail, for filters. */
  async facets(orgId: string) {
    const [entityTypes, actions, actorIds] = await Promise.all([
      this.auditModel.distinct('entityType', { orgId }).exec(),
      this.auditModel.distinct('action', { orgId }).exec(),
      this.auditModel.distinct('performedBy', { orgId }).exec(),
    ]);
    const names = await this.userNames(actorIds.map(String));
    return {
      entityTypes: entityTypes.map(String).sort(),
      actions: actions.map(String).sort(),
      actors: actorIds
        .map(String)
        .map((id) => this.actor(id, names))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private actor(id: string, names: Map<string, string>): AuditRow['actor'] {
    if (names.has(id)) return { id, name: names.get(id)!, kind: 'user' };
    if (id.startsWith('system') || id in SYSTEM_ACTORS) {
      return { id, name: SYSTEM_ACTORS[id] ?? id.replace(/^system:/, '').replace(/-/g, ' '), kind: 'system' };
    }
    // A user id with no user behind it: removed since, or an id from a test.
    return { id, name: 'Former user', kind: 'user' };
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const objectIds = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id) && id.length === 24).map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return new Map();
    const users = await this.userModel.find({ _id: { $in: objectIds } }, { name: 1, email: 1 }).lean().exec();
    return new Map(users.map((u) => [u._id.toString(), u.name || u.email]));
  }
}
