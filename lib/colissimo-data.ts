/**
 * Colissimo reference data shared by the server and the admin: the governorate names its API
 * accepts (spelled exactly as Colissimo lists them) and the parcel statuses it returns.
 */
// Marks admin text translated where it's displayed (same as msg() in lib/admin-i18n.tsx, which
// is client-only; this file is also used by API routes).
const msg = (text: string) => text;

/**
 * Each governorate: the spelling Colissimo requires (`name`, also what orders store), its French
 * and Arabic display names, and other spellings customers type.
 */
const GOVERNORATES: { name: string; fr: string; ar: string; aliases?: string[] }[] = [
    { name: 'Ariana', fr: 'Ariana', ar: 'أريانة', aliases: ['اريانة'] },
    { name: 'Beja', fr: 'Béja', ar: 'باجة' },
    { name: 'Ben Arous', fr: 'Ben Arous', ar: 'بن عروس' },
    { name: 'Bizerte', fr: 'Bizerte', ar: 'بنزرت', aliases: ['Bizert'] },
    { name: 'Gabes', fr: 'Gabès', ar: 'قابس' },
    { name: 'Gafsa', fr: 'Gafsa', ar: 'قفصة' },
    { name: 'Jendouba', fr: 'Jendouba', ar: 'جندوبة' },
    { name: 'Kairouan', fr: 'Kairouan', ar: 'القيروان', aliases: ['Kairaouan'] },
    { name: 'Kasserine', fr: 'Kasserine', ar: 'القصرين' },
    { name: 'Kebili', fr: 'Kébili', ar: 'قبلي' },
    { name: 'LE Kef', fr: 'Le Kef', ar: 'الكاف', aliases: ['Kef', 'El Kef'] },
    { name: 'Mahdia', fr: 'Mahdia', ar: 'المهدية' },
    { name: 'Mannouba', fr: 'La Manouba', ar: 'منوبة', aliases: ['Manouba'] },
    { name: 'Medenine', fr: 'Médenine', ar: 'مدنين', aliases: ['Mednine'] },
    { name: 'Monastir', fr: 'Monastir', ar: 'المنستير' },
    { name: 'Nabeul', fr: 'Nabeul', ar: 'نابل' },
    { name: 'Sfax', fr: 'Sfax', ar: 'صفاقس' },
    { name: 'Sidi Bouzid', fr: 'Sidi Bouzid', ar: 'سيدي بوزيد' },
    { name: 'Siliana', fr: 'Siliana', ar: 'سليانة' },
    { name: 'Sousse', fr: 'Sousse', ar: 'سوسة' },
    { name: 'Tataouine', fr: 'Tataouine', ar: 'تطاوين' },
    { name: 'Tozeur', fr: 'Tozeur', ar: 'توزر' },
    { name: 'Tunis', fr: 'Tunis', ar: 'تونس' },
    { name: 'Zaghouan', fr: 'Zaghouan', ar: 'زغوان' },
];

/** Governorate options for a form, labelled in the given language (en uses the French names). */
export function governorateOptions(locale: string) {
    return GOVERNORATES.map((g) => ({ value: g.name, label: locale === 'ar' ? g.ar : g.fr }));
}

/** Display name of a stored governorate (Colissimo spelling) in the given language. */
export function governorateLabel(name: string | null | undefined, locale: string) {
    const g = GOVERNORATES.find((entry) => entry.name === name);
    return g ? (locale === 'ar' ? g.ar : g.fr) : name ?? '';
}

export const COLISSIMO_GOVERNORATES: string[] = GOVERNORATES.map((g) => g.name);

const normalize = (value: string) =>
    value.normalize('NFD').replace(/[̀-ًͯ-ْ]/g, '').toLowerCase().replace(/[^a-z؀-ۿ]+/g, ' ').trim();

/**
 * Best Colissimo governorate for what the customer typed (region first, then city), or null.
 * A whole-word match wins; "Tunis" doesn't match inside "Tunisie".
 */
export function matchGovernorate(...values: (string | null | undefined)[]): string | null {
    for (const value of values) {
        if (!value) continue;
        const text = ` ${normalize(value)} `;
        // Longer spellings first, so "Ben Arous" or "Sidi Bouzid" win over shorter ones.
        const candidates = GOVERNORATES.flatMap(({ name, fr, ar, aliases = [] }) => [name, fr, ar, ...aliases].map((spelling) => ({ name, spelling: normalize(spelling) })))
            .sort((a, b) => b.spelling.length - a.spelling.length);
        const hit = candidates.find(({ spelling }) => text.includes(` ${spelling} `));
        if (hit) return hit.name;
    }
    return null;
}

export type StatusGroup = 'pending' | 'moving' | 'delivered' | 'returned' | 'problem';

