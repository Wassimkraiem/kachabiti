// ERP flows: orders, payments, till, purchasing, accounting, goals and permissions.
import { APP, done, ok, sql, user } from './helpers.mjs';

const owner = await user('owner@test.local', { role: 'owner' });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['orders', 'customers'] });
const cashier = await user('cashier@test.local', { role: 'staff', permissions: ['pos'] });
ok(owner.id && agent.id && cashier.id, 'test users signed in');

// Catalog seed: online + shop locations, one tracked product with a variant.
let locs = await sql('select * from locations');
let online = locs.find((l) => l.sells_online) ?? (await sql("insert into locations (name, sells_online) values ('Online', true) returning *"))[0];
let shop = locs.find((l) => l.name === 'Shop') ?? (await sql("insert into locations (name, sells_online) values ('Shop', false) returning *"))[0];
let product = (await sql("select * from products where slug = 'e2e-kachabia'"))[0]
    ?? (await sql("insert into products (name, slug, base_price, stock_tracked) values ('E2E Kachabia', 'e2e-kachabia', 120, true) returning *"))[0];
let variant = (await sql('select * from product_variants where product_id = $1', [product.id]))[0]
    ?? (await sql('insert into product_variants (product_id, price) values ($1, 120) returning *', [product.id]))[0];
ok(online?.id && shop?.id && variant?.id, 'catalog seeded', { online, shop, variant });

// Access control
ok((await agent.call('/api/owner/overview')).status === 403, 'agent cannot see owner overview');
ok((await cashier.call('/api/finance/bills')).status === 403, 'cashier cannot see bills');
ok((await agent.call('/admin/overview')).status === 307, 'agent redirected away from overview page');
ok((await owner.call('/api/owner/overview')).status === 200, 'owner sees overview');

// Stock in with cost (owner has stock)
let r = await owner.call('/api/stock/movements', 'POST', { type: 'restock', location_id: online.id, items: [{ variant_id: variant.id, quantity: 10, unit_cost: 50 }], reference: 'E2E' });
ok(r.json?.success, 'restock with unit cost', r.json);
r = await owner.call('/api/stock/movements', 'POST', { type: 'transfer', location_id: online.id, to_location_id: shop.id, items: [{ variant_id: variant.id, quantity: 3 }] });
ok(r.json?.success, 'transfer to shop', r.json);

// Agent: manual order from Instagram, duplicate check, confirm
r = await agent.call('/api/sales/orders', 'POST', {
    customer: { phone: '22334455', first_name: 'Amira', last_name: 'Test', governorate: 'Tunis', city: 'Tunis', address: '1 rue Test' },
    items: [{ product_id: product.id, variant_id: variant.id, quantity: 2 }], channel: 'instagram', shipping_cost: 8,
});
ok(r.status === 201 && r.json?.data?.total === 248, 'agent creates order (2×120+8)', r.json);
const orderId = r.json?.data?.id;
r = await agent.call('/api/sales/orders?phone=22334455');
ok(r.json?.data?.open_orders?.length >= 1 && r.json?.data?.customer?.phone === '22334455', 'duplicate lookup finds open order and customer', r.json);
r = await agent.call('/api/sales/orders', 'POST', {
    customer: { phone: '22334455', first_name: 'Amira', governorate: 'Tunis', city: 'Tunis', address: 'x' },
    items: [{ product_id: product.id, variant_id: variant.id, quantity: 1 }], channel: 'facebook', discount_amount: 60,
});
ok(r.status === 403 && r.json?.code === 'DISCOUNT_LIMIT', 'agent discount above limit refused', r.json);
r = await agent.call('/api/sales/orders', 'PATCH', { action: 'confirm', ids: [orderId] });
ok(r.json?.data?.confirmed === 1, 'agent confirms order', r.json);
r = await agent.call('/api/admin/my-work');
ok(r.json?.success && Array.isArray(r.json.data.to_confirm), 'my-work loads', r.json);

// Validate (no Colissimo tokens → validated without parcel), deliver
r = await agent.call('/api/delivery', 'POST', { action: 'validate', order_id: orderId });
ok(r.json?.success && r.json.data.order.status === 'processing', 'order validated (stock out)', r.json);
r = await owner.call('/api/orders', 'PUT', { id: orderId, status: 'delivered' });
ok(r.json?.success && r.json.data.delivered_at, 'order delivered', r.json);

