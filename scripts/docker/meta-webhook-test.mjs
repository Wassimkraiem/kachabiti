// Sends Meta-style webhook events to the local API (docker compose), signed with META_APP_SECRET
// from .env.docker like Meta signs them: a Facebook comment with a phone number, an Instagram
// comment without one, and a Messenger message. Then check Admin → Customers → Comments / Inbox.
//
//   node scripts/docker/meta-webhook-test.mjs [phone] [http://localhost:4000]
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
    readFileSync('.env.docker', 'utf8').split('\n')
        .map((line) => line.trim().match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value.replace(/^"|"$/g, '')]),
);
const secret = env.META_APP_SECRET;
const verify = env.META_VERIFY_TOKEN;
if (!secret || !verify) throw new Error('Set META_APP_SECRET and META_VERIFY_TOKEN in .env.docker, then restart the api');

const phone = process.argv[2] ?? '22 123 456';
const base = process.argv[3] ?? 'http://localhost:4000';
const url = `${base}/api/webhooks/meta`;
const now = Math.floor(Date.now() / 1000);

// 1. The check Meta runs when the webhook URL is saved.
const challenge = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verify)}&hub.challenge=ok123`);
console.log(`verify: ${challenge.status} ${await challenge.text()}`);

const send = async (label, payload, key = secret) => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
    console.log(`${label}: ${response.status} ${await response.text()}`);
};

await send('facebook comment with a phone', {
    object: 'page',
    entry: [{ id: 'TEST_PAGE', time: now, changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', comment_id: `test_fb_${now}`, post_id: 'TEST_PAGE_post1',
        message: `Salam, nheb nchri wahda, noumrou ${phone}`, created_time: now, from: { id: 'test_user_1', name: 'Test Client' },
    } }] }],
});
await send('instagram comment', {
    object: 'instagram',
    entry: [{ id: 'TEST_IG', time: now, changes: [{ field: 'comments', value: {
        id: `test_ig_${now}`, text: 'Prix svp ?', from: { id: 'test_user_2', username: 'test.client' }, media: { id: 'test_media1' },
    } }] }],
});
await send('messenger message', {
    object: 'page',
    entry: [{ id: 'TEST_PAGE', time: now, messaging: [{ sender: { id: 'test_user_1' }, recipient: { id: 'TEST_PAGE' }, timestamp: now * 1000, message: { mid: `test_mid_${now}`, text: 'Bonjour, c’est dispo en L ?' } }] }],
});
await send('wrong signature (must be refused)', { object: 'page', entry: [] }, 'not-the-secret');
