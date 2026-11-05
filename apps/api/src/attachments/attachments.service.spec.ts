/**
 * Integration tests — files attached to records.
 *
 *  ✓ Attaches to this org's own record, stored once by hash under the org's prefix
 *  ✓ Refuses another org's record, an unknown record type, and file types we do not keep
 *  ✓ Lists, links and removes; removal hides it and both are audited on the record
 *  ✓ Lists every live file in the org for the documents library, an expense's receipt included
 *  ✓ Keeps a scanned document against the record entered from it, once, and closes its proposal
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AttachmentsService } from './attachments.service';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';
import { StorageService } from '../documents/storage.service';
import { AuditService } from '../gl/audit.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { ProposalsService } from '../proposals/proposals.service';

const ACTOR = new Types.ObjectId().toString();
const stored = new Map<string, Buffer>();
const storage = {
  exists: jest.fn(async (key: string) => stored.has(key)),
  upload: jest.fn(async (key: string, buffer: Buffer) => void stored.set(key, buffer)),
  presignedUrl: jest.fn(async (key: string) => `https://files.example/${key}?sig=1`),
};

const proposals = { reject: jest.fn(async () => undefined) };
let moduleRef: TestingModule;
let attachments: AttachmentsService;
let audit: Model<{ action: string; entityId: string; after: Record<string, unknown> }>;
let customers: Model<{ _id: Types.ObjectId }>;
let users: Model<{ _id: Types.ObjectId }>;
let expenses: Model<{ _id: Types.ObjectId }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Attachment.name, schema: AttachmentSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PartyPayment.name, schema: PartyPaymentSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: User.name, schema: UserSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
      ]),
    ],
    providers: [AttachmentsService, AuditService, { provide: StorageService, useValue: storage }, { provide: ProposalsService, useValue: proposals }],
  }).compile();
  attachments = moduleRef.get(AttachmentsService);
  audit = moduleRef.get(getModelToken(AuditLog.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  users = moduleRef.get(getModelToken(User.name));
  expenses = moduleRef.get(getModelToken(DirectExpense.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const pdf = Buffer.from('%PDF-1.4 agreement');

describe('attachments', () => {
  it('attaches, lists, links and removes, audited on the record', async () => {
    const orgId = new Types.ObjectId().toString();
    const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
    const id = String(rao._id);

    const first = await attachments.add(orgId, ACTOR, { entityType: 'Customer', entityId: id, fileName: 'Rate agreement.pdf', mimeType: 'application/pdf', buffer: pdf });
    expect(first).toMatchObject({ fileName: 'Rate agreement.pdf', sizeBytes: pdf.length });
    await attachments.add(orgId, ACTOR, { entityType: 'Customer', entityId: id, fileName: 'copy.pdf', mimeType: 'application/pdf', buffer: pdf });
    // The same bytes are stored once, under this org's prefix.
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0][0]).toMatch(new RegExp(`^orgs/${orgId}/attachments/[a-f0-9]{64}\\.pdf$`));

    expect((await attachments.list(orgId, 'Customer', id)).map((a) => a.fileName).sort()).toEqual(['Rate agreement.pdf', 'copy.pdf']);
    expect((await attachments.url(orgId, first.id)).url).toMatch(/^https:\/\/files\.example\//);

    await attachments.remove(orgId, ACTOR, first.id);
    expect((await attachments.list(orgId, 'Customer', id)).map((a) => a.fileName)).toEqual(['copy.pdf']);
    await expect(attachments.url(orgId, first.id)).rejects.toThrow(/not found/);
    expect((await audit.find({ orgId, entityId: id }).lean().exec()).map((a) => a.action).sort()).toEqual(['ATTACH', 'ATTACH', 'DETACH']);
  });

  it('refuses another org’s record, unknown types, and files we do not keep', async () => {
    const orgId = new Types.ObjectId().toString();
    const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
    const other = new Types.ObjectId().toString();
    await expect(attachments.add(other, ACTOR, { entityType: 'Customer', entityId: String(rao._id), fileName: 'a.pdf', mimeType: 'application/pdf', buffer: pdf })).rejects.toThrow(/Record not found/);
    await expect(attachments.add(orgId, ACTOR, { entityType: 'User', entityId: String(rao._id), fileName: 'a.pdf', mimeType: 'application/pdf', buffer: pdf })).rejects.toThrow(/can be attached to/);
    await expect(attachments.add(orgId, ACTOR, { entityType: 'Customer', entityId: String(rao._id), fileName: 'run.exe', mimeType: 'application/octet-stream', buffer: pdf })).rejects.toThrow(/Attach a PDF/);
    await expect(attachments.list(other, 'Customer', String(rao._id))).resolves.toEqual([]);
  });

  it('lists every live file in the org, with its record and who added it', async () => {
    const orgId = new Types.ObjectId().toString();
    const [asha] = await users.create([{ email: `asha.${orgId}@example.in`, name: 'Asha Rao' }]);
    const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
    // A stand-in expense: only that it is this org's record matters here.
    const expenseId = new Types.ObjectId();
    await expenses.collection.insertOne({ _id: expenseId, orgId });

    const rates = await attachments.add(orgId, String(asha._id), { entityType: 'Customer', entityId: String(rao._id), fileName: 'Rates.pdf', mimeType: 'application/pdf', buffer: pdf });
    const receipt = await attachments.add(orgId, String(asha._id), { entityType: 'DirectExpense', entityId: String(expenseId), fileName: 'Fuel receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg bytes') });
    await attachments.remove(orgId, ACTOR, rates.id);

    expect(await attachments.listAll(orgId)).toEqual([
      expect.objectContaining({ id: receipt.id, fileName: 'Fuel receipt.jpg', entityType: 'DirectExpense', entityId: String(expenseId), uploadedByName: 'Asha Rao' }),
    ]);
    expect(await attachments.listAll(new Types.ObjectId().toString())).toEqual([]);
  });

  it('keeps a scanned document against the record entered from it, once, and closes its proposal', async () => {
    const orgId = new Types.ObjectId().toString();
    const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
    const docs = moduleRef.get<Model<{ _id: Types.ObjectId; enteredAs?: { entityType: string; label: string } | null }>>(getModelToken(UploadedDocument.name));
    const [scan] = await docs.create([{ orgId, s3Key: `orgs/${orgId}/documents/abc.pdf`, originalName: 'invoice-01.pdf', mimeType: 'application/pdf', sizeBytes: 887, sha256: 'a'.repeat(64) }]);
    const proposalId = new Types.ObjectId();
    await moduleRef.get<Model<unknown>>(getModelToken(ProposedEntry.name)).collection.insertOne({ _id: proposalId, orgId, documentId: scan._id, status: 'proposed' });

    const kept = await attachments.fromDocument(orgId, ACTOR, { documentId: String(scan._id), entityType: 'Customer', entityId: String(rao._id), label: 'Customer Rao Traders' });
    expect(kept).toMatchObject({ fileName: 'invoice-01.pdf', sizeBytes: 887, proposalClosed: true });
    expect(proposals.reject).toHaveBeenCalledWith({ proposalId: String(proposalId), orgId, actorId: ACTOR, reason: 'Entered by hand as Customer Rao Traders' });
    expect((await docs.findById(scan._id).lean().exec())!.enteredAs).toMatchObject({ entityType: 'Customer', label: 'Customer Rao Traders' });
    // The file is the scan's own, not a copy.
    expect((await attachments.url(orgId, kept.id)).url).toContain(`orgs/${orgId}/documents/abc.pdf`);
    expect((await attachments.list(orgId, 'Customer', String(rao._id))).map((a) => a.fileName)).toEqual(['invoice-01.pdf']);

    await expect(attachments.fromDocument(orgId, ACTOR, { documentId: String(scan._id), entityType: 'Customer', entityId: String(rao._id), label: 'again' })).rejects.toThrow(/already entered as Customer Rao Traders/);
    await expect(attachments.fromDocument(new Types.ObjectId().toString(), ACTOR, { documentId: String(scan._id), entityType: 'Customer', entityId: String(rao._id), label: 'x' })).rejects.toThrow(/Record not found/);
  });
});
