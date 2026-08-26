import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Permission } from '@ai-accounting/shared';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSION_KEY = 'permission';

/** Mark a route as public — bypasses JwtAuthGuard */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Declare which permission is required for a route */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/** Inject the verified JWT payload into a route handler parameter */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    return request.user;
  },
);

export interface JwtPayload {
  sub: string;     // userId
  email: string;
  orgId: string;
  firmId?: string;
  /** Org-level role — what the holder may do to this org's books. */
  role: string;
  /** Firm-level role, present only for someone who runs the practice. */
  firmRole?: string;
  type: 'access' | 'temp';
  iat?: number;
  exp?: number;
}
