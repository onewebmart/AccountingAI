import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ApprovalsService } from './approvals.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

class PolicyDto {
  @IsString() @Length(1, 120) name: string;
  @IsIn(['bill', 'payment', 'journal', 'expense_claim']) docType: 'bill' | 'payment' | 'journal' | 'expense_claim';
  @IsOptional() @IsInt() @Min(0) minAmountPaise?: number;
  @IsOptional() @IsBoolean() newVendorOnly?: boolean;
  @IsOptional() @IsIn([1, 2]) approvalsRequired?: 1 | 2;
  @IsOptional() @IsArray() @IsString({ each: true }) approverRoles?: string[];
}

class NoteDto {
  @IsOptional() @IsString() @Length(0, 300) note?: string | null;
}

class ReasonDto {
  @IsString() @Length(1, 300) reason: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('policies')
  @RequirePermission(Permission.VIEW_REPORTS)
  policies(@Request() req: AuthRequest) {
    return this.approvals.listPolicies(req.user.orgId);
  }

  @Post('policies')
  @RequirePermission(Permission.MANAGE_ORG)
  createPolicy(@Request() req: AuthRequest, @Body() body: PolicyDto) {
    return this.approvals.createPolicy(req.user.orgId, req.user.sub, body);
  }

  @Post('policies/:id/:action')
  @RequirePermission(Permission.MANAGE_ORG)
  togglePolicy(@Request() req: AuthRequest, @Param('id') id: string, @Param('action') action: string) {
    return this.approvals.setPolicyActive(req.user.orgId, req.user.sub, id, action === 'enable');
  }

  @Get('requests')
  @RequirePermission(Permission.VIEW_REPORTS)
  requests(@Request() req: AuthRequest, @Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.approvals.list(req.user.orgId, status);
  }

  /** Approve; the last approval posts it, in the approver's name. */
  @Post('requests/:id/approve')
  @RequirePermission(Permission.VIEW_REPORTS)
  approve(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: NoteDto) {
    return this.approvals.approve(req.user.orgId, req.user.sub, req.user.role, id, body.note);
  }

  @Post('requests/:id/reject')
  @RequirePermission(Permission.VIEW_REPORTS)
  reject(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.approvals.reject(req.user.orgId, req.user.sub, req.user.role, id, body.reason);
  }
}
