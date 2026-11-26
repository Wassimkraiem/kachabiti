// Messenger: whoever opens a conversation first answers it. Start the API as for media.e2e.mjs.
import { createServer } from 'node:http';
import { APP, done, ok, sql, user } from './helpers.mjs';

const sent = [];
const server = createServer((req, res) => {
    req.on('data', () => undefined).on('end', () => {
        if (req.url.startsWith('/me/messages')) sent.push(1);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.url.startsWith('/me/messages') ? { message_id: `m${Date.now()}${sent.length}` } : {}));
    });
});
await new Promise((resolve) => server.listen(9200, '127.0.0.1', resolve));

const stamp = Date.now();
const amina = await user('amina@test.local', { role: 'staff', permissions: ['customers'] });
const youssef = await user('youssef@test.local', { role: 'staff', permissions: ['customers'] });
const owner = await user('owner@test.local', { role: 'owner' });
const [customer] = await sql("insert into customers (full_name, channel, external_ids) values ($1, 'facebook', $2) returning id", [`Assign ${stamp}`, { messenger: `psid${stamp}` }]);
await sql("insert into customer_interactions (customer_id, channel, direction, body) values ($1, 'facebook', 'in', 'hello')", [customer.id]);
const id = customer.id;
const claim = (who, action) => who.call('/api/crm/interactions/claim', 'POST', { customer_id: id, ...(action ? { action } : {}) });
const reply = (who) => who.call('/api/crm/interactions', 'POST', { customer_id: id, channel: 'facebook', direction: 'out', body: 'hi', send: true });
const assigned = async () => (await sql('select assigned_to_email from customers where id = $1', [id]))[0].assigned_to_email;
const thread = async (who, extra = '') => (await who.call(`/api/crm/interactions?inbox=1&q=Assign ${stamp}${extra}`)).json.data.threads;

let r = await claim(amina);
ok(r.status === 201 && (await assigned()) === 'amina@test.local', 'opening claims it', r.json);
ok((await claim(youssef)).status === 409 && (await assigned()) === 'amina@test.local', 'another agent cannot claim it');
r = await reply(youssef);
ok(r.status === 409 && /another agent/.test(r.json.error), "another agent's reply is refused", r.json);
ok(sent.length === 0, 'and nothing reaches the customer');
const form = new FormData();
form.append('customer_id', id);
form.append('channel', 'facebook');
form.append('file', new Blob([Buffer.from([0xff, 0xd8, 1])], { type: 'image/jpeg' }), 'x.jpg');
ok((await fetch(`${APP}/api/crm/media`, { method: 'POST', headers: { cookie: youssef.cookie }, body: form })).status === 409, 'and so is their photo');
ok((await reply(amina)).status === 201 && sent.length === 1, 'the assigned agent replies');
ok((await claim(youssef, 'take')).status === 403, 'staff cannot take it over');
ok((await claim(youssef, 'release')).status === 409 && (await assigned()) === 'amina@test.local', "nor release someone else's");

let t = await thread(youssef);
ok(t[0]?.customer.assigned_to_email === 'amina@test.local' && t[0].customer.assigned_to === amina.id, 'others see who has it', t[0]?.customer);
ok((await thread(amina, '&assigned=me')).length === 1 && (await thread(youssef, '&assigned=me')).length === 0, '"Mine" lists only your own');

ok((await reply(owner)).status === 201 && (await assigned()) === 'amina@test.local', 'an owner replies without taking it');
ok((await claim(owner, 'take')).status === 201 && (await assigned()) === 'owner@test.local', 'an owner takes it over');
ok((await claim(owner, 'release')).status === 201 && (await assigned()) === null, 'and releases it');
ok((await reply(youssef)).status === 201 && (await assigned()) === 'youssef@test.local', 'replying to a free conversation claims it');

const both = await Promise.all([claim(amina), claim(owner)]);
ok(both.filter((x) => x.status === 201).length >= 1 && (await assigned()) === 'youssef@test.local', 'a claimed conversation stays with its agent');

server.close();
done();