// CRM
r = await agent.call('/api/customers?q=Amira');
const customerId = r.json?.data?.rows?.[0]?.id;
ok(customerId && r.json.data.rows[0].stage === 'delivered', 'customer created from order, stage follows', r.json);
r = await agent.call('/api/crm/interactions', 'POST', { customer_id: customerId, channel: 'phone', direction: 'note', body: 'Called, happy with size' });
ok(r.status === 201, 'log a call', r.json);
r = await agent.call('/api/crm/tasks', 'POST', { customer_id: customerId, title: 'Propose new collection', due_at: new Date(Date.now() + 864e5).toISOString() });
ok(r.status === 201, 'create follow-up', r.json);
r = await agent.call(`/api/customers?id=${customerId}`);
ok(r.json?.data?.stats?.delivered === 1 && r.json.data.interactions.length === 1 && r.json.data.tasks.length === 1, 'customer record complete', r.json?.data?.stats);

// Finance: payment held by carrier, payout with fees
r = await agent.call('/api/sales/payments', 'POST', { order_id: orderId, amount: 248, method: 'cod' });
ok(r.status === 403, 'agent cannot record payments');
r = await owner.call('/api/sales/payments', 'POST', { order_id: orderId, amount: 248, method: 'cod' });
ok(r.status === 201 && r.json.data.account === 'carrier', 'cod payment held by carrier', r.json);
r = await owner.call('/api/sales/remittances');
const open = r.json?.data?.open_payments?.map((p) => p.id) ?? [];
r = await owner.call('/api/sales/remittances', 'POST', { payment_ids: open, fees: 7 });
ok(r.status === 201 && Number(r.json.data.net_amount) === 241, 'carrier payout recorded', r.json);
r = await owner.call('/api/finance/invoices', 'POST', { order_id: orderId });
ok(r.status === 201 && /^FA-\d{4}-\d{5}$/.test(r.json.data.number), 'invoice issued', r.json);

// Bills, treasury
r = await owner.call('/api/stock/suppliers', 'POST', { name: `E2E Supplier ${Date.now()}`, payment_terms_days: 30 });
const supplierId = r.json?.data?.id;
r = await owner.call('/api/finance/bills', 'POST', { supplier_id: supplierId, category: 'rent', amount_ht: 800 });
ok(r.status === 201 && r.json.data.due_date && r.json.data.status === 'unpaid', 'bill with due date from terms', r.json);
const billId = r.json?.data?.id;
r = await owner.call('/api/finance/bills', 'PATCH', { action: 'pay', bill_id: billId, amount: 800, account: 'bank', method: 'bank_transfer' });
ok(r.status === 201, 'bill paid', r.json);
r = await owner.call('/api/finance/bills', 'POST', { payee: 'STEG', category: 'utilities', amount_ht: 100, vat_amount: 19, paid_now: { account: 'cash', method: 'cash' } });
ok(r.status === 201 && r.json.data.status === 'paid', 'expense paid on the spot', r.json);
r = await owner.call('/api/finance/treasury', 'POST', { kind: 'movement', account: 'bank', direction: 'in', amount: 5000, category: 'opening_balance', label: 'Opening' });
ok(r.status === 201, 'opening balance', r.json);
r = await owner.call('/api/finance/treasury', 'POST', { kind: 'transfer', from: 'bank', amount: 200 });
ok(r.status === 201, 'bank → till transfer', r.json);
r = await owner.call('/api/finance/treasury');
ok(r.json?.success, 'treasury loads', r.json?.data?.balances);

// Till: cashier
r = await cashier.call('/api/pos', 'POST', { action: 'open', location_id: shop.id, opening_float: 50 });
const sessionId = r.json?.data?.id;
ok(r.status === 201 && sessionId, 'cashier opens till', r.json);
r = await cashier.call(`/api/pos?catalog=1&location_id=${shop.id}`);
ok(r.json?.data?.some((v) => v.variant_id === variant.id && v.stock === 3), 'till catalog shows shop stock', r.json?.data?.slice?.(0, 2));
r = await cashier.call('/api/pos', 'POST', { action: 'sale', session_id: sessionId, items: [{ product_id: product.id, variant_id: variant.id, quantity: 1 }], payments: [{ method: 'cash', amount: 150 }] });
ok(r.status === 201 && r.json.data.change === 30, 'till sale with change', r.json);
const saleId = r.json?.data?.order?.id;
r = await cashier.call(`/api/pos?receipt=${saleId}`);
ok(r.json?.data?.items?.length === 1 && r.json.data.payments[0].amount == 120, 'receipt data', r.json);
r = await cashier.call('/api/pos', 'POST', { action: 'cash', session_id: sessionId, direction: 'out', amount: 10, label: 'Coffee' });
ok(r.status === 201, 'cash out', r.json);
r = await cashier.call('/api/pos', 'POST', { action: 'close', session_id: sessionId, counted_cash: 158 });
ok(r.json?.success && Number(r.json.data.expected_cash) === 160 && Number(r.json.data.difference) === -2, 'till closed with -2 difference', r.json);

