// Objectives & commissions: prize tiers by delivered orders, the analytics charts, and the
// analytics reset (start date). Each run uses a new agent, so earlier runs' orders don't count.
import { done, ok, sql, user } from './helpers.mjs';

const owner = await user('owner@test.local', { role: 'owner' });
const seller = await user(`seller-${Date.now()}@test.local`, { role: 'staff', permissions: ['orders'] });
ok(owner.id && seller.id, 'test users signed in');
const tunisNow = () => new Date(Date.now() + 3_600_000);
const month = tunisNow().toISOString().slice(0, 7);
const today = tunisNow().toISOString().slice(0, 10);
const tomorrow = new Date(tunisNow().getTime() + 86_400_000).toISOString().slice(0, 10);
const progress = async (who = owner) => (await who.call(`/api/admin/goals?month=${month}`)).json?.data;
const mine = async () => (await progress()).rows.find((r) => r.user_id === seller.id);

// Start from the full history (a previous run may have stopped half-way).
await owner.call('/api/admin/erp-settings', 'PUT', { analytics: { start_date: null } });

// Catalog: an online location and a product with stock.
const online = (await sql('select * from locations where sells_online and deleted_at is null limit 1'))[0]
    ?? (await sql("insert into locations (name, sells_online) values ('Online', true) returning *"))[0];
const product = (await sql("select * from products where slug = 'e2e-objectives'"))[0]
    ?? (await sql("insert into products (name, slug, base_price, stock_tracked) values ('E2E Objectives', 'e2e-objectives', 100, true) returning *"))[0];
const variant = (await sql('select * from product_variants where product_id = $1', [product.id]))[0]
    ?? (await sql('insert into product_variants (product_id, price) values ($1, 100) returning *', [product.id]))[0];
await owner.call('/api/stock/movements', 'POST', { type: 'restock', location_id: online.id, items: [{ variant_id: variant.id, quantity: 20, unit_cost: 40 }] });

// Validation and permissions
const goal = (extra) => ({ user_id: seller.id, month, target_delivered: 5, ...extra });
let r = await owner.call('/api/admin/goals', 'POST', goal({ commission_type: 'tiers', prize_tiers: [] }));
ok(r.status === 400, 'tiers without any tier refused', r.json);
r = await owner.call('/api/admin/goals', 'POST', goal({ commission_type: 'tiers', prize_tiers: [{ orders: 0, prize: 10 }] }));
ok(r.status === 400, 'a tier of 0 orders refused', r.json);
r = await owner.call('/api/admin/goals', 'POST', goal({ commission_type: 'tiers', prize_tiers: [{ orders: 3, prize: -5 }] }));
ok(r.status === 400, 'a negative prize refused', r.json);
r = await seller.call('/api/admin/goals', 'POST', goal({ commission_type: 'tiers', prize_tiers: [{ orders: 1, prize: 1000 }] }));
ok(r.status === 403, 'an agent cannot set objectives', r.status);

// Tiers, given out of order: 1 → 30, 3 → 80, 5 → 150 TND
r = await owner.call('/api/admin/goals', 'POST', goal({ commission_type: 'tiers', prize_tiers: [{ orders: 3, prize: 80 }, { orders: 1, prize: 30 }, { orders: 5, prize: 150 }] }));
ok(r.status === 201 && r.json?.data?.[0]?.commission_type === 'tiers' && r.json.data[0].prize_tiers.length === 3, 'tier objective saved', r.json);
let row = await mine();
ok(row?.goal?.commission_type === 'tiers' && row.delivered === 0 && row.commission === 0, 'no prize before any delivery', row);
ok(row?.tier === null && row?.next_tier?.orders === 1 && row.next_tier.prize === 30 && row.orders_to_next === 1, 'next tier is the smallest one', row);

// The seller takes 4 orders; 3 are delivered, the 4th is delivered then returned.
const orderIds = [];
for (let i = 0; i < 4; i++) {
    r = await seller.call('/api/sales/orders', 'POST', {
        customer: { phone: `5000000${i}`, first_name: `Client${i}`, governorate: 'Tunis', city: 'Tunis', address: `${i} rue Objectif` },
        items: [{ product_id: product.id, variant_id: variant.id, quantity: 1 }], channel: 'phone',
    });
    ok(r.status === 201, `order ${i + 1} taken`, r.json);
    orderIds.push(r.json?.data?.id);
}
for (const id of orderIds) {
    r = await seller.call('/api/delivery', 'POST', { action: 'validate', order_id: id });
    ok(r.json?.data?.order?.status === 'processing', 'order validated', r.json);
    r = await owner.call('/api/orders', 'PUT', { id, status: 'delivered' });
    ok(r.json?.data?.delivered_at, 'order delivered', r.json);
}
r = await owner.call('/api/orders', 'PUT', { id: orderIds[3], status: 'returned' });
ok(r.json?.success, 'the 4th order comes back (returned)', r.json);

