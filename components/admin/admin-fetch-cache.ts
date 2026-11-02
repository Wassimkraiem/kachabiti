"use client";

/**
 * In-memory browser cache for the small lookup lists every admin form loads (categories,
 * colors, sizes, suppliers, collections, locations). Without it each page refetches them,
 * which costs a full round trip to the API every time on a slow connection.
 *
 * Installed once by app/admin/layout.tsx as a thin wrapper around window.fetch:
 * - GET to a cached path is answered from memory for up to TTL_MS (in-flight requests are shared).
 * - Any other method to the same path clears it, so this tab sees its own edits at once.
 * Edits made elsewhere show up after TTL_MS or a page reload.
 */
const CACHED_PATHS = new Set([
    "/api/categories",
    "/api/colors",
    "/api/sizes",
    "/api/stock/suppliers",
    "/api/stock/collections",
    "/api/stock/locations",
]);
const TTL_MS = 5 * 60 * 1000;

interface Entry {
    at: number;
    response: Promise<{ status: number; headers: [string, string][]; body: string }>;
}

const entries = new Map<string, Entry>();
let installed = false;

export function installAdminFetchCache() {
    if (installed || typeof window === "undefined") return;
    installed = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request ? request.url : String(input), window.location.origin);
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

        if (url.origin !== window.location.origin || !CACHED_PATHS.has(url.pathname)) {
            return originalFetch(input, init);
        }
        if (method !== "GET") {
            for (const key of entries.keys()) if (key.startsWith(url.pathname)) entries.delete(key);
            return originalFetch(input, init);
        }

        const key = url.pathname + url.search;
        let entry = entries.get(key);
        if (!entry || Date.now() - entry.at > TTL_MS) {
            const response = originalFetch(input, init).then(async (res) => ({
                status: res.status,
                headers: [...res.headers.entries()],
                body: await res.text(),
            }));
            entry = { at: Date.now(), response };
            entries.set(key, entry);
            // Never keep failures.
            response.then((r) => r.status >= 400 && entries.delete(key)).catch(() => entries.delete(key));
        }
        const cached = await entry.response;
        return new Response(cached.body, { status: cached.status, headers: cached.headers });
    };
}
