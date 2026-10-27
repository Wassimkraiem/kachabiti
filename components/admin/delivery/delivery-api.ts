"use client";

import { isFinalParcel } from "@/lib/colissimo-data";

/** A parcel as GET /api/delivery returns it. */
export interface Delivery {
    id: string;
    order_id: string | null;
    barcode: string | null;
    label_url: string | null;
    label_zebra_url: string | null;
    status: string;
    status_reason: string | null;
    status_changed_at: string | null;
    recipient_name: string | null;
    phone: string | null;
    governorate: string | null;
    city: string | null;
    address: string | null;
    cod_amount: number | null;
    items_count: number | null;
    designation: string | null;
    created_at: string;
    created_by_email: string | null;
    /** Colissimo marks it paid (v2 tracking). */
    paid: boolean;
    /** What the driver reported on the spot, before Colissimo confirms it. */
    driver_status: string | null;
    driver_reason: string | null;
    manifest_id: number | null;
    handed_over_at: string | null;
    /** The last price change asked of Colissimo (it answers later). */
    price_change: { request_id: number | null; old_price: number | null; new_price: number; reason: string | null; at: string } | null;
    order: { id: string; order_number: string; customer_first_name: string; customer_last_name: string; status: string; total: number } | null;
}

export interface DeliveryList {
    rows: Delivery[];
    configured: { add: boolean; tracking: boolean };
    /** The last automatic check (every 15 minutes), null until the first one. */
    tracking: (RefreshResult & { at: string }) | null;
}

/** A parcel waiting for pickup can be edited at Colissimo. */
export const canEditParcel = (d: Delivery) => !!d.barcode && d.status === "En attente";

/** Once handed over or printed, only its price can change, through a request Colissimo answers. */
export const canRequestPriceChange = (d: Delivery) =>
    !!d.barcode && !canEditParcel(d) && !["sending", "Supprime"].includes(d.status) && !isFinalParcel(d.status, d.paid);

interface ApiResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    code?: string;
    barcode?: string;
}

/** Calls /api/delivery; throws an Error with the server's message (and `code`) on failure. */
export async function deliveryApi<T>(init?: { method?: string; body?: unknown; query?: string }): Promise<T> {
    const response = await fetch(`/api/delivery${init?.query ? `?${init.query}` : ""}`, {
        method: init?.method ?? "GET",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
    });
    const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
    if (!response.ok || !result?.success) {
        const error = new Error(result?.error || `Request failed (${response.status})`) as Error & { code?: string };
        error.code = result?.code;
        throw error;
    }
    return result.data as T;
}

/** Colissimo's answer for one barcode (action `track`), and the parcel in our list if any. */
export interface TrackResult {
    barcode: string;
    status: string;
    reason: string;
    paid: boolean;
    driverStatus: string;
    driverReason: string;
    delivery: Delivery | null;
}

export interface RefreshResult {
    checked: number;
    changed: number;
    failures: { barcode: string; error: string }[];
}

/** Action `handover`: Colissimo's manifest(s), and each refused barcode with its reason. */
export interface HandOverResult {
    manifests: number[];
    accepted: string[];
    refused: { barcode: string; reason: string }[];
}

/** What happened at Colissimo to the parcels of orders just cancelled or deleted (PUT/DELETE /api/orders). */
export interface ParcelCancellation {
    barcode: string;
    deleted: boolean;
    message: string;
}

/** Tells the admin whether the cancelled orders' parcels were deleted at Colissimo, or why not. */
export function reportParcelCancellation(
    parcels: ParcelCancellation[] | undefined,
    notify: { success: (text: string) => void; warning: (text: string, seconds?: number) => void },
    t: (text: string, values?: Record<string, string | number>) => string,
) {
    for (const parcel of parcels ?? []) {
        if (parcel.deleted) notify.success(t("Parcel {barcode} deleted at Colissimo", { barcode: parcel.barcode }));
        else notify.warning(t("Parcel {barcode} is still at Colissimo: {reason}", { barcode: parcel.barcode || "—", reason: t(parcel.message) }), 10);
    }
}

/** DELETE: parcels removed, and those Colissimo already has (kept, with the reason). */
export interface RemoveResult {
    deleted: number;
    kept: { id: string; barcode: string; reason: string }[];
}
