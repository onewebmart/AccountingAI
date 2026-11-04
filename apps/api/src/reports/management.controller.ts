import { Body, Controller, Get, Param, Post, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ManagementReportsService } from './management.service';
import { ReportCatalogService, ReportParams } from './report-catalog.service';
import { ReportSchedulesService } from './report-schedules.service';
import { toCsv } from './report-table';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY = /^\d{4}-\d{2}$/;

class ParamsDto implements ReportParams {
  @IsOptional() @Matches(MONTH, { message: 'from is a month like 2026-04' }) from?: string;
  @IsOptional() @Matches(MONTH, { message: 'to is a month like 2026-11' }) to?: string;
  @IsOptional() @Matches(FY, { message: 'financialYear looks like 2026-27' }) financialYear?: string;
  @IsOptional() @Matches(MONTH, { message: 'through is a month like 2026-11' }) through?: string;
}

class BudgetRowDto {
  @IsMongoId() accountId: string;
  @IsArray() @ArrayMinSize(12) @ArrayMaxSize(12) @IsInt({ each: true }) @Min(0, { each: true }) monthsPaise: number[];
}

class BudgetsDto {
  @Matches(FY) financialYear: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BudgetRowDto) rows: BudgetRowDto[];
}

class FromYearDto {
  @Matches(FY) financialYear: string;
  @Matches(FY) fromYear: string;
  @IsOptional() @IsNumber() @Min(-99) @Max(500) changePct?: number;
}

class ScheduleDto {
  @IsIn(['pl_monthly', 'comparison', 'expenses', 'budget_vs_actual', 'sales_by_customer', 'sales_by_item', 'sales_by_month', 'purchases_by_vendor', 'purchases_by_item', 'purchases_by_month', 'receivables', 'payables', 'gst_summary', 'trial_balance', 'balance_sheet'])
  report: string;
  @IsOptional() @IsIn(['last_month', 'this_month', 'last_quarter', 'this_fy', 'last_fy']) period?: 'last_month' | 'this_month' | 'last_quarter' | 'this_fy' | 'last_fy';
  @IsIn(['monthly', 'weekly']) frequency: 'monthly' | 'weekly';
  @IsInt() @Min(1) @Max(28) day: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsEmail({}, { each: true }) recipients: string[];
}

/** Management reports, budgets, any report as PDF or CSV, and reports emailed on a schedule. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('reports')
export class ManagementController {
  constructor(
    private readonly catalog: ReportCatalogService,
    private readonly management: ManagementReportsService,
    private readonly schedules: ReportSchedulesService,
  ) {}

  @Get('catalog')
  @RequirePermission(Permission.VIEW_REPORTS)
  list() {
    return this.catalog.list();
  }

  @Get('run/:key')
  @RequirePermission(Permission.VIEW_REPORTS)
  run(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: ParamsDto) {
    return this.catalog.run(req.user.orgId, key, q);
  }

  @Get('run/:key/pdf')
  @RequirePermission(Permission.VIEW_REPORTS)
  async pdf(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: ParamsDto, @Res() res: Response) {
    const { filename, buffer } = await this.catalog.pdf(req.user.orgId, key, q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('run/:key/csv')
  @RequirePermission(Permission.VIEW_REPORTS)
  async csv(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: ParamsDto, @Res() res: Response) {
    const table = await this.catalog.run(req.user.orgId, key, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${key.replace(/_/g, '-')}.csv"`);
    // A byte-order mark, so Excel reads the rupee sign and Indian names right.
    res.send(`﻿${toCsv(table)}`);
  }

  @Get('budgets')
  @RequirePermission(Permission.VIEW_REPORTS)
  budgets(@Request() req: AuthRequest, @Query('financialYear') financialYear: string) {
    return this.management.budgets(req.user.orgId, financialYear);
  }

  @Put('budgets')
  @RequirePermission(Permission.MANAGE_COA)
  saveBudgets(@Request() req: AuthRequest, @Body() body: BudgetsDto) {
    return this.management.saveBudgets(req.user.orgId, req.user.sub, body.financialYear, body.rows);
  }

  @Post('budgets/from-year')
  @RequirePermission(Permission.MANAGE_COA)
  fromYear(@Request() req: AuthRequest, @Body() body: FromYearDto) {
    return this.management.budgetsFromYear(req.user.orgId, body.financialYear, body.fromYear, body.changePct ?? 0);
  }

  @Get('schedules')
  @RequirePermission(Permission.VIEW_REPORTS)
  listSchedules(@Request() req: AuthRequest) {
    return this.schedules.list(req.user.orgId);
  }

  @Post('schedules')
  @RequirePermission(Permission.VIEW_REPORTS)
  createSchedule(@Request() req: AuthRequest, @Body() body: ScheduleDto) {
    return this.schedules.create(req.user.orgId, req.user.sub, body);
  }

  @Post('schedules/:id/stop')
  @RequirePermission(Permission.VIEW_REPORTS)
  stop(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.schedules.setActive(req.user.orgId, req.user.sub, id, false);
  }

  @Post('schedules/:id/resume')
  @RequirePermission(Permission.VIEW_REPORTS)
  resume(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.schedules.setActive(req.user.orgId, req.user.sub, id, true);
  }

  @Post('schedules/:id/send')
  @RequirePermission(Permission.VIEW_REPORTS)
  sendNow(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.schedules.sendNow(req.user.orgId, req.user.sub, id);
  }
}
