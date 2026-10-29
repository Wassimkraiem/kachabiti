// A stand-in for Colissimo's APIs in the local Docker setup and CI (docs/DOCKER.md): the v1
// parcel creation (post.php) and the v2 APIs from "Documentation des API Colissimo" (track,
// validate, price change, edit, delete), with their rules and error codes. Parcels live in memory.
// Tests play Colissimo's side through /__mock: POST /__mock/parcel {barcode, etat, paid,
// printed, pre_etat, …} changes a parcel, GET /__mock/parcel?barcode= reads one, POST /__mock/reset,
// POST /__mock/down {down} makes Colissimo unreachable.
// Tokens: COLISSIMO_ADD_TOKEN (full) and COLISSIMO_TRACKING_TOKEN (read-only), as the API uses them.
import { createServer } from 'node:http';

const FULL = process.env.COLISSIMO_ADD_TOKEN || 'local-colissimo-token';
const STATE = process.env.COLISSIMO_TRACKING_TOKEN || 'local-colissimo-state-token';
const GOVERNORATES = ['Ariana', 'Beja', 'Ben Arous', 'Bizerte', 'Gabes', 'Gafsa', 'Jendouba', 'Kairouan', 'Kasserine', 'Kebili', 'LE Kef', 'Mahdia', 'Mannouba', 'Medenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid', 'Siliana', 'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'];

let parcels = new Map();
let down = false;
// Starts from the clock so a restarted stand-in never repeats a barcode the database already has.
let nextBarcode = 400000000000 + (Math.floor(Date.now() / 1000) % 100000000) * 10;
let nextManifest = 1;
let nextRequest = 1;

const fail = (error_code, status_message, extra = {}) => ({ status: 0, error_code, status_message: `ERREUR!. ${status_message}`, ...extra });
const codesOf = (value) => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(',')).map((c) => String(c).trim().slice(0, 12)).filter(Boolean))];
const price = (value) => {
    const text = String(value ?? '').replace(/dt/i, '').replace(',', '.').trim();
    return /^\d{1,5}(\.\d{1,3})?$/.test(text) && Number(text) > 0 ? Number(text) : null;
};

function trackOrder(body) {
    const codes = codesOf(body.codes);
    if (codes.length === 0) return fail('MISSING_PARAM', 'Parametre codes manquant');
    if (codes.length > 200) return fail('TOO_MANY_CODES', 'Plus de 200 codes');
    const commandes = {};
    for (const code of codes) {
        const p = parcels.get(code);
        commandes[code] = p
            ? {
                status: p.paid ? 'payee' : 'Non payee',
                etat: p.etat,
                motif: p.motif ?? '',
                'pre-etat': p.etat === 'En cours' ? p.pre_etat ?? 'En cours' : '',
                'pre-motif': p.etat === 'En cours' ? p.pre_motif ?? '' : '',
                status_message: code,
            }
            : { status: 0, etat: '', motif: '', status_message: 'ERREUR!. Commande introuvable' };
    }
    return { status: 1, nb_demandes: codes.length, commandes };
}

function validateOrders(body) {
    const codes = codesOf(body.codes);
    if (codes.length === 0) return fail('MISSING_PARAM', 'Parametre codes manquant');
    if (codes.length > 200) return fail('TOO_MANY_CODES', 'Plus de 200 codes');
    const validees = [];
    const rejetees = [];
    for (const code of codes) {
        const p = parcels.get(code);
        if (!p) rejetees.push({ code_barre: code, raison: 'Commande introuvable' });
        else if (p.paid) rejetees.push({ code_barre: code, raison: 'Commande deja payee' });
        else if (p.etat !== 'En attente') rejetees.push({ code_barre: code, raison: 'Commande non en attente' });
        else validees.push(code);
    }
    if (validees.length === 0) return fail('NO_ORDER_VALIDATED', 'Aucune commande validee', { id_manifeste: null, validees, rejetees });
    for (const code of validees) parcels.get(code).etat = 'A enlever';
    return { status: 1, status_message: 'OK', id_manifeste: nextManifest++, nb_demandes: codes.length, nb_validees: validees.length, validees, rejetees };
}

