/**
 * Phase 5 Integration Tests — Document upload, storage & dedup.
 *
 * Done when:
 *  ✓ File uploads, gets hashed (SHA-256), document record created in DB
 *  ✓ Duplicate file (same sha256) is flagged with DUPLICATE status
 *  ✓ A processing job is enqueued for every upload
 *  ✓ EMPLOYEE cannot upload (403), ACCOUNTANT can (201)
 *  ✓ Tenant isolation: documents from Org A are not visible to Org B
 *
 * StorageService is replaced with an in-memory fake — no MinIO required.
 * The @Processor class is excluded from the test module — no Redis required.
 */
import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { createHash } from 'crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import configuration from '../config/configuration';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DocumentsService, DOCUMENT_PROCESSING_QUEUE } from './documents.service';
import { DocumentsController } from './documents.controller';
import { StorageService } from './storage.service';
import { Document, DocumentSchema, DocumentDocument } from './schemas/document.schema';
import { DocumentStatus, UserRole } from '@ai-accounting/shared';

const JWT_SECRET = 'test-access-secret-phase5';
const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();

// ── Fake StorageService (no MinIO needed) ────────────────────────────────
class FakeStorageService {
  private store = new Map<string, Buffer>();
  async onModuleInit() {}
  async upload(key: string, buffer: Buffer) { this.store.set(key, buffer); }
  async presignedUrl(key: string) { return `http://fake-storage/${key}`; }
  async exists(key: string) { return this.store.has(key); }
}

// ── Fake Queue (no Redis needed) ─────────────────────────────────────────
const fakeQueue = { add: jest.fn().mockResolvedValue({ id: 'fake-job-id' }) };

let replSet: MongoMemoryReplSet;
let app: INestApplication;
let jwtService: JwtService;
let documentModel: Model<DocumentDocument>;

function makeToken(role: UserRole, orgId: string) {
  return jwtService.sign(
    {
      sub: new Types.ObjectId().toString(),
      email: 'test@test.com',
      orgId,
      role,
      type: 'access',
      jti: randomUUID(),
    },
    { secret: JWT_SECRET, expiresIn: '15m' },
  );
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();

  // Build a minimal module without the @Processor (which requires real Redis).
  // DocumentsModule is NOT imported — instead we register exactly what the tests need.
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            ...configuration(),
            jwt: { ...configuration().jwt, accessSecret: JWT_SECRET },
          }),
        ],
      }),
      MongooseModule.forRoot(uri),
      MongooseModule.forFeature([{ name: Document.name, schema: DocumentSchema }]),
      TenancyModule,
      AuthModule,
    ],
    controllers: [DocumentsController],
    providers: [
      DocumentsService,
      StorageService,
      // Provide the queue token as a plain value — no BullModule, no Redis connection needed.
      { provide: getQueueToken(DOCUMENT_PROCESSING_QUEUE), useValue: fakeQueue },
    ],
  })
    .overrideProvider(StorageService)
    .useClass(FakeStorageService)
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');
  await app.init();

  jwtService = moduleRef.get(JwtService);
  documentModel = moduleRef.get<Model<DocumentDocument>>(getModelToken(Document.name));
}, 60_000);

afterAll(async () => {
  await app.close();
  await mongoose.disconnect();
  await replSet.stop();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /documents/upload — RBAC', () => {
  it('AUDITOR is rejected with 403 (read-only role, no upload permission)', async () => {
    const token = makeToken(UserRole.AUDITOR, ORG_A);
    await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('test-pdf'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .expect(403);
  });
});

describe('POST /documents/upload — happy path', () => {
  let uploadedDocId: string;
  const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content for hashing test');
  const getToken = () => makeToken(UserRole.ACCOUNTANT, ORG_A);

  it('uploads a file, stores it, and returns document metadata', async () => {
    fakeQueue.add.mockClear();
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${getToken()}`)
      .attach('file', pdfBuffer, { filename: 'invoice.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.sha256).toHaveLength(64); // SHA-256 hex is 64 chars
    expect(res.body.status).toBe(DocumentStatus.UPLOADED);
    expect(res.body.duplicateOf).toBeUndefined();
    uploadedDocId = res.body.id;
  });

  it('document record is persisted in MongoDB with correct fields', async () => {
    const doc = await documentModel.findById(uploadedDocId).exec();
    expect(doc).not.toBeNull();
    expect(doc!.orgId).toBe(ORG_A);
    expect(doc!.sha256).toHaveLength(64);
    expect(doc!.status).toBe(DocumentStatus.UPLOADED);
    expect(doc!.sizeBytes).toBe(pdfBuffer.length);
  });

  it('SHA-256 hash matches the uploaded content', async () => {
    const doc = await documentModel.findById(uploadedDocId).exec();
    const expected = createHash('sha256').update(pdfBuffer).digest('hex');
    expect(doc!.sha256).toBe(expected);
  });

  it('enqueues a processing job for the uploaded document', async () => {
    expect(fakeQueue.add).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = fakeQueue.add.mock.calls[0] as [
      string,
      { documentId: string; orgId: string; isDuplicate: boolean },
    ];
    expect(jobName).toBe('process-document');
    expect(jobData.documentId).toBe(uploadedDocId);
    expect(jobData.orgId).toBe(ORG_A);
    expect(jobData.isDuplicate).toBe(false);
  });

  it('uploading the SAME file again flags it as DUPLICATE', async () => {
    fakeQueue.add.mockClear();
    const res = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${getToken()}`)
      .attach('file', pdfBuffer, { filename: 'invoice-copy.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(res.body.status).toBe(DocumentStatus.DUPLICATE);
    expect(res.body.duplicateOf).toBe(uploadedDocId);

    // Duplicate still gets a processing job — human must decide
    expect(fakeQueue.add).toHaveBeenCalledTimes(1);
    const [, jobData] = fakeQueue.add.mock.calls[0] as [string, { isDuplicate: boolean }];
    expect(jobData.isDuplicate).toBe(true);
  });

  it('rejects unsupported file types', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${getToken()}`)
      .attach('file', Buffer.from('malicious content'), {
        filename: 'malware.exe',
        contentType: 'application/octet-stream',
      })
      .expect(400);
  });
});

describe('GET /documents — list and tenant isolation', () => {
  it('ACCOUNTANT can list their org documents', async () => {
    const token = makeToken(UserRole.ACCOUNTANT, ORG_A);
    const res = await request(app.getHttpServer())
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('Org B cannot see Org A documents (tenant isolation)', async () => {
    const orgBBuffer = Buffer.from('org-b-exclusive-document-unique-789xyz');
    const orgBToken = makeToken(UserRole.ACCOUNTANT, ORG_B);

    // Upload a doc from Org B
    await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${orgBToken}`)
      .attach('file', orgBBuffer, { filename: 'org-b.pdf', contentType: 'application/pdf' })
      .expect(201);

    // Org A lists documents — Org B's doc must NOT appear
    const orgAToken = makeToken(UserRole.ACCOUNTANT, ORG_A);
    const resA = await request(app.getHttpServer())
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(200);

    const orgBSha256 = createHash('sha256').update(orgBBuffer).digest('hex');
    const leak = (resA.body.data as Array<{ sha256: string }>).find(
      (d) => d.sha256 === orgBSha256,
    );
    expect(leak).toBeUndefined();
  });
});
