/**
 * AI support agent — Phase 7 acceptance criteria.
 *
 * Done when: an inbound message produces a contextual reply, and a fee question
 * escalates instead of answering.
 *
 * The theme throughout is that every uncertain path ends with a human. A model
 * speaking on a CA firm's behalf is only allowed to send when it is confident
 * AND did not ask for help AND the question was never commercial or sensitive
 * to begin with.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { testMongoUri } from '../../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  ConversationStatus,
  EscalationReason,
  MessageChannel,
  MessageDirection,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import {
  Conversation,
  ConversationSchema,
  ConversationDocument,
} from '../schemas/conversation.schema';
import { ComplianceItem, ComplianceItemSchema } from '../schemas/compliance-item.schema';
import { DocumentRequest, DocumentRequestSchema } from '../schemas/document-request.schema';
import { PracticeInvoice, PracticeInvoiceSchema } from '../schemas/practice-invoice.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import {
  Organization,
  OrganizationSchema,
  OrganizationDocument,
} from '../../tenancy/schemas/organization.schema';
import { Firm, FirmSchema, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from '../messaging/messaging.service';
import { ConversationsService, CRM_AGENT_QUEUE, AgentReplyJob } from './conversations.service';
import { AgentProcessor } from './agent.processor';
import { SupportAgentService } from './support-agent.service';
import { ClientContextService } from './client-context.service';
import { UsageMeterService } from '../../ocr/usage-meter.service';

const FIRM_ID = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();
const CLIENT_WA = '9876543210';

let moduleRef: TestingModule;
let conversations: ConversationsService;
let processor: AgentProcessor;
let conversationModel: Model<ConversationDocument>;
let messageModel: Model<CrmMessageDocument>;
let orgModel: Model<OrganizationDocument>;
let auditModel: Model<AuditLogDocument>;
let client: OrganizationDocument;

const fakeMessagingQueue = { add: jest.fn() };
const fakeAgentQueue = { add: jest.fn() };
const fakeAgent = { reply: jest.fn() };
const fakeUsageMeter = { recordAiTokens: jest.fn() };

const GOOD_REPLY = {
  reply: 'Namaste ji, GSTR-3B ki last date 20 Aug 2026 hai.',
  confidence: 0.9,
  needsHuman: false,
  topic: 'GST deadline',
  model: 'gemini-2.5-flash',
  tokensIn: 300,
  tokensOut: 60,
};

async function inbound(text: string, from = CLIENT_WA) {
  return withFirm(FIRM_ID.toString(), () =>
    conversations.receiveInbound({
      firmId: FIRM_ID.toString(),
      channel: MessageChannel.WHATSAPP,
      from,
      text,
      contactName: 'Ramesh Mehta',
    }),
  );
}

async function runReplyJob(conversationId: string, messageId: string) {
  return processor.process({
    data: { conversationId, messageId, firmId: FIRM_ID.toString() },
  } as Job<AgentReplyJob>);
}

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: CrmMessage.name, schema: CrmMessageSchema },
        { name: Conversation.name, schema: ConversationSchema },
        { name: ComplianceItem.name, schema: ComplianceItemSchema },
        { name: DocumentRequest.name, schema: DocumentRequestSchema },
        { name: PracticeInvoice.name, schema: PracticeInvoiceSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: Firm.name, schema: FirmSchema },
      ]),
    ],
    providers: [
      ConversationsService,
      AgentProcessor,
      ClientContextService,
      MessagingService,
      { provide: SupportAgentService, useValue: fakeAgent },
      { provide: UsageMeterService, useValue: fakeUsageMeter },
      { provide: getQueueToken(CRM_MESSAGING_QUEUE), useValue: fakeMessagingQueue },
      { provide: getQueueToken(CRM_AGENT_QUEUE), useValue: fakeAgentQueue },
    ],
  }).compile();

  conversations = moduleRef.get(ConversationsService);
  processor = moduleRef.get(AgentProcessor);
  conversationModel = moduleRef.get(getModelToken(Conversation.name));
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));

  const firmModel = moduleRef.get<Model<FirmDocument>>(getModelToken(Firm.name));
  await firmModel.create({ _id: FIRM_ID, name: 'Sharma & Associates', slug: 'sharma-agent' });

  await conversationModel.syncIndexes();
}, 90_000);

beforeEach(async () => {
  jest.clearAllMocks();
  fakeAgent.reply.mockResolvedValue(GOOD_REPLY);
  await conversationModel.deleteMany({}).exec();
  await messageModel.deleteMany({}).exec();
  await auditModel.deleteMany({}).exec();
  await orgModel.deleteMany({}).exec();
  client = await orgModel.create({
    firmId: FIRM_ID,
    name: 'Mehta Textiles',
    isActive: true,
    gstin: '23AABCM1234F1Z5',
    whatsappNumber: CLIENT_WA,
    contactName: 'Ramesh Mehta',
  });
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('inbound threading', () => {
  it('opens one thread per contact and matches them to a client on file', async () => {
    const first = await inbound('Namaste, GSTR-3B kab bharna hai?');

    expect(first.escalated).toBe(false);
    expect(first.conversation.clientOrgId?.toString()).toBe(client._id.toString());
    expect(first.conversation.status).toBe(ConversationStatus.ACTIVE);

    const second = await inbound('Aur ITR ka kya?');
    expect(second.conversation._id.toString()).toBe(first.conversation._id.toString());
    expect(second.conversation.inboundCount).toBe(2);
  });

  it('records an inbound message as received, not queued', async () => {
    const { message } = await inbound('Namaste');
    expect(message.direction).toBe(MessageDirection.INBOUND);
    expect(message.sentAt).toBeInstanceOf(Date);
  });

  it('queues a reply job for an ordinary question', async () => {
    await inbound('Bank statement kahan bhejun?');
    expect(fakeAgentQueue.add).toHaveBeenCalledTimes(1);
    const [, , opts] = fakeAgentQueue.add.mock.calls[0];
    // BullMQ rejects ':' in a custom job id.
    expect(opts.jobId).not.toContain(':');
  });
});

describe('a fee question escalates instead of answering', () => {
  it('never reaches the model at all', async () => {
    const result = await inbound('Fees kitni hogi GSTR-3B ki?');

    expect(result.escalated).toBe(true);
    expect(result.reason).toBe(EscalationReason.COMMERCIAL);
    // The whole point: no job was queued, so the model was never consulted.
    expect(fakeAgentQueue.add).not.toHaveBeenCalled();
    expect(fakeAgent.reply).not.toHaveBeenCalled();

    const saved = await conversationModel.findById(result.conversation._id).exec();
    expect(saved!.status).toBe(ConversationStatus.ESCALATED);
    expect(saved!.escalation?.reason).toBe(EscalationReason.COMMERCIAL);
  });

  it('tells the client a human is coming, using a fixed template', async () => {
    const result = await inbound('kya discount mil sakta hai');

    const outbound = await messageModel
      .findOne({
        direction: MessageDirection.OUTBOUND,
        // Threaded, so the CA opening the escalation sees the client was
        // already told — otherwise they repeat it.
        conversationId: result.conversation._id,
      })
      .exec();

    expect(outbound).not.toBeNull();
    expect(outbound!.body).toContain('CA sahab');
    expect(outbound!.body).not.toMatch(/\{\{/);
  });

  it('writes an audit entry naming the trigger', async () => {
    await inbound('Fees kitni hai?');
    const audit = await auditModel.findOne({ action: 'conversation_escalated' }).exec();
    expect(audit).not.toBeNull();
    expect(audit!.meta).toEqual(
      expect.objectContaining({ reason: EscalationReason.COMMERCIAL, matched: 'fees' }),
    );
  });

  it('keeps the thread with the human on the next message', async () => {
    await inbound('Fees kitni hai?');
    jest.clearAllMocks();

    // A perfectly ordinary follow-up must NOT resume auto-replying.
    const next = await inbound('Aur GSTR-1 kab hai?');

    expect(next.escalated).toBe(true);
    expect(fakeAgentQueue.add).not.toHaveBeenCalled();
  });
});

describe('the agent replies when it is confident', () => {
  it('sends a grounded reply and records the response', async () => {
    const { conversation, message } = await inbound('GSTR-3B kab tak bharna hai?');
    await runReplyJob(conversation._id.toString(), message._id.toString());

    const outbound = await messageModel
      .findOne({ direction: MessageDirection.OUTBOUND })
      .exec();
    expect(outbound!.body).toContain('GSTR-3B');
    expect(outbound!.conversationId?.toString()).toBe(conversation._id.toString());

    const saved = await conversationModel.findById(conversation._id).exec();
    expect(saved!.status).toBe(ConversationStatus.ACTIVE);
    expect(saved!.autoRepliedCount).toBe(1);
    expect(saved!.topics).toContain('GST deadline');
  });

  it('passes the client’s real context to the model', async () => {
    const { conversation, message } = await inbound('Mera GSTIN kya hai?');
    await runReplyJob(conversation._id.toString(), message._id.toString());

    const [input] = fakeAgent.reply.mock.calls[0];
    expect(input.context.gstin).toBe('23AABCM1234F1Z5');
    expect(input.context.clientName).toBe('Mehta Textiles');
  });

  it('meters the model spend against the firm', async () => {
    const { conversation, message } = await inbound('Namaste');
    await runReplyJob(conversation._id.toString(), message._id.toString());
    expect(fakeUsageMeter.recordAiTokens).toHaveBeenCalledWith(FIRM_ID.toString(), 300, 60);
  });
});

describe('every uncertain path ends with a human', () => {
  it('escalates when the model asks for help', async () => {
    fakeAgent.reply.mockResolvedValue({ ...GOOD_REPLY, needsHuman: true, reply: '' });

    const { conversation, message } = await inbound('Kuch complicated sawaal');
    await runReplyJob(conversation._id.toString(), message._id.toString());

    const saved = await conversationModel.findById(conversation._id).exec();
    expect(saved!.status).toBe(ConversationStatus.ESCALATED);
    expect(saved!.autoRepliedCount).toBe(0);
  });

  it('escalates a low-confidence answer rather than sending it', async () => {
    fakeAgent.reply.mockResolvedValue({ ...GOOD_REPLY, confidence: 0.3 });

    const { conversation, message } = await inbound('Kuch aisa sawaal');
    await runReplyJob(conversation._id.toString(), message._id.toString());

    const saved = await conversationModel.findById(conversation._id).exec();
    expect(saved!.status).toBe(ConversationStatus.ESCALATED);
    expect(saved!.escalation?.reason).toBe(EscalationReason.LOW_CONFIDENCE);

    // The drafted reply must not have gone out.
    const agentReply = await messageModel
      .findOne({ direction: MessageDirection.OUTBOUND, body: GOOD_REPLY.reply })
      .exec();
    expect(agentReply).toBeNull();
  });

  it('escalates when the model throws', async () => {
    fakeAgent.reply.mockRejectedValue(new Error('Gemini unavailable'));

    const { conversation, message } = await inbound('Namaste');
    // A model outage must not leave the client unanswered, nor fail the job.
    await expect(runReplyJob(conversation._id.toString(), message._id.toString())).resolves
      .toBeUndefined();

    const saved = await conversationModel.findById(conversation._id).exec();
    expect(saved!.status).toBe(ConversationStatus.ESCALATED);
    expect(saved!.escalation?.reason).toBe(EscalationReason.AGENT_ERROR);
  });

  it('does not reply if a human took the thread after the job was queued', async () => {
    const { conversation, message } = await inbound('GSTR-3B kab hai?');
    await withFirm(FIRM_ID.toString(), () =>
      conversations.escalate(conversation, EscalationReason.MANUAL),
    );
    jest.clearAllMocks();

    await runReplyJob(conversation._id.toString(), message._id.toString());
    expect(fakeAgent.reply).not.toHaveBeenCalled();
  });

  it('refuses a job belonging to another firm', async () => {
    const { conversation, message } = await inbound('Namaste');

    // Two defences stack here. The processor wraps its work in withFirm(), so
    // the isolation plugin scopes the lookup and the conversation is simply not
    // visible — which is why this surfaces as "not found" rather than reaching
    // the processor's own firmId comparison. That explicit check stays as
    // defence in depth for any future path that reads outside firm scope.
    await expect(
      processor.process({
        data: {
          conversationId: conversation._id.toString(),
          messageId: message._id.toString(),
          firmId: new Types.ObjectId().toString(),
        },
      } as Job<AgentReplyJob>),
    ).rejects.toThrow(/not found/i);

    // Whichever defence fired, the model must never have been consulted.
    expect(fakeAgent.reply).not.toHaveBeenCalled();
  });
});

describe('resolving an escalation', () => {
  it('hands the thread back to the agent', async () => {
    const result = await inbound('Fees kitni hai?');
    const id = result.conversation._id.toString();

    const resolved = await withFirm(FIRM_ID.toString(), () =>
      conversations.resolveEscalation(id, ACTOR),
    );

    expect(resolved.status).toBe(ConversationStatus.ACTIVE);
    expect(resolved.escalation?.resolvedBy).toBe(ACTOR);

    // The agent may answer again afterwards.
    jest.clearAllMocks();
    const next = await inbound('GSTR-1 kab hai?');
    expect(next.escalated).toBe(false);
    expect(fakeAgentQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('stats', () => {
  it('reports auto-resolve rate and the FAQ list', async () => {
    const a = await inbound('GSTR-3B kab hai?');
    await runReplyJob(a.conversation._id.toString(), a.message._id.toString());

    // A second, escalated thread from a different contact.
    await inbound('Fees kitni hai?', '9000000001');

    const stats = await withFirm(FIRM_ID.toString(), () => conversations.stats());

    expect(stats.inboundTotal).toBe(2);
    expect(stats.autoRepliedTotal).toBe(1);
    expect(stats.autoResolveRate).toBe(50);
    expect(stats.escalatedOpen).toBe(1);
    expect(stats.topFaqs[0]).toEqual({ topic: 'GST deadline', count: 1 });
  });
});
