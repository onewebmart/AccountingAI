import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';

/**
 * Inbound email arrives as JSON with every attachment base64-encoded inside
 * it, far past the 100 KB default; Postmark allows messages up to 35 MB.
 * Every other route keeps the default.
 *
 * Call before the app initialises, so this runs ahead of Nest's own parsers,
 * which then leave the body alone. Wrapped in a named function because Nest
 * skips its JSON parser for every route if it finds a middleware already
 * named jsonParser, which is the name body-parser gives its own.
 */
export function allowLargeInboundEmail(app: INestApplication, prefix = '/api/v1'): void {
  const parse = json({ limit: '40mb' });
  app.use(`${prefix}/inbound/email`, function inboundEmailBody(req: Request, res: Response, next: NextFunction) {
    parse(req, res, next);
  });
}