function priceChange(body) {
    const code = String(body.code_barre ?? '').trim();
    if (!code) return fail('MISSING_PARAM', 'Parametre code_barre manquant');
    if (code.length > 12) return fail('INVALID_CODE', 'code_barre invalide');
    if (body.nouveau_prix === undefined) return fail('MISSING_PARAM', 'Parametre nouveau_prix manquant');
    const value = price(body.nouveau_prix);
    if (value === null) return fail('INVALID_PRICE', 'nouveau_prix invalide');
    const p = parcels.get(code);
    if (!p) return fail('ORDER_NOT_FOUND', 'Commande introuvable');
    if (p.paid && ['Livrer', 'Livre'].includes(p.etat)) return fail('ORDER_DELIVERED_AND_PAID', 'Colis livre et paye');
    if (value === p.prix) return fail('PRICE_UNCHANGED', 'Prix identique');
    if (p.price_request) return fail('REQUEST_ALREADY_PENDING', 'Demande deja en attente');
    p.price_request = { id: nextRequest++, nouveau_prix: value, motif: body.motif ?? '' };
    return { status: 1, status_message: 'Demande envoyee', id_demande: p.price_request.id, code_barre: code, ancien_prix: p.prix.toFixed(3), nouveau_prix: value.toFixed(3), statut: 'En attente' };
}

const EDITABLE = {
    nom: (v) => (String(v).trim() && String(v).length <= 100 ? String(v).trim() : 'INVALID_NOM'),
    adresse: (v) => (String(v).trim() && String(v).length <= 255 ? String(v).trim() : 'INVALID_ADRESSE'),
    designation: (v) => (String(v).trim() && String(v).length <= 255 ? String(v).trim() : 'INVALID_DESIGNATION'),
    tel: (v) => (/^\d{8}$/.test(String(v)) ? String(v) : 'INVALID_TEL'),
    tel2: (v) => (/^(\d{8})?$/.test(String(v)) ? String(v) : 'INVALID_TEL2'),
    prix: (v) => price(v) ?? 'INVALID_PRICE',
    nb_article: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 9999 ? Number(v) : 'INVALID_NB_ARTICLE'),
    gouvernerat: (v) => (GOVERNORATES.includes(String(v)) ? String(v) : 'INVALID_LOCATION'),
    ville: (v) => (String(v).trim() && String(v).length <= 100 ? String(v).trim() : 'INVALID_LOCATION'),
};

function editOrder(body) {
    const code = String(body.code_barre ?? '').trim();
    if (!code) return fail('MISSING_PARAM', 'Parametre code_barre manquant');
    if (code.length > 12) return fail('INVALID_CODE', 'code_barre invalide');
    const fields = Object.keys(EDITABLE).filter((key) => body[key] !== undefined);
    if (fields.length === 0) return fail('MISSING_PARAM', 'Aucun champ a modifier');
    const values = {};
    for (const key of fields) {
        const value = EDITABLE[key](body[key]);
        if (typeof value === 'string' && value.startsWith('INVALID_')) return fail(value, `${key} invalide`);
        values[key] = value;
    }
    const p = parcels.get(code);
    if (!p) return fail('ORDER_NOT_FOUND', 'Commande introuvable');
    if (p.etat !== 'En attente') return fail('ORDER_NOT_EDITABLE', 'Seule une commande en attente peut etre modifiee');
    if (p.printed) return fail('ORDER_ALREADY_PRINTED', 'Commande deja imprimee');
    const modifications = {};
    for (const [key, value] of Object.entries(values)) {
        if (p[key] !== value) modifications[key] = { ancien: p[key], nouveau: value };
        p[key] = value;
    }
    if (Object.keys(modifications).length === 0) return fail('NO_CHANGE', 'Aucune modification');
    return { status: 1, status_message: 'Commande modifiee', code_barre: code, modifications, lien: `https://colissimo.local/print/imprimer.php?code=${code}`, lien_zebra: `https://colissimo.local/print/zebra.php?code=${code}` };
}

