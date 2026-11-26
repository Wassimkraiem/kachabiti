// Connect with Facebook, against a stand-in for Meta. Not in test:e2e (the Docker API has no stand-in): start the API with
// META_GRAPH_URL=http://127.0.0.1:9200 META_APP_ID=app META_APP_SECRET=secret META_LOGIN_CONFIG_ID=cfg
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { APP, done, ok, sql, user } from './helpers.mjs';

const calls = [];
const info = { is_valid: true, app_id: 'app', expires_at: 0, data_access_expires_at: 4102444800, scopes: ['pages_messaging', 'pages_manage_metadata'] };
const pages = [
    { id: '111', name: 'Shop', access_token: 'page-token-111', instagram_business_account: { id: '999', username: 'shop' } },
    { id: '222', name: 'Other', access_token: 'page-token-222' },
];
const meta = createServer((req, res) => {
    const path = req.url.split('?')[0];
    const token = req.headers.authorization?.replace('Bearer ', '') ?? null;
    let text = '';
    req.on('data', (c) => (text += c)).on('end', () => {
        calls.push({ method: req.method, path, token, body: text ? JSON.parse(text) : null });
        const body = path === '/oauth/access_token' ? { access_token: 'user-token' }
            : path === '/me/accounts' ? { data: pages }
            : path === '/debug_token' ? { data: info }
            : path === '/me/messages' ? { message_id: `m-${Date.now()}` }
            : { success: true };
        res.setHeader('Content-Type', 'application/json').end(JSON.stringify(body));
    });
});
await new Promise((resolve) => meta.listen(9200, '0.0.0.0', resolve));

const owner = await user('owner@test.local', { role: 'owner' });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
const other = await user('admin2@test.local', { role: 'admin' });

