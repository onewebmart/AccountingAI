/**
 * Unit tests — request body limits.
 *
 *  ✓ Inbound email takes a body with attachments in it
 *  ✓ Every other route still parses JSON, and still refuses an oversized body
 */
import 'reflect-metadata';
import { Body, Controller, HttpCode, INestApplication, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { allowLargeInboundEmail } from './body-limits';

@Controller()
class Echo {
  @Post('inbound/email')
  @HttpCode(200)
  email(@Body() body: { a?: string }) {
    return { len: body?.a?.length ?? 0 };
  }

  @Post('vouchers')
  @HttpCode(200)
  other(@Body() body: { a?: string }) {
    return { len: body?.a?.length ?? 0 };
  }
}

@Module({ controllers: [Echo] })
class EchoModule {}

let app: INestApplication;

beforeAll(async () => {
  app = await NestFactory.create(EchoModule, { rawBody: true, logger: false });
  allowLargeInboundEmail(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const big = { a: 'x'.repeat(1_000_000) };

it('lets an email with attachments through to inbound email', async () => {
  const res = await request(app.getHttpServer()).post('/api/v1/inbound/email').send(big);
  expect([res.status, res.body.len]).toEqual([200, 1_000_000]);
});

it('leaves every other route parsing JSON with the default limit', async () => {
  const small = await request(app.getHttpServer()).post('/api/v1/vouchers').send({ a: 'hi' });
  expect([small.status, small.body.len]).toEqual([200, 2]);
  expect((await request(app.getHttpServer()).post('/api/v1/vouchers').send(big)).status).toBe(413);
});
