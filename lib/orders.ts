import { CartItem } from "./cart-context";

export interface OrderData {
    customerEmail?: string; // Optional - only name and phone are required
    customerFirstName: string;
    customerLastName: string;
    customerPhone: string;
    shippingAddress?: string; // Optional
    shippingCity?: string; // Optional
    shippingState?: string; // Optional
    shippingZip?: string; // Optional
    shippingCountry?: string; // Optional
    items: CartItem[];
    subtotal: number;
    shippingCost: number;
    total: number;
    orderNotes?: string; // Optional customer notes
    userId?: string;
    cartId?: string; // Optional: link order to cart for analytics
}

// Kept in order-types.ts so server code (NestJS, e-mails) can use them without this client module.
import type { Order, OrderItem } from './order-types';
export type { Order, OrderItem };

/**
 * Create a new order via POST /api/orders.
 *
 * Orders are written server-side. When the shopper is signed in, the session
 * cookie lets the server link the order to them.
 */
export async function createOrder(orderData: OrderData): Promise<{ order: Order | null; error: Error | null; code?: string }> {
    try {
        // The server derives the user from the session, never from the payload.
        const payload = { ...orderData, userId: undefined, cartId: undefined };

        const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            // code (e.g. PRICES_CHANGED) lets the checkout show a specific message.
            return { order: null, error: new Error(result.error || "Failed to create order"), code: result.code };
        }

        return { order: result.data as Order, error: null };
    } catch (error) {
        console.error("Error creating order:", error);
        return { order: null, error: error as Error };
    }
}
