// Imports the Colissimo parcels of the tools used before this system (two CSV exports) as if the
// owner's "Import all parcels into Delivery" had found them: each becomes a deliveries row, then
// import_colissimo_history gives it a COL-<barcode> order (status and dates of the parcel, linked
// to its customer by phone) and records the money of its payout. Barcodes already in deliveries
// and payouts already imported are skipped, so it can run again.
//
//   DATABASE_URL=… node scripts/import/old-colissimo.mjs <livres_payes.csv> <colis_rows.csv> [--dry-run] [--account=bank|cash]
//
// --dry-run reads the files (and the database when DATABASE_URL is set) and writes nothing.
// --account: where Colissimo's payouts went (default bank). Fees aren't in the exports: payouts
// are recorded gross, with no fees.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

/** CSV with quoted fields ("" escapes, separators and newlines inside quotes) → objects by header. */
function parseCsv(input, sep) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const text = input.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === sep) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
        else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const [header, ...body] = rows;
    return body.filter((r) => r.length >= header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** "2025-05-04", "2025-05-06 20:10:10" (Tunis time, UTC+1 all year) or "2026-01-09 15:59:38.277+00" → Date. */
function when(value) {
    const m = value?.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/);
    if (!m) return null;
    const zone = !m[4] ? '+01:00' : m[4] === 'Z' || m[4].length > 3 ? m[4] : `${m[4]}:00`;
    return new Date(`${m[1]}T${m[2] ?? '12:00'}${m[3] ?? ':00'}${zone}`);
}

assert.deepEqual(parseCsv('﻿a;"b"\n1;"x;""y""\nz"\r\n', ';'), [{ a: '1', b: 'x;"y"\nz' }]);
assert.equal(when('2025-05-06 20:10:10').toISOString(), '2025-05-06T19:10:10.000Z');
assert.equal(when('2025-05-04').toISOString(), '2025-05-04T11:00:00.000Z');
assert.equal(when('2026-01-09 15:59:38.277+00').toISOString(), '2026-01-09T15:59:38.277Z');

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const account = args.find((a) => a.startsWith('--account='))?.split('=')[1] ?? 'bank';
if (files.length !== 2 || !['bank', 'cash'].includes(account)) {
    console.error('Usage: node scripts/import/old-colissimo.mjs <livres_payes.csv> <colis_rows.csv> [--dry-run] [--account=bank|cash]');
    process.exit(1);
}

// The old tool's wording → the spelling deliveries uses (deliveryStatus() in colissimo-portal.ts).
const STATUSES = {
    'Livré Payé': 'Livre paye',
    'Livré': 'Livrer',
    'A Enlever': 'A enlever',
    'En Attente': 'En attente',
    'Au Dépôt': 'Au depot',
    'En Cours de Livraison': 'En cours',
    'Retour Reçu': 'Retour recu',
    'Echange Reçu': 'Echange',
    'Retour Expéditeur': 'Retour Expediteur',
    'Retour Dépôt': 'Rtn depot',
    'Retour Client Agence': 'Rtn client/agence',
};
const DELIVERED = new Set(['Livre', 'Livre paye', 'Livrer', 'Echange']);
const money = (value) => Math.round(Number(String(value ?? '').replace(',', '.')) * 1000) / 1000 || 0;
const text = (value) => (value ?? '').trim() || null;

const parcels = new Map(); // barcode → deliveries row
const payouts = new Map(); // reference → { reference, date, gross, fees, account, parcels }
const addToPayout = (reference, date, barcode, amount) => {
    if (!reference || !date) return;
    const p = payouts.get(reference) ?? { reference, date, gross: 0, fees: 0, account, parcels: [] };
    if (date > p.date) p.date = date;
    p.gross = Math.round((p.gross + amount) * 1000) / 1000;
    p.parcels.push({ barcode, status: 'delivered', date });
    payouts.set(reference, p);
};

