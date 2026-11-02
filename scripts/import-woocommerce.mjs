#!/usr/bin/env node
/**
 * Import the WooCommerce product export (kachabiti-products.csv) into the database.
 *
 *   npm run import:woocommerce -- --dry-run     # report only, no writes
 *   npm run import:woocommerce                  # import (idempotent: re-runs update in place)
 *   npm run import:woocommerce -- --csv path/to/export.csv
 *
 * Arabic text comes from the export; English/French titles and descriptions come
 * from scripts/import/translations.json and scripts/import/descriptions.json.
 * Images are downloaded, resized to WebP and re-hosted in the `products` bucket (R2).
 * Needs DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and FILES_PUBLIC_URL in .env.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import sharp from 'sharp';
import { AwsClient } from 'aws4fetch';
import pg from 'pg';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const csvArg = args.indexOf('--csv');
const CSV_PATH = csvArg >= 0 ? path.resolve(args[csvArg + 1]) : path.join(ROOT, 'kachabiti-products.csv');

const SKIP_IDS = new Set(['3877']); // no price and no images in the export
const BUCKET = 'products';
const UPLOAD_CONCURRENCY = 6;
const OFFERS_CATEGORY = 'عروضنا';
const IGNORED_CATEGORIES = new Set(['produits sans categories']);

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/import', p), 'utf8'));
const translations = readJson('translations.json');
const descriptions = readJson('descriptions.json');
const colorMap = readJson('colors.json');

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** WordPress HTML → plain text with paragraph breaks (the storefront renders plain text). */
function htmlToText(html) {
    if (!html) return '';
    let t = html.replace(/\\n/g, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '');
    t = decodeEntities(t);
    const out = [];
    for (const raw of t.split('\n')) {
        const line = raw.replace(/[ \t ]+/g, ' ').trim();
        if (line || (out.length && out[out.length - 1])) out.push(line);
    }
    return out.join('\n').trim();
}

/** Drops links to the dead staging site and editor "(Internal Link)" markers; keeps everything else. */
function cleanDescription(text) {
    return text
        .replace(/https?:\/\/\S*hostingersite\.com\S*/g, '')
        .replace(/\s*\((Internal|External|extern) Links?\)/gi, '')
        .split('\n').map((l) => l.trimEnd())
        .filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim()))
        .join('\n').trim();
}

