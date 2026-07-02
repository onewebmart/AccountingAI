import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermission } from '../auth/decorators';
import { Permission, UserRole } from '@ai-accounting/shared';
import { OrgSettingsService, UpdateSettingsDto } from './org-settings.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

@Controller('settings')
@UseGuards(AuthGuard('jwt'))
export class OrgSettingsController {
  constructor(private readonly orgSettingsService: OrgSettingsService) {}

  // ── Company settings ─────────────────────────────────────────────────────────

  @Get()
  @RequirePermission(Permission.MANAGE_ORG)
  getSettings(@Request() req: AuthRequest) {
    return this.orgSettingsService.getSettings(req.user.orgId);
  }

  @Patch()
  @RequirePermission(Permission.MANAGE_ORG)
  updateSettings(
    @Request() req: AuthRequest,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.orgSettingsService.updateSettings(req.user.orgId, req.user.sub, dto);
  }

  // ── Team management ───────────────────────────────────────────────────────────

  @Get('team')
  @RequirePermission(Permission.MANAGE_USERS)
  getTeam(@Request() req: AuthRequest) {
    return this.orgSettingsService.getTeamMembers(req.user.orgId);
  }

  @Post('team')
  @RequirePermission(Permission.MANAGE_USERS)
  inviteTeamMember(
    @Request() req: AuthRequest,
    @Body() body: { email: string; role: UserRole },
  ) {
    return this.orgSettingsService.inviteTeamMember(
      req.user.orgId,
      req.user.sub,
      body.email,
      body.role,
    );
  }

  @Delete('team/:userId')
  @RequirePermission(Permission.MANAGE_USERS)
  removeTeamMember(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
  ) {
    return this.orgSettingsService.removeTeamMember(req.user.orgId, req.user.sub, userId);
  }
}
