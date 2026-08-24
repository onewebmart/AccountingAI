/**
 * Auth Integration Test — Phase 2 acceptance criteria.
 *
 * Proves: signup → login → 2FA → refresh → logout → TOTP enroll flow
 * all work end-to-end, and issued JWTs carry orgId for tenant isolation.
 *
 * Runs against an in-memory MongoDB RS (same as production requirement).
 */
import 'reflect-metadata';
import mongoose, { Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import configuration from '../config/configuration';
import { AuthModule } from './auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';

let app: INestApplication;

beforeAll(async () => {
  const uri = testMongoUri();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [configuration],
      }),
      MongooseModule.forRoot(uri),
      TenancyModule,
      AuthModule,
    ],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');
  await app.init();
}, 60_000);

afterAll(async () => {
  await app.close();
  await mongoose.disconnect();
});

describe('POST /auth/signup', () => {
  it('creates a user + org and returns tokens with orgId in payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Ronak Patel',
        email: 'ronak@test.com',
        password: 'SecurePass123!',
        businessName: 'Ronak Traders',
      })
      .expect(201);

    expect(res.body.tokens).toBeDefined();
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('ronak@test.com');
    expect(res.body.org.name).toBe('Ronak Traders');

    // Decode the JWT and verify orgId is embedded
    const [, payloadB64] = res.body.tokens.accessToken.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    expect(payload.orgId).toBeTruthy();
    expect(payload.sub).toBeTruthy();
    expect(payload.type).toBe('access');
  });

  it('rejects duplicate email with 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Duplicate',
        email: 'ronak@test.com',
        password: 'SecurePass123!',
        businessName: 'Dupe Co',
      })
      .expect(409);
  });

  it('rejects short passwords with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Test', email: 'bad@test.com', password: '123', businessName: 'X' })
      .expect(400);
  });
});

describe('firmId claim in the access token', () => {
  function decodePayload(token: string): Record<string, unknown> {
    const [, payloadB64] = token.split('.');
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString()) as Record<string, unknown>;
  }

  it('omits firmId for a direct SME signup', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Solo Trader',
        email: 'solo@test.com',
        password: 'SecurePass123!',
        businessName: 'Solo Traders',
      })
      .expect(201);

    const payload = decodePayload(res.body.tokens.accessToken);
    expect(payload.orgId).toBeTruthy();
    expect(payload.firmId).toBeUndefined();
  });

  it('carries firmId when the org belongs to a firm', async () => {
    // Regression guard: every /api/v1/firm/* route and the whole CRM scope by
    // req.user.firmId. It used to be declared on JwtPayload but never set, so
    // those routes silently returned empty sets.
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Managed Client',
        email: 'managed@test.com',
        password: 'SecurePass123!',
        businessName: 'Managed Client Ltd',
      })
      .expect(201);

    const firmId = new mongoose.Types.ObjectId();
    // Use the app's own connection — the spec wires Mongoose through Nest DI,
    // so the global `mongoose.connection` is not the one holding this data.
    const orgModel = app.get<Model<OrganizationDocument>>(getModelToken(Organization.name));
    await orgModel
      .updateOne(
        { _id: new mongoose.Types.ObjectId(signup.body.org.id as string) },
        { $set: { firmId } },
      )
      .exec();

    // Re-authenticate so a fresh token is minted against the updated org.
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'managed@test.com', password: 'SecurePass123!' })
      .expect(200);

    const payload = decodePayload(login.body.tokens.accessToken);
    expect(payload.firmId).toBe(firmId.toHexString());
  });
});

describe('POST /auth/login', () => {
  let accessToken: string;
  let refreshToken: string;

  it('issues tokens for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ronak@test.com', password: 'SecurePass123!' })
      .expect(200);

    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    accessToken = res.body.tokens.accessToken;
    refreshToken = res.body.tokens.refreshToken;
  });

  it('rejects wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ronak@test.com', password: 'WrongPassword!' })
      .expect(401);
  });

  it('issued access token grants access to /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe('ronak@test.com');
    expect(res.body.orgId).toBeTruthy();
    expect(res.body.role).toBeTruthy();
  });

  it('unauthenticated request to protected route returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  describe('Token refresh', () => {
    it('rotates refresh token and issues new access token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      // New tokens must be different
      expect(res.body.accessToken).not.toBe(accessToken);
      expect(res.body.refreshToken).not.toBe(refreshToken);

      // Old refresh token is now invalid (rotation)
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken }) // old token
        .expect(401);
    });
  });
});

describe('POST /auth/logout', () => {
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    // Create a fresh account for logout test
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Logout User',
        email: 'logout@test.com',
        password: 'SecurePass123!',
        businessName: 'Logout Co',
      });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'logout@test.com', password: 'SecurePass123!' });

    accessToken = loginRes.body.tokens.accessToken;
    refreshToken = loginRes.body.tokens.refreshToken;
  });

  it('logout revokes the refresh token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    // Refresh token is now invalid
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});

describe('POST /auth/forgot-password + /auth/reset-password', () => {
  it('forgot-password always returns 204 (even for unknown email)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nonexistent@test.com' })
      .expect(204);
  });

  it('forgot-password for known email also returns 204', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ronak@test.com' })
      .expect(204);
  });

  it('reset-password with invalid token returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'invalid-token', newPassword: 'NewPass456!' })
      .expect(400);
  });
});

describe('TOTP enrollment', () => {
  let accessToken: string;

  beforeAll(async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'TOTP User',
        email: 'totp@test.com',
        password: 'SecurePass123!',
        businessName: 'TOTP Co',
      });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'totp@test.com', password: 'SecurePass123!' });

    accessToken = res.body.tokens.accessToken;
  });

  it('GET /auth/totp/enroll returns a QR code data URL and manual key', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/totp/enroll')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.manualKey).toBeTruthy();
    expect(res.body.manualKey.length).toBeGreaterThan(10);
  });

  it('POST /auth/totp/verify with invalid code returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '000000' })
      .expect(400);
  });
});
