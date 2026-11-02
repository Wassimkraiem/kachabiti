// Colissimo (v2 APIs) against the stand-in (scripts/docker/colissimo-mock.mjs, port 9100): a parcel's
// whole life (validate → edit → hand over → price change → tracking → delivered and paid), the
// shopper's view, cancelling an order, removing a parcel, and the refusals Colissimo makes.
import { done, ok, sql, user } from './helpers.mjs';

const MOCK = process.env.COLISSIMO_MOCK_URL ?? 'http://localhost:9100';
const mock = async (path, body) =>
    (await fetch(`${MOCK}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const parcelAt = (barcode) => mock(`/__mock/parcel?barcode=${barcode}`);

await mock('/__mock/reset', {});
const owner = await user('owner@test.local', { role: 'owner' });
const shopper = await user(`shopper-${Date.now()}@test.local`);
ok(owner.id && shopper.id, 'test users signed in');

let product = (await sql("select * from products where slug = 'e2e-kachabia'"))[0]
    ?? (await sql("insert into products (name, slug, base_price, stock_tracked) values ('E2E Kachabia', 'e2e-kachabia', 120, true) returning *"))[0];
let variant = (await sql('select * from product_variants where product_id = $1', [product.id]))[0]
    ?? (await sql('insert into product_variants (product_id, price) values ($1, 120) returning *', [product.id]))[0];

async function newOrder(phone) {
    const r = await owner.call('/api/sales/orders', 'POST', {
        customer: { phone, first_name: 'Salma', last_name: 'Colis', governorate: 'Tunis', city: 'Tunis', address: '1 rue du Test' },
        items: [{ product_id: product.id, variant_id: variant.id, quantity: 1 }], channel: 'phone', shipping_cost: 8,
    });
    return r.json?.data;
}
const delivery = async (id) => (await sql('select * from deliveries where id = $1', [id]))[0];

// Validate: the parcel is created at Colissimo and the order validated.
const order = await newOrder('21000001');
ok(order?.id && Number(order.total) === 128, 'order created (120 + 8)', order);
let r = await owner.call('/api/delivery', 'POST', { action: 'validate', order_id: order.id });
const parcel = r.json?.data?.delivery;
ok(r.json?.success && parcel?.barcode, 'validate creates the parcel', r.json);
ok((await parcelAt(parcel.barcode))?.etat === 'En attente', 'Colissimo has it waiting for pickup');

// Edit while waiting for pickup: Colissimo, the parcel and the order change together.
r = await owner.call('/api/delivery', 'POST', { action: 'edit', id: parcel.id, parcel: { adresse: '2 rue Neuve', tel: '22998877' } });
ok(r.json?.success && r.json.data.changed === true, 'edit accepted', r.json);
let atColissimo = await parcelAt(parcel.barcode);
ok(atColissimo.adresse === '2 rue Neuve' && atColissimo.tel === '22998877', 'Colissimo has the new address and phone', atColissimo);
let [orderRow] = await sql('select shipping_address, customer_phone from orders where id = $1', [order.id]);
ok(orderRow.shipping_address === '2 rue Neuve' && orderRow.customer_phone === '22998877', 'the order has them too', orderRow);
r = await owner.call('/api/delivery', 'POST', { action: 'edit', id: parcel.id, parcel: { tel: '123' } });
ok(r.status === 400, 'an invalid phone is refused before reaching Colissimo', r.json);

// Hand over for pickup: a manifest, the parcel becomes "A enlever"; a second try is refused.
r = await owner.call('/api/delivery', 'POST', { action: 'handover', ids: [parcel.id] });
ok(r.json?.success && r.json.data.accepted.includes(parcel.barcode) && r.json.data.manifests.length === 1, 'handed over with a manifest', r.json);
let row = await delivery(parcel.id);
ok(row.status === 'A enlever' && row.manifest_id && row.handed_over_at, 'parcel recorded as handed over', row);
r = await owner.call('/api/delivery', 'POST', { action: 'handover', ids: [parcel.id] });
ok(r.json?.data?.accepted.length === 0 && r.json.data.refused[0]?.reason === 'Not waiting for pickup', 'handing over twice is refused with a reason', r.json);

// After hand-over Colissimo refuses edits: a new price becomes a price change request.
r = await owner.call('/api/delivery', 'POST', { action: 'edit', id: parcel.id, parcel: { prix: 118 } });
ok(r.json?.success && r.json.data.price_change?.new_price === 118, 'price edit after hand-over becomes a request', r.json);
ok((await delivery(parcel.id)).price_change?.new_price === 118, 'the request is kept on the parcel');
r = await owner.call('/api/delivery', 'POST', { action: 'price_change', id: parcel.id, price: 110 });
ok(r.status === 502 && r.json?.code === 'REQUEST_ALREADY_PENDING', 'a second request while one waits is refused', r.json);
r = await owner.call('/api/delivery', 'POST', { action: 'edit', id: parcel.id, parcel: { adresse: '3 rue Autre' } });
ok(r.status === 502 && r.json?.code === 'ORDER_NOT_EDITABLE', 'an address change after hand-over is refused clearly', r.json);

// Removing a parcel Colissimo already has is refused: it stays listed.
r = await owner.call(`/api/delivery?ids=${parcel.id}`, 'DELETE');
ok(r.json?.data?.deleted === 0 && r.json.data.kept[0]?.barcode === parcel.barcode, 'a handed-over parcel cannot be removed', r.json);

// Tracking: driver's live report, on its way → shipped; delivered → delivered; paid → cash recorded once.
await mock('/__mock/parcel', { barcode: parcel.barcode, etat: 'En cours', pre_etat: 'Livrer' });
r = await owner.call('/api/delivery', 'POST', { action: 'refresh', ids: [parcel.id] });
ok(r.json?.data?.changed === 1, 'refresh sees the change', r.json);
row = await delivery(parcel.id);
ok(row.status === 'En cours' && row.driver_status === 'Livrer', 'status and driver report recorded', row);
[orderRow] = await sql('select status from orders where id = $1', [order.id]);
ok(orderRow.status === 'shipped', 'order marked shipped', orderRow);

await mock('/__mock/parcel', { barcode: parcel.barcode, etat: 'Livrer' });
await owner.call('/api/delivery', 'POST', { action: 'refresh', ids: [parcel.id] });
[orderRow] = await sql('select status, paid_amount from orders where id = $1', [order.id]);
ok(orderRow.status === 'delivered' && Number(orderRow.paid_amount) === 0, 'delivered, not paid yet', orderRow);

await mock('/__mock/parcel', { barcode: parcel.barcode, paid: true });
r = await owner.call('/api/delivery', 'POST', { action: 'refresh' });
ok(r.json?.success && r.json.data.changed >= 1, 'refresh of every open parcel sees the payment', r.json);
let payments = await sql('select amount, account from order_payments where order_id = $1 and deleted_at is null', [order.id]);
ok(payments.length === 1 && Number(payments[0].amount) === 128 && payments[0].account === 'carrier', 'cash on delivery recorded as held by the carrier', payments);
await owner.call('/api/delivery', 'POST', { action: 'refresh', ids: [parcel.id] });
payments = await sql('select amount from order_payments where order_id = $1 and deleted_at is null', [order.id]);
ok(payments.length === 1, 'refreshing again records it only once', payments);
row = await delivery(parcel.id);
ok(row.status === 'Livrer' && row.paid === true, 'recorded delivered and paid (final: no longer tracked)', row);

// The shopper sees where the parcel stands, without internal details.
await sql('update orders set user_id = $1 where id = $2', [shopper.id, order.id]);
r = await shopper.call('/api/account/orders');
const mine = (r.json?.data ?? []).find((o) => o.id === order.id);
ok(mine?.delivery?.stage === 'delivered' && mine.delivery.barcode === parcel.barcode, 'shopper sees the parcel delivered', mine?.delivery);
ok(mine && !('cod_amount' in (mine.delivery ?? {})) && !('driver_status' in (mine.delivery ?? {})), 'no internal parcel fields for the shopper', mine?.delivery);

// Cancelling an order deletes its parcel at Colissimo while it waits for pickup.
const second = await newOrder('21000002');
r = await owner.call('/api/delivery', 'POST', { action: 'validate', order_id: second.id });
const secondParcel = r.json?.data?.delivery;
ok(secondParcel?.barcode, 'second parcel created', r.json);
r = await owner.call('/api/orders', 'PUT', { id: second.id, status: 'cancelled' });
ok(r.json?.success && r.json.data.parcels?.[0]?.deleted === true, 'cancelling deletes the parcel at Colissimo', r.json);
ok((await parcelAt(secondParcel.barcode)).etat === 'Supprime' && (await delivery(secondParcel.id)).status === 'Supprime', 'deleted on both sides');

// Colissimo unreachable: cancelling or deleting an order with a waiting parcel changes nothing
// (the parcel would still be picked up), then works once Colissimo answers again.
const fourth = await newOrder('21000004');
r = await owner.call('/api/delivery', 'POST', { action: 'validate', order_id: fourth.id });
const fourthParcel = r.json?.data?.delivery;
ok(fourthParcel?.barcode, 'fourth parcel created', r.json);
await mock('/__mock/down', { down: true });
r = await owner.call('/api/orders', 'PUT', { id: fourth.id, status: 'cancelled' });
ok(r.status === 502 && r.json?.code === 'COLISSIMO_UNREACHABLE', 'cancel refused while Colissimo is down', r.json);
r = await owner.call(`/api/orders?id=${fourth.id}`, 'DELETE');
ok(r.status === 502, 'delete refused while Colissimo is down', r.json);
let [fourthRow] = await sql('select status, deleted_at, stock_deducted from orders where id = $1', [fourth.id]);
ok(fourthRow.status === 'processing' && !fourthRow.deleted_at && fourthRow.stock_deducted, 'the order and its stock are unchanged', fourthRow);
await mock('/__mock/down', { down: false });
ok((await parcelAt(fourthParcel.barcode)).etat === 'En attente' && (await delivery(fourthParcel.id)).status === 'En attente', 'the parcel is still waiting on both sides');
r = await owner.call('/api/orders', 'PUT', { id: fourth.id, status: 'cancelled' });
[fourthRow] = await sql('select status from orders where id = $1', [fourth.id]);
ok(r.json?.success && fourthRow.status === 'cancelled' && (await parcelAt(fourthParcel.barcode)).etat === 'Supprime', 'cancelled on both sides once Colissimo is back', r.json);

// Removing a parcel waiting for pickup deletes it at Colissimo, then from the list.
const third = await newOrder('21000003');
r = await owner.call('/api/delivery', 'POST', { action: 'validate', order_id: third.id });
const thirdParcel = r.json?.data?.delivery;
r = await owner.call(`/api/delivery?ids=${thirdParcel.id}`, 'DELETE');
ok(r.json?.data?.deleted === 1 && r.json.data.kept.length === 0, 'pending parcel removed', r.json);
ok((await parcelAt(thirdParcel.barcode)).etat === 'Supprime' && (await delivery(thirdParcel.id)).deleted_at, 'deleted at Colissimo and here');

// Unknown barcodes: a clear refusal, nothing saved.
r = await owner.call('/api/delivery', 'POST', { action: 'track', barcode: '999999999999' });
ok(r.status === 502 && r.json?.code === 'ORDER_NOT_FOUND', 'checking an unknown barcode says so', r.json);
r = await owner.call('/api/delivery', 'POST', { action: 'import', barcode: '999999999999' });
ok(r.status === 502 && (await sql("select 1 from deliveries where barcode = '999999999999'")).length === 0, 'importing an unknown barcode saves nothing', r.json);

// The list reports the last automatic check (null until the first one runs, a minute after start).
r = await owner.call('/api/delivery');
ok(r.json?.success && 'tracking' in r.json.data, 'the list says when parcels were last checked', Object.keys(r.json?.data ?? {}));

done();
