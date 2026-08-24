import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import {
  MessageChannel,
  MessageDirection,
  MessageStatus,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { CrmMessage, CrmMessageDocument } from '../schemas/crm-message.schema';
import { MESSAGE_TEMPLATES, TemplateRenderError, renderTemplate } from './message-templates';

export const CRM_MESSAGING_QUEUE = 'crm-messaging';

export interface SendMessageJob {
  messageId: string;
  firmId: string;
}

export interface EnqueueMessageInput {
  firmId: string;
  channel: MessageChannel;
  templateKey: MessageTemplateKey;
  variables: Record<string, string>;
  /** Resolved destination — phone for WhatsApp, address for email. */
  recipientAddress: string;
  recipientName?: string;
  clientOrgId?: string;
  leadId?: string;
  /** Threads this send into a support-agent conversation. */
  conversationId?: string;
  cause?: { type: string; id: string };
}

export interface OutboxFilter {
  channel?: MessageChannel;
  status?: MessageStatus;
  templateKey?: MessageTemplateKey;
  limit?: number;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @InjectModel(CrmMessage.name) private messageModel: Model<CrmMessageDocument>,
    @InjectQueue(CRM_MESSAGING_QUEUE) private queue: Queue<SendMessageJob>,
  ) {}

  /**
   * Renders the template, persists the message as QUEUED, and hands the job to
   * BullMQ. Nothing is transmitted here — per the project rule, the actual
   * provider call happens only in the queue processor, never in a request.
   *
   * Rendering happens up-front on purpose: a missing variable then fails the
   * caller's request synchronously instead of dying inside a worker later.
   */
  async enqueue(input: EnqueueMessageInput): Promise<CrmMessageDocument> {
    let body: string;
    let subject: string | undefined;
    try {
      ({ body, subject } = renderTemplate(input.templateKey, input.channel, input.variables));
    } catch (err) {
      // A missing variable or wrong channel is the caller's mistake, not a server
      // fault — surface it as a 400 carrying the reason, not an opaque 500.
      if (err instanceof TemplateRenderError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const message = await this.messageModel.create({
      firmId: new Types.ObjectId(input.firmId),
      channel: input.channel,
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.QUEUED,
      clientOrgId: input.clientOrgId ? new Types.ObjectId(input.clientOrgId) : undefined,
      leadId: input.leadId ? new Types.ObjectId(input.leadId) : undefined,
      conversationId: input.conversationId
        ? new Types.ObjectId(input.conversationId)
        : undefined,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress,
      templateKey: input.templateKey,
      subject,
      body,
      cause: input.cause,
    });

    const messageId = message._id.toString();

    await this.queue.add(
      'send',
      { messageId, firmId: input.firmId },
      {
        // The message row is the record of truth; the job is just the trigger.
        jobId: messageId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Queued ${input.channel} message ${messageId} (${input.templateKey}) → ${input.recipientAddress}`,
    );

    return message;
  }

  /** Outbox listing — firm scope is injected by the Mongoose plugin. */
  async listMessages(filter: OutboxFilter = {}): Promise<CrmMessageDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter.channel) query.channel = filter.channel;
    if (filter.status) query.status = filter.status;
    if (filter.templateKey) query.templateKey = filter.templateKey;

    return this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(filter.limit ?? 100, 500))
      .exec();
  }

  async getMessage(id: string): Promise<CrmMessageDocument | null> {
    return this.messageModel.findById(id).exec();
  }

  /** The built-in template catalogue, for the settings screen. */
  listTemplates() {
    return Object.values(MESSAGE_TEMPLATES);
  }
}
