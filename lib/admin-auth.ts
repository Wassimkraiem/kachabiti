type AuthUser = { email?: string | null; app_metadata?: Record<string, unknown> };

export type AdminRole = 'owner' | 'admin' | 'staff';

/** Owners and admins have every permission; only owners manage other owners and get owner alerts. */
export const hasFullAccess = (role: AdminRole | null | undefined): boolean => role === 'owner' || role === 'admin';

/**
 * What a staff member can be allowed to do. Admins implicitly have every permission,
 * plus team management, which can't be granted to staff.
 */
export const PERMISSIONS = {
    products: { label: 'Products', description: 'Create and edit products, categories, variants, colors and sizes' },
    stock: { label: 'Stock', description: 'See inventory, record movements and counts, manage locations and suppliers' },
    orders: { label: 'Orders', description: 'See and validate orders and change their status (validating deducts stock)' },
    discounts: { label: 'Discounts', description: 'Create and edit product discounts' },
    marketing: { label: 'Marketing', description: 'Sale banners, video reels and abandoned-cart emails' },
    analytics: { label: 'Analytics', description: 'Cart analytics on the dashboard' },
    costs: { label: 'Costs', description: 'See and edit purchase costs and stock value' },
    customers: { label: 'Customers (CRM)', description: 'Customer records, conversations, follow-ups and the sales pipeline' },
    pos: { label: 'Point of sale', description: 'Sell at the till, open and close the cash register, cash in and out' },
    purchasing: { label: 'Purchasing', description: 'Suppliers, price requests, purchase orders, goods receipts, raw materials and cost prices' },
    finance: { label: 'Finance', description: 'Payments received, carrier payouts, bills and expenses, cash and bank, invoices, accounting and documents' },
    delete: { label: 'Delete', description: 'Delete records in the areas they can edit' },
    hard_delete: { label: 'Permanent delete', description: 'Erase deleted records for good in the areas they can edit (Deleted items)' },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Staff accounts created before per-member permissions get what the Staff role used to allow. */
export const DEFAULT_STAFF_PERMISSIONS: Permission[] = ['products', 'stock', 'orders', 'marketing', 'analytics'];

/** Starting points offered in the Team page; each member's list can still be edited. */
export const PERMISSION_PRESETS: { label: string; permissions: Permission[] }[] = [
    { label: 'Staff', permissions: DEFAULT_STAFF_PERMISSIONS },
    { label: 'Stock clerk', permissions: ['stock'] },
    { label: 'Order manager', permissions: ['orders', 'stock'] },
    { label: 'Content editor', permissions: ['products', 'marketing', 'discounts'] },
    { label: 'Sales agent', permissions: ['orders', 'customers'] },
    { label: 'Cashier', permissions: ['pos', 'customers'] },
    { label: 'Purchasing clerk', permissions: ['purchasing', 'stock'] },
    { label: 'Accountant', permissions: ['finance', 'costs'] },
];

const isPermission = (value: unknown): value is Permission =>
    typeof value === 'string' && (ALL_PERMISSIONS as string[]).includes(value);

const emailList = (value: string | undefined) =>
    (value ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);

/**
 * Back-office role of a signed-in user, or null for shoppers.
 * Only app_metadata is trusted: user_metadata is editable by the user themselves.
 * Emails in OWNER_EMAILS are always owners, and emails in ADMIN_EMAILS always admins.
 */
export function getAdminRole(user: AuthUser | null): AdminRole | null {
    if (!user) return null;

    const role = user.app_metadata?.role;
    const email = user.email?.toLowerCase();
    if (role === 'owner' || (email && emailList(process.env.OWNER_EMAILS).includes(email))) return 'owner';
    if (role === 'admin' || (email && emailList(process.env.ADMIN_EMAILS).includes(email))) return 'admin';

    return role === 'staff' ? 'staff' : null;
}

/** True when the role comes from OWNER_EMAILS / ADMIN_EMAILS rather than the account itself (can't be changed in the Team page). */
export function isRoleFromSettings(user: AuthUser | null): boolean {
    const role = getAdminRole(user);
    return (role === 'owner' || role === 'admin') && user?.app_metadata?.role !== role;
}

/** Permissions of a back-office user: every one for owners and admins, app_metadata.permissions for staff. */
export function getPermissions(user: AuthUser | null): Permission[] {
    const role = getAdminRole(user);
    if (hasFullAccess(role)) return ALL_PERMISSIONS;
    if (role !== 'staff') return [];
    const stored = user?.app_metadata?.permissions;
    return Array.isArray(stored) ? stored.filter(isPermission) : DEFAULT_STAFF_PERMISSIONS;
}

/** Owners and admins. */
export function isAdminUser(user: AuthUser | null): boolean {
    return hasFullAccess(getAdminRole(user));
}

/**
 * What a request needs:
 * - null: public
 * - { any: [] }: any back-office user
 * - { any: [a, b] }: at least one of these permissions
 * - { all: [...] }: every one of these (deletes need the area's permission and `delete`;
 *   permanent deletes need it and `hard_delete`)
 * - { admin: true }: owners and admins only (team management)
 * - { owner: true }: owners only (the money overview)
 * Owners and admins have every permission.
 */
export type Requirement = { any?: Permission[]; all?: Permission[]; admin?: boolean; owner?: boolean };

// Area permission for each back-office API path that is public for GET but gated for writes.
/** Whether a back-office user with this role and these permissions meets a requirement. */
export function allows(requirement: Requirement, role: AdminRole, permissions: Permission[]): boolean {
    if (requirement.owner) return role === 'owner';
    if (hasFullAccess(role)) return true;
    if (requirement.admin) return false;
    const any = requirement.any ?? [];
    return (any.length === 0 || any.some((p) => permissions.includes(p))) && (requirement.all ?? []).every((p) => permissions.includes(p));
}
