import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { BankFeedsService } from './bank-feeds.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class RequestConsentDto {
  /** The customer's Account Aggregator handle, e.g. 9876543210@onemoney. */
  @IsString()
  @Length(5, 100)
  customerVua: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be a date like 2026-04-01' })
  fromDate?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('bank-feeds')
export class BankFeedsController {
  constructor(private readonly feeds: BankFeedsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_JOURNAL)
  list(@Request() req: AuthRequest) {
    return this.feeds.list(req.user.orgId);
  }

  /** Connecting a bank account is an org decision: it reads the account's history. */
  @Post('consents')
  @RequirePermission(Permission.MANAGE_ORG)
  requestConsent(@Request() req: AuthRequest, @Body() body: RequestConsentDto) {
    return this.feeds.requestConsent(req.user.orgId, req.user.sub, body);
  }

  @Post('consents/:id/refresh')
  @RequirePermission(Permission.VIEW_JOURNAL)
  async refresh(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.feeds.refresh(req.user.orgId, id);
    return this.feeds.list(req.user.orgId);
  }

  /** Pull now rather than waiting for the morning run. */
  @Post('consents/:id/sync')
  @RequirePermission(Permission.POST_JOURNAL)
  sync(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.feeds.sync(req.user.orgId, id, req.user.sub);
  }

  @Post('consents/:id/revoke')
  @RequirePermission(Permission.MANAGE_ORG)
  async revoke(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.feeds.revoke(req.user.orgId, req.user.sub, id);
    return this.feeds.list(req.user.orgId);
  }

  /** Mock aggregator only: plays the customer approving in their AA app. */
  @Post('consents/:id/mock-approve')
  @RequirePermission(Permission.MANAGE_ORG)
  async approveMock(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.feeds.approveMock(req.user.orgId, id);
    return this.feeds.list(req.user.orgId);
  }
}