// Purchasing: PO → receipt with a rejected unit → stock up at cost
r = await owner.call('/api/purchasing/materials', 'POST', { name: `E2E Linen ${Date.now()}`, unit: 'm' });
const materialId = r.json?.data?.id;
r = await owner.call('/api/purchasing/orders', 'POST', { supplier_id: supplierId, location_id: online.id, status: 'ordered', lines: [{ variant_id: variant.id, quantity: 5, unit_cost: 70 }, { material_id: materialId, quantity: 20, unit_cost: 12.5 }] });
const poId = r.json?.data?.id;
ok(r.json?.success && Number(r.json.data.total) === Math.round((350 + 250) * 1.19 * 1000) / 1000, 'purchase order with VAT total', r.json);
r = await owner.call(`/api/purchasing/orders?id=${poId}`);
const lines = r.json?.data?.lines ?? [];
r = await owner.call('/api/purchasing/receipts', 'POST', { purchase_order_id: poId, validate: true, lines: lines.map((l) => ({ po_line_id: l.id, quantity_accepted: l.variant_id ? 4 : 20, quantity_rejected: l.variant_id ? 1 : 0, reject_reason: l.variant_id ? 'stain' : undefined })) });
ok(r.status === 201 && r.json.data.status === 'validated', 'goods received and validated', r.json);
r = await owner.call(`/api/purchasing/orders?id=${poId}`);
ok(r.json?.data?.status === 'partial', 'PO partly received (1 rejected)', r.json?.data?.status);
r = await owner.call('/api/purchasing/costing', 'PUT', { product_id: product.id, labor_cost: 15, overhead_cost: 5, bom: [{ material_id: materialId, quantity: 2.5 }] });
ok(r.json?.success, 'bill of materials saved', r.json);
r = await owner.call('/api/purchasing/costing', 'POST', { variant_id: variant.id, quantity: 2, location_id: online.id });
ok(r.status === 201 && Number(r.json.data.unit_cost) === 51.25, 'production at cost price (2.5×12.5+20)', r.json);
r = await owner.call('/api/purchasing/prices');
ok(r.json?.data?.length >= 2, 'price comparison', r.json);

// Accounting
r = await owner.call('/api/finance/accounting?status=draft');
ok(r.json?.data?.drafts > 0, 'draft entries created automatically', r.json?.data?.drafts);
r = await owner.call('/api/finance/accounting', 'POST', { action: 'post' });
ok(r.json?.data?.posted > 0, 'drafts validated', r.json);
r = await owner.call('/api/finance/reports?report=trial&from=2000-01-01');
ok(r.json?.success && Math.abs(r.json.data.totals.debit - r.json.data.totals.credit) < 0.001, 'trial balance balances', r.json?.data?.totals);
r = await owner.call('/api/finance/reports?report=balance');
ok(r.json?.success && Math.abs(r.json.data.total_assets - r.json.data.total_liabilities_and_equity) < 0.001, 'balance sheet balances', r.json?.data && { a: r.json.data.total_assets, l: r.json.data.total_liabilities_and_equity });
r = await owner.call('/api/finance/reports?report=income');
ok(r.json?.success, 'income statement', r.json?.data && { result: r.json.data.result });
r = await owner.call('/api/finance/accounting', 'POST', { action: 'save', journal: 'OD', entry_date: new Date().toISOString().slice(0, 10), label: 'Unbalanced', lines: [{ account: '658', debit: 10 }, { account: '541', credit: 9 }] });
ok(r.status === 400, 'unbalanced manual entry refused', r.json);
const csv = await fetch(`${APP}/api/finance/reports?report=export`, { headers: { cookie: '' } });
ok(csv.status === 401, 'export needs a session');

// Overview numbers
r = await owner.call(`/api/owner/overview?from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`);
const m = r.json?.data?.money;
ok(m && Number(m.delivered_revenue) === 368, 'overview delivered sales (248 + 120)', m);
ok(m && Number(m.cogs) > 0 && m.missing_cost_lines === 0, 'overview cost of goods', m);
ok(r.json?.data?.channels?.some((c) => c.channel === 'instagram' && c.delivered === 1), 'overview by channel', r.json?.data?.channels);

