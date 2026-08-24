/**
 * Dashboard & reports — Phase 8 acceptance criteria.
 *
 * Done when: every dashboard tile reads live data, with zero hardcoded numbers.
 *
 * The tests seed real records through the same collections the earlier phases
 * write, then assert the tiles reflect them — including the empty case, which
 * is the one a hardcoded dashboard always gets wrong.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { testMongoUri } from '../../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import {
  ChecklistItemStatus,
  ComplianceStatus,
  ComplianceType,
  ConversationStatus,
  DocumentRequestStatus,
  LeadSource,
  LeadStage,
  MessageChannel,
  MessageDirection,
  MessageStatus,
  MessageTemplateKey,
  PracticeInvoiceStatus,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import { ComplianceItem, ComplianceItemSchema, ComplianceItemDocument } from '../schemas/compliance-item.schema';
import { DocumentRequest, DocumentRequestSchema, DocumentRequestDocument } from '../schemas/document-request.schema';
import { PracticeInvoice, PracticeInvoiceSchema, PracticeInvoiceDocument } from '../schemas/practice-invoice.schema';
import { Lead, LeadSchema, LeadDocument } from '../schemas/lead.schema';
import { Conversation, ConversationSchema, ConversationDocument } from '../schemas/conversation.schema';
import { Organization, OrganizationSchema, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { DashboardService } from './dashboard.service';
import { CrmReportsService } from './crm-reports.service';

const FIRM_ID = new Types.ObjectId();
const OTHER_FIRM = new Types.ObjectId();
const TODAY = '2026-08-20';

let moduleRef: TestingModule;
let dashboard: DashboardService;
let reports: CrmReportsService;
let orgModel: Model<OrganizationDocument>;
let complianceModel: Model<ComplianceItemDocument>;
let requestModel: Model<DocumentRequestDocument>;
let invoiceModel: Model<PracticeInvoiceDocument>;
let leadModel: Model<LeadDocument>;
let conversationModel: Model<ConversationDocument>;
let messageModel: Model<CrmMessageDocument>;

const summary = () => withFirm(FIRM_ID.toString(), () => dashboard.summary(FIRM_ID.toString(), TODAY));

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Organization.name, schema: OrganizationSchema },
        { name: ComplianceItem.name, schema: ComplianceItemSchema },
        { name: DocumentRequest.name, schema: DocumentRequestSchema },
        { name: PracticeInvoice.name, schema: PracticeInvoiceSchema },
        { name: Lead.name, schema: LeadSchema },
        { name: Conversation.name, schema: ConversationSchema },
        { name: CrmMessage.name, schema: CrmMessageSchema },
      ]),
    ],
    providers: [DashboardService, CrmReportsService],
  }).compile();

  dashboard = moduleRef.get(DashboardService);
  reports = moduleRef.get(CrmReportsService);
  orgModel = moduleRef.get(getModelToken(Organization.name));
  complianceModel = moduleRef.get(getModelToken(ComplianceItem.name));
  requestModel = moduleRef.get(getModelToken(DocumentRequest.name));
  invoiceModel = moduleRef.get(getModelToken(PracticeInvoice.name));
  leadModel = moduleRef.get(getModelToken(Lead.name));
  conversationModel = moduleRef.get(getModelToken(Conversation.name));
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));
}, 90_000);

beforeEach(async () => {
  await Promise.all([
    orgModel.deleteMany({}).exec(),
    complianceModel.deleteMany({}).exec(),
    requestModel.deleteMany({}).exec(),
    invoiceModel.deleteMany({}).exec(),
    leadModel.deleteMany({}).exec(),
    conversationModel.deleteMany({}).exec(),
    messageModel.deleteMany({}).exec(),
  ]);
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function seedClient(name = 'Mehta Textiles') {
  return orgModel.create({ firmId: FIRM_ID, name, isActive: true });
}

/**
 * One obligation per (client, type, period) — the Phase 3 unique index enforces
 * that, so the period is derived from the due date rather than fixed.
 */
