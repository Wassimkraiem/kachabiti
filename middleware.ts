import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server';
import { supportedLanguages, defaultLanguage, detectLanguageFromHeader, isValidLocale } from './lib/language-utils';
import { allows, getAdminRole, getPermissions, type Requirement } from './lib/admin-auth';
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from './lib/auth-session';

const ADMIN_LOGIN_PATH = '/admin/login';

// Admin pages by path prefix (longest match wins). Pages not listed need any back-office user.
const PAGE_PERMISSIONS: [string, Requirement][] = [
    ['/admin/overview', { owner: true }],
    ['/admin/colissimo-account', { owner: true }],
    ['/admin/team', { admin: true }],
    ['/admin/activity', { admin: true }],
    ['/admin/performance', { admin: true }],
    ['/admin/goals', { admin: true }],
    ['/admin/settings', { admin: true }],
    ['/admin/customers', { any: ['customers'] }],
    ['/admin/pos', { any: ['pos'] }],
    ['/admin/purchasing', { any: ['purchasing'] }],
    ['/admin/finance', { any: ['finance'] }],
    ['/admin/marketing', { any: ['marketing'] }],
    ['/admin/trash', { all: ['hard_delete'] }],
    ['/admin/products', { any: ['products'] }],
    ['/admin/categories', { any: ['products'] }],
    ['/admin/variants', { any: ['products'] }],
    ['/admin/orders', { any: ['orders'] }],
    ['/admin/delivery', { any: ['orders'] }],
    ['/admin/stock', { any: ['stock'] }],
    ['/admin/promotions', { any: ['discounts'] }],
    ['/admin/sale-banners', { any: ['marketing'] }],
    ['/admin/reels', { any: ['marketing'] }],
    ['/admin/landing', { any: ['marketing'] }],
    ['/admin/cart-analytics', { any: ['analytics'] }],
];

// What an admin page needs. API requests are checked by the NestJS guard (lib/api-access.ts).
function requirementFor(request: NextRequest): Requirement | null {
    const { pathname } = request.nextUrl;
    const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (!under('/admin') || pathname === ADMIN_LOGIN_PATH) return null;
    return PAGE_PERMISSIONS.find(([prefix]) => under(prefix))?.[1] ?? { any: [] };
}

// The signed-in user from the kb_access cookie set by the NestJS auth API (lib/auth-session.ts),
// verified locally: no round trip per request.
async function getRequestUser(request: NextRequest) {
    const claims = await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, process.env.AUTH_SECRET);
    if (!claims) return null;
    return { id: claims.sub, email: claims.email, app_metadata: claims.app_metadata ?? {} };
}

// kb_access lives 15 minutes. Once it has expired while kb_refresh remains, NestJS issues a new
// one before the request goes on, so pages, API routes and NestJS all see a live session.
// Returns the Set-Cookie lines to pass on to the browser. Pages (and their RSC requests) send
// them; responses proxied to NestJS drop them, so a tab making only API calls renews on each
// call until its next navigation. Harmless: refresh tokens aren't rotated.
async function refreshSession(request: NextRequest): Promise<string[]> {
    if (request.cookies.has(ACCESS_COOKIE) || !request.cookies.has(REFRESH_COOKIE)) return [];
    // Without NEST_URL the call below comes back through here; don't refresh the refresh call.
    if (request.nextUrl.pathname === '/api/auth/refresh') return [];
    try {
        const response = await fetch(`${process.env.NEST_URL ?? request.nextUrl.origin}/api/auth/refresh`, {
            method: 'POST',
            headers: { cookie: request.headers.get('cookie') ?? '' },
        });
        const setCookies = response.headers.getSetCookie();
        // The same cookies on this request, for the route or rewrite it goes on to.
        for (const line of setCookies) {
            const pair = line.split(';')[0];
            const name = pair.slice(0, pair.indexOf('='));
            const value = decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
            if (value) request.cookies.set(name, value);
            else request.cookies.delete(name);
        }
        return setCookies;
    } catch {
        return [];
    }
}