// Goals
r = await owner.call('/api/admin/goals', 'POST', { user_id: agent.id, month: new Date().toISOString().slice(0, 7), target_orders: 50, commission_type: 'percent', commission_value: 2 });
ok(r.status === 201, 'objective set', r.json);
r = await owner.call('/api/admin/goals');
const mine = r.json?.data?.rows?.find((x) => x.user_id === agent.id);
ok(mine && mine.delivered === 1 && Math.abs(mine.commission - 4.96) < 0.001, 'agent progress and 2% commission on 248', mine);

// Product cost is the reference: a product sold without a cost, then given one
const slug2 = `e2e-jebba-${Date.now()}`;
const [p2] = await sql("insert into products (name, slug, base_price) values ('E2E Jebba', $1, 200) returning *", [slug2]);
const [v2] = await sql('insert into product_variants (product_id, price) values ($1, 200) returning *', [p2.id]);
r = await agent.call('/api/sales/orders', 'POST', { customer: { phone: '55667788', first_name: 'Sami', governorate: 'Sfax', city: 'Sfax', address: 'x' }, items: [{ product_id: p2.id, variant_id: v2.id, quantity: 1 }], channel: 'phone', shipping_cost: 0 });
const o2 = r.json?.data?.id;
await owner.call('/api/orders', 'PUT', { id: o2, status: 'delivered' });
const win = `from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`;
r = await owner.call(`/api/owner/overview?${win}`);
ok(r.json?.data?.money?.missing_cost_lines >= 1 && r.json.data.stock.products_without_cost >= 1, 'product without cost is reported', { m: r.json?.data?.money?.missing_cost_lines, p: r.json?.data?.stock?.products_without_cost });
r = await owner.call('/api/stock/costs', 'PUT', { product_id: p2.id, cost: 90 });
ok(r.json?.success, 'set product cost', r.json);
r = await owner.call(`/api/owner/overview?${win}&product=${p2.id}`);
ok(Number(r.json?.data?.money?.cogs) === 90 && r.json.data.money.missing_cost_lines === 0, 'past order line takes the product cost', r.json?.data?.money);
const line = await sql('select unit_cost from order_items where order_id = $1', [o2]);
ok(Number(line[0]?.unit_cost) === 90, 'order line stored the cost', line);
r = await owner.call('/api/stock/costs', 'PUT', { product_id: p2.id, cost: 100 });
r = await agent.call('/api/sales/orders', 'POST', { customer: { phone: '55667788', first_name: 'Sami', governorate: 'Sfax', city: 'Sfax', address: 'x' }, items: [{ product_id: p2.id, variant_id: v2.id, quantity: 1 }], channel: 'phone', shipping_cost: 0 });
const line2 = await sql('select unit_cost from order_items where order_id = $1', [r.json?.data?.id]);
ok(Number(line2[0]?.unit_cost) === 100 && Number((await sql('select unit_cost from order_items where order_id = $1', [o2]))[0]?.unit_cost) === 90, 'new orders take the new cost, old ones keep theirs');

// Monthly business goal
const thisMonth = new Date().toISOString().slice(0, 7);
r = await owner.call('/api/admin/goals', 'PUT', { month: thisMonth, target_revenue: 10000, target_orders: 100, target_delivered: 60, max_return_rate: 15, notes: 'Ramadan push' });
ok(r.json?.success && Number(r.json.data.target_revenue) === 10000, 'team goal saved', r.json);
r = await owner.call(`/api/admin/goals?month=${thisMonth}`);
ok(r.json?.data?.team?.goal?.target_orders === 100 && r.json.data.team.created >= 3 && r.json.data.team.days_in_month >= 28, 'team progress against goal', r.json?.data?.team);
r = await agent.call('/api/admin/goals');
ok(r.status === 403, 'agent cannot edit goals');
r = await agent.call('/api/admin/my-work');
ok(r.json?.data?.team?.goal?.target_revenue == 10000, 'agent sees the month goal on My day', r.json?.data?.team);
r = await owner.call(`/api/owner/overview?${win}`);
ok(r.json?.data?.month_goal?.goal?.target_delivered === 60, 'overview carries the month goal', r.json?.data?.month_goal);

// Return after delivery reverses the sale and gives the stock back
r = await owner.call('/api/orders', 'PUT', { id: orderId, status: 'returned' });
ok(r.json?.success && r.json.data.stock_deducted === false, 'returned order restores stock', r.json);

// Pages render (owner)
for (const page of ['/admin/overview', '/admin/my-work', '/admin/orders/new', '/admin/customers', '/admin/pos', '/admin/purchasing', '/admin/finance/accounting', '/admin/finance/treasury', '/admin/goals', '/admin/settings']) {
    const res = await owner.call(page);
    ok(res.status === 200, `page ${page}`, res.status);
}

done();