async function seedCompliance(dueDate: string, status = ComplianceStatus.PENDING, client?: OrganizationDocument) {
  const c = client ?? (await seedClient());
  // Full date, so two obligations in the same month stay distinct.
  const periodKey = dueDate;
  return complianceModel.create({
    firmId: FIRM_ID,
    clientOrgId: c._id,
    clientName: c.name,
    complianceType: ComplianceType.GSTR_3B,
    periodKey,
    periodLabel: periodKey,
    dueDate,
    authority: 'GST Department',
    status,
  });
}

async function seedInvoice(over: Record<string, unknown> = {}) {
  const client = await seedClient('Kumar Constructions');
  return invoiceModel.create({
    firmId: FIRM_ID,
    clientOrgId: client._id,
    clientName: client.name,
    invoiceNumber: `INV-2026-27-${Math.floor(Math.random() * 9000 + 1000)}`,
    financialYear: 'FY2026-27',
    sequence: 1,
    issueDate: '2026-08-01',
    dueDate: '2026-08-10',
    lines: [{ description: 'Fees', amountPaise: 5_000_000 }],
    totalPaise: 5_000_000,
    paidPaise: 0,
    status: PracticeInvoiceStatus.SENT,
    ...over,
  });
}

describe('the empty firm', () => {
  it('reports zeroes rather than inventing numbers', async () => {
    const result = await summary();

    expect(result.clients.total).toBe(0);
    expect(result.deadlines.pending).toBe(0);
    expect(result.fees.billedPaise).toBe(0);
    expect(result.fees.outstandingPaise).toBe(0);
    expect(result.leads.active).toBe(0);
    expect(result.leads.pipelineValuePaise).toBe(0);
    expect(result.agent.autoResolveRate).toBe(0);
    expect(result.recentActivity).toEqual([]);
    // A rate over zero events is 0, not NaN — a dashboard must never show NaN.
    expect(Number.isFinite(result.agent.autoResolveRate)).toBe(true);
  });
});

describe('clients tile', () => {
  it('counts this firm’s active clients only', async () => {
    await seedClient('A');
    await seedClient('B');
    await orgModel.create({ firmId: FIRM_ID, name: 'Dormant', isActive: false });
    await orgModel.create({ firmId: OTHER_FIRM, name: 'Someone Else', isActive: true });

    const result = await summary();
    expect(result.clients.total).toBe(2);
  });
});

describe('deadlines tile', () => {
  it('separates urgent, overdue and upcoming', async () => {
    const client = await seedClient();
    await seedCompliance('2026-08-25', ComplianceStatus.PENDING, client); // 5 days — urgent
    await seedCompliance('2026-09-30', ComplianceStatus.PENDING, client); // upcoming
    await seedCompliance('2026-08-01', ComplianceStatus.PENDING, client); // overdue

    const result = await summary();

    expect(result.deadlines.pending).toBe(3);
    expect(result.deadlines.urgent).toBe(1);
    expect(result.deadlines.overdue).toBe(1);
    // Overdue work is counted but kept out of the "upcoming" list.
    expect(result.deadlines.upcoming.every((u) => u.daysLeft >= 0)).toBe(true);
  });

  it('groups clients under one obligation', async () => {
    // Same obligation, same period, two different clients — permitted by the
    // unique index and exactly what the "14 clients pending" tile counts.
    const a = await seedClient('A');
    const b = await seedClient('B');
    await seedCompliance('2026-08-25', ComplianceStatus.PENDING, a);
    await seedCompliance('2026-08-25', ComplianceStatus.PENDING, b);

    const result = await summary();
    expect(result.deadlines.upcoming).toHaveLength(1);
    expect(result.deadlines.upcoming[0].clientsPending).toBe(2);
  });
});

