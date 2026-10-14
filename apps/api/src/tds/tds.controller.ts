import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsIn, IsISO8601, IsString, Length, Matches } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TDS_SECTION_CODES } from '../gl/tds';
import { financialYearOf } from '../gl/posting.service';
import { TdsService } from './tds.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class DepositTdsDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must look like 2026-10' })
  month: string;

  @IsIn(TDS_SECTION_CODES)
  section: string;

  @IsISO8601({}, { message: 'paidOn must be a date like 2026-11-07' })
  paidOn: string;

  @IsString()
  @Length(3, 40, { message: 'Enter the challan number the bank gave you' })
  challanNumber: string;
}

const thisYear = () => financialYearOf(new Date().toISOString().slice(0, 10));

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('tds')
export class TdsController {
  constructor(private readonly tds: TdsService) {}

  /** TDS deducted from vendors this year, by bill and by month and section. */
  @Get('payable')
  @RequirePermission(Permission.VIEW_REPORTS)
  payable(@Request() req: AuthRequest, @Query('financialYear') financialYear?: string) {
    return this.tds.payable(req.user.orgId, financialYear || thisYear());
  }

  /** Pay over one month's TDS under one section. */
  @Post('deposits')
  @RequirePermission(Permission.POST_JOURNAL)
  deposit(@Request() req: AuthRequest, @Body() body: DepositTdsDto) {
    return this.tds.deposit(req.user.orgId, req.user.sub, body);
  }

  @Get('deposits')
  @RequirePermission(Permission.VIEW_REPORTS)
  deposits(@Request() req: AuthRequest) {
    return this.tds.deposits(req.user.orgId);
  }

  /** TDS customers deducted from payments to us, to match against Form 26AS. */
  @Get('receivable')
  @RequirePermission(Permission.VIEW_REPORTS)
  receivable(@Request() req: AuthRequest, @Query('financialYear') financialYear?: string) {
    return this.tds.receivable(req.user.orgId, financialYear || thisYear());
  }
}