// A signed-in staff member was refused: recorded in the activity log, which alerts the owner
// (private.owner_alerts). Prefetches are skipped: they aren't something the person did.
function logRefusal(request: NextRequest, event: NextFetchEvent) {
    const prefetch = request.headers.get('next-router-prefetch') || request.headers.get('purpose') === 'prefetch';
    if (prefetch) return;
    // NestJS records it under the signed-in user (from the same session cookie).
    event.waitUntil(
        fetch(`${process.env.NEST_URL ?? request.nextUrl.origin}/api/admin/access-denied`, {
            method: 'POST',
            headers: { cookie: request.headers.get('cookie') ?? '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: request.nextUrl.pathname, query: request.nextUrl.search || null }),
        }).catch(() => undefined)
    );
}

// Against CSRF, on top of the SameSite=Lax session cookies: a write to the API sent by a page
// on another host (a sibling subdomain included) is refused. Server-to-server calls (webhooks)
// send no Origin.
function foreignWrite(request: NextRequest) {
    if (!request.nextUrl.pathname.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
    const origin = request.headers.get('origin');
    if (!origin) return false;
    try {
        // The Host the browser used (nextUrl.host is the server's own address in standalone builds).
        return new URL(origin).host !== request.headers.get('host');
    } catch {
        return true;
    }
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
    if (foreignWrite(request)) {
        return NextResponse.json({ success: false, error: 'Cross-site request refused' }, { status: 403 });
    }
    const refreshed = await refreshSession(request);
    const response = await handle(request, event);
    refreshed.forEach((cookie) => response.headers.append('set-cookie', cookie));
    return response;
}

async function handle(request: NextRequest, event: NextFetchEvent) {
    const pathname = request.nextUrl.pathname;

    // Already-signed-in back-office users have no reason to see the login form.
    if (pathname === ADMIN_LOGIN_PATH) {
        if (getAdminRole(await getRequestUser(request))) {
            return NextResponse.redirect(new URL('/admin/dashboard', request.url));
        }
        return NextResponse.next();
    }

    const needed = requirementFor(request);
    if (needed) {
        const user = await getRequestUser(request);
        const role = getAdminRole(user);
        if (!role) {
            const loginUrl = new URL(ADMIN_LOGIN_PATH, request.url);
            loginUrl.searchParams.set('next', pathname);
            return NextResponse.redirect(loginUrl);
        }
        if (!allows(needed, role, getPermissions(user))) {
            logRefusal(request, event);
            return NextResponse.redirect(new URL('/admin/dashboard', request.url));
        }
        return NextResponse.next({ request: { headers: request.headers } });
    }

    if (
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/favicon.ico') ||
        pathname.includes('.')
    ) {
        return NextResponse.next({ request: { headers: request.headers } });
    }

    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        return NextResponse.next({ request: { headers: request.headers } });
    }

    if (pathname === '/api-docs' || pathname.startsWith('/api-docs/') || pathname.startsWith('/api/')) {
        return NextResponse.next({ request: { headers: request.headers } });
    }

    const segments = pathname.split('/');
    if (segments.length >= 3 && segments[2] === 'api-docs') {
        const locale = segments[1];
        if (isValidLocale(locale)) {
            return NextResponse.redirect(new URL('/api-docs', request.url));
        }
    }

    const pathnameIsMissingLocale = supportedLanguages.every(
        (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
    );

    if (pathnameIsMissingLocale) {
        const acceptLanguage = request.headers.get('accept-language');
        const locale = detectLanguageFromHeader(acceptLanguage);
        return NextResponse.redirect(new URL(`/${locale}${pathname}`, request.url));
    }

    const locale = segments[1];
    if (locale && !isValidLocale(locale)) {
        return NextResponse.redirect(new URL(`/${defaultLanguage}${pathname}`, request.url));
    }

    // Lets the root layout set <html lang> for the requested locale.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-locale', locale);
    return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
    // /monitoring is the Sentry tunnel (next.config.ts): no locale prefix, no admin gate.
    matcher: ['/((?!_next|favicon.ico|monitoring).*)'],
};
