import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ai-accounting/shared';

/**
 * Guards all platform-admin routes — only PLATFORM_SUPER_ADMIN tokens may pass.
 * Must be used after AuthGuard('jwt') which populates req.user.
 * This is a separate guard (not a Permission) to prevent any platform ability
 * from leaking into regular tenant JWTs.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { role: string } }>();
    if (req.user?.role !== UserRole.PLATFORM_SUPER_ADMIN) {
      throw new ForbiddenException('Platform admin access required');
    }
    return true;
  }
}
