// Orders: "Injoignable" (unreachable), still waiting for the customer's confirmation.
import { done, ok, sql, user } from './helpers.mjs';

const owner = await user('owner@test.local', { role: 'owner' });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['orders'] });
const product = (await sql("select * from products where slug = 'e2e-unreachable'"))[0]
    ?? (await sql("insert into products (name, slug, base_price, stock_tracked) values ('E2E Unreachable', 'e2e-unreachable', 50, false) returning *"))[0];
const variant = (await sql('select * from product_variants where product_id = $1', [product.id]))[0]
    ?? (await sql('insert into product_variants (product_id, price) values ($1, 50) returning *', [product.id]))[0];
const phone = `2${String(Date.now()).slice(-7)}`;
const newOrder = async () => (await agent.call('/api/sales/orders', 'POST', {
    customer: { phone, first_name: 'Hela', governorate: 'Tunis', city: 'Tunis', address: '1 rue' },
    items: [{ product_id: product.id, variant_id: variant.id, quantity: 1 }], channel: 'phone', shipping_cost: 8,
})).json?.data;
const row = async (id) => (await sql('select status, confirmed_at, stock_deducted from orders where id = $1', [id]))[0];
const stage = async () => (await sql('select stage from customers where phone = $1 and deleted_at is null', [phone]))[0]?.stage;

const order = await newOrder();
ok(order?.id && (await row(order.id)).status === 'pending', 'a new order is to confirm', order);
let r = await agent.call('/api/sales/orders', 'PATCH', { action: 'unreachable', ids: [order.id] });
ok(r.json?.data?.changed === 1 && (await row(order.id)).status === 'unreachable', 'marked unreachable', r.json);
ok((await stage()) === 'to_confirm', "the customer is still to confirm", await stage());
ok(!(await row(order.id)).stock_deducted, 'its stock stays in');

r = await agent.call('/api/sales/orders', 'PATCH', { action: 'unreachable', ids: [order.id] });
ok(r.json?.data?.changed === 0, 'marking it again changes nothing');
r = await owner.call('/api/admin/my-work');
ok(r.status === 200, 'my work loads with it');

const twin = await newOrder();
const dupes = await sql('select * from public.find_order_duplicates($1, $2)', [phone, twin.id]);
ok(JSON.stringify(dupes).includes(order.id), 'it is still an open order for duplicates', dupes);

r = await agent.call('/api/sales/orders', 'PATCH', { action: 'confirm', ids: [order.id] });
ok(r.json?.data?.confirmed === 1 && (await row(order.id)).status === 'confirmed' && (await row(order.id)).confirmed_at, 'confirmed once the customer answers', r.json);
r = await owner.call('/api/orders', 'PUT', { id: order.id, status: 'unreachable' });
ok(r.status === 200 && (await row(order.id)).status === 'unreachable', 'a confirmed order can become unreachable by hand', r.json);
r = await owner.call('/api/orders', 'PUT', { id: order.id, status: 'cancelled' });
ok(r.status === 200 && (await row(order.id)).status === 'cancelled', 'and be cancelled');
r = await owner.call('/api/orders', 'PUT', { id: order.id, status: 'unreachable' });
ok(r.status === 409, 'a cancelled order is reopened as to confirm first', r.json);
r = await owner.call('/api/orders', 'PUT', { id: twin.id, status: 'nonsense' });
ok(r.status === 400, 'unknown statuses are still refused', r.status);
done();
