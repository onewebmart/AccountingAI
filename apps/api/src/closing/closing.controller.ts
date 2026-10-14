import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClosingService } from './closing.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class SetLockDto {
  /** null unlocks. */
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'lockedThrough must be a date like 2026-09-30, or null' })
  lockedThrough: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  reason?: string;
}

const FY = /^\d{4}-\d{2}$/;

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('closing')
export class ClosingController {
  constructor(private readonly closing: ClosingService) {}

  @Get()
  @RequirePermission(Permission.VIEW_REPORTS)
  status(@Request() req: AuthRequest) {
    return this.closing.status(req.user.orgId);
  }

  /** What is still open on or before a date — deal with it before locking. */
  @Get('checklist')
  @RequirePermission(Permission.VIEW_REPORTS)
  checklist(@Request() req: AuthRequest, @Query('through') through: string) {
    return this.closing.checklist(req.user.orgId, through);
  }

  @Post('lock')
  @RequirePermission(Permission.MANAGE_ORG)
  lock(@Request() req: AuthRequest, @Body() body: SetLockDto) {
    return this.closing.setLock(req.user.orgId, req.user.sub, body.lockedThrough, body.reason);
  }

  @Post('years/:fy/close')
  @RequirePermission(Permission.MANAGE_ORG)
  close(@Request() req: AuthRequest, @Param('fy') fy: string) {
    if (!FY.test(fy)) throw new BadRequestException('Financial year must look like 2025-26');
    return this.closing.closeYear(req.user.orgId, req.user.sub, fy);
  }

  @Post('years/:fy/reopen')
  @RequirePermission(Permission.MANAGE_ORG)
  reopen(@Request() req: AuthRequest, @Param('fy') fy: string) {
    if (!FY.test(fy)) throw new BadRequestException('Financial year must look like 2025-26');
    return this.closing.reopenYear(req.user.orgId, req.user.sub, fy);
  }
}
