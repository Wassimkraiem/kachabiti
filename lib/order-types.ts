// Order rows as the API returns them. No imports: shared with the NestJS API (api/).

export interface Order {
    id: string;
    order_number: string;
    user_id?: string;
    customer_email: string;
    customer_first_name: string;
    customer_last_name: string;
    customer_phone?: string;
    shipping_address: string;
    shipping_city: string;
    shipping_state?: string;
    shipping_zip?: string;
    shipping_country: string;
    subtotal: number;
    shipping_cost: number;
    total: number;
    order_notes?: string;
    status: string;
    payment_status: string;
    created_at: string;
    updated_at: string;
}

export interface OrderItem {
    id: string;
    order_id: string;
    product_id: string;
    product_name: string;
    product_name_ar?: string;
    product_name_fr?: string;
    product_image?: string;
    variant_id?: string | null;
    /** e.g. "Black / XL" */
    variant_label?: string | null;
    quantity: number;
    price: number;
    subtotal: number;
    created_at: string;
}
