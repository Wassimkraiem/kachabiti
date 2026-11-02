// Stock: locations, suppliers, movements (restock, transfer, count, shortage), tracking and costs.
import { done, ok, sql, user } from './helpers.mjs';

const owner = await user('owner@test.local', { role: 'owner' });
const clerk = await user('clerk@test.local', { role: 'staff', permissions: ['stock'] });
const stamp = Date.now();

// A product with one variant to move stock on
let r = await owner.call('/api/products', 'POST', { name: `E2E stock ${stamp}`, base_price: 50, variants: [{ price: 50 }] });
const product = r.json?.data;
const variantId = product?.product_variants?.[0]?.id;
ok(r.status === 201 && variantId, 'product for stock tests', r.json);

// Lookups
r = await clerk.call('/api/stock/locations', 'POST', { name: `E2E depot A ${stamp}` });
const depotA = r.json?.data;
ok(r.status === 200 && depotA?.sells_online === false, 'location created', r.json);
r = await clerk.call('/api/stock/locations', 'POST', { name: `E2E depot B ${stamp}` });
const depotB = r.json?.data;
r = await clerk.call('/api/stock/suppliers', 'POST', { name: `  E2E supplier ${stamp}  `, phone: '' });
ok(r.status === 200 && r.json.data.name === `E2E supplier ${stamp}` && r.json.data.phone === null, 'supplier created, text trimmed', r.json);
const supplier = r.json?.data;
r = await clerk.call('/api/stock/suppliers', 'PUT', { id: supplier?.id, payment_terms_days: 30 });
ok(r.status === 200 && r.json.data.payment_terms_days === 30, 'supplier updated', r.json);

// Movements
r = await clerk.call('/api/stock/movements', 'POST', { type: 'restock', location_id: depotA?.id, items: [{ variant_id: variantId, quantity: 10, unit_cost: 20 }], reference: 'E2E' });
ok(r.status === 200 && r.json?.data?.recorded === 1, 'restock recorded', r.json);
const [movement] = await sql('select created_by_email from stock_movements where variant_id = $1 limit 1', [variantId]);
ok(movement?.created_by_email === 'clerk@test.local', 'movement carries the clerk', movement);
r = await clerk.call('/api/stock/movements', 'POST', { type: 'transfer', location_id: depotA?.id, to_location_id: depotB?.id, items: [{ variant_id: variantId, quantity: 4 }] });
ok(r.status === 200, 'transfer recorded', r.json);
r = await clerk.call('/api/stock/movements', 'POST', { type: 'sale', location_id: depotB?.id, items: [{ variant_id: variantId, quantity: 9 }] });
ok(r.status === 409 && /stock/i.test(r.json?.error), 'shortage refused with a stock message', r.json);
r = await clerk.call('/api/stock/movements', 'POST', { type: 'count', location_id: depotA?.id, items: [{ variant_id: variantId, quantity: 5 }] });
ok(r.status === 200, 'count recorded', r.json);
const [levelA] = await sql('select available from inventory_levels where variant_id = $1 and location_id = $2', [variantId, depotA?.id]);
ok(levelA?.available === 5, 'count set depot A to 5', levelA);
ok((await clerk.call('/api/stock/movements', 'POST', { type: 'transfer', location_id: depotA?.id, items: [{ variant_id: variantId, quantity: 1 }] })).status === 400, 'transfer without destination refused');
r = await clerk.call(`/api/stock/movements?variant_id=${variantId}`);
ok(r.status === 200 && r.json.total === 4 && r.json.data.length === 4, 'history with total', r.json);

// Inventory, tracking, deletes
r = await clerk.call('/api/stock/inventory');
const row = r.json?.data?.rows?.find((x) => x.variant_id === variantId);
ok(row?.total === 9 && row.levels[depotA?.id] === 5 && row.levels[depotB?.id] === 4, 'inventory totals per location', row);
r = await clerk.call('/api/stock/tracking', 'PUT', { product_ids: [product?.id], tracked: false });
const [tracked] = await sql('select stock_tracked from products where id = $1', [product?.id]);
ok(r.status === 200 && tracked?.stock_tracked === false, 'tracking switched off', tracked);
r = await owner.call(`/api/stock/locations?id=${depotA?.id}`, 'DELETE');
ok(r.status === 409 && /still holds stock/.test(r.json?.error), 'stocked location cannot be deleted', r.json);

// Costs need the costs permission
ok((await clerk.call('/api/stock/costs')).status === 403, 'clerk cannot read costs');
r = await owner.call('/api/stock/costs', 'PUT', { product_id: product?.id, cost: 18.5 });
ok(r.status === 200 && r.json.data.cost === 18.5, 'cost set', r.json);
r = await owner.call('/api/stock/costs', 'PUT', { product_id: product?.id, cost: null });
ok(r.status === 200 && r.json.data === null, 'cost cleared', r.json);

// Clean up: empty the depots, then soft-delete them
await clerk.call('/api/stock/movements', 'POST', { type: 'count', location_id: depotA?.id, items: [{ variant_id: variantId, quantity: 0 }] });
await clerk.call('/api/stock/movements', 'POST', { type: 'count', location_id: depotB?.id, items: [{ variant_id: variantId, quantity: 0 }] });
ok((await owner.call(`/api/stock/locations?id=${depotA?.id}`, 'DELETE')).status === 200, 'empty location deleted');
await owner.call(`/api/stock/locations?id=${depotB?.id}`, 'DELETE');
await owner.call(`/api/stock/suppliers?id=${supplier?.id}`, 'DELETE');
await owner.call(`/api/products?id=${product?.id}`, 'DELETE');

done();
