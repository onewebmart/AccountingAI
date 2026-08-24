import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantContext } from '../database/tenant.plugin';

/**
 * TenantMiddleware reads the JWT from the Authorization header, decodes
 * the payload, and stores { orgId, firmId } in AsyncLocalStorage so the
 * Mongoose isolation plugins can inject both scopes automatically:
 * orgId for accounting models, firmId for CRM models.
 *
 * Phase 1: decodes the payload without verifying the signature.
 * Phase 2 (auth module) adds full JWT verification — this middleware
 * will then run AFTER the JwtAuthGuard which validates the token.
 *
 * IMPORTANT: neither orgId nor firmId is EVER accepted from the request
 * body or query string. Both come only from the verified JWT.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
    const payload = decodeJwtPayload(token);

    if (!payload?.orgId && !payload?.firmId) {
      return next();
    }

    // Run the rest of the request inside the tenant context.
    // Every Mongoose query in this request auto-filters by orgId (accounting
    // models) and by firmId (CRM models) — see the plugins in tenant.plugin.ts.
    tenantContext.run(
      {
        orgId: payload.orgId as string | undefined,
        firmId: payload.firmId as string | undefined,
      },
      () => next(),
    );
  }
}

/** Decode JWT payload without signature verification (Phase 1). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const paddedPayload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(paddedPayload, 'base64').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
