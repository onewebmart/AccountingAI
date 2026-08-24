import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import {
  ConversationStatus,
  EscalationReason,
  MessageChannel,
  MessageDirection,
  MessageStatus,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { CrmMessage, CrmMessageDocument } from '../schemas/crm-message.schema';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { Firm, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { MessagingService } from '../messaging/messaging.service';
import { checkEscalation } from './escalation-rules';

export const CRM_AGENT_QUEUE = 'crm-agent';

export interface AgentReplyJob {
  conversationId: string;
  messageId: string;
  firmId: string;
}

export interface InboundMessageInput {
  firmId: string;
  channel: MessageChannel;
  /** Sender's phone number or email — the thread key. */
  from: string;
  text: string;
  contactName?: string;
}

export interface AgentStats {
  inboundTotal: number;
  autoRepliedTotal: number;
  /** Percentage of inbound messages the agent handled without a human. */
  autoResolveRate: number;
  /** Mean seconds between an inbound message and its auto-reply. */
  avgResponseSeconds: number;
  escalatedOpen: number;
  /** What clients keep asking, most common first. */
  topFaqs: { topic: string; count: number }[];
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(CrmMessage.name) private messageModel: Model<CrmMessageDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectQueue(CRM_AGENT_QUEUE) private queue: Queue<AgentReplyJob>,
    private messaging: MessagingService,
  ) {}

  /**
   * Accepts a message from a client and decides whether the agent may answer.
   *
   * The deterministic escalation check runs HERE, before anything is queued —
   * a commercial or sensitive question never reaches the model at all. Only
   * when it passes is a reply job enqueued.
   */
  async receiveInbound(input: InboundMessageInput): Promise<{
    conversation: ConversationDocument;
    message: CrmMessageDocument;
    escalated: boolean;
    reason?: EscalationReason;
  }> {
    const conversation = await this.findOrCreateThread(input);

    const message = await this.messageModel.create({
      firmId: new Types.ObjectId(input.firmId),
      conversationId: conversation._id,
      channel: input.channel,
      direction: MessageDirection.INBOUND,
      // An inbound message was received, not sent — SENT is its terminal state.
      status: MessageStatus.SENT,
      clientOrgId: conversation.clientOrgId,
      recipientName: input.contactName ?? conversation.contactName,
      recipientAddress: input.from,
      body: input.text,
      isMock: true,
      sentAt: new Date(),
    });

    conversation.inboundCount += 1;
    conversation.lastInboundAt = new Date();

    // A thread already with a human stays with them — no auto-reply resumes
    // until they resolve it.
    if (conversation.status === ConversationStatus.ESCALATED) {
      await conversation.save();
      return { conversation, message, escalated: true, reason: conversation.escalation?.reason };
    }

    const check = checkEscalation(input.text);
    if (check.escalate) {
      await this.escalate(conversation, check.reason!, input.text, check.matched);
      return { conversation, message, escalated: true, reason: check.reason };
    }

    await conversation.save();

    await this.queue.add(
      'reply',
      {
        conversationId: conversation._id.toString(),
        messageId: message._id.toString(),
        firmId: input.firmId,
      },
      {
        // BullMQ rejects ':' in a custom job id.
        jobId: `reply-${message._id.toString()}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: true,
      },
    );

    return { conversation, message, escalated: false };
  }

  /** One thread per contact per channel. */
  private async findOrCreateThread(input: InboundMessageInput): Promise<ConversationDocument> {
    const existing = await this.conversationModel
      .findOne({ channel: input.channel, contactAddress: input.from })
      .exec();

    if (existing) {
      if (input.contactName && !existing.contactName) existing.contactName = input.contactName;
      return existing;
    }

    // Match the sender to a client on file, so the agent can be grounded.
    const client = await this.orgModel
      .findOne({
        firmId: new Types.ObjectId(input.firmId),
        $or: [{ whatsappNumber: input.from }, { contactEmail: input.from }],
      })
      .exec();

    return this.conversationModel.create({
      firmId: new Types.ObjectId(input.firmId),
      clientOrgId: client?._id,
      channel: input.channel,
      contactName: input.contactName ?? client?.contactName,
      contactAddress: input.from,
      status: ConversationStatus.ACTIVE,
    });
  }

  /**
   * Hands a thread to a human and tells the client so.
   *
   * The holding message is a fixed template, not model output — it is sent in
   * exactly the situations where the model is not trusted to speak.
   */
  async escalate(
    conversation: ConversationDocument,
    reason: EscalationReason,
    triggeredBy?: string,
    matched?: string,
  ): Promise<ConversationDocument> {
    conversation.status = ConversationStatus.ESCALATED;
    conversation.escalation = {
      reason,
      triggeredBy,
      escalatedAt: new Date(),
    };
    await conversation.save();

    const firm = await this.firmModel.findById(conversation.firmId).exec();

    await this.messaging.enqueue({
      firmId: conversation.firmId.toString(),
      channel: conversation.channel,
      templateKey: MessageTemplateKey.GENERIC,
      recipientAddress: conversation.contactAddress,
      recipientName: conversation.contactName,
      clientOrgId: conversation.clientOrgId?.toString(),
      // Thread it, or the CA opening the escalation cannot see that the client
      // was already told someone is coming — and may repeat it.
      conversationId: conversation._id.toString(),
      cause: { type: 'conversation', id: conversation._id.toString() },
      variables: {
        body:
          `Namaste${conversation.contactName ? ` ${conversation.contactName} ji` : ''},\n\n` +
          'Aapka sawaal maine CA sahab tak pahuncha diya hai. Woh jald hi aapko reply karenge.\n\n' +
          'Dhanyavaad,\n' +
          (firm?.name ?? 'Your CA firm'),
      },
    });

    await this.auditLogModel.create({
      orgId: conversation.clientOrgId?.toString() ?? conversation.firmId.toString(),
      entityType: 'Conversation',
      entityId: conversation._id.toString(),
      action: 'conversation_escalated',
      performedBy: 'system:support-agent',
      meta: {
        firmId: conversation.firmId.toString(),
        reason,
        matched: matched ?? null,
        triggeredBy: triggeredBy ?? null,
      },
    });

    this.logger.log(
      `Conversation ${conversation._id.toString()} escalated (${reason}${matched ? `: "${matched}"` : ''})`,
    );

    return conversation;
  }

  /** Records an auto-reply the agent produced, and its response time. */
  async recordAutoReply(
    conversationId: string,
    inboundAt: Date,
    topic: string,
  ): Promise<void> {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) return;

    conversation.autoRepliedCount += 1;
    conversation.lastOutboundAt = new Date();
    conversation.totalResponseMs += Date.now() - inboundAt.getTime();

    if (topic && !conversation.topics.includes(topic)) {
      conversation.topics.push(topic);
    }

    await conversation.save();
  }

  async findById(id: string): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(id).exec();
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async list(filter: { status?: ConversationStatus } = {}): Promise<ConversationDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    return this.conversationModel.find(query).sort({ lastInboundAt: -1 }).limit(100).exec();
  }

  /** Every message in a thread, oldest first. */
  async messagesFor(conversationId: string): Promise<CrmMessageDocument[]> {
    return this.messageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .exec();
  }

  /** A human closes an escalation and hands the thread back to the agent. */
  async resolveEscalation(id: string, actorId: string): Promise<ConversationDocument> {
    const conversation = await this.findById(id);

    if (conversation.status !== ConversationStatus.ESCALATED) {
      return conversation;
    }

    conversation.status = ConversationStatus.ACTIVE;
    if (conversation.escalation) {
      conversation.escalation.resolvedAt = new Date();
      conversation.escalation.resolvedBy = actorId;
    }
    await conversation.save();

    await this.auditLogModel.create({
      orgId: conversation.clientOrgId?.toString() ?? conversation.firmId.toString(),
      entityType: 'Conversation',
      entityId: id,
      action: 'conversation_escalation_resolved',
      performedBy: actorId,
      meta: { firmId: conversation.firmId.toString() },
    });

    return conversation;
  }

  /** The activity panel: auto-resolve rate, response time, FAQ list. */
  async stats(): Promise<AgentStats> {
    const conversations = await this.conversationModel.find({}).exec();

    let inboundTotal = 0;
    let autoRepliedTotal = 0;
    let totalResponseMs = 0;
    let escalatedOpen = 0;
    const topicCounts = new Map<string, number>();

    for (const c of conversations) {
      inboundTotal += c.inboundCount;
      autoRepliedTotal += c.autoRepliedCount;
      totalResponseMs += c.totalResponseMs;
      if (c.status === ConversationStatus.ESCALATED) escalatedOpen++;
      for (const topic of c.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
    }

    return {
      inboundTotal,
      autoRepliedTotal,
      autoResolveRate: inboundTotal === 0 ? 0 : Math.round((autoRepliedTotal / inboundTotal) * 100),
      avgResponseSeconds:
        autoRepliedTotal === 0 ? 0 : Math.round(totalResponseMs / autoRepliedTotal / 1000),
      escalatedOpen,
      topFaqs: [...topicCounts.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }
}
