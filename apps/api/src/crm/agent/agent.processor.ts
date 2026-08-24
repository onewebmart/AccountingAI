import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ConversationStatus,
  EscalationReason,
  MessageDirection,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { UsageMeterService } from '../../ocr/usage-meter.service';
import { MessagingService } from '../messaging/messaging.service';
import { ClientContextService } from './client-context.service';
import { SupportAgentService } from './support-agent.service';
import { ConversationsService, CRM_AGENT_QUEUE, AgentReplyJob } from './conversations.service';
import { MIN_REPLY_CONFIDENCE } from './escalation-rules';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Firm, FirmDocument } from '../../tenancy/schemas/firm.schema';

/**
 * Drafts and sends the agent's reply, off the request path.
 *
 * Every failure mode here ends in a human: a low-confidence answer, a model
 * request for help, or an outright error all escalate. The agent is only ever
 * allowed to send when it is confident AND did not ask for help.
 */
@Processor(CRM_AGENT_QUEUE)
export class AgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentProcessor.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly agent: SupportAgentService,
    private readonly clientContext: ClientContextService,
    private readonly messaging: MessagingService,
    private readonly usageMeter: UsageMeterService,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
  ) {
    super();
  }

  async process(job: Job<AgentReplyJob>): Promise<void> {
    const { conversationId, firmId } = job.data;

    await withFirm(firmId, async () => {
      const conversation = await this.conversations.findById(conversationId);

      if (conversation.firmId.toString() !== firmId) {
        throw new Error(`Conversation ${conversationId} does not belong to firm ${firmId}`);
      }

      // A human may have taken the thread between enqueue and now.
      if (conversation.status === ConversationStatus.ESCALATED) {
        this.logger.log(`Conversation ${conversationId} is with a human — not replying`);
        return;
      }

      const history = await this.conversations.messagesFor(conversationId);
      const inbound = history[history.length - 1];
      const inboundAt = inbound?.sentAt ?? inbound?.get('createdAt') ?? new Date();

      const firm = await this.firmModel.findById(firmId).exec();
      const context = conversation.clientOrgId
        ? await this.clientContext.forClient(conversation.clientOrgId.toString())
        : null;

      let result;
      try {
        result = await this.agent.reply({
          message: inbound?.body ?? '',
          history: history.slice(0, -1).map((m) => ({
            role: m.direction === MessageDirection.INBOUND ? ('client' as const) : ('firm' as const),
            text: m.body,
          })),
          context,
          firmName: firm?.name ?? 'your CA firm',
        });
      } catch (err) {
        // A model failure is not a reason to leave a client unanswered — hand
        // the thread to a person.
        await this.conversations.escalate(
          conversation,
          EscalationReason.AGENT_ERROR,
          inbound?.body,
        );
        this.logger.error(
          `Agent failed on conversation ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      await this.usageMeter.recordAiTokens(firmId, result.tokensIn, result.tokensOut);

      if (result.needsHuman || result.confidence < MIN_REPLY_CONFIDENCE) {
        await this.conversations.escalate(
          conversation,
          result.needsHuman ? EscalationReason.CLIENT_REQUESTED : EscalationReason.LOW_CONFIDENCE,
          inbound?.body,
        );
        this.logger.log(
          `Conversation ${conversationId} escalated by the agent ` +
            `(needsHuman=${result.needsHuman}, confidence=${result.confidence})`,
        );
        return;
      }

      await this.messaging.enqueue({
        firmId,
        channel: conversation.channel,
        templateKey: MessageTemplateKey.GENERIC,
        recipientAddress: conversation.contactAddress,
        recipientName: conversation.contactName,
        clientOrgId: conversation.clientOrgId?.toString(),
        conversationId,
        cause: { type: 'conversation', id: conversationId },
        variables: { body: result.reply },
      });

      await this.conversations.recordAutoReply(
        conversationId,
        inboundAt instanceof Date ? inboundAt : new Date(),
        result.topic,
      );

      this.logger.log(`Conversation ${conversationId} auto-replied (topic="${result.topic}")`);
    });
  }
}
