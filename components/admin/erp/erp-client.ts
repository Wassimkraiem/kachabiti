"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";

/** An API refusal: its English message (show it with t()) and code. */
export class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) {
        super(message);
    }
}

/** Calls a back-office JSON route and returns `data`, or throws ApiError with the route's message. */
export async function api<T>(url: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
    const body = init?.body;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const response = await fetch(url, {
        ...init,
        headers: isForm || body === undefined ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) {
        throw new ApiError(json?.error ?? `Request failed (${response.status})`, response.status, json?.code);
    }
    return json.data as T;
}

/** Loads a URL (null: don't) and reloads on demand. */
export function useApi<T>(url: string | null) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(Boolean(url));
    const [error, setError] = useState<string | null>(null);
    // A slow answer for the previous URL must not replace the current one.
    const current = useRef(url);
    useEffect(() => {
        current.current = url;
    }, [url]);
    const load = useCallback(async () => {
        if (!url) return;
        setLoading(true);
        setError(null);
        try {
            const next = await api<T>(url);
            if (current.current === url) setData(next);
        } catch (e) {
            if (current.current === url) setError((e as Error).message);
        } finally {
            if (current.current === url) setLoading(false);
        }
    }, [url]);
    useEffect(() => {
        load();
    }, [load]);
    return { data, loading, error, reload: load, setData };
}

const NUMBER_LOCALES = { en: "en-GB", fr: "fr-FR", ar: "ar-TN" } as const;

/** 1 234,500 TND — Tunisian dinars have 3 decimals (millimes); `digits` lowers that for summaries. */
export function formatMoney(value: number | string | null | undefined, locale: "en" | "fr" | "ar", digits = 3) {
    const n = Number(value ?? 0);
    const text = n.toLocaleString(NUMBER_LOCALES[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${text} TND`;
}

export const formatNumber = (value: number | string | null | undefined, locale: "en" | "fr" | "ar", digits = 0) =>
    Number(value ?? 0).toLocaleString(NUMBER_LOCALES[locale], { maximumFractionDigits: digits });

export const formatDate = (value: string | null | undefined, locale: "en" | "fr" | "ar", withTime = false) =>
    value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleString(NUMBER_LOCALES[locale], withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }) : "—";

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "last_month" | "year" | "custom";

/** [start, end) of a period in local time. */
export function periodRange(period: Period, custom: [Dayjs, Dayjs] | null): [Dayjs, Dayjs] {
    const now = dayjs();
    switch (period) {
        case "today": return [now.startOf("day"), now.endOf("day")];
        case "yesterday": return [now.subtract(1, "day").startOf("day"), now.subtract(1, "day").endOf("day")];
        case "7d": return [now.subtract(6, "day").startOf("day"), now.endOf("day")];
        case "month": return [now.startOf("month"), now.endOf("day")];
        case "last_month": return [now.subtract(1, "month").startOf("month"), now.subtract(1, "month").endOf("month")];
        case "year": return [now.startOf("year"), now.endOf("day")];
        case "custom": if (custom) return [custom[0].startOf("day"), custom[1].endOf("day")]; break;
    }
    return [now.subtract(29, "day").startOf("day"), now.endOf("day")];
}

/** YYYY-MM-DD in local time. */
export const day = (d: Dayjs | Date | string) => dayjs(d).format("YYYY-MM-DD");

/** Opens a CSV/HTML route as a download. */
export function download(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
}
