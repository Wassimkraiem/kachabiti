// Post calendar, the shop's own replies, connection check and messages apart from other notifications,
// against a stand-in for Meta. Not in test:e2e (the Docker API has no stand-in): start the API with
// META_GRAPH_URL=http://127.0.0.1:9200 META_APP_ID=app META_APP_SECRET=secret META_LOGIN_CONFIG_ID=cfg
// META_VERIFY_TOKEN=v SITE_DOMAIN=api.test META_POLL_MS=200
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { APP, done, ok, sql, user } from './helpers.mjs';

const calls = [];
const info = { is_valid: true, app_id: 'app', expires_at: 0, scopes: ['pages_messaging', 'pages_manage_metadata'] };
let instagramFails = false;
let subscribed = ['messages'];
let appSubscriptions = [{ object: 'page', callback_url: 'https://api.test/api/webhooks/meta', active: true, fields: [{ name: 'messages' }, { name: 'leadgen' }] }];
const meta = createServer((req, res) => {
    const path = req.url.split('?')[0];
    let text = '';
    req.on('data', (c) => (text += c)).on('end', () => {
        const body = text ? JSON.parse(text) : null;
        calls.push({ method: req.method, path, body });
        if (path === '/999/media' && instagramFails) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: { message: 'Bad aspect ratio' } }));
        }
        if (path === '/app/subscriptions' && req.method === 'POST')
            appSubscriptions = [...appSubscriptions.filter((s) => s.object !== body.object), { ...body, active: true, fields: body.fields.split(',').map((name) => ({ name })) }];
        if (path === '/me/subscribed_apps' && req.method === 'POST') subscribed = body.subscribed_fields.split(',');
        const answer = path === '/oauth/access_token' ? { access_token: 'user-token' }
            : path === '/me/accounts' ? { data: [{ id: '111', name: 'Shop', access_token: 'page-token', instagram_business_account: { id: '999', username: 'shop' } }] }
            : path === '/debug_token' ? { data: info }
            : path === '/app/subscriptions' && req.method === 'GET' ? { data: appSubscriptions }
            : path === '/me/subscribed_apps' && req.method === 'GET' ? { data: [{ id: 'app', subscribed_fields: subscribed }] }
            : path === '/me' ? { id: '111', instagram_business_account: { id: '999' } }
            : path === '/me/messages' ? { message_id: 'mid-crm' }
            : path.startsWith('/container') ? { status_code: calls.filter((c) => c.path === path).length < 2 ? 'IN_PROGRESS' : 'FINISHED' }
            : path === '/999/media' ? { id: `container${calls.length}` }
            : { id: `post${calls.length}`, success: true };
        res.setHeader('Content-Type', 'application/json').end(JSON.stringify(answer));
    });
});
await new Promise((resolve) => meta.listen(9200, '127.0.0.1', resolve));

const owner = await user('owner@test.local', { role: 'owner' });
const marketer = await user('marketer@test.local', { role: 'staff', permissions: ['marketing'] });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
await sql("update meta_connection set deleted_at = now(), token_encrypted = ''");
await sql("update scheduled_posts set deleted_at = now()");

const post = (extra = {}) => ({ caption: 'Hello', targets: ['facebook'], scheduled_at: new Date(Date.now() + 3600e3).toISOString(), ...extra });
const image = { media_url: 'https://files.test/a.jpg', media_type: 'image' };
const list = async () => (await marketer.call(`/api/social/posts?from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`)).json?.data;
const until = async (test) => { for (let i = 0; i < 60; i++) { if (await test()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const row = async (id) => (await sql('select * from scheduled_posts where id = $1', [id]))[0];
const due = (id) => sql("update scheduled_posts set scheduled_at = now() - interval '1 minute' where id = $1", [id]);
const sent = (path) => calls.filter((c) => c.method === 'POST' && c.path === path).length;

// Access
for (const [path, method] of [['/posts', 'GET'], ['/posts', 'POST'], ['/posts', 'PATCH'], ['/posts', 'DELETE'], ['/posts/retry', 'POST'], ['/media', 'POST']]) {
    ok((await agent.call(`/api/social${path}`, method)).status === 403, `without marketing: ${method} ${path} refused`);
    ok((await fetch(`${APP}/api/social${path}`, { method })).status === 401, `visitor: ${method} ${path} refused`);
}
for (const [path, method] of [['check', 'GET'], ['repair', 'POST']]) ok((await marketer.call(`/api/admin/meta/${path}`, method)).status === 403, `staff: ${path} refused`);
ok((await marketer.call('/api/social/posts', 'POST', post())).status === 409, 'no Page connected: refused');

// Connect the Page
const login = await fetch(`${APP}/api/admin/meta/login`, { redirect: 'manual', headers: { cookie: owner.cookie } });
const state = new URL(login.headers.get('location')).searchParams.get('state');
const pair = (r, name) => r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`)).split(';')[0];
const back = await fetch(`${APP}/api/admin/meta/callback?code=x&state=${state}`, { redirect: 'manual', headers: { cookie: `${owner.cookie}; ${pair(login, 'kb_meta_state')}` } });
const connected = await fetch(`${APP}/api/admin/meta`, { method: 'POST', headers: { cookie: `${owner.cookie}; ${pair(back, 'kb_meta_login')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: '111' }) });
ok(connected.ok, 'Page connected', connected.status);