/** A request that keeps the cookies the API sets, like the browser. */
const jar = {};
const call = async (path, method = 'GET', body, session = owner.cookie) => {
    const cookie = [session, ...Object.entries(jar).map(([k, v]) => `${k}=${v}`)].join('; ');
    const r = await fetch(`${APP}${path}`, { method, redirect: 'manual', headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    for (const line of r.headers.getSetCookie()) {
        const [, name, value] = line.match(/^([^=]+)=([^;]*)/);
        if (!name.startsWith('kb_meta')) continue;
        if (value) jar[name] = value; else delete jar[name];
    }
    return { status: r.status, location: r.headers.get('location') ?? '', json: await r.json().catch(() => null) };
};
const signIn = async () => {
    const r = await call('/api/admin/meta/login');
    return call(`/api/admin/meta/callback?code=abc&state=${new URL(r.location).searchParams.get('state')}`);
};
const webhook = (entry) => {
    const raw = JSON.stringify({ object: 'page', entry: [entry] });
    const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    return fetch(`${APP}/api/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body: raw });
};
const messageFrom = (pageId, sender, mid) => ({ id: pageId, messaging: [{ sender: { id: sender }, timestamp: Date.now(), message: { mid, text: 'hello' } }] });

// Only owners and admins.
for (const [path, method] of [['', 'GET'], ['/login', 'GET'], ['/callback', 'GET'], ['/pages', 'GET'], ['', 'POST'], ['', 'DELETE']]) {
    ok((await agent.call(`/api/admin/meta${path}`, method)).status === 403, `staff refused: ${method} ${path || '/'}`);
    ok((await fetch(`${APP}/api/admin/meta${path}`, { method, redirect: 'manual' })).status === 401, `visitor refused: ${method} ${path || '/'}`);
}

let r = await call('/api/admin/meta/login');
const url = new URL(r.location);
ok(r.status === 302 && url.hostname === 'www.facebook.com' && url.searchParams.get('config_id') === 'cfg' && url.searchParams.get('redirect_uri').endsWith('/api/admin/meta/callback'), 'login goes to Facebook', r);
r = await call('/api/admin/meta/callback?code=abc&state=wrong');
ok(r.location.endsWith('meta=expired') && !jar.kb_meta_login, 'a wrong state is refused', r);
r = await call('/api/admin/meta/callback?code=abc');
ok(r.location.endsWith('meta=expired'), 'no state, no cookie: refused', r);
ok((await call('/api/admin/meta/pages')).status === 409, 'no Pages before signing in');

r = await signIn();
ok(r.location.endsWith('meta=choose') && jar.kb_meta_login && !jar.kb_meta_login.includes('user-token'), 'signed in, token sealed in the cookie', r);
r = await call('/api/admin/meta/pages');
ok(r.json?.data?.length === 2 && !JSON.stringify(r.json).includes('token'), 'Pages listed without tokens', r.json);
ok((await call('/api/admin/meta/pages', 'GET', null, other.cookie)).status === 409, "another admin can't use that sign-in");
ok((await call('/api/admin/meta', 'POST', { page_id: '333' })).status === 404, 'a Page that was not granted is refused');
info.expires_at = 1;
ok((await call('/api/admin/meta', 'POST', { page_id: '111' })).status === 409, 'an expiring token is refused');
info.expires_at = 0;
info.app_id = 'another';
ok((await call('/api/admin/meta', 'POST', { page_id: '111' })).status === 409, "another app's token is refused");
info.app_id = 'app';
info.scopes = [];
ok((await call('/api/admin/meta', 'POST', { page_id: '111' })).status === 409, 'missing permissions are refused');
info.scopes = ['pages_messaging', 'pages_manage_metadata'];

r = await call('/api/admin/meta', 'POST', { page_id: '111' });
ok(r.json?.data?.name === 'Shop' && !jar.kb_meta_login, 'Page connected', r);
ok(calls.some((c) => c.method === 'POST' && c.path === '/111/subscribed_apps' && c.token === 'page-token-111' && c.body.subscribed_fields === 'messages,message_echoes,feed'), 'Page subscribed to the webhook');
let [row] = await sql('select * from meta_connection');
ok(row.page_id === '111' && row.instagram_id === '999' && !row.token_encrypted.includes('page-token'), 'token stored encrypted', row);
r = await call('/api/admin/meta');
ok(r.json?.data?.page?.name === 'Shop' && !JSON.stringify(r.json).includes('token'), 'status shows the Page, not its token', r.json);
const logged = await sql("select * from activity_log where entity = 'meta_connection'");
ok(logged.length >= 1 && !JSON.stringify(logged).includes(row.token_encrypted), 'logged without the token');

// Messages: this Page's are kept, another Page's aren't; the reply uses the connected Page's token.
const stamp = Date.now();
await webhook(messageFrom('111', `s1-${stamp}`, `m1-${stamp}`));
await webhook(messageFrom('222', `s2-${stamp}`, `m2-${stamp}`));
const kept = await sql('select customer_id, external_id from customer_interactions where external_id = any($1)', [[`m1-${stamp}`, `m2-${stamp}`]]);
ok(kept.length === 1 && kept[0].external_id === `m1-${stamp}`, "another Page's message is ignored", kept);
r = await agent.call('/api/crm/interactions', 'POST', { customer_id: kept[0].customer_id, channel: 'facebook', direction: 'out', body: 'Hi', send: true });
const sentReply = calls.findLast((c) => c.path === '/me/messages');
ok(r.status === 201 && sentReply?.token === 'page-token-111' && sentReply.body.recipient.id === `s1-${stamp}`, 'reply sent with the Page token', r);
r = await agent.call('/api/crm/interactions?inbox=1');
ok(r.json?.data?.connected?.facebook === true, 'inbox shows connected', r.json?.data?.connected);

// Another Page replaces it.
await signIn();
r = await call('/api/admin/meta', 'POST', { page_id: '222' });
[row] = await sql('select * from meta_connection');
ok(r.json?.success && row.page_id === '222' && row.instagram_id === null, 'Page switched', row);
ok(calls.some((c) => c.method === 'DELETE' && c.path === '/111/subscribed_apps' && c.token === 'page-token-111'), 'the old Page is unsubscribed');

r = await call('/api/admin/meta', 'DELETE');
[row] = await sql('select * from meta_connection');
ok(r.json?.success && row.deleted_at && row.token_encrypted === '', 'disconnected, token erased', row);
ok(calls.some((c) => c.method === 'DELETE' && c.path === '/222/subscribed_apps'), 'its events are stopped');
ok((await call('/api/admin/meta')).json?.data?.page === null, 'status shows no Page');

meta.close();
done();
