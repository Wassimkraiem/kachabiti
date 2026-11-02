import { stockErrorMessage } from '../stock';

// Shared by the Next.js routes (lib/erp/api.ts) and the NestJS API (api/), so relative imports only.

type DbError = { message?: string; code?: string; details?: string };

// Exceptions raised by the database functions, as messages an admin can act on.
export const DB_MESSAGES: [string, string, number][] = [
    ['unbalanced_entry', 'Debits and credits must be equal (and not zero).', 409],
    ['entry_posted', 'This entry is posted and can no longer change. Reverse it instead.', 409],
    ['entry_not_reversible', 'Only posted entries that were not reversed yet can be reversed.', 409],
    ['entry_not_found', 'This entry no longer exists.', 404],
    ['session_already_open', 'A till session is already open at this location.', 409],
    ['session_not_open', 'This till session is closed. Open a new one.', 409],
    ['payment_short', 'The payments do not cover the total.', 409],
    ['order_items_required', 'Add at least one product.', 400],
    ['order_not_editable', 'Only orders still to confirm or confirmed can be edited. Once validated, edit the parcel from the delivery card.', 409],
    ['purchase_order_not_open', 'Goods can only be received on an ordered purchase order.', 409],
    ['purchase_order_closed', 'This purchase order is received or cancelled; its lines can no longer change.', 409],
    ['purchase_order_not_found', 'This purchase order no longer exists.', 404],
    ['line_already_received', 'A line that already received goods cannot be removed.', 409],
    ['line_not_on_order', 'A received line is not on this purchase order.', 400],
    ['receipt_not_pending', 'This receipt was already validated or cancelled.', 409],
    ['receipt_not_found', 'This receipt no longer exists.', 404],
    ['receipt_location_required', 'Choose the location where the goods are stored.', 400],
    ['receipt_empty', 'Enter at least one received quantity.', 400],
    ['product_quantity_must_be_whole', 'Products are received in whole units.', 400],
    ['no_bill_of_materials', 'This product has no bill of materials yet.', 409],
    ['variant_not_found', 'This size/colour no longer exists.', 404],
    ['invalid_quantity', 'Enter a quantity above zero.', 400],
    ['material_not_found', 'This raw material no longer exists.', 404],
    ['invoice_exists', 'This order already has an invoice.', 409],
    ['order_not_invoiceable', 'Cancelled and returned orders cannot be invoiced.', 409],
    ['invoice_already_cancelled', 'This invoice is already cancelled.', 409],
    ['invoice_not_found', 'This invoice no longer exists.', 404],
    ['customer_has_open_orders', 'This customer still has orders in progress.', 409],
    ['same_customer', 'Choose two different customers.', 400],
    ['customer_not_found', 'This customer no longer exists.', 404],
    ['payments_not_open', 'Some payments were already paid out or removed. Reload and try again.', 409],
    ['order_not_found', 'Order not found', 404],
    ['invalid_status', 'Unknown order status.', 400],
    ['append_only', 'History cannot be edited; record a correcting movement instead.', 409],
    ['order_cancelled', 'This order is cancelled.', 409],
    ['invalid_account', 'Choose the till or the bank.', 400],
    ['remittance_not_found', 'This payout no longer exists.', 404],
    ['movement_not_found', 'This movement no longer exists.', 404],
    ['pos_difference_locked', 'Till differences come from closing a session and cannot be removed.', 409],
    ['product_not_found', 'This product no longer exists.', 404],
];

/** Message and status for an error raised by the database, or null when it isn't one we know. */
export function knownDbError(error: unknown): { message: string; status: number; code?: string } | null {
    const e = (error ?? {}) as DbError;
    const message = e.message ?? '';
    if (/insufficient_stock|no_online_location|variants_with_stock|negative_count|invalid_transfer/.test(message)) {
        return { message: stockErrorMessage(e), status: 409, code: 'STOCK' };
    }
    const material = message.match(/insufficient_material:([^:]+):(-?[\d.]+)/);
    if (material) return { message: `Not enough ${material[1]} in stock (${material[2]} left).`, status: 409, code: 'STOCK' };
    for (const [key, text, status] of DB_MESSAGES) {
        if (message.includes(key)) return { message: text, status, code: key.toUpperCase() };
    }
    if (e.code === '23505') return { message: 'This already exists.', status: 409, code: 'DUPLICATE' };
    if (e.code === '23503') return { message: 'This item is still in use elsewhere.', status: 409, code: 'IN_USE' };
    if (e.code === '23514') return { message: 'A value is out of range.', status: 400, code: 'INVALID' };
    if (e.code === '22P02') return { message: 'Invalid data', status: 400, code: 'INVALID' };
    return null;
}
