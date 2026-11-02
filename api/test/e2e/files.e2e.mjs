// Phase 4: uploads and documents on S3-compatible storage, and the live notification stream,
// through APP_URL. Needs the local storage service (docker-compose.yml). Local only.
import { APP, done, ok, user } from './helpers.mjs';

const owner = await user('owner@test.local', { role: 'owner' });
const marketer = await user('marketer@test.local', { role: 'staff', permissions: ['marketing'] });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['orders', 'customers'] });

async function send(who, path, form, method = 'POST') {
    const r = await fetch(`${APP}${path}`, { method, headers: { cookie: who.cookie }, body: form });
    return { status: r.status, json: await r.json().catch(() => null) };
}
const file = (bytes, type, name) => new File([bytes], name, { type });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// Shop images: public bucket.
let form = new FormData();
form.append('file', file(png, 'image/png', 'a.png'));
const upload = await send(marketer, '/api/upload/image', form);
ok(upload.status === 200 && /^product-.*\.png$/.test(upload.json?.fileName ?? ''), 'image uploaded', upload.json);
const image = await fetch(upload.json.url);
ok(image.status === 200 && (await image.arrayBuffer()).byteLength === png.length, 'image public at its url');
form = new FormData();
form.append('file', file('<script>', 'text/html', 'a.html'));
ok((await send(marketer, '/api/upload/image', form)).status === 400, 'non-image refused');
form = new FormData();
form.append('file', file(png, 'image/png', 'a.png'));
ok((await send(agent, '/api/upload/image', form)).status === 403, 'upload needs products or marketing');
ok((await owner.call('/api/upload/image?fileName=../secret', 'DELETE')).status === 400, 'no paths in file names');
ok((await owner.call(`/api/upload/image?fileName=${upload.json.fileName}`, 'DELETE')).status === 200, 'image deleted');
ok((await fetch(upload.json.url)).status === 404, 'image gone');

// Documents: private bucket, signed links.
form = new FormData();
form.append('file', file('%PDF-1.4 e2e', 'application/pdf', 'contract.pdf'));
form.append('title', 'E2E contract');
form.append('kind', 'contract');
const doc = await send(owner, '/api/finance/documents', form);
ok(doc.status === 201 && doc.json?.data?.storage_path && doc.json.data.file_name === 'contract.pdf', 'document stored', doc.json);
const id = doc.json?.data?.id;
ok((await fetch(`http://localhost:9000/documents/${doc.json.data.storage_path}`)).status === 403, 'documents bucket is private');
const link = await owner.call(`/api/finance/documents?id=${id}&download=1`);
const downloaded = await fetch(link.json.data.url);
ok(downloaded.status === 200 && (await downloaded.text()) === '%PDF-1.4 e2e', 'signed link downloads it');
ok(/contract\.pdf/.test(downloaded.headers.get('content-disposition') ?? ''), 'under its own name');
ok((await agent.call(`/api/finance/documents?id=${id}`)).status === 403, 'documents need finance');
ok((await owner.call('/api/finance/documents', 'PUT', { id, title: 'Renamed' })).json?.data?.title === 'Renamed', 'document renamed');
ok((await owner.call(`/api/finance/documents?id=${id}`, 'DELETE')).status === 200, 'document deleted (soft)');
ok((await owner.call(`/api/finance/documents?id=${id}`)).status === 404, 'deleted document hidden');

// Live notifications (SSE): the test notification arrives on the open stream.
const controller = new AbortController();
const stream = await fetch(`${APP}/api/admin/notifications/stream`, { headers: { cookie: owner.cookie }, signal: controller.signal });
ok(stream.status === 200 && stream.headers.get('content-type')?.startsWith('text/event-stream'), 'stream opens');
const reader = stream.body.getReader();
await owner.call('/api/admin/notifications/test', 'POST');
let text = '';
const deadline = Date.now() + 8000;
while (!text.includes('"op":"insert"') && Date.now() < deadline) {
    const { value, done: end } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: false }), 1000))]);
    if (end) break;
    if (value) text += new TextDecoder().decode(value);
}
controller.abort();
const event = JSON.parse(text.split('\n').find((l) => l.startsWith('data: {'))?.slice(6) ?? 'null');
ok(event?.op === 'insert' && event.row?.type === 'test' && event.row.recipient_id === owner.id, 'test notification streamed', text.slice(0, 300));
ok((await fetch(`${APP}/api/admin/notifications/stream`)).status === 401, 'stream needs a session');

done();
