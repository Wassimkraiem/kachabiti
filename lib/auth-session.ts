import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

// Sessions issued by the NestJS API (/api/auth/*), read by middleware.ts and the NestJS guard.
// Both cookies are httpOnly: the browser never sees the tokens.
// - kb_access: a short-lived JWT (HS256, AUTH_SECRET) carrying the id, e-mail and app_metadata
//   (role, permissions), so lib/admin-auth.ts reads it like the old Supabase claims.
// - kb_refresh: a random token whose hash is a row in user_sessions; it renews kb_access.
export const ACCESS_COOKIE = 'kb_access';
export const REFRESH_COOKIE = 'kb_refresh';
export const ACCESS_SECONDS = 15 * 60;
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;

const ISSUER = 'kachabity';
const key = (secret: string) => new TextEncoder().encode(secret);

export interface SessionClaims extends JWTPayload {
    sub: string;
    email: string | null;
    app_metadata: Record<string, unknown>;
}

export function signAccessToken(
    user: { id: string; email: string | null; app_metadata: Record<string, unknown> },
    secret: string
): Promise<string> {
    return new SignJWT({ email: user.email, app_metadata: user.app_metadata })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_SECONDS}s`)
        .sign(key(secret));
}

/** The verified claims, or null for a missing, expired or forged token. */
export async function verifyAccessToken(token: string | null | undefined, secret: string | undefined): Promise<SessionClaims | null> {
    if (!token || !secret) return null;
    try {
        const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, algorithms: ['HS256'] });
        return typeof payload.sub === 'string' ? (payload as SessionClaims) : null;
    } catch {
        return null;
    }
}

/** One cookie's value from a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
    for (const part of (header ?? '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return decodeURIComponent(value.join('='));
    }
    return null;
}
