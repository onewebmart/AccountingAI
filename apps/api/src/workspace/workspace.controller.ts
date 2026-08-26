import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { WorkspaceService } from './workspace.service';
import { PracticeSetupService } from './practice-setup.service';

interface AuthRequest {
  user: { sub: string; orgId: string; role: string; firmRole?: string; firmId?: string };
}

/**
 * Backs the app shell. Any signed-in user may read their own workspace —
 * there is no firm-admin guard here, because the sidebar and topbar render for
 * everyone.
 */
export class EnablePracticeDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  firmName?: string;
}

@Controller('workspace')
@UseGuards(AuthGuard('jwt'))
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly practice: PracticeSetupService,
  ) {}

  @Get()
  get(@Request() req: AuthRequest) {
    return this.workspace.forUser(req.user.sub, req.user.orgId, req.user.role, req.user.firmRole);
  }

  /**
   * Turns on practice management for this org.
   *
   * Deliberately not behind FirmAdminGuard: nobody can be a firm admin before
   * the firm exists, so guarding this on the role it creates would make it
   * unreachable.
   */
  @Post('practice')
  enablePractice(@Request() req: AuthRequest, @Body() dto: EnablePracticeDto) {
    return this.practice.enable(req.user.orgId, req.user.sub, dto.firmName);
  }
}
