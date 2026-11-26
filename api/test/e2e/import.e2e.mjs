// Past conversations read from Meta, against a stand-in. Not in test:e2e.
// Start the API as for media.e2e.mjs (META_POLL_MS=200 reads every 200 ms).
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { APP, done, ok, sql, user } from './helpers.mjs';

const stamp = Date.now();
const HERE = 'http://127.0.0.1:9200';
const ago = (minutes) => new Date(Date.now() - minutes * 60e3).toISOString().replace(/\.\d+Z/, '+0000');
const shop = { id: 'page', name: 'Shop' };
const insta = { id: 'ig-other-id', username: 'shop' };
const amel = { id: `amel${stamp}`, name: 'Amel' };
const sami = { id: `sami${stamp}`, username: 'sami.ig' };
const msg = (id, from, message, minutes, attachments) => ({ id: `${id}${stamp}`, from, message, created_time: ago(minutes), ...(attachments ? { attachments: { data: attachments } } : {}) });
const fb = [{
    id: 'conv1', updated_time: ago(1), participants: { data: [amel, shop] },
    messages: {
        data: [msg('new', amel, 'still there?', 5), msg('reply', shop, 'yes we do', 3000), msg('pic', amel, '', 3010, [{ mime_type: 'image/jpeg', image_data: { url: `${HERE}/cdn/photo` } }])],
        paging: { next: 'x', cursors: { after: 'c2' } },
    },
}];
const stuck = { id: 'conv3', updated_time: ago(1), participants: { data: [{ id: `stuck${stamp}`, username: 'stuck' }, insta] } };
const ig = [{ id: 'conv2', updated_time: ago(1), participants: { data: [sami, insta] }, messages: { data: [msg('igout', insta, 'marhba', 2000), msg('igin', sami, 'salam', 2001)] } }];
let igFails = false;
let deeper = false;
const stored = new Map();
const server = createServer((req, res) => {
    const url = new URL(req.url, HERE);
    req.on('data', () => undefined).on('end', () => {
        const json = (body, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (url.pathname.startsWith('/s3/')) { if (req.method === 'PUT') stored.set(url.pathname, 1); return res.end(); }
        if (url.pathname === '/cdn/photo') return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end('x');
        if (url.pathname === '/me') return json({ id: 'page', instagram_business_account: { id: '999', username: 'shop' } });
        // Like Meta: Instagram refuses messages inside the conversation list, and lists ids only.
        // One conversation Instagram never answers, even one message at a time.
        if (url.pathname === '/conv3/messages') return json({ error: { message: 'Timeout' } }, 500);
        if (url.pathname === '/conv2/messages' && Number(url.searchParams.get('limit')) > 5) return json({ error: { message: 'Please reduce the amount of data' } }, 500);
        if (url.pathname === '/conv2/messages') return json({ data: ig[0].messages.data.map(({ id, created_time }) => ({ id, created_time })) });
        const one = ig[0].messages.data.find((m) => url.pathname === `/${m.id}`);
        if (one) return json(one);
        if (url.pathname === '/conv1/messages') return json({ data: [msg('old', amel, 'first hello', 5000), ...(deeper ? [msg('deep', amel, 'deeper, never stored', 6000)] : [])] });
        if (url.pathname === '/me/conversations' && url.searchParams.has('user_id')) return json({ data: [] });
        if (url.pathname === '/me/conversations') {
            if (url.searchParams.get('platform') === 'messenger') return json({ data: fb });
            if (/messages/.test(url.searchParams.get('fields'))) return json({ error: { message: 'Please reduce the amount of data' } }, 500);
            if (Number(url.searchParams.get('limit')) > 2) return json({ error: { message: "Please reduce the amount of data you're asking for, then retry your request" } }, 500);
            if (Number(url.searchParams.get('limit')) > 1) return json({ error: { message: 'Timeout' } }, 500);
            return igFails ? json({ error: { message: 'Needs instagram_manage_messages' } }, 400) : json({ data: [stuck, ...ig].map(({ messages, ...c }) => c) });
        }
        json({});
    });
});
await sql("update meta_connection set deleted_at = now(), token_encrypted = ''");
const owner = await user('owner@test.local', { role: 'owner' });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
const unread = async () => (await agent.call('/api/admin/notifications?scope=messages')).json.data.unread;
const before = await unread();
await new Promise((resolve) => server.listen(9200, '127.0.0.1', resolve));

const until = async (test) => { for (let i = 0; i < 60; i++) { const v = await test(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = (key, id) => sql('select i.*, c.full_name from customer_interactions i join customers c on c.id = i.customer_id where c.external_ids->>$1 = $2 order by i.created_at', [key, id]);

await until(async () => (await rows('messenger', amel.id)).length >= 4 && (await rows('instagram', sami.id)).length >= 2);
await pause(1500); // several more readings
let list = await rows('messenger', amel.id);
ok(list.map((m) => `${m.direction}:${m.body}`).join() === 'in:first hello,in:[image],out:yes we do,in:still there?', 'both sides, in order, older pages too, once', list.map((m) => m.body));
ok(list[0].full_name === 'Amel' && list[1].attachments?.[0].path, 'with the name and the photo', list[1]);
ok(list.map((m) => Boolean(m.read_at)).join() === 'true,true,false,false' || (list[0].read_at && !list[3].read_at), 'old messages are read, recent ones wait');
ok((await rows('instagram', sami.id)).map((m) => m.direction).join() === 'in,out', "Instagram: direction found although the shop's id differs");
ok((await unread()) === before + 1, 'only the recent message notifies', [before, await unread()]);

const inbox = (await agent.call(`/api/crm/interactions?customer_id=${list[0].customer_id}&channel=facebook`)).json.data;
ok(inbox.length === 4, 'shown in the conversation');

// The webhook brings one of them, and a reply from the CRM has another id
const raw = JSON.stringify({ object: 'page', entry: [{ id: 'page', messaging: [{ sender: { id: amel.id }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: `new${stamp}`, text: 'still there?' } }] }] });
await fetch(`${APP}/api/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}` }, body: raw });
await sql("insert into customer_interactions (customer_id, channel, direction, body, external_id, read_at) values ($1, 'facebook', 'out', 'sent here', $2, now())", [list[0].customer_id, `crm${stamp}`]);
fb[0].updated_time = ago(-1);
fb[0].messages.data.unshift(msg('other-id', shop, 'sent here', 0), msg('live', amel, 'missed by the webhook', 0));
await until(async () => (await rows('messenger', amel.id)).some((m) => m.body === 'missed by the webhook'));
await pause(800);
list = await rows('messenger', amel.id);
ok(list.filter((m) => m.body === 'sent here').length === 1 && list.filter((m) => m.body === 'still there?').length === 1 && list.length === 6, 'no duplicates; a missed message is added', list.map((m) => m.body));

// Check: the stuck conversation is skipped and named, the others are read
const igCheck = (await owner.call('/api/admin/meta/check')).json.data.checks.find((c) => c.id === 'import_instagram');
ok(igCheck?.ok && /1 ✕ Timeout/.test(igCheck.detail), 'a conversation that times out is skipped, the others read', igCheck);
igFails = true;
const checks = async () => (await owner.call('/api/admin/meta/check')).json.data.checks;
ok(await until(async () => (await checks()).some((c) => c.id === 'import_instagram' && !c.ok && /instagram_manage_messages/.test(c.detail))), "Check shows Meta's refusal");
ok((await checks()).some((c) => c.id === 'import_facebook' && c.ok), 'and that Messenger works');

// Erased: nothing comes back, the messages of after do
const customer = list[0].customer_id;
await owner.call('/api/customers', 'PATCH', { action: 'anonymize', id: customer });
fb[0].messages.data.splice(2, 0, msg('unseen', amel, 'never stored', 60));
fb[0].updated_time = ago(-2);
deeper = true;
await pause(1500);
ok((await rows('messenger', amel.id)).length === 0, 'an erased customer is not brought back', await rows('messenger', amel.id));
await pause(1000);
fb[0].messages.data.unshift({ ...msg('again', amel, 'hello again', 0), created_time: new Date(Date.now() + 2000).toISOString() });
fb[0].updated_time = ago(-3);
await until(async () => (await rows('messenger', amel.id)).length);
await pause(600);
ok((await rows('messenger', amel.id)).map((m) => m.body).join() === 'hello again', 'writing again starts a new record', await rows('messenger', amel.id));

server.close();
done();
