// Accounts and sessions (/api/auth), the shopper's own data (/api/account) and Admin → Team,
// through APP_URL. Local only: it creates accounts. Run like the other suites (api/README.md).
import { createHash, randomBytes } from 'node:crypto';
import { APP, done, ok, sql, user } from './helpers.mjs';

const cookiesOf = (response) => response.headers.getSetCookie().map((c) => c.split(';')[0]);
const jar = (lines) => lines.filter((c) => !c.endsWith('=')).join('; ');
async function call(path, { method, body, cookie } = {}) {
    method ??= body ? 'POST' : 'GET';
    const r = await fetch(`${APP}${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
    });
    let json = null;
    try { json = await r.json(); } catch { /* redirect or page */ }
    return { status: r.status, json, cookies: cookiesOf(r), location: r.headers.get('location') };
}

const email = `shopper-${Date.now()}@test.local`;
const password = 'Shopper-pass-1';

// Sign-up (no SMTP locally: confirmed at once and signed in).
const signUp = await call('/api/auth/sign-up', { body: { email, password, fullName: 'Test Shopper', locale: 'en' } });
ok(signUp.status === 200 && signUp.json.data.user?.email === email, 'sign-up signs in', signUp.json);
ok(signUp.cookies.some((c) => c.startsWith('kb_access=')) && signUp.cookies.some((c) => c.startsWith('kb_refresh=')), 'sign-up sets both cookies');
let session = jar(signUp.cookies);
const shopperId = signUp.json.data.user?.id;

const again = await call('/api/auth/sign-up', { body: { email, password, fullName: 'Twice', locale: 'en' } });
ok(again.status === 409 && again.json.code === 'user_already_exists', 'same e-mail refused', again.json);

const me = await call('/api/auth/me', { cookie: session });
ok(me.json?.data?.id === shopperId && me.json.data.user_metadata.full_name === 'Test Shopper', 'me returns the account', me.json);
ok(!('password_hash' in (me.json?.data ?? {})), 'me never returns the hash');
ok((await call('/api/auth/me')).json?.data === null, 'me without a session is null');

const csrf = await fetch(`${APP}/api/auth/sign-out`, { method: 'POST', headers: { cookie: session, origin: 'https://evil.example' } });
ok(csrf.status === 403, 'write from another site refused');

const wrong = await call('/api/auth/sign-in', { body: { email, password: 'nope-nope' } });
ok(wrong.status === 400 && wrong.json.code === 'invalid_credentials', 'wrong password refused', wrong.json);
const unknown = await call('/api/auth/sign-in', { body: { email: 'nobody@test.local', password: 'nope-nope' } });
ok(unknown.status === 400 && unknown.json.code === 'invalid_credentials', 'unknown e-mail looks the same', unknown.json);

// The access cookie expired: middleware renews it from the refresh cookie on the way.
const refreshOnly = session.split('; ').filter((c) => c.startsWith('kb_refresh=')).join('; ');
const renewed = await call('/api/auth/me', { cookie: refreshOnly });
ok(renewed.json?.data?.id === shopperId, 'expired access renewed by middleware', renewed);
const page = await call('/en', { cookie: refreshOnly });
ok(page.cookies.some((c) => c.startsWith('kb_access=')), 'a page passes the renewed cookie to the browser', page.cookies);
ok((await call('/api/auth/me', { cookie: 'kb_refresh=forged' })).json?.data === null, 'forged refresh gives no session');
ok((await call('/api/auth/me', { cookie: 'kb_access=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad' })).json?.data === null, 'forged access gives no session');

// Profile, favorites, reviews, orders.
const profile = await call('/api/auth/profile', { method: 'PUT', cookie: session, body: { full_name: 'Renamed Shopper', phone: '22123456', city: 'Tunis' } });
ok(profile.status === 200 && profile.json.data.user_metadata.city === 'Tunis', 'profile saved', profile.json);
// Its own product, so the suite also runs on an empty database (CI).
const product = (await sql("select id from products where slug = 'e2e-auth'"))[0]
    ?? (await sql("insert into products (name, slug, base_price, status) values ('E2E Auth', 'e2e-auth', 90, 'active') returning id"))[0];
ok((await call('/api/account/favorites', { cookie: session, body: { product_id: product.id } })).status === 200, 'favorite added');
let favorites = (await call('/api/account/favorites', { cookie: session })).json.data;
ok(favorites.length === 1 && favorites[0].product_id === product.id && favorites[0].products?.id === product.id, 'favorites list it', favorites);
ok((await call(`/api/account/favorites?product_id=${product.id}`, { method: 'DELETE', cookie: session })).status === 200, 'favorite removed');
favorites = (await call('/api/account/favorites', { cookie: session })).json.data;
ok(favorites.length === 0, 'favorites empty again');
ok((await call('/api/account/favorites')).status === 401, 'favorites need a session');
const review = await call('/api/account/reviews', { cookie: session, body: { product_id: product.id, rating: 5, comment: 'e2e review' } });
ok(review.status === 200 && review.json.data.user_id === shopperId && review.json.data.user_name === 'Renamed Shopper', 'review posted under the account name', review.json);
ok((await call('/api/account/reviews', { cookie: session, body: { product_id: product.id, rating: 9 } })).status === 400, 'invalid rating refused');
const orders = await call('/api/account/orders', { cookie: session });
ok(orders.status === 200 && Array.isArray(orders.json.data), 'own orders listed', orders.json);

// Password change: wrong current refused; other sessions signed out, this one kept.
const second = jar((await call('/api/auth/sign-in', { body: { email, password } })).cookies);
ok((await call('/api/auth/password', { method: 'PUT', cookie: session, body: { currentPassword: 'wrong-one', newPassword: 'Another-pass-2' } })).status === 400, 'wrong current password refused');
const changed = await call('/api/auth/password', { method: 'PUT', cookie: session, body: { currentPassword: password, newPassword: 'Another-pass-2' } });
ok(changed.status === 200, 'password changed', changed.json);
ok((await call('/api/auth/refresh', { method: 'POST', cookie: second })).status === 401, 'other session signed out');
ok((await call('/api/auth/refresh', { method: 'POST', cookie: session })).status === 200, 'this session kept');
ok((await call('/api/auth/sign-in', { body: { email, password: 'Another-pass-2' } })).status === 200, 'new password works');

// Reset link: single use, signs in, closes the old sessions.
const token = randomBytes(32).toString('base64url');
await sql("insert into auth_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'reset', now() + interval '1 hour')", [
    createHash('sha256').update(token).digest('hex'),
    shopperId,
]);
const reset = await call('/api/auth/reset', { body: { token, password: 'Third-pass-33' } });
ok(reset.status === 200 && reset.cookies.some((c) => c.startsWith('kb_access=')), 'reset signs in', reset.json);
ok((await call('/api/auth/reset', { body: { token, password: 'Fourth-pass-4' } })).json?.code === 'link_expired', 'reset link works once');
ok((await call('/api/auth/refresh', { method: 'POST', cookie: session })).status === 401, 'reset signs out old sessions');
const forgot = await call('/api/auth/forgot', { body: { email: 'nobody@test.local', locale: 'fr' } });
ok(forgot.status === 200 && forgot.json.data.sent === true, 'forgot answers the same for unknown e-mails');

// Sign-out.
session = jar(reset.cookies);
const out = await call('/api/auth/sign-out', { method: 'POST', cookie: session });
ok(out.status === 200 && out.cookies.some((c) => c === 'kb_access='), 'sign-out clears cookies');
ok((await call('/api/auth/refresh', { method: 'POST', cookie: session })).status === 401, 'signed-out session is gone');

// A shopper has no back office.
const shopper = jar((await call('/api/auth/sign-in', { body: { email, password: 'Third-pass-33' } })).cookies);
ok((await call('/api/admin/me', { cookie: shopper })).status === 403, 'shopper refused by the back office');

// Admin → Team: create, change, remove access (signs them out), delete.
const owner = await user('owner@test.local', { role: 'owner' });
const staffEmail = `staff-${Date.now()}@test.local`;
const created = await owner.call('/api/admin/team', 'POST', { email: staffEmail, password: 'Staff-pass-11', role: 'staff', permissions: ['orders', 'bogus'] });
ok(created.status === 200 && created.json.data.role === 'staff' && created.json.data.permissions.join() === 'orders', 'team member created', created.json);
const staffId = created.json.data?.id;
const staffSession = jar((await call('/api/auth/sign-in', { body: { email: staffEmail, password: 'Staff-pass-11' } })).cookies);
const staffMe = await call('/api/admin/me', { cookie: staffSession });
ok(staffMe.json?.data?.role === 'staff', 'new member signs in as staff', staffMe.json);
ok((await call('/api/admin/team', { cookie: staffSession })).status === 403, 'staff cannot open Team');
const list = await owner.call('/api/admin/team');
ok(list.json.data.some((m) => m.id === staffId), 'team lists the member');
ok((await owner.call('/api/admin/team', 'PUT', { id: owner.id, role: 'staff' })).status === 400, 'cannot change own role');
const removed = await owner.call('/api/admin/team', 'PUT', { id: staffId, role: null });
ok(removed.status === 200 && removed.json.data.role === null, 'access removed', removed.json);
ok((await call('/api/auth/refresh', { method: 'POST', cookie: staffSession })).status === 401, 'removed member signed out');
const log = await sql("select action from activity_log where entity = 'team_member' and entity_id = $1", [staffId]);
ok(log.map((r) => r.action).sort().join() === 'create,remove_access', 'team changes logged', log);
ok((await owner.call(`/api/admin/team?id=${staffId}`, 'DELETE')).status === 200, 'member deleted');
const [row] = await sql('select deleted_at from users where id = $1', [staffId]);
ok(!!row?.deleted_at, 'deleted softly');
ok((await call('/api/auth/sign-in', { body: { email: staffEmail, password: 'Staff-pass-11' } })).status === 400, 'deleted member cannot sign in');

done();
