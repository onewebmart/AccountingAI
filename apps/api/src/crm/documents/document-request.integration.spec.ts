/**
 * Document collection hub — Phase 4 acceptance criteria.
 *
 * Done when: uploading a client document flips its checklist item and moves the
 * progress bar.
 *
 * Proves:
 *  ✓ a request is built from the service's checklist template
 *  ✓ an upload auto-matches to the right item and lands on RECEIVED, not VERIFIED
 *  ✓ an extracted document type outranks a misleading filename
 *  ✓ nothing matches when the file resembles no outstanding item
 *  ✓ an already-satisfied item is not re-matched by a later upload
 *  ✓ verifying requires the document to have been received first
 *  ✓ reminders list only what is still missing, and skip complete requests
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import {
  ChecklistItemStatus,
  DocumentRequestStatus,
  DocumentType,
  FirmService,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import {
  DocumentRequest,
  DocumentRequestSchema,
  DocumentRequestDocument,
} from '../schemas/document-request.schema';
import { AuditLog, AuditLogSchema } from '../../gl/schemas/audit-log.schema';
import {
  Organization,
  OrganizationSchema,
  OrganizationDocument,
} from '../../tenancy/schemas/organization.schema';
import { Firm, FirmSchema, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from '../messaging/messaging.service';
import { DocumentRequestService, progressOf } from './document-request.service';
import { matchDocumentToItem, templateForService } from './checklist-templates';

const FIRM_ID = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let service: DocumentRequestService;
let requestModel: Model<DocumentRequestDocument>;
let orgModel: Model<OrganizationDocument>;
let messageModel: Model<CrmMessageDocument>;

const fakeQueue = { add: jest.fn() };

async function seedClient(over: Record<string, unknown> = {}) {
  return orgModel.create({
    firmId: FIRM_ID,
    name: 'Mehta Textiles',
    isActive: true,
    whatsappNumber: '9876543210',
    contactName: 'Ramesh Mehta',
    ...over,
  });
}

async function seedRequest(service_: FirmService = FirmService.ITR, client?: OrganizationDocument) {
  const c = client ?? (await seedClient());
  return withFirm(FIRM_ID.toString(), () =>
    service.create({
      firmId: FIRM_ID.toString(),
      clientOrgId: c._id.toString(),
      service: service_,
      dueDate: '2026-08-31',
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
        { name: DocumentRequest.name, schema: DocumentRequestSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: Firm.name, schema: FirmSchema },
      ]),
    ],
    providers: [
      DocumentRequestService,
      MessagingService,
      { provide: getQueueToken(CRM_MESSAGING_QUEUE), useValue: fakeQueue },
    ],
  }).compile();

  service = moduleRef.get(DocumentRequestService);
  requestModel = moduleRef.get(getModelToken(DocumentRequest.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));

  const firmModel = moduleRef.get<Model<FirmDocument>>(getModelToken(Firm.name));
  await firmModel.create({ _id: FIRM_ID, name: 'Sharma & Associates', slug: 'sharma' });
}, 90_000);

beforeEach(async () => {
  jest.clearAllMocks();
  await requestModel.deleteMany({}).exec();
  await messageModel.deleteMany({}).exec();
  await orgModel.deleteMany({}).exec();
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

describe('matchDocumentToItem', () => {
  const itrItems = templateForService(FirmService.ITR)!.items;

  it('matches on a filename fragment', () => {
    expect(matchDocumentToItem(itrItems, 'Form16_2026.pdf')).toBe('form_16');
    expect(matchDocumentToItem(itrItems, 'my-aadhaar-scan.jpg')).toBe('aadhaar');
  });

  it('prefers the extracted type over a misleading filename', () => {
    // Client called their bank statement "form16-final.pdf"; the extractor knows better.
    expect(
      matchDocumentToItem(itrItems, 'form16-final.pdf', DocumentType.BANK_STATEMENT),
    ).toBe('bank_statement');
  });

  it('prefers the longest matching hint', () => {
    const gstItems = templateForService(FirmService.GST_FILING)!.items;
    // "purchase" (8) should beat nothing, and not be shadowed by a shorter hint.
    expect(matchDocumentToItem(gstItems, 'purchase-register-aug.xlsx')).toBe('purchase_bills');
  });

  it('returns null when nothing resembles an outstanding item', () => {
    expect(matchDocumentToItem(itrItems, 'holiday-photo.png')).toBeNull();
  });
});

describe('create', () => {
  it('refuses a client that belongs to a different firm', async () => {
    // Organization is the tenant root and carries no firm scope of its own, so
    // this has to be checked explicitly rather than relying on the plugin.
    const otherFirmsClient = await orgModel.create({
      firmId: new Types.ObjectId(),
      name: 'Someone Else Ltd',
      isActive: true,
    });

    await expect(
      withFirm(FIRM_ID.toString(), () =>
        service.create({
          firmId: FIRM_ID.toString(),
          clientOrgId: otherFirmsClient._id.toString(),
          service: FirmService.ITR,
          dueDate: '2026-08-31',
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('builds the checklist from the service template', async () => {
    const request = await seedRequest(FirmService.ITR);

    expect(request.purpose).toBe('ITR filing');
    expect(request.items.map((i) => i.key)).toEqual(
      templateForService(FirmService.ITR)!.items.map((i) => i.key),
    );
    expect(request.items.every((i) => i.status === ChecklistItemStatus.PENDING)).toBe(true);
    expect(progressOf(request).percent).toBe(0);
  });
});

describe('tryAutoMatch', () => {
  it('flips the item to RECEIVED and moves the progress bar', async () => {
    const client = await seedClient();
    const request = await seedRequest(FirmService.ITR, client);
    const before = progressOf(request).percent;

    const result = await service.tryAutoMatch(
      client._id.toString(),
      new Types.ObjectId().toString(),
      'Form16_Ramesh.pdf',
    );

    expect(result.matched).toBe(true);
    expect(result.itemKey).toBe('form_16');

    const saved = await requestModel.findById(request._id).exec();
    const item = saved!.items.find((i) => i.key === 'form_16')!;

    // RECEIVED, never VERIFIED — a machine guess waits for a human.
    expect(item.status).toBe(ChecklistItemStatus.RECEIVED);
    expect(item.autoMatched).toBe(true);
    expect(item.documentName).toBe('Form16_Ramesh.pdf');
    expect(progressOf(saved!).percent).toBeGreaterThan(before);
  });

  it('does not match a file that resembles nothing outstanding', async () => {
    const client = await seedClient();
    await seedRequest(FirmService.ITR, client);

    const result = await service.tryAutoMatch(
      client._id.toString(),
      new Types.ObjectId().toString(),
      'holiday-photo.png',
    );

    expect(result.matched).toBe(false);
  });

  it('does not re-match an item that is already satisfied', async () => {
    const client = await seedClient();
    const request = await seedRequest(FirmService.ITR, client);

    await service.tryAutoMatch(client._id.toString(), new Types.ObjectId().toString(), 'form16.pdf');
    const second = await service.tryAutoMatch(
      client._id.toString(),
      new Types.ObjectId().toString(),
      'form16-again.pdf',
    );

    expect(second.matched).toBe(false);
    const saved = await requestModel.findById(request._id).exec();
    expect(
      saved!.items.filter((i) => i.status !== ChecklistItemStatus.PENDING),
    ).toHaveLength(1);
  });

  it('marks the request COMPLETE once every item is in', async () => {
    const client = await seedClient();
    const request = await seedRequest(FirmService.GST_FILING, client);

    for (const name of ['sales-register.xlsx', 'purchase-bills.pdf', 'bank-statement.pdf']) {
      await service.tryAutoMatch(client._id.toString(), new Types.ObjectId().toString(), name);
    }

    const saved = await requestModel.findById(request._id).exec();
    expect(saved!.status).toBe(DocumentRequestStatus.COMPLETE);
    expect(progressOf(saved!).percent).toBe(100);
  });
});

describe('verifyItem', () => {
  it('refuses to verify something that was never received', async () => {
    const request = await seedRequest(FirmService.ITR);

    await expect(
      withFirm(FIRM_ID.toString(), () =>
        service.verifyItem(request._id.toString(), 'form_16', ACTOR),
      ),
    ).rejects.toThrow(/not been received/i);
  });

  it('promotes a received item to VERIFIED', async () => {
    const client = await seedClient();
    const request = await seedRequest(FirmService.ITR, client);
    await service.tryAutoMatch(client._id.toString(), new Types.ObjectId().toString(), 'form16.pdf');

    const updated = await withFirm(FIRM_ID.toString(), () =>
      service.verifyItem(request._id.toString(), 'form_16', ACTOR),
    );

    const item = updated.items.find((i) => i.key === 'form_16')!;
    expect(item.status).toBe(ChecklistItemStatus.VERIFIED);
    expect(item.verifiedBy).toBe(ACTOR);
    expect(progressOf(updated).verified).toBe(1);
  });
});

describe('sendReminders', () => {
  it('lists only the still-missing documents', async () => {
    const client = await seedClient();
    await seedRequest(FirmService.ITR, client);
    await service.tryAutoMatch(client._id.toString(), new Types.ObjectId().toString(), 'form16.pdf');

    const result = await withFirm(FIRM_ID.toString(), () =>
      service.sendReminders(FIRM_ID.toString()),
    );

    expect(result.remindersQueued).toBe(1);

    const message = await messageModel.findOne({}).exec();
    expect(message!.templateKey).toBe(MessageTemplateKey.DOCUMENT_REMINDER);
    expect(message!.body).toContain('PAN card');
    // Form 16 is in, so it must not be chased.
    expect(message!.body).not.toContain('Form 16');
    expect(message!.body).toContain('31 Aug 2026');
    expect(message!.body).not.toMatch(/\{\{/);
  });

  it('skips a request with nothing outstanding', async () => {
    const client = await seedClient();
    await seedRequest(FirmService.GST_FILING, client);
    for (const name of ['sales-register.xlsx', 'purchase-bills.pdf', 'bank-statement.pdf']) {
      await service.tryAutoMatch(client._id.toString(), new Types.ObjectId().toString(), name);
    }

    const result = await withFirm(FIRM_ID.toString(), () =>
      service.sendReminders(FIRM_ID.toString()),
    );

    // COMPLETE requests are filtered out before the missing-list check.
    expect(result.remindersQueued).toBe(0);
    expect(await messageModel.countDocuments({}).exec()).toBe(0);
  });

  it('skips a client with no contact details rather than failing the run', async () => {
    const client = await seedClient({ whatsappNumber: undefined, contactEmail: undefined });
    await seedRequest(FirmService.ITR, client);

    const result = await withFirm(FIRM_ID.toString(), () =>
      service.sendReminders(FIRM_ID.toString()),
    );

    expect(result.remindersQueued).toBe(0);
    expect(result.skippedNoContact).toBe(1);
  });
});
