import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission, Requirement } from '@shared/admin-auth';
import type { RequestActor } from './auth.guard';

// Deny by default: a route without one of these decorators answers 403 (see AuthGuard).
export const REQUIREMENT = 'requirement';
export const PUBLIC = 'public';

export const Public = () => SetMetadata(PUBLIC, true);
/** At least one of these permissions (none: any back-office user). */
export const Requires = (...any: Permission[]) =>
  SetMetadata(REQUIREMENT, { any } satisfies Requirement);
/** Every one of these permissions, e.g. ('products', 'delete'). */
export const RequiresAll = (...all: Permission[]) =>
  SetMetadata(REQUIREMENT, { all } satisfies Requirement);
export const AdminOnly = () =>
  SetMetadata(REQUIREMENT, { admin: true } satisfies Requirement);
export const OwnerOnly = () =>
  SetMetadata(REQUIREMENT, { owner: true } satisfies Requirement);

/** The verified back-office user (set by AuthGuard; null on public routes without a session). */
export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestActor | null =>
    ctx.switchToHttp().getRequest<{ actor?: RequestActor | null }>().actor ??
    null,
);

/** The verified user's id (shopper or staff), or null without a valid session. */
export const CurrentUserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null =>
    ctx.switchToHttp().getRequest<{ userId?: string | null }>().userId ?? null,
);
