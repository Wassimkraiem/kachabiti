import type { Permission, Requirement } from '@/lib/admin-auth';
import { TRASH_TABLES, isTrashTable } from '@/lib/trash-tables';

// What each back-office API request needs, enforced by middleware.ts (Next.js routes) and by the
// NestJS guard (api/src/auth/auth.guard.ts), so both apply the same rules. null means public.
// Shared with api/: no Next.js imports here.

const MUTATION_PERMISSIONS: Record<string, Permission[]> = {
    '/api/categories': ['products'],
    '/api/colors': ['products'],
    '/api/sizes': ['products'],
    '/api/variants': ['products'],
    '/api/products': ['products'],
    '/api/product-images': ['products'],
    '/api/upload/image': ['products', 'marketing'],
    '/api/promotions': ['discounts'],
    '/api/sale-banners': ['marketing'],
    '/api/reels': ['marketing'],
    '/api/cart/send-recovery-emails': ['marketing'],
};

const withDelete = (method: string, area: Permission[]): Requirement =>
    method === 'DELETE' ? { any: area, all: ['delete'] } : { any: area };

export function apiRequirement(pathname: string, method: string, searchParams: URLSearchParams): Requirement | null {
    const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

    // The owner's money overview.
    if (under('/api/owner')) return { owner: true };
    if (under('/api/admin/team') || under('/api/admin/activity') || under('/api/admin/performance')) return { admin: true };
    // Objectives and business settings are managed by owners and admins; anyone signed in reads
    // their own objectives through /api/admin/my-work.
    if (under('/api/admin/goals') || under('/api/admin/erp-settings')) return { admin: true };
    // Permanent deletes: `hard_delete` plus the permission of the area the table belongs to.
    if (under('/api/admin/trash')) {
        const table = searchParams.get('table');
        return { all: isTrashTable(table) ? [TRASH_TABLES[table].permission, 'hard_delete'] : ['hard_delete'] };
    }
    if (under('/api/admin')) return { any: [] };
    if (under('/api/stock/costs')) return { any: ['costs'] };
    // Product forms, purchase orders, the till and bills read suppliers, collections and locations too.
    if (['/api/stock/suppliers', '/api/stock/collections', '/api/stock/locations'].some(under) && method === 'GET') {
        return { any: ['stock', 'products', 'purchasing', 'pos', 'finance'] };
    }
    // Purchase orders and the till pick variants from the inventory list.
    if (pathname === '/api/stock/inventory' && method === 'GET') return { any: ['stock', 'purchasing', 'pos'] };
    // Purchasing manages its suppliers (terms, tax id, bank details).
    if (under('/api/stock/suppliers')) return withDelete(method, ['stock', 'purchasing']);
    // Manual orders, assignment, confirmation and duplicate checks.
    if (under('/api/sales/orders')) return withDelete(method, ['orders']);
    // Money received and carrier payouts. Agents can see an order's payments.
    if (under('/api/sales/payments') && method === 'GET') return { any: ['finance', 'orders'] };
    if (under('/api/sales')) return withDelete(method, ['finance']);
    // Order pages look up a customer by phone to warn about duplicates.
    if (under('/api/customers') && method === 'GET') return { any: ['customers', 'orders', 'pos'] };
    if (under('/api/customers') || under('/api/crm')) return withDelete(method, ['customers']);
    if (under('/api/pos')) return withDelete(method, ['pos']);
    if (under('/api/purchasing')) return withDelete(method, ['purchasing']);
    if (under('/api/finance')) return withDelete(method, ['finance']);
    // Campaigns: the order forms list them; marketing manages them and their spend.
    if (under('/api/marketing/campaigns') && method === 'GET') return { any: ['marketing', 'orders', 'finance'] };
    if (under('/api/marketing')) return withDelete(method, ['marketing']);
    if (under('/api/stock')) return withDelete(method, ['stock']);
    if (pathname === '/api/cart/analytics') return { any: ['analytics'] };
    // Home page curation: reads and writes are back-office only.
    if (under('/api/landing')) return { any: ['marketing'] };
    // Admin product lists also feed the discount, banner, stock, order, purchasing and costing screens.
    if (pathname === '/api/products' && searchParams.get('admin') === 'true' && method === 'GET') {
        return { any: ['products', 'discounts', 'marketing', 'stock', 'orders', 'purchasing', 'finance'] };
    }
    if (pathname === '/api/orders' && method !== 'POST') return withDelete(method, ['orders']);
    // Colissimo parcels: sending orders, tracking and removing them from the list.
    if (under('/api/delivery')) return withDelete(method, ['orders']);
    const area = MUTATION_PERMISSIONS[pathname];
    if (area && method !== 'GET') return withDelete(method, area);
    return null;
}
