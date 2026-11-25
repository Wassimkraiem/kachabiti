// Photos, audio, names and profile photos in Messenger, against a stand-in for Meta and for S3.
// Not in test:e2e. Start the API as for social.e2e.mjs, plus
// META_PAGE_ACCESS_TOKEN=page-token S3_ENDPOINT=http://127.0.0.1:9200/s3 S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { APP, done, ok, sql, user } from './helpers.mjs';

const stamp = Date.now();
const HERE = 'http://127.0.0.1:9200';
const stored = new Map();
const sent = [];
let refuse = false;
let early = null;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const wav = Buffer.from('RIFF0000WAVEfmt ');
const file = (res, type, data) => res.writeHead(200, { 'Content-Type': type }).end(data);
const server = createServer((req, res) => {
    const url = new URL(req.url, HERE);
    const chunks = [];
    req.on('data', (c) => chunks.push(c)).on('end', async () => {
        const data = Buffer.concat(chunks);
        const path = url.pathname;
        const json = (body, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (path.startsWith('/s3/')) {
            if (req.method === 'PUT') stored.set(path, { data, type: req.headers['content-type'] });
            else if (req.method === 'DELETE') stored.delete(path);
            else return stored.has(path) && url.searchParams.has('X-Amz-Signature') ? file(res, stored.get(path).type, stored.get(path).data) : res.writeHead(403).end();
            return res.end();
        }
        if (path === '/cdn/photo') return file(res, 'image/jpeg', jpeg);
        if (path === '/cdn/voice') return file(res, 'audio/mp4', Buffer.from('voice'));
        if (path === '/cdn/html') return file(res, 'text/html', '<script>');
        if (path === '/cdn/away') return res.writeHead(302, { Location: 'http://127.0.0.1:9/secret' }).end();
        if (path === `/fb${stamp}`) return json({ first_name: 'Amel', last_name: 'Ben Ali', profile_pic: `${HERE}/cdn/photo` });
        if (path === `/ig${stamp}`) return json({ error: { message: 'No access' } }, 400);
        if (path === '/me/conversations') return json({ data: [{ participants: { data: [{ id: 'shop', username: 'shop' }, { id: `ig${stamp}`, username: 'amel.ig' }] } }] });
        if (path === `/old${stamp}/attachments`) return json({ data: [{ mime_type: 'image/jpeg', image_data: { url: `${HERE}/cdn/photo` } }] });
        if (path === '/me/messages') {
            if (refuse) return json({ error: { message: 'Outside the window' } }, 400);
            const body = JSON.parse(data);
            const read = await fetch(body.message.attachment.payload.url); // as Meta does
            sent.push({ ...body, status: read.status, bytes: Buffer.from(await read.arrayBuffer()) });
            const message_id = `out${sent.length}-${stamp}`;
            if (early) await early(message_id);
            return json({ message_id });
        }
        json({});
    });
});
await new Promise((resolve) => server.listen(9200, '127.0.0.1', resolve));

await sql("update meta_connection set deleted_at = now(), token_encrypted = ''");
const owner = await user('owner@test.local', { role: 'owner' });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
const other = await user('stock@test.local', { role: 'staff', permissions: ['stock'] });
const webhook = (object, event) => {
    const raw = JSON.stringify({ object, entry: [{ id: '111', messaging: [{ timestamp: Date.now(), ...event }] }] });
    return fetch(`${APP}/api/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}` }, body: raw });
};
const from = (id, mid, attachments, text) => ({ sender: { id }, recipient: { id: '111' }, message: { mid, text, attachments } });
const at = (type, path) => ({ type, payload: { url: path.startsWith('http') ? path : HERE + path } });
const until = async (test) => { for (let i = 0; i < 50; i++) { const v = await test(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };
const message = async (mid) => (await sql('select * from customer_interactions where external_id = $1', [mid]))[0];
const get = (path, who = agent) => fetch(`${APP}${path}`, { redirect: 'manual', headers: { cookie: who.cookie } });
const customerOf = async (key, id) => (await sql('select * from customers where external_ids->>$1 = $2 and deleted_at is null', [key, id]))[0];

// Receiving
await webhook('page', from(`fb${stamp}`, `a${stamp}`, [at('image', '/cdn/photo'), at('audio', '/cdn/voice')]));
let row = await until(async () => { const m = await message(`a${stamp}`); return m?.attachments?.every((a) => a.path) && m; });
ok(row?.attachments.map((a) => a.type).join() === 'image,audio', 'photo and audio copied to our storage', row);
const customer = await until(async () => { const c = await customerOf('messenger', `fb${stamp}`); return c?.external_ids.messenger_photo && c; });
ok(customer?.full_name === 'Amel Ben Ali', 'name and profile photo fetched', customer);
let r = await get(`/api/crm/media?id=${row.id}&i=1`);
ok(r.status === 302 && (await (await fetch(r.headers.get('location'))).text()) === 'voice', 'audio opens through a signed link', r.status);
r = await get(`/api/crm/media/photo?customer_id=${customer.id}&channel=facebook`);
ok(r.status === 302 && r.headers.get('location').includes('X-Amz-Signature'), 'profile photo opens', r.status);
let j = (await agent.call(`/api/crm/interactions?customer_id=${customer.id}&channel=facebook`)).json.data;
ok(JSON.stringify(j[0].attachments) === '[{"type":"image"},{"type":"audio"}]', 'the conversation lists them without links', j[0].attachments);
j = (await agent.call('/api/crm/interactions?inbox=1&q=Amel')).json.data.threads.find((t) => t.customer_id === customer.id);
ok(j?.photo === true && j.customer.full_name === 'Amel Ben Ali', 'the list shows name and photo', j);
for (const path of [`?id=${row.id}`, `/photo?customer_id=${customer.id}&channel=facebook`, '/products']) {
    ok((await get(`/api/crm/media${path}`, other)).status === 403, `without customers: refused ${path.slice(0, 9)}`);
    ok((await fetch(`${APP}/api/crm/media${path}`, { redirect: 'manual' })).status === 401, `visitor: refused ${path.slice(0, 9)}`);
}
ok((await get(`/api/crm/media?id=${row.id}&i=9`)).status === 404 && (await get('/api/crm/media?id=x')).status === 400, 'unknown files are refused');

// Never fetched: other hosts (redirects included), and never stored: pages
await webhook('page', from(`fb${stamp}`, `b${stamp}`, [at('image', 'http://169.254.169.254/latest'), at('file', 'https://evil-fbcdn.net/x'), at('image', 'https://a.fbcdn.net.evil.test/x')]));
row = await until(() => message(`b${stamp}`));
ok(row && row.attachments === null, 'links outside Meta are dropped', row);
await webhook('page', from(`fb${stamp}`, `c${stamp}`, [at('image', '/cdn/away'), at('file', '/cdn/html')]));
await new Promise((x) => setTimeout(x, 1000));
row = await message(`c${stamp}`);
ok(row.attachments.every((a) => !a.path), 'a redirect elsewhere and an HTML file are not copied', row.attachments);

// Instagram: profile refused, the conversation gives the name; a name typed by an agent stays
await webhook('instagram', from(`ig${stamp}`, `d${stamp}`, undefined, 'salut'));
ok(await until(async () => (await customerOf('instagram', `ig${stamp}`))?.full_name === 'amel.ig'), 'Instagram name from the conversation');

// Older messages kept as "[image]"
const [old] = await sql("insert into customer_interactions (customer_id, channel, direction, body, external_id) values ($1, 'facebook', 'in', '[image]', $2) returning id", [customer.id, `old${stamp}`]);
await agent.call(`/api/crm/interactions?customer_id=${customer.id}&channel=facebook`);
ok(await until(async () => (await sql('select attachments from customer_interactions where id = $1', [old.id]))[0].attachments?.[0].path), 'an older photo is recovered');

// Sending
const send = async (blob, type, who = agent, extra = {}) => {
    const form = new FormData();
    form.append('customer_id', customer.id);
    form.append('channel', 'facebook');
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    form.append('file', new Blob([blob], { type }), 'x');
    const response = await fetch(`${APP}/api/crm/media`, { method: 'POST', headers: { cookie: who.cookie }, body: form });
    return { status: response.status, json: await response.json().catch(() => null) };
};
r = await send(jpeg, 'image/jpeg');
ok(r.status === 201 && sent[0]?.recipient.id === `fb${stamp}` && sent[0].message.attachment.type === 'image' && sent[0].status === 200 && sent[0].bytes.equals(jpeg), 'a photo is sent, and Meta can read it', r);
// Meta's echo comes before its answer
early = (mid) => webhook('page', { sender: { id: '111' }, recipient: { id: `fb${stamp}` }, message: { mid, is_echo: true, attachments: [at('audio', '/cdn/voice')] } });
r = await send(wav, 'audio/wav');
early = null;
await new Promise((x) => setTimeout(x, 1000));
row = await message(`out2-${stamp}`);
ok(r.status === 201 && sent[1].message.attachment.type === 'audio' && row?.created_by_email === 'agent@test.local' && row.attachments[0].path, 'audio is sent, once, with its sender', row);
ok((await send(Buffer.from('<svg>'), 'image/svg+xml')).status === 400 && (await send(Buffer.from('not a jpeg'), 'image/jpeg')).status === 400, 'other files are refused');
ok((await send(jpeg, 'image/jpeg', other)).status === 403, 'sending needs the customers permission');
ok((await send(jpeg, 'image/jpeg', agent, { channel: 'whatsapp' })).status === 400, 'WhatsApp is refused');
ok((await send(jpeg, 'image/jpeg', agent, { channel: 'instagram' })).status === 409, 'not to someone who never wrote there');
const before = stored.size;
refuse = true;
r = await send(jpeg, 'image/jpeg');
ok(r.status === 502 && /Outside the window/.test(r.json.error) && stored.size === before, "Meta's refusal is shown and nothing is left", r);

// Products
const [product] = await sql("insert into products (name, slug, base_price) values ($1, $2, 10) returning id", [`Media ${stamp}`, `media-${stamp}`]);
await sql("insert into product_images (product_id, image_url, is_main, position) values ($1, 'https://x/b.webp', false, 1), ($1, 'https://x/a.webp', true, 2)", [product.id]);
j = (await agent.call(`/api/crm/media/products?q=Media ${stamp}`)).json.data;
ok(j.length === 1 && j[0].images.join() === 'https://x/a.webp,https://x/b.webp', 'products with their photos, main first', j);

// Erasing personal data
const mine = () => [...stored.keys()].filter((k) => k.includes(customer.id)).length;
ok(mine() >= 5, 'files are stored per customer', mine());
r = await owner.call('/api/customers', 'PATCH', { action: 'anonymize', id: customer.id });
ok(r.status === 200 && mine() === 0 && (await sql('select 1 from customer_interactions where customer_id = $1 and attachments is not null', [customer.id])).length === 0, 'erasing a customer deletes their files', { r, left: mine() });

server.close();
done();
