"use client";

import { deliveryApi, type Delivery } from "@/components/admin/delivery/delivery-api";

/**
 * Admin wording for order statuses, in pipeline order. "pending" is an order still to confirm
 * with the customer, "unreachable" one whose customer doesn't answer (still to confirm); "confirmed" means they agreed. "processing" is shown as "Validated":
 * validating an order creates its Colissimo parcel and takes its items out of stock (tracked
 * products). Being delivered is not being paid: payments are tracked separately.
 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
    pending: "To confirm",
    unreachable: "Unreachable",
    confirmed: "Confirmed",
    processing: "Validated",
    shipped: "Shipped",
    delivered: "Delivered",
    returned: "Returned",
    cancelled: "Cancelled",
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
    pending: "orange",
    unreachable: "magenta",
    confirmed: "gold",
    processing: "blue",
    shipped: "cyan",
    delivered: "green",
    returned: "volcano",
    cancelled: "red",
};

/** Payment status of an order: money received is recorded per payment (Finance → Payments). */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
    pending: "Not paid",
    partial: "Partly paid",
    paid: "Paid",
    failed: "Failed",
    refunded: "Refunded",
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
    pending: "default",
    partial: "orange",
    paid: "green",
    failed: "red",
    refunded: "purple",
};

export const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }));

export const orderStatusLabel = (status: string) => ORDER_STATUS_LABELS[status] ?? status;

export interface ValidationResult {
    order: { status: string; stock_deducted: boolean } | null;
    delivery: Delivery | null;
    warning: string | null;
}

/**
 * Validates a pending order: sends its parcel to Colissimo, then validates it (POST /api/delivery,
 * action `validate`). Throws an Error with `code`: NEEDS_DETAILS when a delivery detail must be
 * completed in the send form, COLISSIMO when Colissimo refused (the order stays pending).
 */
export async function validateOrder(orderId: string) {
    return deliveryApi<ValidationResult>({ method: "POST", body: { action: "validate", order_id: orderId } });
}

export const errorCode = (error: unknown) => (error as { code?: string })?.code;

/** Grey square shown when an order line has no photo, or its photo no longer loads. */
export const ORDER_ITEM_IMAGE_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f5f5f5"/></svg>');
