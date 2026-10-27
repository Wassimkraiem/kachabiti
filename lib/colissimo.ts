/**
 * Colissimo (colissimodelivery.tn), the delivery company. Server-only: it uses the tokens from
 * the Colissimo sender account (Paramètres → APIs): COLISSIMO_ADD_TOKEN (the full token: create,
 * hand over, edit, price change, delete) and COLISSIMO_TRACKING_TOKEN (read-only: tracking).
 *
 * Parcels are created with the v1 API (post.php: form fields, answers the barcode and label
 * links). Everything else uses the v2 API (/apis-v2, docs: "Documentation des API Colissimo"):
 * JSON with the X-Api-Key header, always HTTP 200, `status` 1 or 0 with a stable `error_code`,
 * batches of up to 200 barcodes (50 for deletion), and per-barcode results in batch answers.
 */
import { COLISSIMO_GOVERNORATES } from '@/lib/colissimo-data';

// COLISSIMO_API_URL / COLISSIMO_API_V2_URL override the addresses for a stand-in server
// (scripts/docker/colissimo-mock.mjs in the local Docker setup and CI).
const BASE_URL = process.env.COLISSIMO_API_URL || 'https://colissimodelivery.tn/api/v1';
const V2_URL = process.env.COLISSIMO_API_V2_URL || 'https://colissimodelivery.tn/apis-v2';
const TIMEOUT_MS = 20_000;

export function colissimoConfigured() {
    return { add: !!process.env.COLISSIMO_ADD_TOKEN, tracking: !!process.env.COLISSIMO_TRACKING_TOKEN };
}

/** Fields of a new parcel, as Colissimo names them. */
export interface ParcelRequest {
    nom: string;
    gouvernerat: string;
    ville: string;
    adresse: string;
    tel: string;
    tel2?: string;
    designation: string;
    nb_article: number;
    /** Cash to collect from the customer, in TND. */
    prix: number;
    msg?: string;
    echange: 'oui' | 'non';
    article?: string;
    nb_echange?: number;
    ouvrir: 0 | 1;
    fragile: 0 | 1;
    type_colis: 1 | 2 | 3;
}

export class ColissimoError extends Error {
    /** `code`: Colissimo's error_code (v2), when it gave one. */
    constructor(message: string, readonly reachable: boolean, readonly code?: string) {
        super(message);
    }
}

