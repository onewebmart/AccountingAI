import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { ReportsService } from './reports.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(Permission.VIEW_REPORTS)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('trial-balance')
  getTrialBalance(@Request() req: AuthRequest, @Query('financialYear') financialYear: string) {
    return this.reportsService.getTrialBalance(req.user.orgId, financialYear);
  }

  @Get('profit-loss')
  getProfitAndLoss(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('period') period?: string,
  ) {
    return this.reportsService.getProfitAndLoss(req.user.orgId, financialYear, period);
  }

  @Get('balance-sheet')
  getBalanceSheet(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.reportsService.getBalanceSheet(req.user.orgId, financialYear, asOf);
  }

  @Get('ledger')
  getLedger(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('account') account: string,
  ) {
    return this.reportsService.getLedger(req.user.orgId, financialYear, account);
  }

  @Get('day-book')
  getDayBook(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getDayBook(req.user.orgId, startDate, endDate, financialYear);
  }

  @Get('cash-flow')
  getCashFlow(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('period') period?: string,
  ) {
    return this.reportsService.getCashFlow(req.user.orgId, financialYear, period);
  }
}
