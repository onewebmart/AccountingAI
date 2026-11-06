import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ProjectsService, TimeQuery } from './projects.service';
import { missingRateMessage } from './time-billing';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DURATION = /^\d{1,2}:[0-5]\d$/;

class MemberDto {
  @IsMongoId() userId: string;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
}

class TaskDto {
  @IsOptional() @IsMongoId() id?: string | null;
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
}

class ProjectDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(0, 30) code?: string | null;
  @IsOptional() @IsMongoId() customerId?: string | null;
  // 'time' is the old name for project_hours.
  @IsOptional() @IsIn(['fixed', 'project_hours', 'task_hours', 'staff_hours', 'time']) billing?: 'fixed' | 'project_hours' | 'task_hours' | 'staff_hours' | 'time';
  @IsOptional() @IsInt() @Min(0) budgetPaise?: number | null;
  @IsOptional() @IsInt() @Min(0) costBudgetPaise?: number | null;
  @IsOptional() @IsInt() @Min(0) revenueBudgetPaise?: number | null;
  @IsOptional() @IsNumber() @Min(0) budgetHours?: number | null;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
  @IsOptional() @IsMongoId() serviceItemId?: string | null;
  @IsOptional() @Matches(DATE) startDate?: string | null;
  @IsOptional() @Matches(DATE) endDate?: string | null;
  @IsOptional() @IsString() @Length(0, 2000) description?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsBoolean() watchlist?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => MemberDto) members?: MemberDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TaskDto) tasks?: TaskDto[];
  @IsOptional() @IsMongoId() importTasksFrom?: string | null;
}

class StatusDto {
  @IsIn(['active', 'on_hold', 'completed']) status: 'active' | 'on_hold' | 'completed';
}

/** How long: hours, or hours and minutes (duration), or a start and end time. The server works out the hours. */
class TimeDto {
  @IsMongoId() projectId: string;
  @Matches(DATE, { message: 'date must look like 2026-11-04' }) date: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(24) hours?: number | null;
  @IsOptional() @Matches(DURATION, { message: 'Time spent looks like 1:30, hours and minutes.' }) duration?: string | null;
  @IsOptional() @Matches(CLOCK, { message: 'A start time looks like 09:30.' }) startTime?: string | null;
  @IsOptional() @Matches(CLOCK, { message: 'An end time looks like 13:00.' }) endTime?: string | null;
  @IsOptional() @IsMongoId() taskId?: string | null;
  @IsOptional() @IsString() @Length(1, 80) task?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
  /** Whose time, when not your own: needs MANAGE_SALES. */
  @IsOptional() @IsMongoId() userId?: string | null;
}

class TimeUpdateDto {
  @IsOptional() @IsMongoId() projectId?: string;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(24) hours?: number | null;
  @IsOptional() @Matches(DURATION, { message: 'Time spent looks like 1:30, hours and minutes.' }) duration?: string | null;
  @IsOptional() @Matches(CLOCK, { message: 'A start time looks like 09:30.' }) startTime?: string | null;
  @IsOptional() @Matches(CLOCK, { message: 'An end time looks like 13:00.' }) endTime?: string | null;
  @IsOptional() @IsMongoId() taskId?: string | null;
  @IsOptional() @IsString() @Length(1, 80) task?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
  @IsOptional() @IsMongoId() userId?: string;
}

class TimerDto {
  @IsMongoId() projectId: string;
  @IsOptional() @IsMongoId() taskId?: string | null;
  @IsOptional() @IsString() @Length(1, 80) task?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class BillDto {
  @IsOptional() @Matches(DATE) through?: string;
}

/**
 * Projects, time on them, and invoices drafted from unbilled time.
 *
 * Time: anyone who works (UPLOAD_DOCUMENT) logs and changes their own, as
 * with expense claims. MANAGE_SALES, the permission projects are managed
 * with, also lets a person log time for someone else on the project and
 * change or remove anyone's unbilled time.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  private actor(req: AuthRequest) {
    return { userId: req.user.sub, canManage: hasPermission(req.user.role as UserRole, Permission.MANAGE_SALES) };
  }

  @Get()
  @RequirePermission(Permission.VIEW_REPORTS)
  list(@Request() req: AuthRequest) {
    return this.projects.list(req.user.orgId);
  }

  /** The org's people: a project's users, and whose time an entry is. */
  @Get('people')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  people(@Request() req: AuthRequest) {
    return this.projects.people(req.user.orgId);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_SALES)
  create(@Request() req: AuthRequest, @Body() body: ProjectDto) {
    return this.projects.create(req.user.orgId, req.user.sub, body);
  }

