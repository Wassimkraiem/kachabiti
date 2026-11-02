// Catalog writes (products, variants, photos, colors, sizes, discounts, banners, reels, landing)
// through APP_URL, plus the activity log and access rules.
import { done, ok, sql, user } from './helpers.mjs';

const owner = await user('owner@test.local', { role: 'owner' });
const editor = await user('editor@test.local', { role: 'staff', permissions: ['products'] });
const marketer = await user('marketer@test.local', { role: 'staff', permissions: ['marketing'] });
const stamp = Date.now();

// Colors and sizes
let r = await owner.call('/api/colors', 'POST', { name: `E2E color ${stamp}`, hex_code: '#112233' });
const color = r.json?.data;
ok(r.status === 201 && color?.hex_code === '#112233', 'color created', r.json);
r = await owner.call('/api/sizes', 'POST', { name: `E2E size ${stamp}` });
const size = r.json?.data;
ok(r.status === 201 && size?.id, 'size created', r.json);
r = await editor.call('/api/colors', 'PUT', { id: color?.id, display_name: 'Bleu nuit' });
ok(r.status === 200 && r.json.data.display_name === 'Bleu nuit', 'color updated by staff with products', r.json);
ok((await marketer.call('/api/sizes', 'POST', { name: 'x' })).status === 403, 'marketing staff cannot add sizes');

// Product with a variant and opening stock, in one save_product transaction
r = await editor.call('/api/products', 'POST', {
    name: `E2E product ${stamp}`,
    base_price: 99.5,
    variants: [{ color_id: color?.id, size_id: size?.id, price: 99.5, stock: 4 }],
    images: [{ image_url: 'https://example.com/a.jpg', is_main: true }],
});
const product = r.json?.data;
const variant = product?.product_variants?.[0];
ok(r.status === 201 && product?.base_price === 99.5 && variant?.colors?.id === color?.id && variant?.stock === 4, 'product created with variant and stock', r.json);
const [log] = await sql("select actor_email from activity_log where entity = 'products' and entity_id = $1 and action = 'create'", [product?.id]);
ok(log?.actor_email === 'editor@test.local', 'product creation logged with the staff member', log);
r = await editor.call('/api/products', 'PUT', { id: product?.id, name: `E2E product ${stamp} renamed`, base_price: 120 });
ok(r.status === 200 && r.json.data.base_price === 120 && r.json.data.product_variants.length === 1, 'product updated, variant kept', r.json);
r = await editor.call('/api/products', 'POST', { name: `E2E dup ${stamp}`, variants: [{ sku: 'DUP' }, { sku: 'DUP' }] });
ok(r.status === 400 && /Duplicate SKU/.test(r.json?.error), 'duplicate SKUs refused', r.json);

// Variants and photos
r = await editor.call('/api/variants', 'POST', { product_id: product?.id, size_id: size?.id, price: 110 });
const variant2 = r.json?.data;
ok(r.status === 201 && variant2?.sizes?.id === size?.id, 'variant added', r.json);
r = await editor.call('/api/variants', 'PUT', { id: variant2?.id, reorder_point: 2 });
ok(r.status === 200 && r.json.data.reorder_point === 2, 'variant updated', r.json);
r = await editor.call('/api/product-images', 'POST', { product_id: product?.id, image_url: 'https://example.com/b.jpg' });
const image = r.json?.data;
ok(r.status === 201 && image?.position === 1, 'photo added after the existing one', r.json);
r = await editor.call('/api/product-images', 'PUT', { id: image?.id, alt_text: 'side' });
ok(r.status === 200 && r.json.data.alt_text === 'side', 'photo updated', r.json);
ok((await editor.call(`/api/product-images?id=${image?.id}`, 'DELETE')).status === 403, 'deleting a photo needs the delete permission');
ok((await owner.call(`/api/product-images?id=${image?.id}`, 'DELETE')).status === 200, 'owner deletes the photo');
ok((await owner.call(`/api/variants?id=${variant2?.id}`, 'DELETE')).status === 200, 'owner deletes the variant');
const [deletedVariant] = await sql('select deleted_at from product_variants where id = $1', [variant2?.id]);
ok(deletedVariant?.deleted_at, 'variant soft-deleted', deletedVariant);

// Discounts, banners, reels
r = await owner.call('/api/promotions', 'POST', { product_id: product?.id, discount_percent: 15 });
const discount = r.json?.data;
ok(r.status === 201 && discount?.discount_percent === 15, 'discount created', r.json);
ok((await owner.call('/api/promotions', 'PUT', { id: discount?.id, discount_percent: 20 })).json?.data?.discount_percent === 20, 'discount updated');
ok((await owner.call('/api/promotions', 'DELETE', { id: discount?.id })).status === 200, 'discount deleted (id in body)');
r = await marketer.call('/api/sale-banners', 'POST', { title: `E2E banner ${stamp}`, image_url: 'https://example.com/c.jpg', discount_percent: '30', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString() });
const banner = r.json?.data;
ok(r.status === 201 && banner?.discount_percent === 30, 'banner created by marketing staff', r.json);
ok((await marketer.call('/api/sale-banners', 'PUT', { id: banner?.id, subtitle: 'Soldes' })).json?.data?.subtitle === 'Soldes', 'banner updated');
ok((await owner.call('/api/sale-banners', 'DELETE', { id: banner?.id })).status === 200, 'banner deleted');
r = await marketer.call('/api/reels', 'POST', { title: `E2E reel ${stamp}`, thumbnail_url: 'https://example.com/t.jpg', video_url: 'https://example.com/v.mp4' });
const reel = r.json?.data;
ok(r.status === 201 && reel?.username === '@kachabiti', 'reel created', r.json);
ok((await marketer.call('/api/reels', 'PUT', { id: reel?.id, is_new: true })).json?.data?.is_new === true, 'reel updated');
ok((await owner.call('/api/reels', 'DELETE', { id: reel?.id })).status === 200, 'reel deleted');

// Landing page
r = await marketer.call('/api/landing');
const before = r.json?.data;
ok(r.status === 200 && Array.isArray(before?.sections?.showcase), 'landing read', r.json);
r = await marketer.call('/api/landing', 'PUT', { section: 'showcase', product_ids: [product?.id, ...before.sections.showcase] });
ok(r.status === 200, 'landing picks saved', r.json);
ok((await marketer.call('/api/landing')).json?.data?.sections?.showcase?.[0] === product?.id, 'pick is first');
await marketer.call('/api/landing', 'PUT', { section: 'showcase', product_ids: before.sections.showcase });
ok((await editor.call('/api/landing')).status === 403, 'landing needs marketing');

// Clean up: soft-delete what was created
ok((await owner.call(`/api/products?ids=${product?.id}`, 'DELETE')).status === 200, 'product deleted');
const [deleted] = await sql('select status, deleted_at from products where id = $1', [product?.id]);
ok(deleted?.status === 'archived' && deleted?.deleted_at, 'product archived and soft-deleted', deleted);
await owner.call(`/api/colors?id=${color?.id}`, 'DELETE');
await owner.call(`/api/sizes?id=${size?.id}`, 'DELETE');

done();
