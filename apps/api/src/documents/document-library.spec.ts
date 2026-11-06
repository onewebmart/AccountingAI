/**
 * Integration tests — the Documents area: folders, the library, statements and the pipeline.
 *
 *  ✓ Its routes are not taken by GET /documents/:id (the controller is listed first)
 *  ✓ Folders: create, refuse a second of the same name whatever the case, rename, list with counts
 *  ✓ Files uploads and attached files in a folder, filters by folder, and audits each move in its transaction
 *  ✓ Deleting a folder moves its files to no folder; the files stay
 *  ✓ Another org can neither see, rename, delete nor file into this org's folders and files
 *  ✓ "Associated to": the record a scan was entered as, the bill or voucher a posted one became,
 *    the statement and bank account a statement went to, the file a duplicate repeats, and an attachment's record
 *  ✓ Who uploaded each: a person by name, or the email address it was sent from
 *  ✓ Bank statements: account, period, lines imported, matched, confirmed and unmatched; a failed one with its reason
 *  ✓ The pipeline: reading, ready, couldn't read with the reasons, duplicates, entered today and this week (India time)
 *  ✓ An auditor can read the area but not file anything
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DocumentStatus, MatchStatus, UserRole } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditService } from '../gl/audit.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Document as UploadedDocument, DocumentSchema } from './schemas/document.schema';
import { DocumentFolder, DocumentFolderSchema } from './schemas/document-folder.schema';
import { Attachment, AttachmentSchema } from '../attachments/schemas/attachment.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { OcrResult, OcrResultSchema } from '../ocr/schemas/ocr-result.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { BankStatement, BankStatementSchema } from '../banking/schemas/bank-statement.schema';
import { BankAccount, BankAccountSchema } from '../banking/schemas/bank-account.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { DocumentsController } from './documents.controller';
import { DocumentsService, DOCUMENT_PROCESSING_QUEUE } from './documents.service';
import { StorageService } from './storage.service';
import { DocumentLibraryController } from './document-library.controller';
import { DocumentLibraryService, indiaDayAndWeekStart } from './document-library.service';

const JWT_SECRET = 'test-access-secret-library';

/* eslint-disable @typescript-eslint/no-explicit-any -- test models are read loosely */
let app: INestApplication;
let jwt: JwtService;
let library: DocumentLibraryService;
let documents: Model<any>;
let attachments: Model<any>;
let proposals: Model<any>;
let audit: Model<any>;
let users: Model<any>;
let customers: Model<any>;
let journals: Model<any>;
let bills: Model<any>;
let accounts: Model<any>;
let statements: Model<any>;
let lines: Model<any>;

function token(orgId: string, role = UserRole.ACCOUNTANT, sub = new Types.ObjectId().toString()) {
  return jwt.sign({ sub, email: 't@test.in', orgId, role, type: 'access', jti: randomUUID() }, { secret: JWT_SECRET, expiresIn: '15m' });
}
const http = () => request(app.getHttpServer());
const folderIdOf = async (model: Model<any>, id: unknown) => ((await model.findById(id).lean().exec()) as { folderId?: unknown } | null)?.folderId;

let n = 0;
async function upload(orgId: string, extra: Record<string, unknown> = {}) {
  n += 1;
  const [doc] = await documents.create([
    { orgId, s3Key: `orgs/${orgId}/f${n}.pdf`, originalName: `file-${n}.pdf`, mimeType: 'application/pdf', sizeBytes: 1000 + n, sha256: `sha${n}`.padEnd(64, '0'), status: DocumentStatus.PROPOSED, ...extra },
  ]);
  return doc;
}

