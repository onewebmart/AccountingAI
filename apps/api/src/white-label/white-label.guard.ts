import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ai-accounting/shared';

/**
 * Guards all firm-admin routes — only FIRM_ADMIN tokens may pass.
 * Must be used after AuthGuard('jwt') which populates req.user.
 */
@Injectable()
export class FirmAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { role: string } }>();
    if (req.user?.role !== UserRole.FIRM_ADMIN) {
      throw new ForbiddenException('Firm admin access required');
    }
    return true;
  }
}
