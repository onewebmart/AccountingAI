import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import type { SubscriptionPlan } from './schemas/subscription.schema';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

@Controller('platform')
@UseGuards(AuthGuard('jwt'), PlatformAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  // ── Org list & detail ─────────────────────────────────────────────────────────

  @Get('orgs')
  getOrgs() {
    return this.platformAdminService.getOrgs();
  }

  @Get('orgs/:orgId')
  getOrgDetail(@Param('orgId') orgId: string) {
    return this.platformAdminService.getOrgDetail(orgId);
  }

  // ── AI cost dashboard ────────────────────────────────────────────────────────

  @Get('cost')
  getAiCost(@Query('period') period: string) {
    const p = period ?? new Date().toISOString().slice(0, 7);
    return this.platformAdminService.getAiCostSummary(p);
  }

  @Get('orgs/:orgId/usage')
  getOrgUsage(
    @Param('orgId') orgId: string,
    @Query('period') period: string,
  ) {
    const p = period ?? new Date().toISOString().slice(0, 7);
    return this.platformAdminService.getUsageByOrg(orgId, p);
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────────

  @Get('orgs/:orgId/subscription')
  getSubscription(@Param('orgId') orgId: string) {
    return this.platformAdminService.getSubscription(orgId);
  }

  @Patch('orgs/:orgId/subscription')
  setSubscription(
    @Request() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Body() body: { plan: SubscriptionPlan },
  ) {
    return this.platformAdminService.setSubscription(orgId, body.plan, req.user.sub);
  }

  // ── Feature flags ─────────────────────────────────────────────────────────────

  @Get('orgs/:orgId/features')
  getFeatureFlags(@Param('orgId') orgId: string) {
    return this.platformAdminService.getFeatureFlags(orgId);
  }

  @Patch('orgs/:orgId/features/:flagName')
  setFeatureFlag(
    @Request() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Param('flagName') flagName: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.platformAdminService.setFeatureFlag(orgId, flagName, body.enabled, req.user.sub);
  }

  // ── Impersonation ─────────────────────────────────────────────────────────────

  @Post('orgs/:orgId/impersonate')
  impersonate(
    @Request() req: AuthRequest,
    @Param('orgId') orgId: string,
  ) {
    return this.platformAdminService.logImpersonation(orgId, req.user.sub);
  }

  // ── Audit log (cross-org, platform only) ─────────────────────────────────────

  @Get('audit')
  getAuditLogs(
    @Query('orgId') orgId: string | undefined,
    @Query('limit') limit: string,
  ) {
    return this.platformAdminService.getAuditLogs(orgId, limit ? parseInt(limit, 10) : 100);
  }
}
