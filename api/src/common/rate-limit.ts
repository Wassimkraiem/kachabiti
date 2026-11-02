import type { Request } from 'express';
import { ApiError } from './api';

// shortcut: per-process memory, so limits reset on restart and aren't shared between instances;
// move them to Postgres or Redis when the API runs on more than one instance.
const hits = new Map<string, number[]>();

/** Refuses with 429 once `key` was used `max` times within `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max)
    throw new ApiError(
      'Too many attempts. Try again later.',
      429,
      'rate_limit',
    );
  recent.push(now);
  if (hits.size > 50_000) hits.clear(); // bounded memory under a flood of distinct keys
  hits.set(key, recent);
}

/** The visitor's address as forwarded by Next.js / the proxy in front of the API. */
export const clientIp = (request: Request) =>
  String(request.headers['x-forwarded-for'] ?? request.ip ?? '')
    .split(',')[0]
    .trim();
