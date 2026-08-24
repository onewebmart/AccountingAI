import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ClientType,
  ComplianceStatus,
  ComplianceType,
  FirmService,
  MessageChannel,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import {
  ComplianceItem,
  ComplianceItemDocument,
} from '../schemas/compliance-item.schema';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { Firm, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { MessagingService } from '../messaging/messaging.service';
import {
  COMPLIANCE_RULES,
  REMINDER_OFFSETS,
  daysUntil,
  obligationsInWindow,
  ruleAppliesToClient,
} from './statutory-calendar';

/** How far ahead the generator materialises obligations. */
const HORIZON_DAYS = 120;

export interface GenerateResult {
  created: number;
  alreadyPresent: number;
  clientsConsidered: number;
}

export interface ReminderRun {
  remindersQueued: number;
  skippedNoContact: number;
}

/** A deadline grouped for the UI: one obligation, many clients. */
export interface DeadlineGroup {
  complianceType: ComplianceType;
  label: string;
  authority: string;
  periodKey: string;
  periodLabel: string;
  dueDate: string;
  daysLeft: number;
  pendingCount: number;
  filedCount: number;
  clients: { itemId: string; clientOrgId: string; clientName: string; status: ComplianceStatus }[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * ISO dates are how we store and compare, but "2026-08-31" reads like a
 * database field to the SME owner receiving the WhatsApp. Client-facing copy
 * gets "31 Aug 2026".
 */
function formatDateForClient(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @InjectModel(ComplianceItem.name) private itemModel: Model<ComplianceItemDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    private messaging: MessagingService,
  ) {}

  /**
   * Materialises every obligation due within the horizon for every client of a
   * firm, based on the services they subscribe to and their constitution.
   *
   * Safe to run repeatedly: the unique index on
   * (firmId, clientOrgId, complianceType, periodKey) makes re-runs no-ops, so
   * this can be a daily job as well as an on-demand action.
   */
  async generateForFirm(firmId: string, today = todayIso()): Promise<GenerateResult> {
    const horizonEnd = addDays(today, HORIZON_DAYS);

    const clients = await this.orgModel
      .find({ firmId: new Types.ObjectId(firmId), isActive: true })
      .exec();

    let created = 0;
    let alreadyPresent = 0;

    for (const client of clients) {
      const services = client.services as FirmService[] | undefined;
      const clientType = client.clientType as ClientType | undefined;

      for (const rule of COMPLIANCE_RULES) {
        if (!ruleAppliesToClient(rule, services, clientType)) continue;

        for (const ob of obligationsInWindow(rule, today, horizonEnd)) {
          try {
            await this.itemModel.create({
              firmId: new Types.ObjectId(firmId),
              clientOrgId: client._id,
              clientName: client.name,
              complianceType: ob.complianceType,
              periodKey: ob.periodKey,
              periodLabel: ob.periodLabel,
              dueDate: ob.dueDate,
              authority: ob.authority,
              status: ComplianceStatus.PENDING,
            });
            created++;
          } catch (err) {
            // Duplicate key = this obligation already exists. That is the
            // expected path on every run after the first.
            if ((err as { code?: number }).code === 11000) {
              alreadyPresent++;
              continue;
            }
            throw err;
          }
        }
      }
    }

    this.logger.log(
      `Firm ${firmId}: generated ${created} obligation(s), ${alreadyPresent} already present, across ${clients.length} client(s)`,
    );

    return { created, alreadyPresent, clientsConsidered: clients.length };
  }

  /** Deadlines grouped by obligation and period, the way the UI shows them. */
  async listDeadlines(
    opts: { from?: string; to?: string; status?: ComplianceStatus; today?: string } = {},
  ): Promise<DeadlineGroup[]> {
    const today = opts.today ?? todayIso();

    const query: Record<string, unknown> = {};
    if (opts.status) query.status = opts.status;
    if (opts.from || opts.to) {
      const range: Record<string, string> = {};
      if (opts.from) range.$gte = opts.from;
      if (opts.to) range.$lte = opts.to;
      query.dueDate = range;
    }

    const items = await this.itemModel.find(query).sort({ dueDate: 1 }).exec();

    const groups = new Map<string, DeadlineGroup>();
    for (const item of items) {
      const key = `${item.complianceType}|${item.periodKey}`;
      let group = groups.get(key);

      if (!group) {
        const rule = COMPLIANCE_RULES.find((r) => r.complianceType === item.complianceType);
        group = {
          complianceType: item.complianceType,
          label: rule?.label ?? item.complianceType,
          authority: item.authority,
          periodKey: item.periodKey,
          periodLabel: item.periodLabel,
          dueDate: item.dueDate,
          daysLeft: daysUntil(item.dueDate, today),
          pendingCount: 0,
          filedCount: 0,
          clients: [],
        };
        groups.set(key, group);
      }

      if (item.status === ComplianceStatus.PENDING) group.pendingCount++;
      if (item.status === ComplianceStatus.FILED) group.filedCount++;

      group.clients.push({
        itemId: item._id.toString(),
        clientOrgId: item.clientOrgId.toString(),
        clientName: item.clientName,
        status: item.status,
      });
    }

    return [...groups.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /** Mark one client's filing done. */
  async markFiled(itemId: string, actorId: string): Promise<ComplianceItemDocument> {
    const item = await this.itemModel.findById(itemId).exec();
    if (!item) throw new NotFoundException('Compliance item not found');

    const before = item.status;
    item.status = ComplianceStatus.FILED;
    item.filedAt = new Date();
    item.filedBy = actorId;
    await item.save();

    await this.auditLogModel.create({
      orgId: item.clientOrgId.toString(),
      entityType: 'ComplianceItem',
      entityId: itemId,
      action: 'compliance_filed',
      performedBy: actorId,
      meta: {
        firmId: item.firmId.toString(),
        complianceType: item.complianceType,
        periodKey: item.periodKey,
        before,
        after: ComplianceStatus.FILED,
      },
    });

    return item;
  }

  /**
   * Queues reminders for everything falling due at exactly 7, 3 or 1 days out.
   *
   * Idempotent per (item, offset): the offset is recorded on the item before
   * the next run, so a client is never reminded twice for the same deadline at
   * the same distance — which matters when this runs daily and on demand.
   */
  async runDueReminders(firmId: string, today = todayIso()): Promise<ReminderRun> {
    const firm = await this.firmModel.findById(firmId).exec();
    const firmName = firm?.name ?? 'your CA firm';

    const targetDates = REMINDER_OFFSETS.map((offset) => ({
      offset,
      date: addDays(today, offset),
    }));

    const items = await this.itemModel
      .find({
        status: ComplianceStatus.PENDING,
        dueDate: { $in: targetDates.map((t) => t.date) },
      })
      .exec();

    let remindersQueued = 0;
    let skippedNoContact = 0;

    for (const item of items) {
      const target = targetDates.find((t) => t.date === item.dueDate);
      if (!target) continue;

      if (item.remindersSent.some((r) => r.offsetDays === target.offset)) continue;

      const client = await this.orgModel.findById(item.clientOrgId).exec();
      const whatsapp = client?.whatsappNumber;
      const email = client?.contactEmail;

      // Prefer WhatsApp — it is what Indian SME clients actually read.
      const channel = whatsapp ? MessageChannel.WHATSAPP : MessageChannel.EMAIL;
      const address = whatsapp ?? email;

      if (!address) {
        skippedNoContact++;
        this.logger.warn(
          `Client ${item.clientName} has no WhatsApp number or email — cannot remind for ${item.complianceType}`,
        );
        continue;
      }

      const rule = COMPLIANCE_RULES.find((r) => r.complianceType === item.complianceType);

      const message = await this.messaging.enqueue({
        firmId,
        channel,
        templateKey: MessageTemplateKey.COMPLIANCE_DEADLINE,
        recipientAddress: address,
        recipientName: client?.contactName ?? item.clientName,
        clientOrgId: item.clientOrgId.toString(),
        cause: { type: 'complianceItem', id: item._id.toString() },
        variables: {
          clientName: client?.contactName ?? item.clientName,
          complianceName: `${rule?.label ?? item.complianceType} (${item.periodLabel})`,
          dueDate: formatDateForClient(item.dueDate),
          daysLeft: String(target.offset),
          firmName,
        },
      });

      item.remindersSent.push({
        offsetDays: target.offset,
        messageId: message._id,
        sentAt: new Date(),
      });
      await item.save();

      remindersQueued++;
    }

    if (remindersQueued || skippedNoContact) {
      this.logger.log(
        `Firm ${firmId}: queued ${remindersQueued} reminder(s), skipped ${skippedNoContact} with no contact details`,
      );
    }

    return { remindersQueued, skippedNoContact };
  }

  /** Every firm with compliance items — used by the daily cross-firm job. */
  async firmIdsWithItems(): Promise<string[]> {
    const ids = await this.itemModel.distinct('firmId').exec();
    return (ids as unknown[]).map((id) => String(id));
  }
}