async function call(endpoint: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    let response: Response;
    try {
        response = await fetch(`${BASE_URL}/${endpoint}`, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    } catch (error) {
        throw new ColissimoError(`Colissimo could not be reached (${(error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message})`, false);
    }
    const text = await response.text();
    let json: Record<string, unknown>;
    try {
        json = JSON.parse(text);
    } catch {
        throw new ColissimoError(`Colissimo answered ${response.status} with an unexpected response: ${text.slice(0, 200)}`, true);
    }
    if (Number(json.status) !== 1) {
        throw new ColissimoError(String(json.status_message || json.message || `Colissimo refused the request (HTTP ${response.status})`), true);
    }
    return json;
}

/** Creates the parcel. Not retried: a second call would create a second parcel. */
export async function createParcel(parcel: ParcelRequest) {
    const token = process.env.COLISSIMO_ADD_TOKEN;
    if (!token) throw new ColissimoError('COLISSIMO_ADD_TOKEN is not set', false);
    if (!COLISSIMO_GOVERNORATES.includes(parcel.gouvernerat)) throw new ColissimoError(`Unknown governorate: ${parcel.gouvernerat}`, false);
    const json = await call('post.php', {
        nom: parcel.nom,
        gouvernerat: parcel.gouvernerat,
        ville: parcel.ville,
        adresse: parcel.adresse,
        tel: parcel.tel,
        tel2: parcel.tel2 ?? '',
        designation: parcel.designation,
        nb_article: String(parcel.nb_article),
        prix: String(parcel.prix),
        msg: parcel.msg ?? '',
        echange: parcel.echange,
        article: parcel.article ?? '',
        nb_echange: String(parcel.nb_echange ?? 0),
        ouvrir: String(parcel.ouvrir),
        fragile: String(parcel.fragile),
        type_colis: String(parcel.type_colis),
        token,
    });
    const barcode = String(json.status_message ?? '').trim();
    if (!barcode) throw new ColissimoError('Colissimo accepted the parcel but returned no barcode', true);
    return {
        barcode,
        labelUrl: typeof json.lien === 'string' ? json.lien : null,
        labelZebraUrl: typeof json.lien_zebra === 'string' ? json.lien_zebra : null,
    };
}

// ── v2 ──

/** What the admin reads for Colissimo's error codes (the rest show Colissimo's own message). */
const V2_MESSAGES: Record<string, string> = {
    TOKEN_MISSING: 'Colissimo refused the token: check COLISSIMO_ADD_TOKEN / COLISSIMO_TRACKING_TOKEN',
    TOKEN_INVALID: 'Colissimo refused the token: check COLISSIMO_ADD_TOKEN / COLISSIMO_TRACKING_TOKEN',
    RATE_LIMIT: 'Colissimo is busy (too many requests): try again in a minute',
    DB_ERROR: 'Colissimo had an internal error: try again in a moment',
    ORDER_NOT_FOUND: 'Colissimo has no parcel with this barcode',
    ORDER_NOT_EDITABLE: 'Colissimo already has this parcel: only parcels waiting for pickup can be changed',
    ORDER_ALREADY_PRINTED: 'The label is already printed: Colissimo no longer accepts changes to this parcel',
    ORDER_DELIVERED_AND_PAID: 'This parcel is delivered and paid: its price can no longer change',
    PRICE_UNCHANGED: 'The new price is the same as the current one',
    REQUEST_ALREADY_PENDING: "A price change is already waiting for Colissimo's answer for this parcel",
    INVALID_LOCATION: 'Colissimo does not accept this governorate or city',
    INVALID_TEL: 'The phone number must be exactly 8 digits',
    INVALID_TEL2: 'The second phone number must be exactly 8 digits',
    INVALID_PRICE: 'Invalid price (positive, at most 3 decimals)',
};

/**
 * One v2 request. RATE_LIMIT and DB_ERROR are retried once (after Colissimo's retry_after, at
 * most 30 s), as the docs advise. Answers with per-barcode details (`commandes`, `rejetees`) come
 * back even when nothing succeeded, for the caller to read; other refusals throw.
 */
async function callV2(endpoint: string, token: string, body: Record<string, unknown>, retried = false): Promise<Record<string, unknown>> {
    let response: Response;
    try {
        response = await fetch(`${V2_URL}/${endpoint}`, {
            method: 'POST',
            headers: { 'X-Api-Key': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
        });
    } catch (error) {
        throw new ColissimoError(`Colissimo could not be reached (${(error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message})`, false);
    }
    const text = await response.text();
    let json: Record<string, unknown>;
    try {
        json = JSON.parse(text);
    } catch {
        throw new ColissimoError(`Colissimo answered ${response.status} with an unexpected response: ${text.slice(0, 200)}`, true);
    }
    if (Number(json.status) === 1) return json;
    const code = typeof json.error_code === 'string' ? json.error_code : undefined;
    if (!retried && (code === 'RATE_LIMIT' || code === 'DB_ERROR')) {
        const wait = Math.min(Number(json.retry_after) || 2, 30);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        return callV2(endpoint, token, body, true);
    }
    if (json.commandes || json.rejetees) return json;
    throw new ColissimoError((code && V2_MESSAGES[code]) || String(json.status_message || `Colissimo refused the request (${code ?? 'no code'})`), true, code);
}

function fullToken() {
    const token = process.env.COLISSIMO_ADD_TOKEN;
    if (!token) throw new ColissimoError('COLISSIMO_ADD_TOKEN is not set', false);
    return token;
}

const chunks = <T,>(items: T[], size: number) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export interface Tracked {
    /** Colissimo's état (e.g. "En cours", "Livrer"); "Inconnu" for one it doesn't name. */
    status: string;
    /** motif: why, for returns and problems. */
    reason: string;
    /** Colissimo's payment status is "payee". */
    paid: boolean;
    /** What the driver reported on the spot (pre-état / pre-motif), before Colissimo confirms it. */
    driverStatus: string;
    driverReason: string;
}

/** Status of each barcode (null: unknown to Colissimo), 200 per request. */
export async function trackParcels(barcodes: string[]): Promise<Map<string, Tracked | null>> {
    const token = process.env.COLISSIMO_TRACKING_TOKEN;
    if (!token) throw new ColissimoError('COLISSIMO_TRACKING_TOKEN is not set', false);
    const result = new Map<string, Tracked | null>();
    for (const batch of chunks([...new Set(barcodes)], 200)) {
        const json = await callV2('track_order', token, { codes: batch });
        const orders = (json.commandes ?? {}) as Record<string, Record<string, unknown>>;
        for (const code of batch) {
            const row = orders[code];
            const found = row && row.status !== 0 && row.status !== '0';
            result.set(code, found ? {
                status: String(row.etat ?? '').trim() || 'Inconnu',
                reason: String(row.motif ?? '').trim(),
                paid: String(row.status ?? '').trim().toLowerCase() === 'payee',
                driverStatus: String(row['pre-etat'] ?? '').trim(),
                driverReason: String(row['pre-motif'] ?? '').trim(),
            } : null);
        }
    }
    return result;
}

/** One parcel's status; throws when Colissimo doesn't know the barcode. */
export async function trackParcel(barcode: string): Promise<Tracked> {
    const tracked = (await trackParcels([barcode])).get(barcode);
    if (!tracked) throw new ColissimoError(V2_MESSAGES.ORDER_NOT_FOUND, true, 'ORDER_NOT_FOUND');
    return tracked;
}

/** Colissimo's reasons for refusing a hand-over (the docs list these three), in the admin's words. */
const HANDOVER_REASONS: Record<string, string> = {
    'Commande introuvable': 'Colissimo has no parcel with this barcode',
    'Commande non en attente': 'Not waiting for pickup',
    'Commande deja payee': 'Already paid at Colissimo',
};

/**
 * Hands parcels waiting for pickup over to Colissimo: a manifest is created and they become
 * "A enlever". Each batch of 200 is one manifest. Refused ones come back with Colissimo's reason.
 */
export async function handOverParcels(barcodes: string[]) {
    const token = fullToken();
    const accepted: string[] = [];
    const refused: { barcode: string; reason: string }[] = [];
    const manifests: number[] = [];
    for (const batch of chunks([...new Set(barcodes)], 200)) {
        const json = await callV2('validate_orders', token, { codes: batch });
        if (json.id_manifeste != null) manifests.push(Number(json.id_manifeste));
        accepted.push(...((json.validees ?? []) as unknown[]).map(String));
        for (const row of (json.rejetees ?? []) as { code_barre?: unknown; raison?: unknown }[]) {
            const reason = String(row.raison ?? '');
            refused.push({ barcode: String(row.code_barre ?? ''), reason: HANDOVER_REASONS[reason] ?? reason });
        }
    }
    return { manifests, accepted, refused };
}

/** Fields of a parcel waiting for pickup that can change (Colissimo's names). */
export interface ParcelChanges {
    nom?: string;
    adresse?: string;
    designation?: string;
    tel?: string;
    tel2?: string;
    prix?: number;
    nb_article?: number;
    gouvernerat?: string;
    ville?: string;
}

/**
 * Changes a parcel still waiting for pickup and not printed (only the given fields). Answers
 * `changed: false` when Colissimo already had these values, and the updated label links.
 */
export async function editParcel(barcode: string, changes: ParcelChanges) {
    const body: Record<string, unknown> = { code_barre: barcode };
    for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) body[key] = typeof value === 'number' ? String(value) : value;
    }
    try {
        const json = await callV2('edit_order', fullToken(), body);
        return {
            changed: true,
            labelUrl: typeof json.lien === 'string' ? json.lien : null,
            labelZebraUrl: typeof json.lien_zebra === 'string' ? json.lien_zebra : null,
        };
    } catch (error) {
        if (error instanceof ColissimoError && error.code === 'NO_CHANGE') return { changed: false, labelUrl: null, labelZebraUrl: null };
        throw error;
    }
}

