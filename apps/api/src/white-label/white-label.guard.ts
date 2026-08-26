import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ai-accounting/shared';

/**
 * Guards all firm-admin routes — the practice side of the product.
 *
 * Firm administration is read from the `firmRole` claim, not `role`. Those are
 * two different axes: `role` says what you may do to one organisation's books,
 * `firmRole` says whether you run the practice those books belong to. Holding
 * them in one field meant enabling practice management overwrote the org role
 * and silently removed every bookkeeping permission the owner had.
 *
 * `role === FIRM_ADMIN` is still accepted, for two reasons: tokens minted before
 * this change are valid for up to 15 minutes, and memberships that predate the
 * migration still carry the old shape. Both drain on their own.
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
      .getRequest<{ user?: { role: string; firmRole?: string; firmId?: string } }>();

    const runsThePractice =
      req.user?.firmRole === UserRole.FIRM_ADMIN || req.user?.role === UserRole.FIRM_ADMIN;

    if (!runsThePractice) {
      throw new ForbiddenException('Firm admin access required');
    }

    if (!req.user?.firmId) {
      throw new ForbiddenException(
        'This account is not linked to a firm. Re-authenticate to refresh your session.',
      );
    }

    return true;
  }
}
