import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ai-accounting/shared';

/**
 * Guards all firm-admin routes — only FIRM_ADMIN tokens carrying a firmId may pass.
 * Must be used after AuthGuard('jwt') which populates req.user.
 *
 * The firmId check is not redundant with the role check. Controllers downstream
 * scope every query by req.user.firmId; if that were undefined, Mongoose would
 * coerce it (`new Types.ObjectId(undefined)` mints a *random* id) and the route
 * would silently return an empty set instead of failing. Rejecting here turns a
 * silent wrong answer into a clear 403.
 */
@Injectable()
export class FirmAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { role: string; firmId?: string } }>();

    if (req.user?.role !== UserRole.FIRM_ADMIN) {
      throw new ForbiddenException('Firm admin access required');
    }

    if (!req.user.firmId) {
      throw new ForbiddenException(
        'This account is not linked to a firm. Re-authenticate to refresh your session.',
      );
    }

    return true;
  }
}
