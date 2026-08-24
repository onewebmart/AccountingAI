import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WorkspaceService } from './workspace.service';

interface AuthRequest {
  user: { sub: string; orgId: string; role: string; firmId?: string };
}

/**
 * Backs the app shell. Any signed-in user may read their own workspace —
 * there is no firm-admin guard here, because the sidebar and topbar render for
 * everyone.
 */
@Controller('workspace')
@UseGuards(AuthGuard('jwt'))
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  get(@Request() req: AuthRequest) {
    return this.workspace.forUser(req.user.sub, req.user.orgId, req.user.role);
  }
}
