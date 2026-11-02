"use client";

import { useEffect, useState } from "react";

/** The signed-in account as GET /api/auth/me returns it (sessions are httpOnly cookies). */
export type Customer = { id: string; email: string | null; user_metadata: Record<string, any> };

/** The NestJS auth and account API; a failure throws an Error carrying the API's `code`. */
export async function accountApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`/api/${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
        throw Object.assign(new Error(result.error || `Request failed (${response.status})`), { code: result.code as string | undefined, status: response.status });
    }
    return result.data as T;
}

// One /api/auth/me request per page load, shared by the header and the page.
let current: Promise<Customer | null> | null = null;
const AUTH_EVENT = "kachabity:auth";

/** The signed-in customer, or null. */
export function getCustomer(): Promise<Customer | null> {
    current ??= accountApi<Customer | null>("auth/me").catch(() => null);
    return current;
}

/** Tells every useCustomer() on the page that the session changed (sign-in, sign-out, profile). */
export function announceAuthChange(user: Customer | null) {
    current = Promise.resolve(user);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: user }));
}

export async function signOut() {
    await accountApi("auth/sign-out", { body: {} }).catch(() => undefined);
    announceAuthChange(null);
}

// Why a visitor was sent to the login page; the page explains it in a banner.
export type AuthReason = "favorites" | "review" | "account";

/** Login page URL that returns the visitor to `redirect` afterwards. */
export function authHref(locale: string, options: { redirect?: string; reason?: AuthReason; mode?: "signup" } = {}) {
    const params = new URLSearchParams();
    if (options.redirect) params.set("redirect", options.redirect);
    if (options.reason) params.set("reason", options.reason);
    if (options.mode) params.set("mode", options.mode);
    const query = params.toString();
    return `/${locale}/auth${query ? `?${query}` : ""}`;
}

/** The page the visitor is on now, used as the post-login redirect. */
export function currentPath() {
    if (typeof window === "undefined") return undefined;
    return window.location.pathname + window.location.search;
}

/** Only same-site paths are allowed as a post-login redirect. */
export function safeRedirect(path: string | null, locale: string) {
    return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/auth") && !path.includes("/auth?")
        ? path
        : `/${locale}/settings`;
}

/** Storefront customer session. */
export function useCustomer() {
    const [user, setUser] = useState<Customer | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        getCustomer().then((customer) => {
            if (!active) return;
            setUser(customer);
            setLoading(false);
        });
        const onChange = (event: Event) => {
            setUser((event as CustomEvent<Customer | null>).detail);
            setLoading(false);
        };
        window.addEventListener(AUTH_EVENT, onChange);
        return () => {
            active = false;
            window.removeEventListener(AUTH_EVENT, onChange);
        };
    }, []);

    return { user, loading };
}

/** Display name for a customer: the name they entered at sign-up, else their email's local part. */
export function customerName(user: Customer | null) {
    if (!user) return "";
    const meta = user.user_metadata || {};
    return (meta.full_name || meta.name || user.email?.split("@")[0] || "").trim();
}

/** Sends a logged-out visitor to the login page, returning them here afterwards. */
export function goToLogin(locale: string, reason: AuthReason) {
    window.location.assign(authHref(locale, { redirect: currentPath(), reason }));
}