/** Asks Colissimo to change a parcel's price (it answers later; the price doesn't change at once). */
export async function requestPriceChange(barcode: string, price: number, reason?: string) {
    const json = await callV2('price_change', fullToken(), {
        code_barre: barcode,
        nouveau_prix: price.toFixed(3),
        ...(reason ? { motif: reason.slice(0, 255) } : {}),
    });
    return {
        requestId: json.id_demande != null ? Number(json.id_demande) : null,
        oldPrice: Number(json.ancien_prix),
        newPrice: Number(json.nouveau_prix),
    };
}

/** Deletes parcels waiting for pickup at Colissimo, 50 per request: each barcode's result. */
export async function deleteParcels(barcodes: string[]) {
    const token = fullToken();
    const result = new Map<string, { deleted: boolean; notFound: boolean; message: string }>();
    for (const batch of chunks([...new Set(barcodes)], 50)) {
        const json = await callV2('delete_order', token, { codes: batch });
        const orders = (json.commandes ?? {}) as Record<string, Record<string, unknown>>;
        for (const code of batch) {
            const row = orders[code] ?? {};
            const error = typeof row.error_code === 'string' ? row.error_code : '';
            result.set(code, {
                deleted: Number(row.status) === 1,
                notFound: error === 'ORDER_NOT_FOUND',
                message: error === 'ORDER_NOT_DELETABLE'
                    ? "Colissimo already has this parcel (picked up, paid or handed over): it can't be deleted"
                    : V2_MESSAGES[error] || String(row.status_message ?? ''),
            });
        }
    }
    return result;
}
