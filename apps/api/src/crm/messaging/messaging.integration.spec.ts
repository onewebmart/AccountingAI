/**
 * Messaging core — Phase 2 acceptance criteria.
 *
 * Done when: a template renders and "sends" through the queue, and the message
 * is visible in the outbox.
 *
 * Proves:
 *  ✓ enqueue() persists QUEUED and hands a job to the queue — it does NOT send
 *  ✓ the processor sends via the provider, marks SENT, and writes an audit log
 *  ✓ a provider failure marks the message FAILED with a readable reason
 *  ✓ an already-SENT message is not sent twice on a retried job
 *  ✓ a job whose firmId does not match the message never sends (cross-firm guard)
 *  ✓ the outbox is firm-scoped
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  MessageChannel,
  MessageStatus,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { MessagingService, CRM_MESSAGING_QUEUE, SendMessageJob } from './messaging.service';
import { MessagingProcessor } from './messaging.processor';
import { MESSAGING_PROVIDER } from './messaging.provider.interface';

const FIRM_A = new Types.ObjectId().toString();
const FIRM_B = new Types.ObjectId().toString();

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let service: MessagingService;
let processor: MessagingProcessor;
let messageModel: Model<CrmMessageDocument>;
let auditModel: Model<AuditLogDocument>;

const fakeQueue = { add: jest.fn() };
const fakeProvider = { name: 'test', send: jest.fn() };

const REMINDER_VARS = {
  clientName: 'Ramesh',
  purpose: 'ITR Filing',
  documentList: '- Form 16',
  dueDate: '31 Aug 2026',
  firmName: 'Sharma & Associates',
};

function jobFor(messageId: string, firmId: string): Job<SendMessageJob> {
  return { data: { messageId, firmId } } as Job<SendMessageJob>;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: CrmMessage.name, schema: CrmMessageSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [
      MessagingService,
      MessagingProcessor,
      { provide: getQueueToken(CRM_MESSAGING_QUEUE), useValue: fakeQueue },
      { provide: MESSAGING_PROVIDER, useValue: fakeProvider },
    ],
  }).compile();

  service = moduleRef.get(MessagingService);
  processor = moduleRef.get(MessagingProcessor);
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

beforeEach(() => {
  jest.clearAllMocks();
  fakeProvider.send.mockResolvedValue({ providerMessageId: 'prov-1', isMock: true });
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

describe('enqueue', () => {
  it('persists a rendered QUEUED message and queues a job without sending', async () => {
    const message = await service.enqueue({
      firmId: FIRM_A,
      channel: MessageChannel.WHATSAPP,
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
      variables: REMINDER_VARS,
      recipientAddress: '9876543210',
      recipientName: 'Ramesh Mehta',
    });

    expect(message.status).toBe(MessageStatus.QUEUED);
    expect(message.body).toContain('Ramesh');
    expect(message.body).not.toMatch(/\{\{/);
    // The whole point: nothing is transmitted from the request path.
    expect(fakeProvider.send).not.toHaveBeenCalled();
    expect(fakeQueue.add).toHaveBeenCalledTimes(1);

    const [, payload, opts] = fakeQueue.add.mock.calls[0];
    expect(payload).toEqual({ messageId: message._id.toString(), firmId: FIRM_A });
    // jobId pinned to the message id makes a duplicate enqueue idempotent.
    expect(opts.jobId).toBe(message._id.toString());
  });

  it('rejects a send whose template variables are incomplete', async () => {
    await expect(
      service.enqueue({
        firmId: FIRM_A,
        channel: MessageChannel.WHATSAPP,
        templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
        variables: { clientName: 'Ramesh' },
        recipientAddress: '9876543210',
      }),
    ).rejects.toThrow(/missing variable/i);

    expect(fakeQueue.add).not.toHaveBeenCalled();
  });
});

describe('processor', () => {
  it('sends, marks SENT and writes an audit log', async () => {
    const message = await service.enqueue({
      firmId: FIRM_A,
      channel: MessageChannel.EMAIL,
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
      variables: REMINDER_VARS,
      recipientAddress: 'ramesh@example.test',
      cause: { type: 'documentRequest', id: 'req-1' },
    });
    const id = message._id.toString();

    await processor.process(jobFor(id, FIRM_A));

    const saved = await messageModel.findById(id).exec();
    expect(saved!.status).toBe(MessageStatus.SENT);
    expect(saved!.providerMessageId).toBe('prov-1');
    expect(saved!.sentAt).toBeInstanceOf(Date);
    expect(saved!.error).toBeUndefined();

    // Email keeps a subject; the provider must receive it.
    expect(fakeProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ramesh@example.test', subject: expect.stringContaining('ITR') }),
    );

    const audit = await auditModel.findOne({ entityId: id, action: 'message_sent' }).exec();
    expect(audit).not.toBeNull();
    expect(audit!.meta).toEqual(expect.objectContaining({ firmId: FIRM_A, isMock: true }));
  });

  it('marks FAILED with the reason and rethrows so the queue retries', async () => {
    fakeProvider.send.mockRejectedValue(new Error('WhatsApp number not on file'));

    const message = await service.enqueue({
      firmId: FIRM_A,
      channel: MessageChannel.WHATSAPP,
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
      variables: REMINDER_VARS,
      recipientAddress: '0000000000',
    });
    const id = message._id.toString();

    await expect(processor.process(jobFor(id, FIRM_A))).rejects.toThrow('not on file');

    const saved = await messageModel.findById(id).exec();
    expect(saved!.status).toBe(MessageStatus.FAILED);
    expect(saved!.error).toContain('not on file');
  });

  it('does not re-send a message that is already SENT', async () => {
    const message = await service.enqueue({
      firmId: FIRM_A,
      channel: MessageChannel.WHATSAPP,
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
      variables: REMINDER_VARS,
      recipientAddress: '9876543210',
    });
    const id = message._id.toString();

    await processor.process(jobFor(id, FIRM_A));
    expect(fakeProvider.send).toHaveBeenCalledTimes(1);

    // A retry after a crash must not send the client a second copy.
    await processor.process(jobFor(id, FIRM_A));
    expect(fakeProvider.send).toHaveBeenCalledTimes(1);
  });

  it('refuses a job whose firmId does not match the message', async () => {
    const message = await service.enqueue({
      firmId: FIRM_A,
      channel: MessageChannel.WHATSAPP,
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
      variables: REMINDER_VARS,
      recipientAddress: '9876543210',
    });

    await expect(
      processor.process(jobFor(message._id.toString(), FIRM_B)),
    ).rejects.toThrow(/does not belong to firm/);
    expect(fakeProvider.send).not.toHaveBeenCalled();
  });
});

describe('outbox scoping', () => {
  it('lists only the calling firm’s messages', async () => {
    await service.enqueue({
      firmId: FIRM_B,
      channel: MessageChannel.WHATSAPP,
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
      variables: { ...REMINDER_VARS, clientName: 'FirmB Client' },
      recipientAddress: '9111111111',
    });

    const firmBMessages = await withFirm(FIRM_B, () => service.listMessages());
    expect(firmBMessages.length).toBeGreaterThan(0);
    expect(firmBMessages.every((m) => m.firmId.toString() === FIRM_B)).toBe(true);

    const firmAMessages = await withFirm(FIRM_A, () => service.listMessages());
    expect(firmAMessages.every((m) => m.firmId.toString() === FIRM_A)).toBe(true);
  });
});
