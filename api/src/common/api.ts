import {
  ArgumentsHost,
  BadRequestException,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  PipeTransform,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { SSE_METADATA } from '@nestjs/common/constants';
import { map } from 'rxjs';
import { z } from 'zod';
import { knownDbError } from '@shared/erp/db-messages';

// Port of lib/erp/api.ts: same response shapes, so the admin screens don't change.
// { success: true, data } on success, { success: false, error, code? } on failure.

/** Extra top-level fields beside data, e.g. { success, data, total } for paged lists. */
export class Envelope {
  constructor(
    readonly data: unknown,
    readonly extra: Record<string, unknown>,
  ) {}
}

/** A body sent as is, without the { success, data } wrapper (routes that never had it). */
export class Raw {
  constructor(readonly body: unknown) {}
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    // Server-sent events (@Sse) are sent as they are, one event at a time.
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()))
      return next.handle();
    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof Raw) return value.body;
        if (value instanceof Envelope)
          return { success: true, data: value.data, ...value.extra };
        return { success: true, data: value };
      }),
    );
  }
}

/** A refusal to send back as is, with an optional machine-readable code and extra top-level fields. */
export class ApiError extends HttpException {
  constructor(
    message: string,
    status = 400,
    public readonly code?: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const send = (
      status: number,
      message: string,
      code?: string,
      extra: Record<string, unknown> = {},
    ) =>
      response.status(status).json({
        success: false,
        error: message,
        ...(code ? { code } : {}),
        ...extra,
      });

    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return send(
        400,
        issue
          ? `${issue.path.join('.') || 'data'}: ${issue.message}`
          : 'Invalid data',
        'INVALID',
      );
    }
    if (error instanceof ApiError)
      return send(error.getStatus(), error.message, error.code, error.extra);
    if (error instanceof HttpException)
      return send(error.getStatus(), error.message);
    const known = knownDbError(error);
    if (known) return send(known.status, known.message, known.code);

    const request = http.getRequest<Request>();
    this.logger.error(
      `${request.method} ${request.path}`,
      error instanceof Error ? error.stack : error,
    );
    // Only the route, never the body or customer details.
    Sentry.captureException(error, {
      tags: { route: request.path, method: request.method },
    });
    return send(500, 'Something went wrong. Please try again.');
  }
}

/** Validates a body or query with a zod schema: `@Body(new Zod(schema)) body: z.infer<typeof schema>`. */
export class Zod<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    if (value === undefined) throw new BadRequestException('Invalid JSON body');
    return this.schema.parse(value);
  }
}

/** Ids from `?ids=a,b,c` (bulk actions) or `?id=a`, like lib/request-ids.ts. */
export function idsFrom(query: { id?: unknown; ids?: unknown }): string[] {
  const raw =
    typeof query.ids === 'string'
      ? query.ids
      : typeof query.id === 'string'
        ? query.id
        : '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** URL slug: letters and digits in any script (Arabic names included), everything else one '-'. */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');

// Shared zod pieces, as in lib/erp/api.ts.
export const zMoney = z.number().finite().nonnegative().max(100_000_000);
export const zId = z.guid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const zText = (max = 500) => z.string().trim().max(max);

/** Owners and admins can do anything in an area; this tells staff from them. */
export const isManager = (actor: { role: string } | null | undefined) =>
  actor?.role === 'owner' || actor?.role === 'admin';

/** Query-string helpers, as params() in lib/erp/api.ts. */
export function params(query: Record<string, unknown>) {
  const raw = (name: string) =>
    typeof query[name] === 'string' ? query[name] : undefined;
  return {
    get: (name: string) => raw(name)?.trim() || null,
    int: (name: string, fallback: number, max = 1000) => {
      const value = Number(raw(name));
      return Number.isFinite(value) && value > 0
        ? Math.min(Math.floor(value), max)
        : fallback;
    },
    list: (name: string) =>
      (raw(name) ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    bool: (name: string) => raw(name) === 'true' || raw(name) === '1',
  };
}

/** Period from ?from=&to= (ISO), defaulting to the last `days` days. */
export function period(query: Record<string, unknown>, days = 30) {
  const q = params(query);
  const to = q.get('to') ? new Date(q.get('to')!) : new Date();
  const from = q.get('from')
    ? new Date(q.get('from')!)
    : new Date(to.getTime() - days * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to)
    throw new ApiError('Invalid period');
  return { from, to };
}

/** YYYY-MM-DD of a date in Tunis time (the business's calendar). */
export const tunisDay = (date: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
