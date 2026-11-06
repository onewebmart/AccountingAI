import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ReportCatalogService, ReportParams } from './report-catalog.service';
import { ReportSchedulesService } from './report-schedules.service';
import { ReportAiService } from './report-ai.service';
import { BudgetsService } from './budgets.service';
import { BUDGET_PERIODS, BudgetPeriod } from './budget-periods';
import { toCsv } from './report-table';
import { CenterParamsDto, REPORT_KEY } from './catalog/params.dto';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY = /^\d{4}-\d{2}$/;

/** The period, and the Reports Center's filters (asOf, customerId and the rest) from CenterParamsDto. */
class ParamsDto extends CenterParamsDto implements ReportParams {
  /** Budget against actual: which budget; the year's default when left out. */
  @IsOptional() @IsMongoId({ message: 'budgetId is a budget' }) budgetId?: string;
}

class BudgetRowDto {
  @IsMongoId() accountId: string;
  /** One amount per period, whole paise: 12, 4, 2 or 1 of them. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @IsInt({ each: true }) amountsPaise: number[];
}

class BudgetDto {
  @IsString() @Length(1, 100) name: string;
  @Matches(FY, { message: 'financialYear looks like 2026-27' }) financialYear: string;
  @IsIn(BUDGET_PERIODS, { message: 'period is monthly, quarterly, half_yearly or yearly' }) period: BudgetPeriod;
  @IsOptional() @IsBoolean() includeBalanceSheet?: boolean;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BudgetRowDto) rows: BudgetRowDto[];
}

class BudgetListQuery {
  @IsOptional() @Matches(FY, { message: 'financialYear looks like 2026-27' }) financialYear?: string;
  @IsOptional() @IsIn(['active', 'archived']) status?: 'active' | 'archived';
}

class FromYearDto {
  @Matches(FY) financialYear: string;
  @Matches(FY) fromYear: string;
  @IsOptional() @IsNumber() @Min(-99) @Max(500) changePct?: number;
  @IsOptional() @IsBoolean() includeBalanceSheet?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsMongoId({ each: true }) accountIds?: string[];
}

class PeriodDto {
  @Matches(MONTH, { message: 'period is a month like 2026-10' }) period: string;
}

class AskDto {
  @IsString() @Length(3, 500) question: string;
}

class ScheduleDto {
  // Any report's key, a Reports Center one or custom.<id>; the service checks it exists for this person.
  @Matches(REPORT_KEY, { message: 'Pick a report.' })
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
    private readonly schedules: ReportSchedulesService,
    private readonly ai: ReportAiService,
    private readonly budgetPlans: BudgetsService,
  ) {}

  @Get('catalog')
  @RequirePermission(Permission.VIEW_REPORTS)
  list() {
    return this.catalog.list();
  }

  @Get('run/:key')
  @RequirePermission(Permission.VIEW_REPORTS)
  run(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: ParamsDto) {
    return this.catalog.run(req.user.orgId, key, q, req.user.sub);
  }

  @Get('run/:key/pdf')
  @RequirePermission(Permission.VIEW_REPORTS)
  async pdf(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: ParamsDto, @Res() res: Response) {
    const { filename, buffer } = await this.catalog.pdf(req.user.orgId, key, q, req.user.sub);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('run/:key/csv')
  @RequirePermission(Permission.VIEW_REPORTS)
  async csv(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: ParamsDto, @Res() res: Response) {
    const table = await this.catalog.run(req.user.orgId, key, q, req.user.sub);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${key.replace(/[._]/g, '-')}.csv"`);
    // A byte-order mark, so Excel reads the rupee sign and Indian names right.
    res.send(`﻿${toCsv(table)}`);
  }

  // ── Budgets: named plans, several a year. Plans only; nothing here posts. ──

  @Get('budgets')
  @RequirePermission(Permission.VIEW_REPORTS)
  budgets(@Request() req: AuthRequest, @Query() q: BudgetListQuery) {
    return this.budgetPlans.list(req.user.orgId, q);
  }

  @Post('budgets')
  @RequirePermission(Permission.MANAGE_COA)
  createBudget(@Request() req: AuthRequest, @Body() body: BudgetDto) {
    return this.budgetPlans.create(req.user.orgId, req.user.sub, body);
  }

  @Post('budgets/from-year')
  @RequirePermission(Permission.MANAGE_COA)
  fromYear(@Request() req: AuthRequest, @Body() body: FromYearDto) {
    return this.budgetPlans.fromYear(req.user.orgId, body);
  }

  @Get('budgets/:id')
  @RequirePermission(Permission.VIEW_REPORTS)
  budget(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.budgetPlans.get(req.user.orgId, id);
  }

  @Put('budgets/:id')
  @RequirePermission(Permission.MANAGE_COA)
  updateBudget(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: BudgetDto) {
    return this.budgetPlans.update(req.user.orgId, req.user.sub, id, body);
  }

  @Post('budgets/:id/default')
  @RequirePermission(Permission.MANAGE_COA)
  defaultBudget(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.budgetPlans.makeDefault(req.user.orgId, req.user.sub, id);
  }

  @Post('budgets/:id/archive')
  @RequirePermission(Permission.MANAGE_COA)
  archiveBudget(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.budgetPlans.archive(req.user.orgId, req.user.sub, id);
  }

  @Post('budgets/:id/restore')
  @RequirePermission(Permission.MANAGE_COA)
  restoreBudget(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.budgetPlans.restore(req.user.orgId, req.user.sub, id);
  }

  @Delete('budgets/:id')
  @RequirePermission(Permission.MANAGE_COA)
  deleteBudget(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.budgetPlans.remove(req.user.orgId, req.user.sub, id);
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

  // ── The monthly narrative and Ask your books: advice, read-only ─────────

  @Post('narrative')
  @RequirePermission(Permission.VIEW_REPORTS)
  requestNarrative(@Request() req: AuthRequest, @Body() body: PeriodDto) {
    return this.ai.requestNarrative(req.user.orgId, req.user.sub, body.period);
  }

  @Get('narrative')
  @RequirePermission(Permission.VIEW_REPORTS)
  latestNarrative(@Request() req: AuthRequest, @Query() q: PeriodDto) {
    return this.ai.latestNarrative(req.user.orgId, q.period);
  }

  @Get('narrative/:id')
  @RequirePermission(Permission.VIEW_REPORTS)
  narrative(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.ai.narrative(req.user.orgId, id);
  }

  @Post('ask')
  @RequirePermission(Permission.VIEW_REPORTS)
  ask(@Request() req: AuthRequest, @Body() body: AskDto) {
    return this.ai.ask(req.user.orgId, req.user.sub, body.question);
  }

  @Get('ask/recent')
  @RequirePermission(Permission.VIEW_REPORTS)
  recent(@Request() req: AuthRequest) {
    return this.ai.recentQuestions(req.user.orgId);
  }

  @Get('ask/:id')
  @RequirePermission(Permission.VIEW_REPORTS)
  answer(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.ai.answer(req.user.orgId, id);
  }
}
