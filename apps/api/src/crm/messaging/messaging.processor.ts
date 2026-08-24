import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job } from 'bullmq';
import { Model } from 'mongoose';
import { MessageStatus } from '@ai-accounting/shared';
import { CrmMessage, CrmMessageDocument } from '../schemas/crm-message.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { MESSAGING_PROVIDER, MessagingProvider } from './messaging.provider.interface';
import { CRM_MESSAGING_QUEUE, SendMessageJob } from './messaging.service';

/**
 * The only place a CRM message is actually transmitted.
 *
 * Keeping the provider call here (never in an HTTP handler) means a slow or
 * failing WhatsApp/SMTP endpoint can never block a user's request, and retries
 * are the queue's job rather than the caller's.
 */
@Processor(CRM_MESSAGING_QUEUE)
export class MessagingProcessor extends WorkerHost {
  private readonly logger = new Logger(MessagingProcessor.name);

  constructor(
    @InjectModel(CrmMessage.name) private messageModel: Model<CrmMessageDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @Inject(MESSAGING_PROVIDER) private provider: MessagingProvider,
  ) {
    super();
  }

  async process(job: Job<SendMessageJob>): Promise<void> {
    const { messageId, firmId } = job.data;

    // The worker runs outside any request, so there is no firm context to scope
    // by — look the message up by id and verify it belongs to the job's firm.
    const message = await this.messageModel.findById(messageId).exec();
    if (!message) {
      this.logger.warn(`Message ${messageId} no longer exists — dropping job`);
      return;
    }
    if (message.firmId.toString() !== firmId) {
      // Defensive: a mismatched job must never cause a cross-firm send.
      throw new Error(`Message ${messageId} does not belong to firm ${firmId}`);
    }
    if (message.status === MessageStatus.SENT) {
      this.logger.log(`Message ${messageId} already sent — skipping duplicate job`);
      return;
    }

    try {
      const result = await this.provider.send({
        channel: message.channel,
        to: message.recipientAddress,
        subject: message.subject,
        body: message.body,
      });

      message.status = MessageStatus.SENT;
      message.isMock = result.isMock;
      message.providerMessageId = result.providerMessageId;
      message.sentAt = new Date();
      message.error = undefined;
      await message.save();

      // Invariant 6: every state change on a business entity is audited.
      await this.auditLogModel.create({
        orgId: message.clientOrgId?.toString() ?? firmId,
        entityType: 'CrmMessage',
        entityId: messageId,
        action: 'message_sent',
        performedBy: 'system:crm-messaging',
        meta: {
          firmId,
          channel: message.channel,
          templateKey: message.templateKey,
          provider: this.provider.name,
          isMock: result.isMock,
          cause: message.cause ?? null,
        },
      });

      this.logger.log(
        `Message ${messageId} sent via ${this.provider.name} (mock=${result.isMock})`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);

      // Record the failure, but rethrow so BullMQ retries. On the final attempt
      // the row is left FAILED with the reason visible in the outbox.
      message.status = MessageStatus.FAILED;
      message.error = reason;
      await message.save();

      this.logger.error(`Message ${messageId} failed: ${reason}`);
      throw err;
    }
  }
}
