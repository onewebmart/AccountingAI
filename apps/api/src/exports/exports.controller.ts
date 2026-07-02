import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { ExportsService } from './exports.service';
import { TallyService } from './tally.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@Controller('exports')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(Permission.VIEW_REPORTS)
export class ExportsController {
  constructor(
    private readonly exportsService: ExportsService,
    private readonly tallyService: TallyService,
  ) {}

  // ── CSV exports ─────────────────────────────────────────────────────────────

  @Get('trial-balance.csv')
  async trialBalanceCsv(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Res() res: Response,
  ) {
    const csv = await this.exportsService.trialBalanceCsv(req.user.orgId, financialYear);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${financialYear}.csv"`);
    res.send(csv);
  }

  @Get('profit-loss.csv')
  async profitLossCsv(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('period') period: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportsService.profitAndLossCsv(req.user.orgId, financialYear, period);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="profit-loss-${financialYear}.csv"`);
    res.send(csv);
  }

  @Get('balance-sheet.csv')
  async balanceSheetCsv(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('asOf') asOf: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportsService.balanceSheetCsv(req.user.orgId, financialYear, asOf);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="balance-sheet-${financialYear}.csv"`);
    res.send(csv);
  }

  @Get('day-book.csv')
  async dayBookCsv(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const csv = await this.exportsService.dayBookCsv(req.user.orgId, financialYear, startDate, endDate);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="day-book.csv"`);
    res.send(csv);
  }

  @Get('ledger.csv')
  async ledgerCsv(
    @Request() req: AuthRequest,
    @Query('financialYear') financialYear: string,
    @Query('account') account: string,
    @Res() res: Response,
  ) {
    const csv = await this.exportsService.ledgerCsv(req.user.orgId, financialYear, account);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ledger.csv"`);
    res.send(csv);
  }

  // ── Tally connector endpoints ────────────────────────────────────────────────

  @Post('tally/enqueue')
  enqueueTally(
    @Request() req: AuthRequest,
    @Body() body: { financialYear: string },
  ) {
    return this.tallyService.enqueue(req.user.orgId, body.financialYear);
  }

  @Get('tally/pending')
  getPendingVouchers(@Request() req: AuthRequest) {
    return this.tallyService.getPendingVouchers(req.user.orgId);
  }

  @Get('tally/vouchers/:journalId/xml')
  async getVoucherXml(
    @Request() req: AuthRequest,
    @Param('journalId') journalId: string,
    @Res() res: Response,
  ) {
    const xml = await this.tallyService.getVoucherXml(req.user.orgId, journalId);
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  }

  @Post('tally/mark-synced')
  markSynced(
    @Request() req: AuthRequest,
    @Body() body: { journalId: string; tallyGuid: string },
  ) {
    return this.tallyService.markSynced(req.user.orgId, body.journalId, body.tallyGuid);
  }

  @Post('tally/mark-failed')
  markFailed(
    @Request() req: AuthRequest,
    @Body() body: { journalId: string; errorMessage: string },
  ) {
    return this.tallyService.markFailed(req.user.orgId, body.journalId, body.errorMessage);
  }

  @Get('tally/status')
  getTallyStatus(@Request() req: AuthRequest) {
    return this.tallyService.getStatus(req.user.orgId);
  }
}