// Validation
let r = await marketer.call('/api/social/posts', 'POST', post());
ok(r.status === 409 && /pages_manage_posts/.test(r.json?.error), 'missing publishing permission: refused', r.json);
info.scopes.push('pages_manage_posts', 'instagram_content_publish');
ok((await marketer.call('/api/social/posts', 'POST', post({ scheduled_at: '2020-01-01T00:00:00Z' }))).status === 400, 'a past time is refused');
ok((await marketer.call('/api/social/posts', 'POST', post({ targets: ['instagram'] }))).status === 400, 'Instagram without media is refused');
ok((await marketer.call('/api/social/posts', 'POST', post({ caption: '' }))).status === 400, 'an empty post is refused');
ok((await marketer.call('/api/social/posts', 'POST', post({ targets: ['tiktok'] }))).status === 400, 'an unknown target is refused');
const form = new FormData();
form.append('file', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'a.svg');
ok((await fetch(`${APP}/api/social/media`, { method: 'POST', headers: { cookie: marketer.cookie }, body: form })).status === 400, 'other file types are refused');

// Scheduled, edited, removed: nothing leaves before its time
r = await marketer.call('/api/social/posts', 'POST', post({ targets: ['facebook', 'instagram'], ...image }));
const id = r.json?.data?.id;
ok(r.status === 201 && (await list()).posts.length === 1 && (await list()).page.instagram === 'shop', 'on the calendar', r.json);
r = await marketer.call('/api/social/posts', 'PATCH', { id, ...post({ caption: 'Edited', targets: ['facebook', 'instagram'], ...image }) });
ok(r.json?.success && (await row(id)).caption === 'Edited', 'edited', r.json);
r = await marketer.call('/api/social/posts', 'POST', post({ caption: 'Removed' }));
await marketer.call(`/api/social/posts?id=${r.json.data.id}`, 'DELETE');
await due(r.json.data.id);
await new Promise((resolve) => setTimeout(resolve, 900));
ok(sent('/111/feed') === 0 && sent('/111/photos') === 0, 'a future or removed post is not sent');

// Published once on both
await due(id);
ok(await until(async () => (await row(id)).status === 'published'), 'published', await row(id));
await new Promise((resolve) => setTimeout(resolve, 900));
const p = (await row(id)).published;
ok(sent('/111/photos') === 1 && sent('/999/media') === 1 && sent('/999/media_publish') === 1 && p.facebook && p.instagram, 'exactly once on each', { p });
ok(calls.find((c) => c.path === '/111/photos').body.caption === 'Edited', 'with the edited text');
ok((await marketer.call('/api/social/posts', 'PATCH', { id, ...post() })).status === 409, 'a published post cannot be edited');
ok((await marketer.call('/api/social/posts/retry', 'POST', { id })).status === 409, 'a published post cannot be sent again');

// One target fails: only that one is sent again
instagramFails = true;
r = await marketer.call('/api/social/posts', 'POST', post({ targets: ['facebook', 'instagram'], media_url: 'https://files.test/v.mp4', media_type: 'video' }));
const video = r.json.data.id;
await due(video);
ok(await until(async () => (await row(video)).status === 'failed'), 'failure recorded', await row(video));
ok(/Bad aspect ratio/.test((await row(video)).error), "with Meta's reason");
ok((await sql("select 1 from notifications where recipient_id = $1 and type = 'post_failed' and data->>'post_id' = $2", [marketer.id, video])).length === 1, 'its author is told');
instagramFails = false;
await marketer.call('/api/social/posts/retry', 'POST', { id: video });
ok(await until(async () => (await row(video)).status === 'published'), 'sent again', await row(video));
ok(sent('/111/videos') === 1 && calls.findLast((c) => c.path === '/999/media').body.media_type === 'REELS', 'Facebook not sent twice');

// Interrupted half way: never sent again by itself. Another Page connected: not sent to it.
const add = async (extra) => (await sql("insert into scheduled_posts (page_id, caption, targets, scheduled_at, created_by, status, claimed_at) values ($1, 'x', '{facebook}', now() - interval '1 hour', $2, $3, now() - interval '30 minutes') returning id", [extra.page, marketer.id, extra.status]))[0].id;
const stuck = await add({ page: '111', status: 'publishing' });
const foreign = await add({ page: '222', status: 'scheduled' });
ok(await until(async () => (await row(stuck)).status === 'failed' && (await row(foreign)).status === 'failed'), 'interrupted and other-Page posts fail');
ok(sent('/111/feed') === 0 && sent('/222/feed') === 0, 'and are not sent');
const busy = await add({ page: '111', status: 'publishing' });
await sql('update scheduled_posts set claimed_at = now() where id = $1', [busy]);
ok((await marketer.call(`/api/social/posts?id=${busy}`, 'DELETE')).status === 409, 'a post being sent cannot be removed');