beforeAll(async () => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => ({ ...configuration(), jwt: { ...configuration().jwt, accessSecret: JWT_SECRET } })] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: DocumentFolder.name, schema: DocumentFolderSchema },
        { name: Attachment.name, schema: AttachmentSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: OcrResult.name, schema: OcrResultSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: User.name, schema: UserSchema },
        { name: BankStatement.name, schema: BankStatementSchema },
        { name: BankAccount.name, schema: BankAccountSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        // Read by name for "Associated to"; registered here as the app's own modules do.
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Customer.name, schema: CustomerSchema },
      ]),
      TenancyModule,
      AuthModule,
    ],
    // The order DocumentsModule uses: the library's routes before GET /documents/:id.
    controllers: [DocumentLibraryController, DocumentsController],
    providers: [
      DocumentLibraryService,
      DocumentsService,
      AuditService,
      { provide: StorageService, useValue: { upload: jest.fn(), presignedUrl: jest.fn(async (k: string) => `http://files/${k}`), exists: jest.fn(async () => false) } },
      { provide: getQueueToken(DOCUMENT_PROCESSING_QUEUE), useValue: { add: jest.fn().mockResolvedValue({ id: 'job' }) } },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.setGlobalPrefix('api/v1');
  await app.init();

  jwt = moduleRef.get(JwtService);
  library = moduleRef.get(DocumentLibraryService);
  const m = (name: string) => moduleRef.get<Model<any>>(getModelToken(name));
  documents = m(UploadedDocument.name);
  attachments = m(Attachment.name);
  proposals = m(ProposedEntry.name);
  audit = m(AuditLog.name);
  users = m(User.name);
  customers = m(Customer.name);
  journals = m(Journal.name);
  bills = m(PurchaseBill.name);
  accounts = m(BankAccount.name);
  statements = m(BankStatement.name);
  lines = m(BankStatementLine.name);
  // Indexes (the folder name's uniqueness) and collections in place before any transaction writes.
  await Promise.all([documents, attachments, audit, m(DocumentFolder.name)].map((x) => x.init()));
}, 90_000);

afterAll(async () => {
  await app.close();
  await mongoose.disconnect();
});

describe('routes', () => {
  it('serves /documents/pipeline, /library, /statements and /folders rather than reading them as a document id', async () => {
    const t = token(new Types.ObjectId().toString());
    for (const path of ['pipeline', 'library', 'statements', 'folders']) {
      const res = await http().get(`/api/v1/documents/${path}`).set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
    }
  });

  it('DocumentsModule lists the library controller before DocumentsController', async () => {
    const { DocumentsModule } = await import('./documents.module');
    const listed = Reflect.getMetadata('controllers', DocumentsModule) as unknown[];
    expect(listed.indexOf(DocumentLibraryController)).toBeLessThan(listed.indexOf(DocumentsController));
  });
});

