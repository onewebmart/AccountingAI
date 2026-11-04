import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ProjectsService } from './projects.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class ProjectDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(0, 30) code?: string | null;
  @IsOptional() @IsMongoId() customerId?: string | null;
  @IsOptional() @IsIn(['time', 'fixed']) billing?: 'time' | 'fixed';
  @IsOptional() @IsInt() @Min(0) budgetPaise?: number | null;
  @IsOptional() @IsNumber() @Min(0) budgetHours?: number | null;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
  @IsOptional() @IsMongoId() serviceItemId?: string | null;
  @IsOptional() @Matches(DATE) startDate?: string | null;
  @IsOptional() @Matches(DATE) endDate?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class StatusDto {
  @IsIn(['active', 'on_hold', 'completed']) status: 'active' | 'on_hold' | 'completed';
}

class TimeDto {
  @IsMongoId() projectId: string;
  @Matches(DATE, { message: 'date must look like 2026-11-04' }) date: string;
  @IsNumber() @Min(0.01) @Max(24) hours: number;
  @IsString() @Length(1, 80) task: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
}

class TimeUpdateDto {
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(24) hours?: number;
  @IsOptional() @IsString() @Length(1, 80) task?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() @Min(0) ratePaise?: number | null;
}

class BillDto {
  @IsOptional() @Matches(DATE) through?: string;
}

/** Projects, time on them, and invoices drafted from unbilled time. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_REPORTS)
  list(@Request() req: AuthRequest) {
    return this.projects.list(req.user.orgId);
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

  // Time: anyone who works can log their own, as with expense claims.
  @Get('time/entries')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  listTime(@Request() req: AuthRequest, @Query('projectId') projectId?: string, @Query('mine') mine?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.projects.listTime(req.user.orgId, { projectId, userId: mine === 'true' ? req.user.sub : undefined, from, to });
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
    return this.projects.logTime(req.user.orgId, req.user.sub, body);
  }

  @Patch('time/entries/:id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  updateTime(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: TimeUpdateDto) {
    return this.projects.updateTime(req.user.orgId, req.user.sub, id, body);
  }

  @Delete('time/entries/:id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  deleteTime(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.projects.deleteTime(req.user.orgId, req.user.sub, id);
  }

  @Get(':id/unbilled')
  @RequirePermission(Permission.MANAGE_SALES)
  async unbilled(@Request() req: AuthRequest, @Param('id') id: string, @Query('through') through?: string) {
    const { lines, unpriced } = await this.projects.unbilled(req.user.orgId, id, through || undefined);
    return { lines, unpriced: unpriced.length };
  }

  @Post(':id/invoice')
  @RequirePermission(Permission.MANAGE_SALES)
  invoice(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: BillDto) {
    return this.projects.draftInvoice(req.user.orgId, req.user.sub, id, body.through || undefined);
  }
}
