/**
 * Lead pipeline — Phase 5 acceptance criteria.
 *
 * Done when: a lead can be created, qualified by AI, and moved through stages
 * by a human.
 *
 * The invariant under test throughout: the qualifier ADVISES. There is no code
 * path by which an AI verdict changes a lead's stage.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  FirmService,
  LeadQualificationStatus,
  LeadSource,
  LeadStage,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import { Lead, LeadSchema, LeadDocument } from '../schemas/lead.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { Firm, FirmSchema, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from '../messaging/messaging.service';
import { LeadsService, CRM_LEADS_QUEUE, QualifyLeadJob } from './leads.service';
import { LeadsProcessor } from './leads.processor';
import { LeadQualifierService } from './lead-qualifier.service';
import { UsageMeterService } from '../../ocr/usage-meter.service';

const FIRM_ID = new Types.ObjectId();
const OTHER_FIRM = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let leads: LeadsService;
let processor: LeadsProcessor;
let leadModel: Model<LeadDocument>;
let messageModel: Model<CrmMessageDocument>;
let auditModel: Model<AuditLogDocument>;

const fakeMessagingQueue = { add: jest.fn() };
const fakeLeadsQueue = { add: jest.fn() };
const fakeQualifier = { qualify: jest.fn() };
const fakeUsageMeter = { recordAiTokens: jest.fn() };

const GOOD_VERDICT = {
  score: 82,
  summary: 'Registered private limited seeking recurring GST and TDS work.',
  signals: ['Has a GSTIN', 'Wants recurring monthly filing'],
  openQuestions: ['What is the annual turnover?'],
  recommendedStage: LeadStage.PROPOSAL_SENT,
  model: 'gemini-2.5-flash',
  tokensIn: 400,
  tokensOut: 120,
};

async function seedLead(over: Partial<Record<string, unknown>> = {}) {
  return withFirm(FIRM_ID.toString(), () =>
    leads.create({
      firmId: FIRM_ID.toString(),
      name: 'Ratan Steel Works',
      contactName: 'Ratan',
      whatsappNumber: '9876500011',
      source: LeadSource.WEBSITE,
      services: [FirmService.GST_FILING, FirmService.TDS],
      enquiryNotes: 'We need monthly GST filing and TDS returns for our Pvt Ltd.',
      estimatedValuePaise: 2_500_000,
      ...over,
    }),
  );
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: CrmMessage.name, schema: CrmMessageSchema },
        { name: Lead.name, schema: LeadSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Firm.name, schema: FirmSchema },
      ]),
    ],
    providers: [
      LeadsService,
      LeadsProcessor,
      MessagingService,
      { provide: LeadQualifierService, useValue: fakeQualifier },
      { provide: UsageMeterService, useValue: fakeUsageMeter },
      { provide: getQueueToken(CRM_MESSAGING_QUEUE), useValue: fakeMessagingQueue },
      { provide: getQueueToken(CRM_LEADS_QUEUE), useValue: fakeLeadsQueue },
    ],
  }).compile();

  leads = moduleRef.get(LeadsService);
  processor = moduleRef.get(LeadsProcessor);
  leadModel = moduleRef.get(getModelToken(Lead.name));
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));

  const firmModel = moduleRef.get<Model<FirmDocument>>(getModelToken(Firm.name));
  await firmModel.create({ _id: FIRM_ID, name: 'Sharma & Associates', slug: 'sharma-leads' });
}, 90_000);

beforeEach(async () => {
  jest.clearAllMocks();
  fakeQualifier.qualify.mockResolvedValue(GOOD_VERDICT);
  await leadModel.deleteMany({}).exec();
  await messageModel.deleteMany({}).exec();
  await auditModel.deleteMany({}).exec();
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

describe('create', () => {
  it('starts a lead at NEW with no qualification', async () => {
    const lead = await seedLead();
    expect(lead.stage).toBe(LeadStage.NEW);
    expect(lead.qualification.status).toBe(LeadQualificationStatus.NOT_STARTED);
    expect(lead.estimatedValuePaise).toBe(2_500_000);
  });

  it('rejects a fractional value — money is integer paise (Invariant 1)', async () => {
    await expect(
      withFirm(FIRM_ID.toString(), () =>
        leads.create({
          firmId: FIRM_ID.toString(),
          name: 'Bad Money Co',
          source: LeadSource.REFERRAL,
          estimatedValuePaise: 1500.5,
        }),
      ),
    ).rejects.toThrow(/integer number of paise/i);
  });
});

describe('AI qualification', () => {
  it('queues rather than calling the model in the request path', async () => {
    const lead = await seedLead();

    const updated = await withFirm(FIRM_ID.toString(), () =>
      leads.requestQualification(lead._id.toString(), FIRM_ID.toString()),
    );

    expect(updated.qualification.status).toBe(LeadQualificationStatus.QUEUED);
    expect(fakeQualifier.qualify).not.toHaveBeenCalled();
    expect(fakeLeadsQueue.add).toHaveBeenCalledTimes(1);

    // BullMQ rejects ':' in a custom job id. The fake queue here accepts
    // anything, so assert the rule explicitly rather than discovering it live.
    const [, , opts] = fakeLeadsQueue.add.mock.calls[0];
    expect(opts.jobId).not.toContain(':');
    expect(opts.jobId).toContain(lead._id.toString());
  });

  it('leaves the lead unqueued when the queue rejects the job', async () => {
    // Marking QUEUED before enqueuing would strand the lead showing
    // "Qualifying…" with no worker coming to correct it.
    fakeLeadsQueue.add.mockRejectedValueOnce(new Error('Custom Id cannot contain :'));
    const lead = await seedLead();

    await expect(
      withFirm(FIRM_ID.toString(), () =>
        leads.requestQualification(lead._id.toString(), FIRM_ID.toString()),
      ),
    ).rejects.toThrow();

    const saved = await leadModel.findById(lead._id).exec();
    expect(saved!.qualification.status).toBe(LeadQualificationStatus.NOT_STARTED);
  });

  it('records the verdict WITHOUT moving the lead', async () => {
    const lead = await seedLead();
    const id = lead._id.toString();

    await processor.process({ data: { leadId: id, firmId: FIRM_ID.toString() } } as Job<QualifyLeadJob>);

    const saved = await leadModel.findById(id).exec();
    expect(saved!.qualification.status).toBe(LeadQualificationStatus.DONE);
    expect(saved!.qualification.score).toBe(82);
    expect(saved!.qualification.recommendedStage).toBe(LeadStage.PROPOSAL_SENT);

    // The whole point: the model recommended PROPOSAL_SENT, and the lead is
    // still exactly where the human left it.
    expect(saved!.stage).toBe(LeadStage.NEW);
    expect(saved!.stageHistory).toHaveLength(0);
  });

  it('meters the model spend against the firm', async () => {
    const lead = await seedLead();
    await processor.process({
      data: { leadId: lead._id.toString(), firmId: FIRM_ID.toString() },
    } as Job<QualifyLeadJob>);

    expect(fakeUsageMeter.recordAiTokens).toHaveBeenCalledWith(FIRM_ID.toString(), 400, 120);
  });

  it('marks the lead FAILED and rethrows when the model errors', async () => {
    fakeQualifier.qualify.mockRejectedValue(new Error('Gemini returned invalid JSON'));
    const lead = await seedLead();
    const id = lead._id.toString();

    await expect(
      processor.process({ data: { leadId: id, firmId: FIRM_ID.toString() } } as Job<QualifyLeadJob>),
    ).rejects.toThrow(/invalid JSON/);

    const saved = await leadModel.findById(id).exec();
    expect(saved!.qualification.status).toBe(LeadQualificationStatus.FAILED);
    expect(saved!.qualification.error).toContain('invalid JSON');
    expect(saved!.stage).toBe(LeadStage.NEW);
  });

  it('refuses a job whose firmId does not match the lead', async () => {
    const lead = await seedLead();

    await expect(
      processor.process({
        data: { leadId: lead._id.toString(), firmId: OTHER_FIRM.toString() },
      } as Job<QualifyLeadJob>),
    ).rejects.toThrow();
    expect(fakeQualifier.qualify).not.toHaveBeenCalled();
  });
});

describe('changeStage', () => {
  it('moves a lead and records who did it', async () => {
    const lead = await seedLead();

    const moved = await withFirm(FIRM_ID.toString(), () =>
      leads.changeStage(lead._id.toString(), LeadStage.QUALIFYING, ACTOR, 'Called them back'),
    );

    expect(moved.stage).toBe(LeadStage.QUALIFYING);
    expect(moved.stageHistory).toHaveLength(1);
    expect(moved.stageHistory[0]).toMatchObject({
      from: LeadStage.NEW,
      to: LeadStage.QUALIFYING,
      changedBy: ACTOR,
    });

    const audit = await auditModel.findOne({ action: 'lead_stage_changed' }).exec();
    expect(audit).not.toBeNull();
  });

  it('rejects a transition that makes no sense', async () => {
    const lead = await seedLead();
    // NEW → WON skips every step that would justify winning it.
    await expect(
      withFirm(FIRM_ID.toString(), () =>
        leads.changeStage(lead._id.toString(), LeadStage.WON, ACTOR),
      ),
    ).rejects.toThrow(/cannot move from NEW to WON/);
  });

  it('treats WON as terminal', async () => {
    const lead = await seedLead();
    const id = lead._id.toString();

    await withFirm(FIRM_ID.toString(), () => leads.changeStage(id, LeadStage.QUALIFYING, ACTOR));
    await withFirm(FIRM_ID.toString(), () => leads.changeStage(id, LeadStage.WON, ACTOR));

    await expect(
      withFirm(FIRM_ID.toString(), () => leads.changeStage(id, LeadStage.LOST, ACTOR)),
    ).rejects.toThrow(/terminal/);
  });

  it('starts the follow-up clock when a proposal goes out', async () => {
    const lead = await seedLead();
    const moved = await withFirm(FIRM_ID.toString(), () =>
      leads.changeStage(lead._id.toString(), LeadStage.PROPOSAL_SENT, ACTOR),
    );

    expect(moved.followUpDueAt).toBeInstanceOf(Date);
    expect(moved.followUpDueAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('is a no-op when the stage is unchanged', async () => {
    const lead = await seedLead();
    const same = await withFirm(FIRM_ID.toString(), () =>
      leads.changeStage(lead._id.toString(), LeadStage.NEW, ACTOR),
    );
    expect(same.stageHistory).toHaveLength(0);
  });
});

describe('runFollowUps', () => {
  it('nudges a proposal that has gone quiet, once', async () => {
    const lead = await seedLead();
    const id = lead._id.toString();
    await withFirm(FIRM_ID.toString(), () => leads.changeStage(id, LeadStage.PROPOSAL_SENT, ACTOR));

    // Pretend the follow-up became due.
    await leadModel.updateOne({ _id: id }, { $set: { followUpDueAt: new Date(Date.now() - 1000) } }).exec();

    const first = await withFirm(FIRM_ID.toString(), () => leads.runFollowUps(FIRM_ID.toString()));
    expect(first.nudged).toBe(1);

    const message = await messageModel.findOne({}).exec();
    expect(message!.templateKey).toBe(MessageTemplateKey.LEAD_FOLLOW_UP);
    expect(message!.body).not.toMatch(/\{\{/);

    // Running again the same day must not chase them twice — the clock moved.
    const second = await withFirm(FIRM_ID.toString(), () => leads.runFollowUps(FIRM_ID.toString()));
    expect(second.nudged).toBe(0);
  });

  it('leaves leads that are not awaiting a proposal response alone', async () => {
    await seedLead(); // still NEW
    const result = await withFirm(FIRM_ID.toString(), () => leads.runFollowUps(FIRM_ID.toString()));
    expect(result.nudged).toBe(0);
  });

  it('skips a lead with no contact details but stops re-examining it', async () => {
    const lead = await seedLead({ whatsappNumber: undefined, email: undefined });
    const id = lead._id.toString();
    await withFirm(FIRM_ID.toString(), () => leads.changeStage(id, LeadStage.PROPOSAL_SENT, ACTOR));
    await leadModel.updateOne({ _id: id }, { $set: { followUpDueAt: new Date(Date.now() - 1000) } }).exec();

    const result = await withFirm(FIRM_ID.toString(), () => leads.runFollowUps(FIRM_ID.toString()));

    expect(result.nudged).toBe(0);
    expect(result.skippedNoContact).toBe(1);

    const saved = await leadModel.findById(id).exec();
    expect(saved!.followUpDueAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