describe('fees tile', () => {
  it('sums billed, collected and outstanding in integer paise', async () => {
    await seedInvoice({ paidPaise: 2_000_000, status: PracticeInvoiceStatus.PARTIALLY_PAID });
    await seedInvoice();

    const result = await summary();

    expect(result.fees.billedPaise).toBe(10_000_000);
    expect(result.fees.collectedPaise).toBe(2_000_000);
    expect(result.fees.outstandingPaise).toBe(8_000_000);
    expect(Number.isInteger(result.fees.outstandingPaise)).toBe(true);
  });

  it('excludes drafts — nothing has been billed to anyone yet', async () => {
    await seedInvoice({ status: PracticeInvoiceStatus.DRAFT });
    const result = await summary();
    expect(result.fees.billedPaise).toBe(0);
  });

  it('counts distinct clients with something overdue', async () => {
    await seedInvoice({ dueDate: '2026-08-01' });
    await seedInvoice({ dueDate: '2026-08-05' });
    const result = await summary();
    // Two invoices, two different clients seeded by the helper.
    expect(result.fees.clientsOverdue).toBe(2);
  });
});

describe('documents tile', () => {
  it('separates what is still missing from what awaits a human', async () => {
    const client = await seedClient();
    await requestModel.create({
      firmId: FIRM_ID,
      clientOrgId: client._id,
      clientName: client.name,
      purpose: 'ITR filing',
      dueDate: '2026-08-31',
      status: DocumentRequestStatus.OPEN,
      items: [
        { key: 'a', label: 'Form 16', status: ChecklistItemStatus.RECEIVED, autoMatched: true },
        { key: 'b', label: 'PAN card', status: ChecklistItemStatus.PENDING, autoMatched: false },
        { key: 'c', label: 'Aadhaar', status: ChecklistItemStatus.VERIFIED, autoMatched: false },
      ],
    });

    const result = await summary();
    expect(result.documents.openRequests).toBe(1);
    expect(result.documents.itemsOutstanding).toBe(1);
    expect(result.documents.awaitingVerification).toBe(1);
  });
});

describe('leads tile', () => {
  it('values only the open pipeline', async () => {
    await leadModel.create({
      firmId: FIRM_ID, name: 'A', source: LeadSource.WEBSITE,
      stage: LeadStage.NEW, estimatedValuePaise: 2_000_000,
    });
    await leadModel.create({
      firmId: FIRM_ID, name: 'B', source: LeadSource.REFERRAL,
      stage: LeadStage.PROPOSAL_SENT, estimatedValuePaise: 3_000_000,
    });
    // A won lead is revenue, not pipeline.
    await leadModel.create({
      firmId: FIRM_ID, name: 'C', source: LeadSource.REFERRAL,
      stage: LeadStage.WON, estimatedValuePaise: 9_000_000,
    });

    const result = await summary();
    expect(result.leads.active).toBe(2);
    expect(result.leads.pipelineValuePaise).toBe(5_000_000);
    expect(result.leads.won).toBe(1);
  });
});

describe('agent tile', () => {
  it('computes the auto-resolve rate from real counters', async () => {
    await conversationModel.create({
      firmId: FIRM_ID, channel: MessageChannel.WHATSAPP, contactAddress: '900000001',
      status: ConversationStatus.ACTIVE, inboundCount: 3, autoRepliedCount: 3,
    });
    await conversationModel.create({
      firmId: FIRM_ID, channel: MessageChannel.WHATSAPP, contactAddress: '900000002',
      status: ConversationStatus.ESCALATED, inboundCount: 1, autoRepliedCount: 0,
    });

    const result = await summary();
    expect(result.agent.inboundTotal).toBe(4);
    expect(result.agent.autoResolveRate).toBe(75);
    expect(result.agent.escalatedOpen).toBe(1);
  });
});

