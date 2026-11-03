import { BadRequestException, Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AuditTrailService } from './audit-trail.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('audit')
export class AuditTrailController {
  constructor(private readonly trail: AuditTrailService) {}

  /** Newest first. Pass `before` (the last id of a page) for the next page. */
  @Get()
  @RequirePermission(Permission.VIEW_AUDIT)
  list(
    @Request() req: AuthRequest,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit === undefined ? undefined : Number(limit);
    if (n !== undefined && !Number.isInteger(n)) throw new BadRequestException('limit must be a whole number');
    return this.trail.list(req.user.orgId, { entityType, entityId, actorId, action, from, to, before, limit: n });
  }

  @Get('facets')
  @RequirePermission(Permission.VIEW_AUDIT)
  facets(@Request() req: AuthRequest) {
    return this.trail.facets(req.user.orgId);
  }
}