function deleteOrder(body) {
    const codes = codesOf(body.codes);
    if (codes.length === 0) return fail('MISSING_PARAM', 'Parametre codes manquant');
    if (codes.length > 50) return fail('TOO_MANY_CODES', 'Plus de 50 codes');
    const commandes = {};
    let deleted = 0;
    for (const code of codes) {
        const p = parcels.get(code);
        if (!p) commandes[code] = { status: 0, error_code: 'ORDER_NOT_FOUND', status_message: 'ERREUR!. Commande introuvable' };
        else if (p.etat !== 'En attente' || p.paid) commandes[code] = { status: 0, error_code: 'ORDER_NOT_DELETABLE', status_message: 'ERREUR!. Seule une commande en attente peut etre supprimee' };
        else {
            p.etat = 'Supprime';
            deleted += 1;
            commandes[code] = { status: 1, status_message: 'Commande supprimee' };
        }
    }
    return { status: deleted ? 1 : 0, status_message: deleted ? 'Traitement termine' : 'Aucune commande supprimee', nb_demandes: codes.length, nb_supprimes: deleted, nb_echecs: codes.length - deleted, commandes };
}

const V2 = { track_order: [trackOrder, 'state'], validate_orders: [validateOrders], price_change: [priceChange], edit_order: [editOrder], delete_order: [deleteOrder] };

async function handle(request) {
    const url = new URL(request.url);
    const json = (data) => Response.json(data);

    if (url.pathname === '/__mock/reset' && request.method === 'POST') {
        parcels = new Map();
        down = false;
        return json({ ok: true });
    }
    // POST /__mock/down {down: true}: Colissimo answers nothing usable until it's set back.
    if (url.pathname === '/__mock/down' && request.method === 'POST') {
        down = !!(await request.json()).down;
        return json({ down });
    }
    if (down && !url.pathname.startsWith('/__mock')) return new Response('Service Unavailable', { status: 503 });
    if (url.pathname === '/__mock/parcel') {
        if (request.method === 'GET') return json(parcels.get(url.searchParams.get('barcode')) ?? null);
        const { barcode, ...changes } = await request.json();
        const p = parcels.get(barcode);
        if (!p) return Response.json({ error: 'unknown barcode' }, { status: 404 });
        Object.assign(p, changes);
        return json(p);
    }

    if (url.pathname === '/api/v1/post.php' && request.method === 'POST') {
        const form = await request.formData();
        if (form.get('token') !== FULL) return json({ status: 0, status_message: 'Token invalide' });
        if (!GOVERNORATES.includes(String(form.get('gouvernerat')))) return json({ status: 0, status_message: 'Gouvernorat invalide' });
        const code = String(nextBarcode++);
        parcels.set(code, {
            barcode: code, etat: 'En attente', paid: false, printed: false,
            nom: String(form.get('nom')), adresse: String(form.get('adresse')), tel: String(form.get('tel')), tel2: String(form.get('tel2') ?? ''),
            designation: String(form.get('designation')), prix: Number(form.get('prix')), nb_article: Number(form.get('nb_article')),
            gouvernerat: String(form.get('gouvernerat')), ville: String(form.get('ville')),
        });
        return json({ status: 1, status_message: code, lien: `https://colissimo.local/print/imprimer.php?code=${code}`, lien_zebra: `https://colissimo.local/print/zebra.php?code=${code}` });
    }

    const endpoint = url.pathname.startsWith('/apis-v2/') ? url.pathname.slice('/apis-v2/'.length) : null;
    if (endpoint !== null) {
        if (request.method !== 'POST') return json(fail('METHOD_NOT_ALLOWED', 'Methode non autorisee'));
        const [run, tokenKind] = V2[endpoint] ?? [];
        if (!run) return Response.json({ error: 'not found' }, { status: 404 });
        const token = request.headers.get('x-api-key');
        if (!token) return json(fail('TOKEN_MISSING', 'Token manquant'));
        if (token !== FULL && !(tokenKind === 'state' && token === STATE)) return json(fail('TOKEN_INVALID', 'Token invalide'));
        let body;
        try {
            body = await request.json();
        } catch {
            return json(fail('INVALID_JSON', 'JSON invalide'));
        }
        return json(run(body));
    }
    return Response.json({ error: 'not found' }, { status: 404 });
}

createServer(async (req, res) => {
    const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
        duplex: 'half',
    });
    const response = await handle(request).catch((error) => Response.json({ error: String(error) }, { status: 500 }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
}).listen(9100, () => console.log('Colissimo stand-in on :9100'));
