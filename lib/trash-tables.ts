import type { Permission } from '@/lib/admin-auth';

/**
 * Tables whose soft-deleted rows can be erased for good (Admin → Deleted items, through
 * public.purge_deleted). Erasing needs `hard_delete` plus the area's permission, checked in
 * middleware.ts. Keep in sync with the list in public.purge_deleted.
 */
export const TRASH_TABLES = {
    products: { permission: 'products', columns: 'id,name,code,deleted_at' },
    product_variants: { permission: 'products', columns: 'id,sku,deleted_at' },
    categories: { permission: 'products', columns: 'id,name,deleted_at' },
    colors: { permission: 'products', columns: 'id,name,display_name,deleted_at' },
    sizes: { permission: 'products', columns: 'id,name,display_name,deleted_at' },
    product_discounts: { permission: 'discounts', columns: 'id,discount_percent,deleted_at,products(name)' },
    promotions: { permission: 'marketing', columns: 'id,title,deleted_at' },
    reels: { permission: 'marketing', columns: 'id,title,deleted_at' },
    hero_sections: { permission: 'marketing', columns: 'id,title,deleted_at' },
    small_cards: { permission: 'marketing', columns: 'id,title,deleted_at' },
    orders: { permission: 'orders', columns: 'id,order_number,customer_email,total,deleted_at' },
    locations: { permission: 'stock', columns: 'id,name,deleted_at' },
    suppliers: { permission: 'stock', columns: 'id,name,deleted_at' },
    collections: { permission: 'stock', columns: 'id,name,deleted_at' },
    team_tickets: { permission: 'delete', columns: 'id,title,deleted_at' },
} as const satisfies Record<string, { permission: Permission; columns: string }>;

export type TrashTable = keyof typeof TRASH_TABLES;

export const isTrashTable = (value: string | null): value is TrashTable =>
    !!value && Object.prototype.hasOwnProperty.call(TRASH_TABLES, value);
