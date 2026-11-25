// Admin → Messenger: threads per person and channel, unread counts, comments per author.
import { done, ok, sql, user } from './helpers.mjs';

const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
const other = await user('stock@test.local', { role: 'staff', permissions: ['stock'] });
const stamp = Date.now();
const name = `Messenger ${stamp}`;
const [customer] = await sql('insert into customers (full_name, channel) values ($1, $2) returning id', [name, 'facebook']);
const add = (channel, direction, body, minutes) =>
    sql("insert into customer_interactions (customer_id, channel, direction, body, created_at) values ($1, $2, $3, $4, now() - make_interval(mins => $5))", [customer.id, channel, direction, body, minutes]);
await add('facebook', 'in', 'first', 30);
await add('facebook', 'in', 'second', 20);
await add('instagram', 'in', 'on insta', 10);
await add('phone', 'note', 'called', 5);

const inbox = async (extra = '') => (await agent.call(`/api/crm/interactions?inbox=1&q=${encodeURIComponent(name)}${extra}`)).json?.data;
let data = await inbox();
ok(data?.threads.length === 2 && data.threads[0].channel === 'instagram', 'one thread per channel, latest first, no phone notes', data?.threads);
const fb = data.threads.find((t) => t.channel === 'facebook');
ok(fb.unread === 2 && fb.body === 'second' && fb.customer.full_name === name, 'thread shows its latest message and unread count', fb);
ok(data.unread.facebook >= 2 && data.unread.instagram >= 1, 'unread per channel', data.unread);
ok((await inbox('&channel=instagram')).threads.length === 1, 'filtered by channel');

let r = await agent.call(`/api/crm/interactions?customer_id=${customer.id}&channel=facebook`);
ok(r.json.data.map((m) => m.body).join() === 'first,second', 'a conversation holds its channel only, oldest first', r.json.data);
await agent.call('/api/crm/interactions', 'PUT', { customer_id: customer.id, channel: 'facebook' });
data = await inbox('&unread=1');
ok(data.threads.length === 1 && data.threads[0].channel === 'instagram', 'reading one channel leaves the other unread', data.threads);
ok((await other.call('/api/crm/interactions?inbox=1')).status === 403, 'needs the customers permission');

const author = `author-${stamp}`;
const comment = (platform, id, body, minutes) =>
    sql("insert into social_comments (platform, external_id, author_id, author_name, body, commented_at) values ($1, $2, $3, $4, $5, now() - make_interval(mins => $6)) returning id", [platform, `${id}-${stamp}`, author, name, body, minutes]);
await comment('facebook', 'c1', 'price?', 9);
const [latest] = await comment('facebook', 'c2', 'still there?', 3);
await comment('instagram', 'c3', 'nice', 6);
const threads = async (extra = '') => (await agent.call(`/api/crm/comments?threads=1&q=${encodeURIComponent(name)}${extra}`)).json?.data;
data = await threads();
ok(data?.threads.length === 2 && data.threads[0].body === 'still there?' && data.threads[0].open === 2, 'comments grouped per person and platform', data?.threads);
ok((await threads('&platform=instagram')).threads.length === 1, 'comments filtered by channel');
r = await agent.call(`/api/crm/comments?platform=facebook&author=${author}`);
ok(r.json.data.rows.length === 2 && r.json.data.total === 2, "one person's comments", r.json.data);
await agent.call('/api/crm/comments', 'PATCH', { ids: [latest.id], handled: true });
data = await threads('&platform=facebook');
ok(data.threads[0].open === 1, 'handled comments leave the count', data.threads);
r = await agent.call(`/api/crm/comments?threads=1&show=open&q=${encodeURIComponent("100%' or 1=1 --")}`);
ok(r.status === 200 && r.json.data.threads.length === 0, 'search text is only text', r);

done();