row = await mine();
ok(row?.created === 4 && row.delivered === 3, 'taken 4, delivered 3 (the return does not count)', row);
ok(row?.commission === 80 && row.tier?.orders === 3 && row.tier.prize === 80, 'prize of the 3-order tier: 80 TND', row);
ok(row?.next_tier?.orders === 5 && row.orders_to_next === 2, 'next prize: 150 TND, 2 orders to go', row);

const data = await progress();
const todayPoint = data.daily.find((d) => d.date === today);
ok(data.daily.length >= 28 && todayPoint?.delivered >= 3 && todayPoint.revenue >= 300, 'daily chart has today\'s deliveries', todayPoint);
ok(data.rows.filter((x) => x.commission > 0).some((x) => x.user_id === seller.id), 'prizes to pay list the seller', data.rows.map((x) => [x.email, x.commission]));

r = await seller.call('/api/admin/my-work');
ok(r.json?.data?.month?.commission === 80 && r.json.data.month.orders_to_next === 2 && r.json.data.month.goal?.prize_tiers?.length === 3, 'My day shows the prize and the next tier', r.json?.data?.month);

// Analytics reset: count from tomorrow, so nothing of today counts; nothing is deleted.
ok((await seller.call('/api/admin/erp-settings', 'PUT', { analytics: { start_date: tomorrow } })).status === 403, 'an agent cannot reset analytics');
ok((await owner.call('/api/admin/erp-settings', 'PUT', { analytics: { start_date: 'yesterday' } })).status === 400, 'a malformed date is refused');
r = await owner.call('/api/admin/erp-settings', 'PUT', { analytics: { start_date: tomorrow } });
ok(r.json?.data?.analytics?.start_date === tomorrow, 'analytics reset from tomorrow', r.json);
r = await owner.call('/api/admin/erp-settings');
ok(r.json?.data?.analytics?.start_date === tomorrow && r.json.data.sales !== undefined, 'settings keep the other rules', r.json?.data);

const afterReset = await progress();
const resetRow = afterReset.rows.find((x) => x.user_id === seller.id);
ok(afterReset.analytics_start === tomorrow, 'objectives say where figures start', afterReset.analytics_start);
ok(resetRow?.delivered === 0 && resetRow.created === 0 && resetRow.commission === 0, 'objectives start again from zero', resetRow);
ok(afterReset.team.delivered === 0 && afterReset.daily.every((d) => d.delivered === 0), 'team progress and chart start again from zero', afterReset.team);
r = await owner.call('/api/owner/overview');
ok(r.json?.data?.analytics_start === tomorrow && Number(r.json.data.money.delivered_revenue) === 0, 'overview starts again from zero', r.json?.data?.money);
r = await owner.call('/api/admin/performance');
ok(r.json?.success && !(r.json.data.rows ?? []).some((x) => x.agent_id === seller.id && Number(x.delivered) > 0), 'agent performance starts again from zero', r.json?.data?.rows);
r = await seller.call('/api/admin/my-work');
ok(r.json?.data?.month?.delivered === 0 && r.json.data.month.commission === 0, 'My day starts again from zero', r.json?.data?.month);
const kept = await sql('select id from orders where id = any($1) and deleted_at is null', [orderIds]);
ok(kept.length === 4, 'the orders themselves are kept', kept.length);

// Back to the full history.
r = await owner.call('/api/admin/erp-settings', 'PUT', { analytics: { start_date: null } });
ok(r.json?.data?.analytics?.start_date === null, 'reset cleared');
row = await mine();
ok(row?.delivered === 3 && row.commission === 80, 'figures are back after clearing the reset', row);

// The other commission types still work.
r = await owner.call('/api/admin/goals', 'POST', goal({ commission_type: 'per_order', commission_value: 7.5 }));
row = await mine();
ok(r.status === 201 && row?.commission === 22.5 && row.tier === null, 'per order: 3 × 7.5', row);
r = await owner.call('/api/admin/goals', 'POST', goal({ commission_type: 'percent', commission_value: 10 }));
row = await mine();
ok(r.status === 201 && Math.abs(row?.commission - row?.delivered_revenue / 10) < 0.001, 'percent: 10% of delivered sales', row);

// Pages render
for (const page of ['/admin/goals', '/admin/settings', '/admin/my-work', '/admin/overview', '/admin/performance']) {
    ok((await owner.call(page)).status === 200, `page ${page}`);
}

done();