// Own replies
const stamp = Date.now();
const webhook = (payload, secret = 'secret') => {
    const raw = JSON.stringify(payload);
    return fetch(`${APP}/api/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
};
const event = (from, to, mid, text, echo) => ({ sender: { id: from }, recipient: { id: to }, timestamp: Date.now(), message: { mid, text, ...(echo ? { is_echo: true } : {}) } });
const client = `c${stamp}`;
const before = (await agent.call('/api/admin/notifications?scope=messages')).json.data.unread;
const orders = (await agent.call('/api/admin/notifications?scope=other')).json.data.unread;
await webhook({ object: 'page', entry: [{ id: '111', messaging: [event(client, '111', `a${stamp}`, 'hi')] }] });
await webhook({ object: 'page', entry: [{ id: '111', messaging: [event('111', client, `b${stamp}`, 'from Business Suite', true)] }] });
const messages = async () => sql("select i.* from customer_interactions i join customers c on c.id = i.customer_id where c.external_ids->>'messenger' = $1 order by i.created_at, i.direction", [client]);
ok((await messages()).map((m) => m.direction).join() === 'in,out', "the shop's reply is in the same conversation", await messages());
const customer_id = (await messages())[0].customer_id;
await sql("delete from customer_interactions where external_id = 'mid-crm'").catch(() => sql("update customer_interactions set external_id = 'old-' || id where external_id = 'mid-crm'"));
await webhook({ object: 'page', entry: [{ id: '111', messaging: [event('111', client, 'mid-crm', 'from the CRM', true)] }] });
r = await agent.call('/api/crm/interactions', 'POST', { customer_id, channel: 'facebook', direction: 'out', body: 'from the CRM', send: true });
const crm = (await messages()).filter((m) => m.external_id === 'mid-crm');
ok(r.status === 201 && crm.length === 1 && crm[0].created_by_email === 'agent@test.local', 'an echo before the reply is saved makes no duplicate', r.json);
await webhook({ object: 'instagram', entry: [{ id: '999', messaging: [event('999', `i${stamp}`, `d${stamp}`, 'insta reply', true)] }] });
await webhook({ object: 'instagram', entry: [{ id: '999', changes: [{ field: 'messages', value: event(`i${stamp}`, '999', `e${stamp}`, 'insta test') }] }] });
ok((await sql('select direction from customer_interactions where external_id = any($1) order by direction', [[`d${stamp}`, `e${stamp}`]])).map((m) => m.direction).join() === 'in,out', 'Instagram messages and replies are kept');

// Messages apart from orders
r = await agent.call('/api/admin/notifications?scope=messages');
ok(r.json.data.unread === before + 2 && r.json.data.rows.every((n) => ['customer_message', 'comment_phone'].includes(n.type)), 'messages counted apart, own replies not notified', { unread: r.json.data.unread, before });
ok((await agent.call('/api/admin/notifications?scope=other')).json.data.unread === orders, 'the bell does not count them');
await sql("insert into notifications (recipient_id, kind, type, title) values ($1, 'order', 'new_order', '{}')", [agent.id]);
await agent.call('/api/admin/notifications', 'PUT', { all: true, scope: 'messages' });
ok((await agent.call('/api/admin/notifications?scope=messages')).json.data.unread === 0 && (await agent.call('/api/admin/notifications?scope=other')).json.data.unread === orders + 1, 'marking messages read leaves orders unread');

// Check and repair
await webhook({ object: 'instagram', entry: [] }, 'another-secret');
r = await owner.call('/api/admin/meta/check');
const check = (cid) => r.json.data.checks.find((c) => c.id === cid);
ok(check('app').ok && check('token').ok && check('instagram').ok && check('scope_publish').ok, 'what is fine is green', r.json.data);
ok(!check('scope_instagram_messages').ok && /instagram_manage_messages/.test(check('scope_instagram_messages').detail), 'names the missing permission');
ok(!check('webhook_instagram').ok && !check('webhook_page').ok && !check('page_subscription').ok, 'names the missing subscriptions');
ok(r.json.data.received.refused?.endsWith(' instagram') && r.json.data.received.instagram && !JSON.stringify(r.json).includes('page-token'), 'shows refused events, never the token');
r = await owner.call('/api/admin/meta/repair', 'POST');
ok(r.json?.success, 'repaired', r.json);
const page = appSubscriptions.find((s) => s.object === 'page').fields.map((f) => f.name);
ok(['messages', 'message_echoes', 'feed', 'leadgen'].every((f) => page.includes(f)), 'adds fields and keeps the others', page);
r = await owner.call('/api/admin/meta/check');
ok(check('webhook_instagram').ok && check('webhook_page').ok && check('page_subscription').ok, 'subscriptions are green', r.json.data.checks);

await owner.call('/api/admin/meta', 'DELETE');
meta.close();
done();
