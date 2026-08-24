/**
 * Compliance tracker — Phase 3 acceptance criteria.
 *
 * Done when: a deadline auto-appears for the right clients and a dated reminder
 * lands in the outbox.
 *
 * Proves:
 *  ✓ obligations are generated only for clients whose services make them liable
 *  ✓ ROC obligations skip unincorporated clients
 *  ✓ regenerating is a no-op — no duplicate obligations
 *  ✓ reminders fire at exactly 7 / 3 / 1 days out and nowhere in between
 *  ✓ a client is never reminded twice for the same deadline at the same offset
 *  ✓ filed items stop being chased
 *  ✓ a client with no contact details is skipped, not crashed on
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { testMongoUri } from '../../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import {
  ClientType,
  ComplianceStatus,
  ComplianceType,
  FirmService,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import {
  ComplianceItem,
  ComplianceItemSchema,
  ComplianceItemDocument,
} from '../schemas/compliance-item.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import {
  Organization,
  OrganizationSchema,
  OrganizationDocument,
} from '../../tenancy/schemas/organization.schema';
import { Firm, FirmSchema, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from '../messaging/messaging.service';
import { ComplianceService } from './compliance.service';

const FIRM_ID = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();

// Fixed clock so due-date arithmetic is deterministic.
const TODAY = '2026-08-01';

let moduleRef: TestingModule;
let compliance: ComplianceService;
let itemModel: Model<ComplianceItemDocument>;
let orgModel: Model<OrganizationDocument>;
let messageModel: Model<CrmMessageDocument>;

const fakeQueue = { add: jest.fn() };

async function seedClient(over: Partial<Record<string, unknown>> = {}) {
  return orgModel.create({
    firmId: FIRM_ID,
    name: 'Test Client',
    isActive: true,
    services: [FirmService.GST_FILING],
    clientType: ClientType.PROPRIETORSHIP,
    whatsappNumber: '9876543210',
    ...over,
  });
}

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: CrmMessage.name, schema: CrmMessageSchema },
        { name: ComplianceItem.name, schema: ComplianceItemSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: Firm.name, schema: FirmSchema },
      ]),
    ],
    providers: [
      ComplianceService,
      MessagingService,
      { provide: getQueueToken(CRM_MESSAGING_QUEUE), useValue: fakeQueue },
    ],
  }).compile();

  compliance = moduleRef.get(ComplianceService);
  itemModel = moduleRef.get(getModelToken(ComplianceItem.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));

  const firmModel = moduleRef.get<Model<FirmDocument>>(getModelToken(Firm.name));
  await firmModel.create({ _id: FIRM_ID, name: 'Sharma & Associates', slug: 'sharma' });

  // The unique index is what makes regeneration idempotent — build it explicitly
  // rather than relying on autoIndex timing.
  await itemModel.syncIndexes();
}, 90_000);

beforeEach(async () => {
  jest.clearAllMocks();
  await itemModel.deleteMany({}).exec();
  await messageModel.deleteMany({}).exec();
  await orgModel.deleteMany({}).exec();
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('generateForFirm', () => {
  it('creates GST obligations for a client subscribed to GST filing', async () => {
    await seedClient({ name: 'Gupta Hardware' });

    const result = await withFirm(FIRM_ID.toString(), () =>
      compliance.generateForFirm(FIRM_ID.toString(), TODAY),
    );

    expect(result.clientsConsidered).toBe(1);
    expect(result.created).toBeGreaterThan(0);

    const types = await itemModel.distinct('complianceType').exec();
    expect(types).toEqual(expect.arrayContaining([ComplianceType.GSTR_1, ComplianceType.GSTR_3B]));
    // Not subscribed to TDS/ITR/ROC, so none of those.
    expect(types).not.toContain(ComplianceType.TDS_RETURN);
    expect(types).not.toContain(ComplianceType.ROC_MGT_7);
  });

  it('skips ROC filings for an unincorporated client', async () => {
    await seedClient({
      name: 'Priya Sharma',
      clientType: ClientType.INDIVIDUAL,
      services: [FirmService.ROC_MCA, FirmService.ITR],
    });

    await withFirm(FIRM_ID.toString(), () =>
      compliance.generateForFirm(FIRM_ID.toString(), TODAY),
    );

    const roc = await itemModel.countDocuments({ complianceType: ComplianceType.ROC_MGT_7 }).exec();
    expect(roc).toBe(0);
  });

  it('creates ROC filings for a private limited company', async () => {
    await seedClient({
      name: 'Kumar Constructions',
      clientType: ClientType.PRIVATE_LIMITED,
      services: [FirmService.ROC_MCA],
    });

    await withFirm(FIRM_ID.toString(), () =>
      compliance.generateForFirm(FIRM_ID.toString(), TODAY),
    );

    const roc = await itemModel.countDocuments({ complianceType: ComplianceType.ROC_MGT_7 }).exec();
    expect(roc).toBeGreaterThan(0);
  });

  it('is idempotent — a second run creates nothing new', async () => {
    await seedClient();

    const first = await withFirm(FIRM_ID.toString(), () =>
      compliance.generateForFirm(FIRM_ID.toString(), TODAY),
    );
    const countAfterFirst = await itemModel.countDocuments({}).exec();

    const second = await withFirm(FIRM_ID.toString(), () =>
      compliance.generateForFirm(FIRM_ID.toString(), TODAY),
    );

    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(first.created);
    expect(await itemModel.countDocuments({}).exec()).toBe(countAfterFirst);
  });

  it('ignores inactive clients', async () => {
    await seedClient({ name: 'Dormant Co', isActive: false });

    const result = await withFirm(FIRM_ID.toString(), () =>
      compliance.generateForFirm(FIRM_ID.toString(), TODAY),
    );

    expect(result.clientsConsidered).toBe(0);
    expect(result.created).toBe(0);
  });
});

describe('runDueReminders', () => {
  async function seedItem(dueDate: string, over: Partial<Record<string, unknown>> = {}) {
    const client = await seedClient();
    return itemModel.create({
      firmId: FIRM_ID,
      clientOrgId: client._id,
      clientName: client.name,
      complianceType: ComplianceType.GSTR_3B,
      periodKey: '2026-07',
      periodLabel: 'July 2026',
      dueDate,
      authority: 'GST Department',
      status: ComplianceStatus.PENDING,
      ...over,
    });
  }

  it('reminds at exactly 7 days out and writes a rendered message to the outbox', async () => {
    await seedItem('2026-08-08'); // TODAY + 7

    const run = await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(1);

    const message = await messageModel.findOne({}).exec();
    expect(message).not.toBeNull();
    expect(message!.templateKey).toBe(MessageTemplateKey.COMPLIANCE_DEADLINE);
    expect(message!.recipientAddress).toBe('9876543210');
    // Client-facing copy uses a readable date, not the stored ISO form.
    expect(message!.body).toContain('08 Aug 2026');
    expect(message!.body).not.toContain('2026-08-08');
    expect(message!.body).toContain('7');
    expect(message!.body).not.toMatch(/\{\{/);
    expect(message!.cause?.type).toBe('complianceItem');
  });

  it('does not remind on a day that is not an offset', async () => {
    await seedItem('2026-08-06'); // TODAY + 5 — between the 7 and 3 day marks

    const run = await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(0);
    expect(await messageModel.countDocuments({}).exec()).toBe(0);
  });

  it('never reminds twice for the same deadline at the same offset', async () => {
    await seedItem('2026-08-08');

    await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );
    // The daily sweep runs again; the client must not get a second copy.
    const second = await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );

    expect(second.remindersQueued).toBe(0);
    expect(await messageModel.countDocuments({}).exec()).toBe(1);
  });

  it('reminds again at the next offset as the deadline approaches', async () => {
    const item = await seedItem('2026-08-08');

    await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );
    // Four days later the same deadline is now 3 days out.
    await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), '2026-08-05'),
    );

    const saved = await itemModel.findById(item._id).exec();
    expect(saved!.remindersSent.map((r) => r.offsetDays).sort()).toEqual([3, 7]);
    expect(await messageModel.countDocuments({}).exec()).toBe(2);
  });

  it('stops chasing an item once it is filed', async () => {
    await seedItem('2026-08-08', { status: ComplianceStatus.FILED });

    const run = await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(0);
  });

  it('skips a client with no contact details instead of failing the run', async () => {
    const client = await seedClient({
      name: 'No Contact Ltd',
      whatsappNumber: undefined,
      contactEmail: undefined,
    });
    await itemModel.create({
      firmId: FIRM_ID,
      clientOrgId: client._id,
      clientName: client.name,
      complianceType: ComplianceType.GSTR_3B,
      periodKey: '2026-07',
      periodLabel: 'July 2026',
      dueDate: '2026-08-08',
      authority: 'GST Department',
      status: ComplianceStatus.PENDING,
    });

    const run = await withFirm(FIRM_ID.toString(), () =>
      compliance.runDueReminders(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(0);
    expect(run.skippedNoContact).toBe(1);
  });
});

describe('listDeadlines', () => {
  it('groups clients under one obligation and counts pending vs filed', async () => {
    const a = await seedClient({ name: 'Client A' });
    const b = await seedClient({ name: 'Client B' });

    for (const [client, status] of [
      [a, ComplianceStatus.PENDING],
      [b, ComplianceStatus.FILED],
    ] as const) {
      await itemModel.create({
        firmId: FIRM_ID,
        clientOrgId: client._id,
        clientName: client.name,
        complianceType: ComplianceType.GSTR_3B,
        periodKey: '2026-07',
        periodLabel: 'July 2026',
        dueDate: '2026-08-20',
        authority: 'GST Department',
        status,
      });
    }

    const groups = await withFirm(FIRM_ID.toString(), () =>
      compliance.listDeadlines({ today: TODAY }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].pendingCount).toBe(1);
    expect(groups[0].filedCount).toBe(1);
    expect(groups[0].clients).toHaveLength(2);
    expect(groups[0].daysLeft).toBe(19);
  });
});
