import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { todayIst } from '../automation/schedule';
import { AssetsService } from './assets.service';
import { AssistantService } from './assistant.service';
import { SchedulesService } from './schedules.service';
import { CATEGORIES } from './depreciation';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

class PeriodDto {
  @Matches(PERIOD, { message: 'period is a month like 2026-11' }) period: string;
}

class SpreadDto extends PeriodDto {
  @IsMongoId() billId: string;
}

class AssetDto {
  @IsString() @Length(1, 200) name: string;
  @IsIn(Object.keys(CATEGORIES)) category: keyof typeof CATEGORIES;
  @IsMongoId() assetAccountId: string;
  @IsInt() @Min(1) costPaise: number;
  @IsOptional() @IsInt() @Min(0) residualPaise?: number | null;
  @Matches(DATE) purchaseDate: string;
  @Matches(DATE) putToUse: string;
  @IsOptional() @IsIn(['SLM', 'WDV']) method?: 'SLM' | 'WDV';
  @IsOptional() @IsInt() @Min(1) @Max(100) lifeYears?: number | null;
  @IsOptional() @IsInt() @Min(0) openingAccumulatedPaise?: number;
  @IsOptional() @Matches(DATE) openingAsOf?: string | null;
  @IsOptional() @IsMongoId() billId?: string | null;
  @IsOptional() @IsMongoId() capitaliseFromAccountId?: string | null;
}

class DisposeDto {
  @Matches(DATE) date: string;
  @IsInt() @Min(0) proceedsPaise: number;
  @IsOptional() @IsMongoId() proceedsAccountId?: string | null;
}

class ScheduleDto {
  @IsIn(['accrual', 'prepaid']) kind: 'accrual' | 'prepaid';
  @IsString() @Length(1, 120) name: string;
  @IsMongoId() expenseAccountId: string;
  @IsInt() @Min(1) amountPaise: number;
  @Matches(PERIOD) startPeriod: string;
  @IsInt() @Min(1) @Max(120) months: number;
  @IsOptional() @IsString() @Length(0, 300) note?: string | null;
}

class DraftDto {
  @Matches(PERIOD) through: string;
}

/**
 * Month-end: the assistant, the asset register and the schedules. Every
 * entry made here goes to the review queue; posting is Approve & post there.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('month-end')
export class MonthEndController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly assets: AssetsService,
    private readonly schedules: SchedulesService,
  ) {}

  @Get('assistant')
  @RequirePermission(Permission.VIEW_REPORTS)
  suggestions(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.assistant.suggestions(req.user.orgId, period);
  }

  @Post('assistant/propose')
  @RequirePermission(Permission.POST_JOURNAL)
  proposeAll(@Request() req: AuthRequest, @Body() body: PeriodDto) {
    return this.assistant.proposeAll(req.user.orgId, req.user.sub, body.period);
  }

  @Post('assistant/spread')
  @RequirePermission(Permission.POST_JOURNAL)
  spread(@Request() req: AuthRequest, @Body() body: SpreadDto) {
    return this.assistant.spread(req.user.orgId, req.user.sub, body.period, body.billId);
  }

  @Get('categories')
  @RequirePermission(Permission.VIEW_REPORTS)
  categories() {
    return Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c }));
  }

  @Get('assets')
  @RequirePermission(Permission.VIEW_REPORTS)
  listAssets(@Request() req: AuthRequest, @Query('asOf') asOf?: string) {
    return this.assets.list(req.user.orgId, asOf && DATE.test(asOf) ? asOf : todayIst());
  }

  @Post('assets')
  @RequirePermission(Permission.POST_JOURNAL)
  createAsset(@Request() req: AuthRequest, @Body() body: AssetDto) {
    return this.assets.create(req.user.orgId, req.user.sub, body);
  }

  @Post('assets/depreciation-run')
  @RequirePermission(Permission.POST_JOURNAL)
  run(@Request() req: AuthRequest, @Body() body: PeriodDto) {
    return this.assets.run(req.user.orgId, req.user.sub, body.period);
  }

  @Get('assets/tax-report')
  @RequirePermission(Permission.VIEW_REPORTS)
  taxReport(@Request() req: AuthRequest, @Query('fy') fy: string) {
    return this.assets.taxReport(req.user.orgId, fy);
  }

  @Post('assets/:id/dispose')
  @RequirePermission(Permission.POST_JOURNAL)
  dispose(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: DisposeDto) {
    return this.assets.dispose(req.user.orgId, req.user.sub, id, body);
  }

  @Get('schedules')
  @RequirePermission(Permission.VIEW_REPORTS)
  listSchedules(@Request() req: AuthRequest) {
    return this.schedules.list(req.user.orgId);
  }

  @Post('schedules')
  @RequirePermission(Permission.POST_JOURNAL)
  createSchedule(@Request() req: AuthRequest, @Body() body: ScheduleDto) {
    return this.schedules.create(req.user.orgId, req.user.sub, body);
  }

  @Post('schedules/draft')
  @RequirePermission(Permission.POST_JOURNAL)
  draft(@Request() req: AuthRequest, @Body() body: DraftDto) {
    return this.schedules.draftDue(req.user.orgId, req.user.sub, body.through);
  }

  @Post('schedules/:id/stop')
  @RequirePermission(Permission.POST_JOURNAL)
  stop(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.schedules.stop(req.user.orgId, req.user.sub, id);
  }
}