  @Patch(':id')
  @RequirePermission(Permission.MANAGE_SALES)
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: ProjectDto) {
    return this.projects.update(req.user.orgId, req.user.sub, id, body);
  }

  @Post(':id/status')
  @RequirePermission(Permission.MANAGE_SALES)
  status(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: StatusDto) {
    return this.projects.setStatus(req.user.orgId, req.user.sub, id, body.status);
  }

  @Get('time/entries')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  listTime(
    @Request() req: AuthRequest,
    @Query('projectId') projectId?: string,
    @Query('customerId') customerId?: string,
    @Query('userId') userId?: string,
    @Query('mine') mine?: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('billing') billing?: string,
  ) {
    const q: TimeQuery = {
      projectId: projectId || undefined,
      customerId: customerId || undefined,
      userId: mine === 'true' ? req.user.sub : userId || undefined,
      period: (['all', 'today', 'this_week', 'this_month'] as const).find((p) => p === period),
      from: from || undefined,
      to: to || undefined,
      billing: (['billable', 'unbilled', 'billed', 'non_billable'] as const).find((b) => b === billing),
    };
    return this.projects.listTime(req.user.orgId, q);
  }

  @Get('time/nudges')
  @RequirePermission(Permission.VIEW_REPORTS)
  nudges(@Request() req: AuthRequest) {
    return this.projects.nudges(req.user.orgId);
  }

  @Get('time/wording/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  wording(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.projects.wordingStatus(req.user.orgId, id);
  }

  @Post('time/entries')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  logTime(@Request() req: AuthRequest, @Body() body: TimeDto) {
    return this.projects.logTime(req.user.orgId, this.actor(req), body);
  }

  @Patch('time/entries/:id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  updateTime(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: TimeUpdateDto) {
    return this.projects.updateTime(req.user.orgId, this.actor(req), id, body);
  }

  @Delete('time/entries/:id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  deleteTime(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.projects.deleteTime(req.user.orgId, this.actor(req), id);
  }

  // The timer: your own, one at a time, kept on the server.
  @Get('time/timer')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  timer(@Request() req: AuthRequest) {
    return this.projects.currentTimer(req.user.orgId, req.user.sub);
  }

  @Post('time/timer/start')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  startTimer(@Request() req: AuthRequest, @Body() body: TimerDto) {
    return this.projects.startTimer(req.user.orgId, req.user.sub, body);
  }

  @Post('time/timer/stop')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  stopTimer(@Request() req: AuthRequest) {
    return this.projects.stopTimer(req.user.orgId, req.user.sub);
  }

  @Delete('time/timer')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  discardTimer(@Request() req: AuthRequest) {
    return this.projects.discardTimer(req.user.orgId, req.user.sub);
  }

  @Get(':id/unbilled')
  @RequirePermission(Permission.MANAGE_SALES)
  async unbilled(@Request() req: AuthRequest, @Param('id') id: string, @Query('through') through?: string) {
    const { lines, unpriced, missing, method } = await this.projects.unbilled(req.user.orgId, id, through || undefined);
    return { lines, unpriced: unpriced.length, missing: method !== 'fixed' && missing.length ? missingRateMessage(method, missing) : null };
  }

  @Post(':id/invoice')
  @RequirePermission(Permission.MANAGE_SALES)
  invoice(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: BillDto) {
    return this.projects.draftInvoice(req.user.orgId, req.user.sub, id, body.through || undefined);
  }
}