const stripTags = (s) => decodeEntities((s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function slugify(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------------------------------------------------------------------------
// CSV → parents, variations, attributes
// ---------------------------------------------------------------------------

const rows = parse(fs.readFileSync(CSV_PATH), { columns: true, bom: true, relax_quotes: true, relax_column_count: true });
const col = (row, name) => (row[name] ?? '').trim();

const parents = rows.filter((r) => col(r, 'Type') !== 'variation' && !SKIP_IDS.has(col(r, 'ID')));
const variationsByParent = new Map();
for (const r of rows.filter((r) => col(r, 'Type') === 'variation')) {
    const pid = col(r, 'Parent').replace('id:', '');
    if (!variationsByParent.has(pid)) variationsByParent.set(pid, []);
    variationsByParent.get(pid).push(r);
}

const ATTR_KIND = { Color: 'color', Size: 'size', Age: 'size', 'quantité': 'quantity' };
function rowAttributes(row) {
    const out = [];
    for (const n of [1, 2]) {
        const name = col(row, `Nom de l’attribut ${n}`);
        const values = col(row, `Valeur(s) de l’attribut ${n} `).split(',').map((v) => v.trim()).filter(Boolean);
        if (name && values.length && ATTR_KIND[name]) out.push({ kind: ATTR_KIND[name], values });
    }
    return out;
}

const price = (v) => (v === '' || v == null ? null : Number(v));
const imagesOf = (row) => col(row, 'Images').split(',').map((u) => u.trim()).filter(Boolean);

function sizeRank(label) {
    const letters = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    const i = letters.indexOf(label.toUpperCase());
    if (i >= 0) return i + 1;
    let m = label.match(/^(\d+)\s*ans?$/i);
    if (m) return 100 + Number(m[1]);
    m = label.match(/^(\d+(?:\.\d+)?)\s*cm$/i);
    if (m) return 400 + Number(m[1]);
    if (/^\d+(\.\d+)?$/.test(label)) return 200 + Number(label);
    return 900;
}

// ---------------------------------------------------------------------------
// Build the catalog model
// ---------------------------------------------------------------------------

const report = { warnings: [], priceChecks: 0, priceMismatches: [] };
const warn = (m) => report.warnings.push(m);

// Categories: one node per path segment, keyed by its Arabic name.
const categoryNodes = new Map(); // arName -> { arName, parentAr, depth }
function productCategory(p) {
    const paths = col(p, 'Catégories').split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.split('>').map((x) => x.trim()))
        .filter((segs) => !IGNORED_CATEGORIES.has(segs[segs.length - 1]));
    for (const segs of paths) {
        segs.forEach((ar, i) => {
            if (!categoryNodes.has(ar)) categoryNodes.set(ar, { arName: ar, parentAr: i ? segs[i - 1] : null, depth: i });
        });
    }
    // The offers tag only counts when it is the product's sole category.
    const real = paths.filter((segs) => segs[segs.length - 1] !== OFFERS_CATEGORY);
    const candidates = real.length ? real : paths;
    if (!candidates.length) return null;
    // Deepest path wins; ties go to the last listed (WordPress lists the more specific one last).
    let best = candidates[0];
    for (const segs of candidates) if (segs.length >= best.length) best = segs;
    return best[best.length - 1];
}

const products = [];
for (const p of parents) {
    const wpId = col(p, 'ID');
    const tr = translations.products[wpId];
    if (!tr) { warn(`#${wpId}: no translation entry, skipped`); continue; }
    const attrs = rowAttributes(p);
    const colorAttr = attrs.find((a) => a.kind === 'color');
    const sizeAttr = attrs.find((a) => a.kind === 'size');
    const quantityAttr = attrs.find((a) => a.kind === 'quantity');
    const norm = (attr, v) => attr?.values.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;

    // Each variant: { color, size, regular, promo, image }
    let variants = [];
    // Disabled variations are skipped, except on draft products, whose variations are all unpublished too.
    const parentPublished = col(p, 'Publié') === '1';
    const variations = (variationsByParent.get(wpId) || []).filter((v) => !parentPublished || col(v, 'Publié') === '1');

    if (col(p, 'Type') === 'variable' && variations.length) {
        for (const v of variations) {
            const va = {};
            for (const n of [1, 2]) {
                const kind = ATTR_KIND[col(v, `Nom de l’attribut ${n}`)];
                const val = col(v, `Valeur(s) de l’attribut ${n} `);
                if (kind && val) va[kind] = val;
            }
            if (quantityAttr && va.quantity && va.quantity !== '1') continue; // quantity packs → cart quantity
            const base = { regular: price(col(v, 'Tarif régulier')), promo: price(col(v, 'Tarif promo')), image: imagesOf(v)[0] || null };
            if (base.regular == null && base.promo != null) { base.regular = base.promo; base.promo = null; }
            // The export lost an attribute on some variations ("any size"): expand to every value of the parent.
            const colors = va.color ? [norm(colorAttr, va.color)] : colorAttr ? colorAttr.values : [null];
            const sizes = va.size ? [norm(sizeAttr, va.size)] : sizeAttr ? sizeAttr.values : [null];
            for (const c of colors) for (const s of sizes) variants.push({ ...base, color: c, size: s });
        }
    } else {
        const regular = price(col(p, 'Tarif régulier')) ?? price(col(p, 'Tarif promo'));
        const promo = price(col(p, 'Tarif régulier')) != null ? price(col(p, 'Tarif promo')) : null;
        const base = { regular, promo, image: null };
        const colors = colorAttr ? colorAttr.values : [null];
        const sizes = sizeAttr ? sizeAttr.values : [null];
        for (const c of colors) for (const s of sizes) variants.push({ ...base, color: c, size: s });
    }

    // Dedupe (color, size), keeping the first occurrence.
    const seen = new Set();
    variants = variants.filter((v) => { const k = `${v.color}|${v.size}`; if (seen.has(k)) return false; seen.add(k); return true; });
    variants.sort((a, b) => (a.color || '').localeCompare(b.color || '') || sizeRank(a.size || '') - sizeRank(b.size || ''));

    const regulars = variants.map((v) => v.regular).filter((x) => x != null);
    if (!regulars.length) { warn(`#${wpId}: no price, skipped`); continue; }
    const basePrice = Math.min(...regulars);

    // One product-level percentage discount that reproduces every WooCommerce sale price.
    const pcts = variants.filter((v) => v.promo != null && v.regular).map((v) => Math.round((1 - v.promo / v.regular) * 10000) / 100);
    let discount = null;
    if (pcts.length) {
        const counts = pcts.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
        discount = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        for (const v of variants.filter((v) => v.promo != null)) {
            report.priceChecks++;
            const shown = Math.round(v.regular * (1 - discount / 100));
            if (shown !== v.promo) report.priceMismatches.push(`#${wpId} ${v.color || ''} ${v.size || ''}: WP ${v.promo} vs site ${shown}`);
        }
        const noPromo = variants.filter((v) => v.promo == null).length;
        if (noPromo) warn(`#${wpId}: sale price on only ${variants.length - noPromo}/${variants.length} variants; ${discount}% applied to the whole product`);
    }

    const gallery = imagesOf(p);
    const variationImages = [...new Set(variants.map((v) => v.image).filter(Boolean))];
    const images = gallery.length ? gallery : variationImages; // products without a gallery use their variation images
    if (!images.length) warn(`#${wpId}: no images`);

    const arName = stripTags(col(p, 'Nom'));
    const arDesc = cleanDescription(htmlToText(col(p, 'Description')) || htmlToText(col(p, 'Description courte')));
    const desc = descriptions[wpId] || {};
    products.push({
        wpId,
        slug: `${tr.slug}-${wpId}`,
        name: tr.en, name_fr: tr.fr, name_ar: arName,
        description: desc.en || null, description_fr: desc.fr || null, description_ar: arDesc || null,
        status: col(p, 'Publié') === '1' ? 'active' : 'inactive',
        categoryAr: productCategory(p),
        basePrice, discount, variants, images,
    });
}

// Keep only categories that hold products (directly or through descendants).
const usedCategories = new Set();
for (const p of products) {
    for (let ar = p.categoryAr; ar; ar = categoryNodes.get(ar)?.parentAr) usedCategories.add(ar);
}
const categories = [...categoryNodes.values()].filter((c) => usedCategories.has(c.arName)).sort((a, b) => a.depth - b.depth);
for (const c of categories) if (!translations.categories[c.arName]) warn(`category "${c.arName}" has no translation entry`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const allImageUrls = [...new Set(products.flatMap((p) => [...p.images, ...p.variants.map((v) => v.image).filter(Boolean)]))];
const colorsUsed = [...new Set(products.flatMap((p) => p.variants.map((v) => v.color).filter(Boolean)))];
const sizesUsed = [...new Set(products.flatMap((p) => p.variants.map((v) => v.size).filter(Boolean)))].sort((a, b) => sizeRank(a) - sizeRank(b));
for (const c of colorsUsed) if (!colorMap[c]) warn(`color "${c}" has no hex in colors.json`);

console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will be written' : 'IMPORT'} from ${path.relative(ROOT, CSV_PATH)}`);
console.log(`products: ${products.length} (${products.filter((p) => p.status === 'active').length} active, ${products.filter((p) => p.status !== 'active').length} inactive)`);
console.log(`variants: ${products.reduce((s, p) => s + p.variants.length, 0)} · discounts: ${products.filter((p) => p.discount).length} · images: ${allImageUrls.length}`);
console.log(`categories: ${categories.map((c) => `${'  '.repeat(c.depth)}${translations.categories[c.arName]?.slug}`).join(', ')}`);
console.log(`colors: ${colorsUsed.length} · sizes: ${sizesUsed.join(' ')}`);
console.log(`price round-trip: ${report.priceChecks - report.priceMismatches.length}/${report.priceChecks} WooCommerce sale prices reproduced`);
for (const m of report.priceMismatches) console.log(`  MISMATCH ${m}`);
for (const w of report.warnings) console.log(`  note: ${w}`);
if (DRY_RUN) {
    console.log('\nper product:');
    for (const p of products) {
        const colors = new Set(p.variants.map((v) => v.color).filter(Boolean)).size;
        const sizes = new Set(p.variants.map((v) => v.size).filter(Boolean)).size;
        console.log(`  #${p.wpId.padEnd(5)} ${p.status.padEnd(8)} ${String(p.basePrice).padStart(4)} TND${p.discount ? ` -${p.discount}%` : ''} · ${p.variants.length} variants (${colors} colors × ${sizes} sizes) · ${p.images.length} img · ${translations.categories[p.categoryAr]?.slug ?? '—'} · ${p.slug}`);
    }
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Write to the database and the file storage
// ---------------------------------------------------------------------------

for (const name of ['DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'FILES_PUBLIC_URL']) {
    if (!process.env[name]) throw new Error(`${name} is required`);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// Like the API's writes without a staff member: the activity log skips them instead of logging
// hundreds of direct database edits.
await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false), set_config('request.headers', '{}', false)`);
const query = async (sql, params, what) => {
    try { return (await db.query(sql, params)).rows; } catch (error) { throw new Error(`${what}: ${error.message}`); }
};
const s3 = new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, service: 's3', region: process.env.S3_REGION || 'auto' });
const objectUrl = (key) => `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${BUCKET}/${key}`;

// Images: download → WebP (max 1600px) → upload once; re-runs reuse existing files.
const storagePath = (url) => {
    const m = url.match(/uploads\/(\d{4})\/(\d{2})\/([^/?#]+)$/);
    const base = (m ? `${m[1]}-${m[2]}-${m[3]}` : url.split('/').pop()).replace(/\.[a-z0-9]+$/i, '');
    return `wp/${slugify(base) || 'image'}.webp`;
};
const publicUrl = new Map();
let uploaded = 0, reused = 0;
const queue = [...allImageUrls];
async function worker() {
    while (queue.length) {
        const url = queue.shift();
        const key = storagePath(url);
        if (!(await s3.fetch(objectUrl(key), { method: 'HEAD' })).ok) {
            const res = await fetch(url);
            if (!res.ok) { warn(`image ${url}: HTTP ${res.status}`); continue; }
            const webp = await sharp(Buffer.from(await res.arrayBuffer())).rotate()
                .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
            const put = await s3.fetch(objectUrl(key), { method: 'PUT', body: webp, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } });
            if (!put.ok) throw new Error(`upload ${key}: ${put.status} ${await put.text()}`);
            uploaded++;
        } else reused++;
        publicUrl.set(url, `${process.env.FILES_PUBLIC_URL.replace(/\/$/, '')}/${key}`);
        process.stdout.write(`\rimages: ${uploaded} uploaded, ${reused} reused / ${allImageUrls.length}`);
    }
}
await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
console.log();

// Colors and sizes (matched by name).
async function ensureLookup(table, names, row) {
    const existingRows = await query(`select id, name from ${table} where name = any($1)`, [names], `load ${table}`);
    const ids = new Map(existingRows.map((r) => [r.name, r.id]));
    for (const name of names.filter((n) => !ids.has(n))) {
        const values = row(name);
        const columns = Object.keys(values);
        const [inserted] = await query(
            `insert into ${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id, name`,
            Object.values(values),
            `insert ${table}`,
        );
        ids.set(inserted.name, inserted.id);
    }
    return ids;
}
const colorIds = await ensureLookup('colors', colorsUsed, (n) => ({ name: n, display_name: colorMap[n]?.label ?? n, hex_code: colorMap[n]?.hex ?? null }));
const sizeIds = await ensureLookup('sizes', sizesUsed, (n) => ({ name: n, display_name: n, sort_order: Math.round(sizeRank(n) * 10) }));

// Categories, parents first.
const categoryIds = new Map();
for (const c of categories) {
    const t = translations.categories[c.arName];
    const row = { slug: t.slug, name: t.en, name_fr: t.fr, name_ar: c.arName, sort_order: t.sort ?? 0,
        is_featured: c.depth === 0, parent_id: c.parentAr ? categoryIds.get(c.parentAr) : null, deleted_at: null };
    const columns = Object.keys(row);
    const [saved] = await query(
        `insert into categories (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         on conflict (slug) do update set ${columns.filter((c) => c !== 'slug').map((c) => `${c} = excluded.${c}`).join(', ')}
         returning id`,
        Object.values(row),
        `category ${t.slug}`,
    );
    categoryIds.set(c.arName, saved.id);
}

// Products with their variants, images and discount (replaced on every run). Each product is
// saved by the save_product database function in one transaction, so a failure never leaves a
// half-imported product. Variants are matched by color + size and updated in place (their ids
// hold stock, movements and order lines); stock itself is managed in the admin and never
// touched here. Variants missing from the CSV are removed unless they still hold stock.
for (const p of products) {
    const [existing] = await query('select id from products where slug = $1', [p.slug], `find ${p.slug}`);
    const image = (url) => (url && publicUrl.has(url) ? { url: publicUrl.get(url), alt: p.name_ar } : null);
    const args = {
        p_product_id: existing?.id ?? null,
        p_product: {
            slug: p.slug, name: p.name, name_fr: p.name_fr, name_ar: p.name_ar,
            description: p.description, description_fr: p.description_fr, description_ar: p.description_ar,
            category_id: p.categoryAr ? categoryIds.get(p.categoryAr) ?? null : null,
            base_price: p.basePrice, status: p.status, restore: true,
        },
        p_variants: p.variants.map((v) => ({
            color_id: v.color ? colorIds.get(v.color) : null,
            size_id: v.size ? sizeIds.get(v.size) : null,
            price: v.regular === p.basePrice ? null : v.regular,
            is_available: true,
            images: [image(v.image)].filter(Boolean),
        })),
        p_images: p.images.map(image).filter(Boolean),
        p_replace_discount: true,
        p_discount: p.discount ?? null,
        p_keep_stocked_variants: true,
    };
    await query(
        `select public.save_product(p_product_id => $1::uuid, p_product => $2::jsonb, p_variants => $3::jsonb, p_images => $4::jsonb,
                                    p_replace_discount => $5, p_discount => $6, p_keep_stocked_variants => $7)`,
        [args.p_product_id, JSON.stringify(args.p_product), JSON.stringify(args.p_variants), JSON.stringify(args.p_images),
         args.p_replace_discount, args.p_discount, args.p_keep_stocked_variants],
        `product ${p.slug}`,
    );
    process.stdout.write(`\rproducts: ${products.indexOf(p) + 1}/${products.length}`);
}
console.log();

// Category cover images: the main image of the first product in the category tree.
for (const c of categories) {
    const own = products.filter((p) => {
        for (let ar = p.categoryAr; ar; ar = categoryNodes.get(ar)?.parentAr) if (ar === c.arName) return true;
        return false;
    });
    const cover = own.map((p) => publicUrl.get(p.images[0])).find(Boolean);
    if (cover) await query('update categories set image_url = $1 where id = $2', [cover, categoryIds.get(c.arName)], 'category image');
}

for (const w of report.warnings) if (w.startsWith('image')) console.log(`  note: ${w}`);
await db.end();
console.log('done.');
