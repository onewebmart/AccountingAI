import { Controller, Get, Post, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReconciliationService, CreateBankAccountInput, ImportStatementInput } from './reconciliation.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('banking')
export class BankingController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('accounts')
  @RequirePermission(Permission.VIEW_JOURNAL)
  listAccounts(@Request() req: AuthRequest) {
    return this.reconciliationService.listAccounts(req.user.orgId);
  }

  @Post('accounts')
  @RequirePermission(Permission.POST_JOURNAL)
  createAccount(@Request() req: AuthRequest, @Body() body: Omit<CreateBankAccountInput, 'orgId'>) {
    return this.reconciliationService.createAccount({ ...body, orgId: req.user.orgId });
  }

  @Get('statements')
  @RequirePermission(Permission.VIEW_JOURNAL)
  listStatements(@Request() req: AuthRequest, @Query('bankAccountId') bankAccountId?: string) {
    return this.reconciliationService.listStatements(req.user.orgId, bankAccountId);
  }

  @Post('statements')
  @RequirePermission(Permission.POST_JOURNAL)
  importStatement(@Request() req: AuthRequest, @Body() body: Omit<ImportStatementInput, 'orgId'>) {
    return this.reconciliationService.importStatement({ ...body, orgId: req.user.orgId });
  }

  @Get('statements/:id/report')
  @RequirePermission(Permission.VIEW_JOURNAL)
  getReport(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reconciliationService.getDiffReport(id, req.user.orgId);
  }

  @Post('statements/:id/auto-match')
  @RequirePermission(Permission.POST_JOURNAL)
  autoMatch(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reconciliationService.autoMatch(id, req.user.orgId);
  }

  @Post('statements/:id/confirm')
  @RequirePermission(Permission.POST_JOURNAL)
  confirmMatches(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.reconciliationService.confirmMatches(id, req.user.orgId);
  }

  @Post('lines/:lineId/match')
  @RequirePermission(Permission.POST_JOURNAL)
  manualMatch(
    @Request() req: AuthRequest,
    @Param('lineId') lineId: string,
    @Body() body: { journalId: string },
  ) {
    return this.reconciliationService.manualMatch(lineId, body.journalId, req.user.orgId);
  }
}
