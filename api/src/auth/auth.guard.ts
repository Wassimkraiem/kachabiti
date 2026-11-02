import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import {
  allows,
  getAdminRole,
  getPermissions,
  type AdminRole,
  type Permission,
  type Requirement,
} from '@shared/admin-auth';
import { apiRequirement } from '@shared/api-access';
import {
  ACCESS_COOKIE,
  readCookie,
  verifyAccessToken,
} from '@shared/auth-session';
import { config } from '../config';
import { Database } from '../db/database';
import { PUBLIC, REQUIREMENT } from './decorators';

export interface RequestActor {
  userId: string;
  email: string | null;
  role: AdminRole;
  permissions: Permission[];
}

/** The session's access token: the kb_access cookie, or `Authorization: Bearer` (scripts, tests). */
export function accessToken(request: Pick<Request, 'headers'>): string | null {
  return (
    readCookie(request.headers.cookie, ACCESS_COOKIE) ??
    request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ??
    null
  );
}

/** An external system reading the inventory with STOCK_API_KEY (x-api-key), as middleware.ts allows. */
function hasStockApiKey(request: Request, pathname: string): boolean {
  const key = request.headers['x-api-key'];
  if (
    !config.STOCK_API_KEY ||
    typeof key !== 'string' ||
    pathname !== '/api/stock/inventory' ||
    request.method !== 'GET'
  )
    return false;
  const a = Buffer.from(key);
  const b = Buffer.from(config.STOCK_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Port of the back-office gate in middleware.ts: every route is refused unless a decorator opens it. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { actor?: RequestActor | null; userId?: string | null }
      >();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, targets);
    const requirement = this.reflector.getAllAndOverride<Requirement>(
      REQUIREMENT,
      targets,
    );

    const claims = await this.verify(request);
    request.actor = claims ? this.actorFrom(claims) : null;
    // Any verified user, shoppers included (checkout links the order to them).
    request.userId = typeof claims?.sub === 'string' ? claims.sub : null;

    // The same table middleware.ts uses (lib/api-access.ts), plus the route's own decorator.
    const url = new URL(request.originalUrl, 'http://api');
    if (hasStockApiKey(request, url.pathname)) return true;
    const rules = [
      apiRequirement(
        url.pathname,
        request.method.toUpperCase(),
        url.searchParams,
      ),
      requirement,
    ].filter((rule): rule is Requirement => !!rule);
    if (rules.length === 0) {
      if (isPublic) return true;
      throw new ForbiddenException('This route has no access rule');
    }
    if (!claims) throw new UnauthorizedException('Sign in again');
    const actor = request.actor;
    if (!actor) throw new ForbiddenException('Forbidden');
    if (!rules.every((rule) => allows(rule, actor.role, actor.permissions))) {
      await this.logRefusal(request, actor);
      throw new ForbiddenException('Forbidden');
    }
    return true;
  }

  private async verify(request: Request): Promise<JWTPayload | null> {
    return verifyAccessToken(accessToken(request), config.AUTH_SECRET);
  }

  private actorFrom(claims: JWTPayload): RequestActor | null {
    const user = {
      email: typeof claims.email === 'string' ? claims.email : null,
      app_metadata: (claims.app_metadata ?? {}) as Record<string, unknown>,
    };
    const role = getAdminRole(user);
    if (!role || typeof claims.sub !== 'string') return null;
    return {
      userId: claims.sub,
      email: user.email,
      role,
      permissions: getPermissions(user),
    };
  }

  // Recorded in the activity log, which alerts the owner (private.owner_alerts). Never fails the request.
  private async logRefusal(request: Request, actor: RequestActor) {
    if (
      request.headers['next-router-prefetch'] ||
      request.headers.purpose === 'prefetch'
    )
      return;
    const [path, query] = request.originalUrl.split('?');
    await this.db
      .insertInto('activity_log')
      .values({
        actor_id: actor.userId,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'access_denied',
        entity: 'access',
        label: `${request.method} ${path}`,
        changes: JSON.stringify({ query: query ? `?${query}` : null }),
      })
      .execute()
      .catch(() => undefined);
  }
}