// 1. Delivered and paid (Colissimo's "Livrés payés" export, ';'-separated), with its payment day.
for (const r of parseCsv(readFileSync(files[0], 'utf8'), ';')) {
    const barcode = text(r.Code);
    if (!barcode) continue;
    const created = when(r["Date d'ajout"]) ?? new Date();
    const amount = money(r.Prix);
    parcels.set(barcode, {
        barcode,
        recipient_name: text(r.Client),
        phone: text(r['Téléphone']),
        address: text(r.Adresse),
        designation: text(r['Désignation']),
        cod_amount: amount,
        status: 'Livre paye',
        paid: true,
        created_at: created,
        status_changed_at: when(r['Date de livraison']) ?? created,
    });
    const paidOn = text(r['Date de paiement'])?.slice(0, 10);
    addToPayout(paidOn && `OLD-${paidOn}`, paidOn, barcode, amount);
}

// 2. Every parcel of the older tool (its database export, ','-separated). Its updated_at is that
// tool's sync time, so the parcel's creation day stands for its other dates.
for (const r of parseCsv(readFileSync(files[1], 'utf8'), ',')) {
    const barcode = text(r.code);
    if (!barcode || r.deleted_at || parcels.has(barcode)) continue;
    let raw = {};
    try { raw = JSON.parse(r.raw_data || '{}'); } catch { /* the columns are enough */ }
    const status = STATUSES[r.etat?.trim()] ?? (text(r.etat) || 'En attente');
    const created = when(r.date_creation) ?? when(r.created_at) ?? new Date();
    const amount = money(r.prix);
    parcels.set(barcode, {
        barcode,
        recipient_name: text(r.client),
        phone: [text(r.tel1), text(r.tel2)].filter(Boolean).join(' / ') || null,
        address: text(r.adresse),
        city: text(r.ville),
        governorate: text(r.gouvernorat),
        designation: text(r.designation),
        items_count: Number(r.nb_pieces) || null,
        cod_amount: amount,
        status,
        paid: status === 'Livre paye',
        created_at: created,
        status_changed_at: created,
    });
    // shortcut: the export has no payout date, so the payout's latest parcel day stands in
    if (status === 'Livre paye') addToPayout(raw.num_paiement ? String(raw.num_paiement) : null, created.toISOString().slice(0, 10), barcode, amount);
}

const rows = [...parcels.values()];
const byStatus = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
const delivered = rows.filter((r) => DELIVERED.has(r.status));
console.log(`${rows.length} parcels:`, byStatus);
console.log(`delivered: ${delivered.length}, ${delivered.reduce((s, r) => s + r.cod_amount, 0).toFixed(3)} TND`);
console.log(`payouts: ${payouts.size}, ${[...payouts.values()].reduce((s, p) => s + p.gross, 0).toFixed(3)} TND to ${account}`);

if (!process.env.DATABASE_URL) {
    if (!dryRun) throw new Error('Set DATABASE_URL');
    process.exit(0);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
    const { rows: known } = await db.query('select barcode from public.deliveries where barcode = any($1)', [rows.map((r) => r.barcode)]);
    const knownSet = new Set(known.map((k) => k.barcode));
    const fresh = rows.filter((r) => !knownSet.has(r.barcode));
    console.log(`already in the database: ${knownSet.size}, to add: ${fresh.length}`);
    if (dryRun) process.exit(0);

    // One transaction: parcels, orders, customers and money, all or nothing. No staff member, like
    // the Colissimo sync: not in the activity log.
    await db.query('begin');
    const columns = ['barcode', 'recipient_name', 'phone', 'address', 'city', 'governorate', 'designation', 'items_count', 'cod_amount', 'status', 'paid', 'created_at', 'status_changed_at'];
    for (let i = 0; i < fresh.length; i += 500) {
        await db.query(
            `insert into public.deliveries (${columns.join(', ')})
             select * from jsonb_to_recordset($1::jsonb) as r (barcode text, recipient_name text, phone text, address text, city text,
               governorate text, designation text, items_count integer, cod_amount numeric, status text, paid boolean,
               created_at timestamptz, status_changed_at timestamptz)
             on conflict do nothing`,
            [JSON.stringify(fresh.slice(i, i + 500).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))))],
        );
    }
    const { rows: [result] } = await db.query('select public.import_colissimo_history($1::jsonb) as r', [JSON.stringify([...payouts.values()])]);
    await db.query('commit');
    console.log('imported:', result.r);
} catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
} finally {
    await db.end();
}