describe('folders', () => {
  it('creates, refuses a duplicate name, renames, files uploads and attachments, filters, and deletes', async () => {
    const orgId = new Types.ObjectId().toString();
    const actor = new Types.ObjectId().toString();
    const t = token(orgId, UserRole.ACCOUNTANT, actor);

    const created = await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).send({ name: '  GST   returns ' }).expect(201);
    expect(created.body).toMatchObject({ name: 'GST returns', count: 0 });
    const folderId = created.body.id as string;
    await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).send({ name: 'gst RETURNS' }).expect(409);
    await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).send({ name: '   ' }).expect(400);
    const other = await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).send({ name: 'Rent' }).expect(201);
    await http().patch(`/api/v1/documents/folders/${other.body.id}`).set('Authorization', `Bearer ${t}`).send({ name: 'GST Returns' }).expect(409);
    const renamed = await http().patch(`/api/v1/documents/folders/${folderId}`).set('Authorization', `Bearer ${t}`).send({ name: 'GST filings' }).expect(200);
    expect(renamed.body.name).toBe('GST filings');

    const a = await upload(orgId);
    const b = await upload(orgId);
    const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
    const [file] = await attachments.create([
      { orgId, entityType: 'Customer', entityId: rao._id, fileName: 'agreement.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'x'.repeat(64), storageKey: `orgs/${orgId}/attachments/x.pdf`, uploadedBy: actor },
    ]);

    const moved = await http()
      .post('/api/v1/documents/move')
      .set('Authorization', `Bearer ${t}`)
      .send({ folderId, items: [{ kind: 'document', id: String(a._id) }, { kind: 'attachment', id: String(file._id) }] })
      .expect(200);
    expect(moved.body).toMatchObject({ moved: 2, folder: { id: folderId, name: 'GST filings' } });
    // Moving again into the same folder changes nothing and audits nothing.
    const again = await http().post('/api/v1/documents/move').set('Authorization', `Bearer ${t}`).send({ folderId, items: [{ kind: 'document', id: String(a._id) }] }).expect(200);
    expect(again.body.moved).toBe(0);

    const list = await http().get('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).expect(200);
    expect(list.body.map((f: { name: string; count: number }) => [f.name, f.count])).toEqual([['GST filings', 2], ['Rent', 0]]);

    const inFolder = await http().get(`/api/v1/documents/library?folderId=${folderId}`).set('Authorization', `Bearer ${t}`).expect(200);
    expect(inFolder.body.data.map((r: { key: string }) => r.key).sort()).toEqual([`a:${file._id}`, `d:${a._id}`].sort());
    expect(inFolder.body.data.every((r: { folder: { name: string } }) => r.folder.name === 'GST filings')).toBe(true);
    const unfiled = await http().get('/api/v1/documents/library?folderId=none').set('Authorization', `Bearer ${t}`).expect(200);
    expect(unfiled.body.data.map((r: { key: string }) => r.key)).toEqual([`d:${b._id}`]);

    const moves = await audit.find({ orgId, action: 'MOVE' }).lean().exec();
    expect(moves.map((m) => [m.entityType, m.entityId, m.after.folder]).sort()).toEqual([['Attachment', String(file._id), 'GST filings'], ['Document', String(a._id), 'GST filings']].sort());
    expect(moves[0].performedBy).toBe(actor);

    const deleted = await http().delete(`/api/v1/documents/folders/${folderId}`).set('Authorization', `Bearer ${t}`).expect(200);
    expect(deleted.body).toEqual({ deleted: true, filesMoved: 2 });
    expect(await folderIdOf(documents, a._id)).toBeNull();
    expect(await folderIdOf(attachments, file._id)).toBeNull();
    expect((await http().get('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`)).body.map((f: { name: string }) => f.name)).toEqual(['Rent']);
    await http().get(`/api/v1/documents/library?folderId=${folderId}`).set('Authorization', `Bearer ${t}`).expect(404);

    const trail = (await audit.find({ orgId, entityType: 'DocumentFolder' }).sort({ _id: 1 }).lean().exec()).map((x) => x.action);
    expect(trail).toEqual(['CREATE', 'CREATE', 'RENAME', 'DELETE']);
    expect(await audit.countDocuments({ orgId, action: 'MOVE', 'after.reason': 'Folder GST filings deleted' })).toBe(2);
  });

  it('keeps one org out of another’s folders and files', async () => {
    const orgA = new Types.ObjectId().toString();
    const orgB = new Types.ObjectId().toString();
    const tA = token(orgA);
    const tB = token(orgB);
    const folder = (await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${tA}`).send({ name: 'Private' }).expect(201)).body;
    const doc = await upload(orgA);
    const bFolder = (await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${tB}`).send({ name: 'Private' }).expect(201)).body;

    expect((await http().get('/api/v1/documents/folders').set('Authorization', `Bearer ${tB}`)).body.map((f: { id: string }) => f.id)).toEqual([bFolder.id]);
    await http().patch(`/api/v1/documents/folders/${folder.id}`).set('Authorization', `Bearer ${tB}`).send({ name: 'Mine now' }).expect(404);
    await http().delete(`/api/v1/documents/folders/${folder.id}`).set('Authorization', `Bearer ${tB}`).expect(404);
    await http().get(`/api/v1/documents/library?folderId=${folder.id}`).set('Authorization', `Bearer ${tB}`).expect(404);
    // B cannot file A's document, in B's folder or anywhere.
    await http().post('/api/v1/documents/move').set('Authorization', `Bearer ${tB}`).send({ folderId: bFolder.id, items: [{ kind: 'document', id: String(doc._id) }] }).expect(404);
    await http().post('/api/v1/documents/move').set('Authorization', `Bearer ${tA}`).send({ folderId: bFolder.id, items: [{ kind: 'document', id: String(doc._id) }] }).expect(404);
    expect(await folderIdOf(documents, doc._id)).toBeNull();

    const bLibrary = (await http().get('/api/v1/documents/library').set('Authorization', `Bearer ${tB}`)).body.data;
    expect(bLibrary).toEqual([]);
    // The service, called without an org filter of its own, still sees only the org asked for.
    expect((await library.library(orgB)).data).toEqual([]);
  });

  it('lets an auditor read the area but not file anything', async () => {
    const orgId = new Types.ObjectId().toString();
    const t = token(orgId, UserRole.AUDITOR);
    await http().get('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).expect(200);
    await http().get('/api/v1/documents/pipeline').set('Authorization', `Bearer ${t}`).expect(200);
    await http().post('/api/v1/documents/folders').set('Authorization', `Bearer ${t}`).send({ name: 'Audit' }).expect(403);
    await http().post('/api/v1/documents/move').set('Authorization', `Bearer ${t}`).send({ items: [{ kind: 'document', id: new Types.ObjectId().toString() }] }).expect(403);
  });
});

describe('library: what each document became', () => {
  it('names the record, bill, voucher, statement or original behind each file, and who brought it in', async () => {
    const orgId = new Types.ObjectId().toString();
    const t = token(orgId);
    const [asha] = await users.create([{ email: `asha.${orgId}@example.in`, name: 'Asha Rao' }]);

    const entered = await upload(orgId, {
      status: DocumentStatus.REJECTED,
      uploadedBy: asha._id,
      enteredAs: { entityType: 'DirectExpense', entityId: new Types.ObjectId().toString(), label: 'Expense EXP/2026-27/0009', at: new Date(), by: String(asha._id) },
    });

    // Posted from Review: it became a bill.
    const billed = await upload(orgId, { status: DocumentStatus.APPROVED });
    const journalA = new Types.ObjectId();
    await proposals.collection.insertOne({ orgId, documentId: billed._id, status: 'approved', journalId: journalA, documentType: 'purchase_invoice', vendorName: 'Sharma Gas', invoiceNumber: 'SGP/1342', amountsPaise: { total: 118000 }, createdAt: new Date(), updatedAt: new Date() });
    const bill = await bills.collection.insertOne({ orgId, billNumber: 'SGP/1342', sourceDocumentId: billed._id, journalId: journalA });

    // Posted, no bill or invoice behind it: its voucher.
    const vouchered = await upload(orgId, { status: DocumentStatus.APPROVED });
    const account = new Types.ObjectId();
    const [journal] = await journals.create([
      {
        orgId, voucherType: 'PURCHASE', voucherNumber: 3, financialYear: '2026-27', date: '2026-11-02', postedBy: new Types.ObjectId(), postedAt: new Date(),
        lines: [{ accountId: account, debitPaise: 50000, creditPaise: 0 }, { accountId: new Types.ObjectId(), debitPaise: 0, creditPaise: 50000 }],
      },
    ]);
    await proposals.collection.insertOne({ orgId, documentId: vouchered._id, status: 'approved', journalId: journal._id, documentType: 'receipt', amountsPaise: { total: 50000 }, createdAt: new Date(), updatedAt: new Date() });

    // A statement: imported into banking.
    const [hdfc] = await accounts.create([{ orgId, name: 'Current account', bankName: 'HDFC Bank', accountNumber: '50100012341234' }]);
    const [st] = await statements.create([{ orgId, bankAccountId: hdfc._id, periodStart: '2026-10-01', periodEnd: '2026-10-31', openingBalancePaise: 0, closingBalancePaise: 0, totalLines: 3 }]);
    const stmt = await upload(orgId, {
      status: DocumentStatus.PROPOSED,
      source: { channel: 'email', from: 'accounts@hdfc.example', subject: 'Statement', messageId: 'm1' },
      importSummary: { kind: 'bank_statement', sheets: [{ name: 'PDF statement', kind: 'bank_statement', rowsRead: 3, rowsImported: 3, proposalsCreated: 0, statementId: String(st._id), warnings: [] }], totalRowsImported: 3, totalProposals: 0 },
    });

    const failed = await upload(orgId, { status: DocumentStatus.FAILED, failureReason: 'The AI service has no credit left.' });
    const original = await upload(orgId, { originalName: 'invoice.pdf' });
    const dup = await upload(orgId, { status: DocumentStatus.DUPLICATE, duplicateOf: original._id });
    const reading = await upload(orgId, { status: DocumentStatus.EXTRACTING });

    const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
    const [kept] = await attachments.create([
      { orgId, entityType: 'Customer', entityId: rao._id, fileName: 'agreement.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'y'.repeat(64), storageKey: `orgs/${orgId}/attachments/y.pdf`, uploadedBy: String(asha._id) },
      // The copy "Add to" keeps against the record it entered: the upload's row already says so.
      { orgId, entityType: 'Customer', entityId: rao._id, fileName: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'z'.repeat(64), storageKey: `orgs/${orgId}/zzz.pdf`, uploadedBy: String(asha._id) },
    ]);

    const res = await http().get('/api/v1/documents/library').set('Authorization', `Bearer ${t}`).expect(200);
    const row = (key: string) => res.body.data.find((r: { key: string }) => r.key === key);
    expect(res.body.data).toHaveLength(9);

    expect(row(`d:${entered._id}`)).toMatchObject({ stage: 'entered', associatedTo: { kind: 'record', label: 'Expense EXP/2026-27/0009', entityType: 'DirectExpense' }, uploadedBy: { channel: 'upload', name: 'Asha Rao' } });
    expect(row(`d:${billed._id}`)).toMatchObject({ stage: 'posted', vendor: 'Sharma Gas', totalAmountPaise: 118000, associatedTo: { kind: 'record', label: 'Bill SGP/1342', entityType: 'PurchaseBill', entityId: String(bill.insertedId) } });
    expect(row(`d:${vouchered._id}`)).toMatchObject({ stage: 'posted', associatedTo: { label: 'Journal PUR/2026-27/0003', entityType: 'Journal', entityId: String(journal._id) } });
    expect(row(`d:${stmt._id}`)).toMatchObject({
      stage: 'imported',
      documentType: 'bank_statement',
      uploadedBy: { channel: 'email', name: null, from: 'accounts@hdfc.example' },
      associatedTo: { kind: 'statement', label: 'Bank statement · HDFC Bank ··1234 · 3 lines', entityId: String(st._id), bankAccountId: String(hdfc._id) },
    });
    expect(row(`d:${failed._id}`)).toMatchObject({ stage: 'failed', failureReason: 'The AI service has no credit left.', associatedTo: null });
    expect(row(`d:${dup._id}`)).toMatchObject({ stage: 'duplicate', associatedTo: { kind: 'duplicate', label: 'Same file as invoice.pdf', entityId: String(original._id) } });
    expect(row(`d:${original._id}`)).toMatchObject({ stage: 'ready', associatedTo: { kind: 'review', label: 'Waiting in Review' } });
    expect(row(`d:${reading._id}`)).toMatchObject({ stage: 'reading', associatedTo: null, fileKind: 'pdf' });
    expect(row(`a:${kept._id}`)).toMatchObject({ kind: 'attachment', stage: 'attached', associatedTo: { kind: 'record', label: 'Customer Rao Traders', entityType: 'Customer' }, uploadedBy: { name: 'Asha Rao' } });
  });
});

describe('bank statements', () => {
  it('lists each statement with its account, period and reconciliation, and a failed one with its reason', async () => {
    const orgId = new Types.ObjectId().toString();
    const [sbi] = await accounts.create([{ orgId, name: 'SBI current', bankName: null, accountNumber: '0099887766' }]);
    const [st] = await statements.create([{ orgId, bankAccountId: sbi._id, periodStart: '2026-09-01', periodEnd: '2026-09-30', openingBalancePaise: 0, closingBalancePaise: 0, totalLines: 5 }]);
    const line = (matchStatus: MatchStatus, excluded = false) => ({ orgId, statementId: st._id, bankAccountId: sbi._id, date: '2026-09-02', description: 'NEFT', debitPaise: 100, creditPaise: 0, matchStatus, excluded });
    await lines.create([line(MatchStatus.UNMATCHED), line(MatchStatus.UNMATCHED), line(MatchStatus.AUTO_MATCHED), line(MatchStatus.CONFIRMED), line(MatchStatus.UNMATCHED, true)]);
    await upload(orgId, {
      originalName: 'sbi-sep.xlsx',
      importSummary: { kind: 'bank_statement', sheets: [{ name: 'Sheet1', kind: 'bank_statement', rowsRead: 5, rowsImported: 5, proposalsCreated: 0, statementId: String(st._id), warnings: [] }], totalRowsImported: 5, totalProposals: 0 },
    });
    await upload(orgId, {
      originalName: 'scan.pdf',
      status: DocumentStatus.FAILED,
      failureReason: 'Could not read the layout directly: no balance column.',
      importSummary: { kind: 'bank_statement', sheets: [{ name: 'PDF statement', kind: 'bank_statement', rowsRead: 0, rowsImported: 0, proposalsCreated: 0, statementId: null, warnings: ['Could not read the layout directly: no balance column.'] }], totalRowsImported: 0, totalProposals: 0 },
    });
    await upload(orgId, { originalName: 'bill.pdf' }); // not a statement

    const res = await http().get('/api/v1/documents/statements').set('Authorization', `Bearer ${token(orgId)}`).expect(200);
    expect(res.body).toHaveLength(2);
    const [failed, imported] = res.body;
    expect(imported).toMatchObject({
      fileName: 'sbi-sep.xlsx',
      stage: 'imported',
      statementId: String(st._id),
      bankAccount: { id: String(sbi._id), name: 'SBI current', bankName: null, last4: '7766' },
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      linesImported: 5,
      matched: 1,
      confirmed: 1,
      unmatched: 2,
      excluded: 1,
    });
    expect(failed).toMatchObject({ fileName: 'scan.pdf', stage: 'failed', failureReason: 'Could not read the layout directly: no balance column.', statementId: null, linesImported: 0 });
    // Another org sees none of them.
    expect((await http().get('/api/v1/documents/statements').set('Authorization', `Bearer ${token(new Types.ObjectId().toString())}`)).body).toEqual([]);
    // The inbox list says what an import was, so a statement reads as imported into Banking, not as waiting in Review.
    const listed = (await http().get('/api/v1/documents').set('Authorization', `Bearer ${token(orgId)}`).expect(200)).body.data as Array<{ originalName: string; importKind: string | null }>;
    expect(Object.fromEntries(listed.map((d) => [d.originalName, d.importKind]))).toEqual({ 'sbi-sep.xlsx': 'bank_statement', 'scan.pdf': 'bank_statement', 'bill.pdf': null });
  });
});

describe('pipeline', () => {
  it('starts the day and the week at midnight India time, the week on Monday', () => {
    // Friday 6 Nov 2026, 01:30 in India.
    const { today, week } = indiaDayAndWeekStart(new Date('2026-11-05T20:00:00Z'));
    expect(today.toISOString()).toBe('2026-11-05T18:30:00.000Z');
    expect(week.toISOString()).toBe('2026-11-01T18:30:00.000Z');
  });

  it('counts reading, ready, couldn’t read by reason, duplicates, and entered today and this week', async () => {
    const orgId = new Types.ObjectId().toString();
    const now = new Date('2026-11-05T10:00:00Z'); // Thursday, 15:30 in India
    const at = (iso: string) => ({ entityType: 'PurchaseBill', entityId: new Types.ObjectId().toString(), label: 'Bill', at: new Date(iso), by: 'u' });

    await upload(orgId, { status: DocumentStatus.UPLOADED });
    await upload(orgId, { status: DocumentStatus.CLASSIFYING });
    await upload(orgId, { status: DocumentStatus.PROPOSED });
    await upload(orgId, { status: DocumentStatus.EXTRACTED });
    // A statement and a spreadsheet whose rows went straight in wait in Banking, not Review.
    await upload(orgId, { status: DocumentStatus.PROPOSED, importSummary: { kind: 'bank_statement', sheets: [], totalRowsImported: 4, totalProposals: 0 } });
    await upload(orgId, { status: DocumentStatus.PROPOSED, importSummary: { kind: 'sales_register', sheets: [], totalRowsImported: 6, totalProposals: 6 } });
    await upload(orgId, { status: DocumentStatus.FAILED, failureReason: 'The AI service has no credit left.' });
    await upload(orgId, { status: DocumentStatus.FAILED, failureReason: 'The AI service has no credit left.' });
    await upload(orgId, { status: DocumentStatus.FAILED, failureReason: 'The page is blank.' });
    // Couldn't be read, then entered by hand this morning: no longer waiting.
    await upload(orgId, { status: DocumentStatus.FAILED, failureReason: 'The page is blank.', enteredAs: at('2026-11-05T04:00:00Z') });
    await upload(orgId, { status: DocumentStatus.DUPLICATE });
    await upload(orgId, { status: DocumentStatus.REJECTED, enteredAs: at('2026-11-03T06:00:00Z') }); // Tuesday
    await upload(orgId, { status: DocumentStatus.REJECTED, enteredAs: at('2026-10-30T06:00:00Z') }); // last week
    // Approved in Review: today, and on Monday.
    for (const [iso, docs] of [['2026-11-05T05:00:00Z', 1], ['2026-11-02T05:00:00Z', 1]] as const) {
      for (let i = 0; i < docs; i++) {
        const d = await upload(orgId, { status: DocumentStatus.APPROVED });
        await proposals.collection.insertOne({ orgId, documentId: d._id, status: 'approved', createdAt: new Date(iso), updatedAt: new Date(iso) });
      }
    }
    // Two proposals from one spreadsheet, approved today, are one document.
    const sheet = await upload(orgId, { status: DocumentStatus.APPROVED });
    await proposals.collection.insertMany([0, 1].map(() => ({ orgId, documentId: sheet._id, status: 'approved', updatedAt: new Date('2026-11-05T06:00:00Z') })));
    // Another org's document is not counted.
    await upload(new Types.ObjectId().toString(), { status: DocumentStatus.FAILED, failureReason: 'The AI service has no credit left.' });

    const p = await library.pipeline(orgId, now);
    expect(p).toEqual({
      total: 16,
      reading: 2,
      readyForReview: 3,
      couldNotRead: { count: 3, reasons: [{ reason: 'The AI service has no credit left.', count: 2 }, { reason: 'The page is blank.', count: 1 }] },
      duplicates: 1,
      waiting: 6,
      entered: { today: 3, thisWeek: 5 },
    });
  });
});
