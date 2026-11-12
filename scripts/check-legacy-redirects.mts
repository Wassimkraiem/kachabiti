// Self-check for lib/legacy-redirects.ts: node --experimental-strip-types scripts/check-legacy-redirects.mts
import assert from 'node:assert/strict';
import { legacyAnswer } from '../lib/legacy-redirects.ts';

const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');

assert.deepEqual(legacyAnswer(enc('/produit/قشابية-ألوان-demi')), { redirect: '/ar/products/kachabia-couleurs-demi-2329' });
assert.deepEqual(legacyAnswer('/fr/produit/kathroun'), { redirect: '/fr/products/kadroun-djerbien-laine-1801' });
assert.deepEqual(legacyAnswer('/produit/qamis-nm'), { redirect: '/ar/categories/qamis-priere' });
assert.deepEqual(legacyAnswer('/produit/monstera-deliciosa'), { gone: true });
assert.deepEqual(legacyAnswer(enc('/categorie-produit/القشابية/القشابي-طويلة/قشابي-صوف')), { redirect: '/ar/categories/kachabia-laine' });
assert.deepEqual(legacyAnswer('/categorie-produit/sac-et-couffins'), { redirect: '/ar/products' });
assert.deepEqual(legacyAnswer('/shop/page/3'), { redirect: '/ar/products' });
for (const p of ['/color/seal-brown', '/color/potters-clay', '/color/white', '/size/s', '/age/2-ans', '/fr/blog', '/woolentor-template/x']) {
    assert.deepEqual(legacyAnswer(p), { gone: true }, p);
}
// Current pages are never touched, so nothing loops.
for (const p of ['/', '/ar', '/fr', '/en/products/x', '/fr/cart', '/ar/categories/kachabia-laine', '/about', '/cart', '/fr/products']) {
    assert.equal(legacyAnswer(p), null, p);
}
console.log('legacy redirects: ok');
