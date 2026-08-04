/**
 * RBAC Integration Test — Phase 3 acceptance criteria.
 *
 * Proves: the PermissionGuard enforces the role-permission matrix server-side.
 * Key assertion: an Employee-role JWT is rejected (403) when calling the
 * POST /journals endpoint, while an Accountant-role JWT gets past the guard.
 *
 * These tests are about authorisation, not posting semantics. An empty body now
 * reaches the controller's own validation and comes back 400 — which is itself
 * proof the guard let the request through, where a blocked role never would.
 *
 * "The server is the enforcer — UI hiding is convenience, not security."
 */
import 'reflect-metadata';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import configuration from './config/configuration';
import { AuthModule } from './auth/auth.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { JournalsModule } from './journals/journals.module';
import { UserRole } from '@ai-accounting/shared';

let replSet: MongoMemoryReplSet;
let app: INestApplication;
let jwtService: JwtService;

const JWT_SECRET = 'test-access-secret-phase3';

function makeAccessToken(role: UserRole, orgId = 'test-org-id'): string {
  return jwtService.sign(
    {
      sub: new mongoose.Types.ObjectId().toString(),
      email: `${role.toLowerCase()}@test.com`,
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

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            ...configuration(),
            jwt: {
              ...configuration().jwt,
              accessSecret: JWT_SECRET,
            },
          }),
        ],
      }),
      MongooseModule.forRoot(uri),
      TenancyModule,
      AuthModule,
      JournalsModule,
    ],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');
  await app.init();

  jwtService = moduleFixture.get<JwtService>(JwtService);
}, 60_000);

afterAll(async () => {
  await app.close();
  await mongoose.disconnect();
  await replSet.stop();
});

describe('RBAC — POST /journals (requires journal:post permission)', () => {
  it('EMPLOYEE role is rejected with 403 Forbidden', async () => {
    const token = makeAccessToken(UserRole.EMPLOYEE);
    await request(app.getHttpServer())
      .post('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
  });

  it('AUDITOR role is rejected with 403 Forbidden', async () => {
    const token = makeAccessToken(UserRole.AUDITOR);
    await request(app.getHttpServer())
      .post('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
  });

  it('CA_REVIEWER role is rejected with 403 Forbidden', async () => {
    const token = makeAccessToken(UserRole.CA_REVIEWER);
    await request(app.getHttpServer())
      .post('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
  });

  it('ACCOUNTANT role passes the permission guard', async () => {
    const token = makeAccessToken(UserRole.ACCOUNTANT);
    await request(app.getHttpServer())
      .post('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400); // through the guard, stopped by voucher validation
  });

  it('COMPANY_ADMIN role passes the permission guard', async () => {
    const token = makeAccessToken(UserRole.COMPANY_ADMIN);
    await request(app.getHttpServer())
      .post('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('unauthenticated request is rejected with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/journals')
      .send({})
      .expect(401);
  });
});

describe('RBAC — GET /journals (requires journal:view permission)', () => {
  it('EMPLOYEE role is rejected with 403', async () => {
    const token = makeAccessToken(UserRole.EMPLOYEE);
    await request(app.getHttpServer())
      .get('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('ACCOUNTANT role can view journals', async () => {
    const token = makeAccessToken(UserRole.ACCOUNTANT);
    await request(app.getHttpServer())
      .get('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('AUDITOR role can view journals (read-only access)', async () => {
    const token = makeAccessToken(UserRole.AUDITOR);
    await request(app.getHttpServer())
      .get('/api/v1/journals')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