/** Each status Colissimo returns: an English label for the admin (translated with t()), a colour and a group. */
export const COLISSIMO_STATUSES: Record<string, { label: string; color: string; group: StatusGroup }> = {
    'sending': { label: msg('Sending…'), color: 'processing', group: 'pending' },
    'En attente': { label: msg('Waiting for pickup'), color: 'default', group: 'pending' },
    'A enlever': { label: msg('To be picked up'), color: 'default', group: 'pending' },
    'Enleve': { label: msg('Picked up'), color: 'blue', group: 'moving' },
    'Au depot': { label: msg('At the depot'), color: 'blue', group: 'moving' },
    'En cours': { label: msg('Out for delivery'), color: 'geekblue', group: 'moving' },
    'Retour Inter Agence': { label: msg('Between agencies'), color: 'blue', group: 'moving' },
    'A verifier': { label: msg('To be checked'), color: 'orange', group: 'problem' },
    'Non recu': { label: msg('Not received'), color: 'orange', group: 'problem' },
    'Inconnu': { label: msg('Unknown'), color: 'orange', group: 'problem' },
    'Livre': { label: msg('Delivered'), color: 'green', group: 'delivered' },
    'Livre paye': { label: msg('Delivered and paid'), color: 'green', group: 'delivered' },
    'Echange': { label: msg('Exchange'), color: 'purple', group: 'delivered' },
    'Retour Expediteur': { label: msg('Returning to us'), color: 'red', group: 'returned' },
    'Retour depot': { label: msg('Returned to the depot'), color: 'red', group: 'returned' },
    'Retour definitif': { label: msg('Returned'), color: 'red', group: 'returned' },
    'Retour paye': { label: msg('Return paid'), color: 'red', group: 'returned' },
    'Retour recu paye': { label: msg('Return received and paid'), color: 'red', group: 'returned' },
    'Supprime': { label: msg('Deleted at Colissimo'), color: 'default', group: 'problem' },
    // v2 API names (the ones above are v1's; older parcels keep them).
    'Au magasin': { label: msg('At the depot'), color: 'blue', group: 'moving' },
    'Livrer': { label: msg('Delivered'), color: 'green', group: 'delivered' },
    'Rtn depot': { label: msg('Returned to the depot'), color: 'red', group: 'returned' },
    'Rtn client/agence': { label: msg('Returned by the customer'), color: 'red', group: 'returned' },
    'Rtn definitif': { label: msg('Returned'), color: 'red', group: 'returned' },
    'Retour recu': { label: msg('Return received'), color: 'red', group: 'returned' },
    // A driver's report (pre-état) only: on the way back.
    'Retour': { label: msg('Being returned'), color: 'red', group: 'returned' },
};

/**
 * Statuses after which a parcel no longer changes, so tracking skips it. A v2 "Livrer" parcel
 * is final once Colissimo marks it paid (see isFinalParcel).
 */
export const FINAL_STATUSES = ['Livre paye', 'Retour definitif', 'Retour paye', 'Retour recu paye', 'Supprime', 'Rtn definitif', 'Retour recu'];

export const isFinalParcel = (status: string, paid: boolean) => FINAL_STATUSES.includes(status) || (status === 'Livrer' && paid);

/** Where a parcel stands, in a shopper's words (the account page's progress bar). */
export type CustomerStage = 'preparing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'returned' | 'problem';

export function customerStage(status: string): CustomerStage {
    if (status === 'sending' || status === 'En attente') return 'preparing';
    if (status === 'En cours') return 'out_for_delivery';
    const group = statusInfo(status).group;
    if (group === 'moving' || status === 'A enlever') return 'shipped';
    if (group === 'delivered') return 'delivered';
    if (group === 'returned') return 'returned';
    return 'problem';
}

export function statusInfo(status: string) {
    return COLISSIMO_STATUSES[status] ?? { label: status, color: 'default', group: 'problem' as StatusGroup };
}

/** What a parcel needs from an order (the order page and GET /api/orders?id= have all of it). */
export interface OrderForParcel {
    customer_first_name: string;
    customer_last_name: string;
    customer_phone: string;
    shipping_address?: string | null;
    shipping_city?: string | null;
    shipping_state?: string | null;
    total: number;
    payment_status: string;
    order_notes?: string | null;
    items: { product_name: string; variant_label?: string | null; quantity: number }[];
}

/**
 * The Colissimo fields for an order, with the usual options (customer may open, not fragile,
 * small parcel). The cash to collect is the order total unless it's already paid. The
 * governorate is null when it can't be matched; the server checks the result before sending.
 */
export function parcelFromOrder(order: OrderForParcel) {
    const designation = order.items
        .map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.product_name.trim()}${item.variant_label ? ` (${item.variant_label})` : ''}`)
        .join(', ')
        .slice(0, 250);
    const governorate = matchGovernorate(order.shipping_state, order.shipping_city, order.shipping_address);
    return {
        nom: `${order.customer_first_name} ${order.customer_last_name}`.trim().slice(0, 100),
        tel: (order.customer_phone ?? '').replace(/\D/g, '').slice(-8),
        gouvernerat: governorate,
        ville: (order.shipping_city || order.shipping_state || governorate || '').trim().slice(0, 100),
        adresse: (order.shipping_address ?? '').trim().slice(0, 250),
        designation,
        nb_article: order.items.reduce((sum, item) => sum + item.quantity, 0) || 1,
        prix: order.payment_status === 'paid' ? 0 : Number(order.total),
        msg: order.order_notes ? order.order_notes.slice(0, 250) : undefined,
        echange: 'non' as const,
        ouvrir: 1 as const,
        fragile: 0 as const,
        type_colis: 1 as const,
    };
}