describe('recent activity', () => {
  it('describes sends in plain language, newest first', async () => {
    await messageModel.create({
      firmId: FIRM_ID, channel: MessageChannel.WHATSAPP, direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT, recipientAddress: '900000001', recipientName: 'Ramesh',
      templateKey: MessageTemplateKey.DOCUMENT_REMINDER, body: 'x', sentAt: new Date(),
    });

    const result = await summary();
    expect(result.recentActivity[0].clientName).toBe('Ramesh');
    expect(result.recentActivity[0].summary).toBe('Chased missing documents');
  });

  it('describes an agent reply by its cause, not its template', async () => {
    // Agent replies and escalation notices both use GENERIC, so the template
    // alone would render the busiest module as a row of "Message sent".
    await messageModel.create({
      firmId: FIRM_ID, channel: MessageChannel.WHATSAPP, direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT, recipientAddress: '900000002', recipientName: 'Suresh',
      templateKey: MessageTemplateKey.GENERIC, body: 'x', sentAt: new Date(),
      cause: { type: 'conversation', id: new Types.ObjectId().toString() },
    });

    const result = await summary();
    expect(result.recentActivity[0].summary).toBe('Answered a client question');
  });
});

describe('reports', () => {
  const build = () => withFirm(FIRM_ID.toString(), () => reports.build(FIRM_ID.toString(), TODAY, 3));

  it('credits collection to the month the money arrived', async () => {
    await seedInvoice({
      issueDate: '2026-06-01',
      paidPaise: 5_000_000,
      status: PracticeInvoiceStatus.PAID,
      payments: [
        { amountPaise: 5_000_000, receivedOn: '2026-08-15', recordedBy: 'x', recordedAt: new Date() },
      ],
    });

    const result = await build();
    const june = result.revenueTrend.find((p) => p.month === '2026-06')!;
    const august = result.revenueTrend.find((p) => p.month === '2026-08')!;

    // Billed in June, collected in August — a firm's cash position depends on
    // the distinction.
    expect(june.billedPaise).toBe(5_000_000);
    expect(june.collectedPaise).toBe(0);
    expect(august.collectedPaise).toBe(5_000_000);
  });

  it('reports a compliance completion rate', async () => {
    const client = await seedClient();
    await seedCompliance('2026-08-01', ComplianceStatus.FILED, client);
    await seedCompliance('2026-08-25', ComplianceStatus.PENDING, client);

    const result = await build();
    expect(result.compliance.filed).toBe(1);
    expect(result.compliance.completionRate).toBe(50);
  });

  it('excludes undecided leads from the conversion rate', async () => {
    await leadModel.create({ firmId: FIRM_ID, name: 'W', source: LeadSource.REFERRAL, stage: LeadStage.WON });
    await leadModel.create({ firmId: FIRM_ID, name: 'L', source: LeadSource.WEBSITE, stage: LeadStage.LOST });
    // Still in play — counting it as a loss would understate a busy pipeline.
    await leadModel.create({ firmId: FIRM_ID, name: 'O', source: LeadSource.WEBSITE, stage: LeadStage.NEW });

    const result = await build();
    expect(result.leads.conversionRate).toBe(50);
  });

  it('returns zeroes, not NaN, for a firm with no history', async () => {
    const result = await build();
    expect(result.compliance.completionRate).toBe(0);
    expect(result.leads.conversionRate).toBe(0);
    expect(result.automation.estimatedHoursSaved).toBe(0);
    expect(result.revenueTrend).toHaveLength(3);
    expect(result.revenueTrend.every((p) => p.billedPaise === 0)).toBe(true);
  });

  it('estimates hours saved from actual automated actions', async () => {
    const client = await seedClient();
    // Three reminders at 4 minutes each = 12 minutes = 0.2 hours.
    await complianceModel.create({
      firmId: FIRM_ID, clientOrgId: client._id, clientName: client.name,
      complianceType: ComplianceType.GSTR_1, periodKey: '2026-07', periodLabel: 'July 2026',
      dueDate: '2026-08-11', authority: 'GST Department', status: ComplianceStatus.PENDING,
      remindersSent: [
        { offsetDays: 7, sentAt: new Date() },
        { offsetDays: 3, sentAt: new Date() },
        { offsetDays: 1, sentAt: new Date() },
      ],
    });

    const result = await build();
    expect(result.automation.remindersSent).toBe(3);
    expect(result.automation.estimatedHoursSaved).toBeCloseTo(0.2, 1);
  });
});
