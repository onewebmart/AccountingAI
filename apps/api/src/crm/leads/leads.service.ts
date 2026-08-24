import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import {
  FirmService,
  LeadQualificationStatus,
  LeadSource,
  LeadStage,
  MessageChannel,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { Firm, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { MessagingService } from '../messaging/messaging.service';

export const CRM_LEADS_QUEUE = 'crm-leads';

export interface QualifyLeadJob {
  leadId: string;
  firmId: string;
}

export interface CreateLeadInput {
  firmId: string;
  name: string;
  contactName?: string;
  whatsappNumber?: string;
  email?: string;
  source: LeadSource;
  services?: FirmService[];
  enquiryNotes?: string;
  estimatedValuePaise?: number;
  assignedTo?: string;
}

/** Stages a lead may legitimately move to from where it is now. */
const ALLOWED_TRANSITIONS: Record<LeadStage, LeadStage[]> = {
  [LeadStage.NEW]: [LeadStage.QUALIFYING, LeadStage.PROPOSAL_SENT, LeadStage.LOST],
  [LeadStage.QUALIFYING]: [LeadStage.PROPOSAL_SENT, LeadStage.WON, LeadStage.LOST],
  [LeadStage.PROPOSAL_SENT]: [LeadStage.WON, LeadStage.LOST, LeadStage.QUALIFYING],
  // Terminal. Reopening is deliberate work, not a drag on a board.
  [LeadStage.WON]: [],
  [LeadStage.LOST]: [LeadStage.QUALIFYING],
};

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectQueue(CRM_LEADS_QUEUE) private queue: Queue<QualifyLeadJob>,
    private messaging: MessagingService,
  ) {}

  async create(input: CreateLeadInput): Promise<LeadDocument> {
    if (
      input.estimatedValuePaise !== undefined &&
      !Number.isInteger(input.estimatedValuePaise)
    ) {
      // Invariant 1 — caught here so the caller gets a 400 rather than a
      // Mongoose validation error surfacing as a 500.
      throw new BadRequestException('estimatedValuePaise must be an integer number of paise');
    }

    const lead = await this.leadModel.create({
      firmId: new Types.ObjectId(input.firmId),
      name: input.name,
      contactName: input.contactName,
      whatsappNumber: input.whatsappNumber,
      email: input.email,
      source: input.source,
      services: input.services ?? [],
      enquiryNotes: input.enquiryNotes,
      estimatedValuePaise: input.estimatedValuePaise,
      assignedTo: input.assignedTo,
      stage: LeadStage.NEW,
    });

    return lead;
  }

  async list(filter: { stage?: LeadStage } = {}): Promise<LeadDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter.stage) query.stage = filter.stage;
    return this.leadModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findById(id).exec();
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  /**
   * Queues an AI qualification pass.
   *
   * The model call happens in the worker, never in the request — the same rule
   * the rest of the pipeline follows for AI work.
   */
  async requestQualification(leadId: string, firmId: string): Promise<LeadDocument> {
    const lead = await this.findById(leadId);

    // Enqueue BEFORE marking the lead QUEUED. The other order leaves a lead
    // stuck showing "Qualifying…" forever if the queue rejects the job, with no
    // worker coming to correct it.
    await this.queue.add(
      'qualify',
      { leadId, firmId },
      {
        // BullMQ rejects ':' in a custom job id — it is their key separator.
        jobId: `qualify-${leadId}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
      },
    );

    lead.qualification.status = LeadQualificationStatus.QUEUED;
    lead.qualification.error = undefined;
    await lead.save();

    return lead;
  }

  /**
   * Moves a lead between stages. Humans only — there is no code path that lets
   * the qualifier do this (Invariant 4).
   */
  async changeStage(
    leadId: string,
    to: LeadStage,
    actorId: string,
    note?: string,
  ): Promise<LeadDocument> {
    const lead = await this.findById(leadId);
    const from = lead.stage;

    if (from === to) return lead;

    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `A lead cannot move from ${from} to ${to}.` +
          (ALLOWED_TRANSITIONS[from].length
            ? ` Allowed from here: ${ALLOWED_TRANSITIONS[from].join(', ')}.`
            : ' That stage is terminal.'),
      );
    }

    lead.stage = to;
    lead.stageHistory.push({ from, to, changedBy: actorId, changedAt: new Date(), note });

    // Entering PROPOSAL_SENT starts the follow-up clock.
    if (to === LeadStage.PROPOSAL_SENT) {
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + FOLLOW_UP_DAYS);
      lead.followUpDueAt = due;
    }
    if (to === LeadStage.WON || to === LeadStage.LOST) {
      lead.followUpDueAt = undefined;
    }

    await lead.save();

    await this.auditLogModel.create({
      orgId: lead.firmId.toString(),
      entityType: 'CrmLead',
      entityId: leadId,
      action: 'lead_stage_changed',
      performedBy: actorId,
      meta: { firmId: lead.firmId.toString(), from, to, note: note ?? null },
    });

    return lead;
  }

  /**
   * Nudges leads whose proposal has gone quiet.
   *
   * Idempotent by rescheduling: once nudged, the follow-up clock is pushed
   * forward, so a second run the same day sends nothing.
   */
  async runFollowUps(firmId: string, now = new Date()): Promise<{ nudged: number; skippedNoContact: number }> {
    const firm = await this.firmModel.findById(firmId).exec();
    const firmName = firm?.name ?? 'your CA firm';

    const due = await this.leadModel
      .find({ stage: LeadStage.PROPOSAL_SENT, followUpDueAt: { $lte: now } })
      .exec();

    let nudged = 0;
    let skippedNoContact = 0;

    for (const lead of due) {
      const channel = lead.whatsappNumber ? MessageChannel.WHATSAPP : MessageChannel.EMAIL;
      const address = lead.whatsappNumber ?? lead.email;

      if (!address) {
        skippedNoContact++;
        // Push the clock anyway so this lead isn't re-examined every single run.
        lead.followUpDueAt = this.nextFollowUp(now);
        await lead.save();
        continue;
      }

      await this.messaging.enqueue({
        firmId,
        channel,
        templateKey: MessageTemplateKey.LEAD_FOLLOW_UP,
        recipientAddress: address,
        recipientName: lead.contactName ?? lead.name,
        leadId: lead._id.toString(),
        cause: { type: 'lead', id: lead._id.toString() },
        variables: {
          leadName: lead.contactName ?? lead.name,
          serviceSummary: lead.services.length ? lead.services.join(', ') : 'the work you asked about',
          firmName,
        },
      });

      lead.lastContactedAt = now;
      lead.followUpDueAt = this.nextFollowUp(now);
      await lead.save();
      nudged++;
    }

    return { nudged, skippedNoContact };
  }

  /** Records the qualifier's verdict. Never touches `stage`. */
  async applyQualification(
    leadId: string,
    result: {
      score: number;
      summary: string;
      signals: string[];
      openQuestions: string[];
      recommendedStage: LeadStage;
      model: string;
    },
  ): Promise<void> {
    const lead = await this.findById(leadId);

    lead.qualification = {
      status: LeadQualificationStatus.DONE,
      score: result.score,
      summary: result.summary,
      signals: result.signals,
      openQuestions: result.openQuestions,
      recommendedStage: result.recommendedStage,
      model: result.model,
      ranAt: new Date(),
      error: undefined,
    };

    await lead.save();
  }

  async markQualificationFailed(leadId: string, reason: string): Promise<void> {
    const lead = await this.leadModel.findById(leadId).exec();
    if (!lead) return;
    lead.qualification.status = LeadQualificationStatus.FAILED;
    lead.qualification.error = reason;
    await lead.save();
  }

  private nextFollowUp(from: Date): Date {
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + FOLLOW_UP_DAYS);
    return next;
  }
}

/** Days between a proposal (or a nudge) and the next follow-up. */
const FOLLOW_UP_DAYS = 3;
