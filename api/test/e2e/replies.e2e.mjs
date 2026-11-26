// Messenger: the team's saved replies. Start the API as for media.e2e.mjs.
import { APP, done, ok, user } from './helpers.mjs';

const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
const remover = await user('remover@test.local', { role: 'staff', permissions: ['customers', 'delete'] });
const other = await user('stock@test.local', { role: 'staff', permissions: ['stock'] });

let r = await agent.call('/api/crm/replies');
ok(r.status === 200 && r.json.data[0]?.body === 'عسلامة مرحبا بيك 🌹' && r.json.data.length >= 21, "the shop's messages are there, greeting first", r.json.data?.length);
ok(r.json.data.some((x) => x.title === 'Pack duo' && x.body.includes('\n')), 'with their line breaks');
const count = r.json.data.length;

r = await agent.call('/api/crm/replies', 'POST', { title: '  Taille M  ', body: 'Oui, la taille M est disponible.' });
ok(r.status === 201 && r.json.data.title === 'Taille M' && r.json.data.position === count, 'an agent adds one, at the end', r.json);
const id = r.json.data.id;
ok((await agent.call('/api/crm/replies', 'PUT', { id, body: 'Oui, M et L.' })).json.data.body === 'Oui, M et L.', 'and changes it');
ok((await agent.call('/api/crm/replies', 'POST', { title: '', body: 'x' })).status === 400 && (await agent.call('/api/crm/replies', 'POST', { title: 'x', body: '   ' })).status === 400, 'empty title or text is refused');
ok((await agent.call(`/api/crm/replies?id=${id}`, 'DELETE')).status === 403, 'deleting needs the delete permission');
ok((await remover.call(`/api/crm/replies?id=${id}`, 'DELETE')).status === 200 && (await agent.call('/api/crm/replies')).json.data.length === count, 'removed with it');
ok((await agent.call('/api/crm/replies', 'PUT', { id, title: 'back' })).status === 404, 'a removed one stays removed');
ok((await other.call('/api/crm/replies')).status === 403 && (await fetch(`${APP}/api/crm/replies`)).status === 401, 'others cannot see them');
done();
