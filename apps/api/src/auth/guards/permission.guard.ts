import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { IS_PUBLIC_KEY, PERMISSION_KEY, JwtPayload } from '../decorators';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Public routes skip permission check
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @RequirePermission decorator → only authentication is required
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required.');

    const role = user.role as UserRole;
    if (!hasPermission(role, required)) {
      throw new ForbiddenException(
        `Your role (${role}) does not have permission to perform this action.`,
      );
    }

    return true;
  }
}
