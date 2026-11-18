// Till accounts tied to one shop (Admin → Team), shop orders hidden from online staff, and shop
// income for owners only. Each run makes its own two shops, so earlier runs don't count.
import { done, ok, sql, user } from './helpers.mjs';

const run = Date.now();
const [monastir] = await sql('insert into locations (name, is_shop) values ($1, true) returning id', [`Monastir ${run}`]);
const [tunis] = await sql('insert into locations (name, is_shop) values ($1, true) returning id', [`Tunis ${run}`]);
const [warehouse] = await sql('insert into locations (name) values ($1) returning id', [`Warehouse ${run}`]);

const owner = await user('owner@test.local', { role: 'owner' });
const admin = await user(`admin-${run}@test.local`, { role: 'admin' });
const analyst = await user(`analyst-${run}@test.local`, { role: 'staff', permissions: ['analytics', 'finance', 'orders'] });
const monastirTill = await user(`monastir-${run}@test.local`, { role: 'staff', permissions: ['pos', 'customers'], location_id: monastir.id });
ok(owner.id && admin.id && analyst.id && monastirTill.id, 'test users signed in');

// Team: an admin makes a till account for a shop, and only for a real shop.
let r = await admin.call('/api/admin/team', 'POST', { email: `tunis-${run}@test.local`, password: 'Tunis-till-1', role: 'staff', permissions: ['pos', 'customers'], location_id: tunis.id });
ok(r.status === 200 && r.json?.data?.location_id === tunis.id, 'an admin creates a till account for a shop', r.json);
const tunisAccount = r.json?.data;
ok((await admin.call('/api/admin/team', 'POST', { email: `nowhere-${run}@test.local`, role: 'staff', location_id: warehouse.id })).status === 400, 'a till account needs a real shop');
r = await admin.call('/api/admin/team', 'PUT', { id: tunisAccount.id, role: 'staff', permissions: ['pos', 'customers'], location_id: null });
ok(r.status === 200 && r.json?.data?.location_id === null, 'the shop can be removed', r.json);
await admin.call('/api/admin/team', 'PUT', { id: tunisAccount.id, role: 'staff', permissions: ['pos', 'customers'], location_id: tunis.id });

// The Monastir till sees and works its own shop only.
r = await monastirTill.call('/api/pos');
ok(r.json?.data?.locations?.length === 1 && r.json.data.locations[0].id === monastir.id, 'a till account only sees its shop', r.json?.data?.locations);
ok((await monastirTill.call('/api/pos', 'POST', { action: 'open', location_id: tunis.id, opening_float: 0 })).status === 403, 'it cannot open another shop\'s till');
r = await monastirTill.call('/api/pos', 'POST', { action: 'open', location_id: monastir.id, opening_float: 20 });
ok(r.json?.success === true, 'it opens its own till', r.json);
const monastirSession = (await sql('select id from pos_sessions where location_id = $1 and status = $2', [monastir.id, 'open']))[0]?.id;

r = await owner.call('/api/pos', 'POST', { action: 'open', location_id: tunis.id, opening_float: 30 });
ok(r.json?.success === true, 'the owner opens the Tunis till', r.json);
const tunisSession = (await sql('select id from pos_sessions where location_id = $1 and status = $2', [tunis.id, 'open']))[0]?.id;

ok((await monastirTill.call(`/api/pos?session_id=${tunisSession}`)).status === 403, 'it cannot read another shop\'s session');
ok((await monastirTill.call('/api/pos', 'POST', { action: 'cash', session_id: tunisSession, direction: 'out', amount: 5, label: 'Peek' })).status === 403, 'it cannot move cash in another shop\'s till');
ok((await monastirTill.call('/api/pos', 'POST', { action: 'close', session_id: tunisSession, counted_cash: 30 })).status === 403, 'it cannot close another shop\'s till');
r = await monastirTill.call('/api/pos?sessions=1&limit=500');
ok(r.json?.data?.every((s) => s.location_id === monastir.id) && r.json.data.some((s) => s.id === monastirSession), 'its session history is its shop\'s only');
r = await monastirTill.call(`/api/pos?catalog=1&location_id=${tunis.id}`);
ok(r.status === 200, 'the catalog answers (pinned to its own shop)', r.status);
r = await owner.call('/api/pos');
ok([monastir.id, tunis.id].every((id) => r.json?.data?.locations?.some((l) => l.id === id)), 'the owner still sees every shop');

// Shop income: owners only.
const period = `from=2026-01-01&to=2026-12-31`;
ok((await analyst.call(`/api/pos/analytics?${period}`)).status === 403, 'staff with analytics no longer see shop income');
ok((await admin.call(`/api/pos/analytics?${period}`)).status === 403, 'admins don\'t either');
ok((await owner.call(`/api/pos/analytics?${period}`)).status === 200, 'the owner does');

// Online staff don't see shop sales in Orders.
const [{ store }] = await sql("select count(*)::int as store from orders where channel = 'store' and deleted_at is null");
ok((await analyst.call('/api/orders?channel=store&size=1')).json?.total === 0, 'staff see no shop orders in Orders');
ok((await owner.call('/api/orders?channel=store&size=1')).json?.total === store, 'the owner sees them all', store);

await monastirTill.call('/api/pos', 'POST', { action: 'close', session_id: monastirSession, counted_cash: 20 });
await owner.call('/api/pos', 'POST', { action: 'close', session_id: tunisSession, counted_cash: 30 });
done();
