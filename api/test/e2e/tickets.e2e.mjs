// Team tasks: the board's API, assignment notifications, the morning alert and My day.
// Each run uses new team members, so earlier runs' tickets don't count.
import { done, ok, sql, user } from './helpers.mjs';

const run = Date.now();
const owner = await user('owner@test.local', { role: 'owner' });
const alice = await user(`alice-${run}@test.local`, { role: 'staff', permissions: ['pos'] });
const bob = await user(`bob-${run}@test.local`, { role: 'staff', permissions: ['stock'] });
const shopper = await user(`shopper-${run}@test.local`);
ok(owner.id && alice.id && bob.id && shopper.id, 'test users signed in');

const BOARD = '/api/admin/tickets';
const notes = (who, type) => sql('select * from notifications where recipient_id = $1 and type = $2 order by id', [who.id, type]);
const tunis = (days) => new Date(Date.now() + 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

// Access
let r = await shopper.call(BOARD);
ok(r.status === 403, 'a shopper cannot read the board', r.status);
r = await shopper.call(BOARD, 'POST', { title: 'No' });
ok(r.status === 403, 'a shopper cannot create a task', r.status);

// Where people start: staff on the board, owners on the dashboard.
const home = async (who, path) => new URL((await who.call(path)).location ?? path, 'http://x').pathname;
ok(await home(alice, '/admin') === '/admin/tickets', 'staff start on the board');
ok(await home(alice, '/admin/login') === '/admin/tickets', 'signed-in staff skip the login page');
ok(await home(alice, '/admin/overview') === '/admin/tickets', 'a refused page sends staff to the board');
ok(await home(owner, '/admin') === '/admin/dashboard', 'owners start on the dashboard');
ok((await alice.call('/admin/dashboard')).status === 200, 'staff can still open the dashboard');

// Validation
r = await alice.call(BOARD, 'POST', { title: '   ' });
ok(r.status === 400, 'an empty title is refused', r.json);
r = await alice.call(BOARD, 'POST', { title: 'Bad', priority: 'urgent' });
ok(r.status === 400, 'an unknown priority is refused', r.json);
r = await alice.call(BOARD, 'POST', { title: 'Bad', assigned_to: shopper.id });
ok(r.status === 400, 'a shopper cannot be assigned', r.json);

// A colleague assigns a task: the assignee is told, in three languages.
r = await alice.call(BOARD, 'POST', { title: `Count the shelves ${run}`, description: 'Top floor', priority: 'high', due_date: tunis(-1), assigned_to: bob.id });
const ticket = r.json?.data;
ok(r.status === 201 && ticket?.status === 'todo' && ticket.assigned_to_email === `bob-${run}@test.local` && ticket.created_by === alice.id, 'task created', r.json);
let told = await notes(bob, 'ticket_assigned');
ok(told.length === 1 && told[0].title.en.includes('Count the shelves') && told[0].title.ar && told[0].title.fr, 'the assignee is notified', told);
ok(told[0]?.severity === 'warning' && told[0].url === `/admin/tickets?id=${ticket.id}` && told[0].body.en.includes('alice-'), 'the notification links to the task and names who asked', told[0]);

// Owners and admins assign too, and everyone sees it.
r = await owner.call(BOARD, 'POST', { title: `Call the printer ${run}`, assigned_to: alice.id });
ok(r.status === 201 && (await notes(alice, 'ticket_assigned')).length === 1, 'an owner assigns a task to a staff member', r.json);
r = await bob.call(BOARD);
ok(r.json?.data?.some((t) => t.id === ticket.id) && r.json.data.some((t) => t.title === `Call the printer ${run}`), 'everyone sees every task', r.json);

// Taking one yourself is not news; saving without changing the assignee neither.
r = await bob.call(BOARD, 'POST', { title: `My own ${run}`, assigned_to: bob.id });
ok(r.status === 201 && (await notes(bob, 'ticket_assigned')).length === 1, 'no notification for your own task', r.json);
r = await alice.call(BOARD, 'PUT', { id: ticket.id, title: `Count all shelves ${run}`, assigned_to: bob.id });
ok(r.status === 200 && r.json.data.title.startsWith('Count all') && (await notes(bob, 'ticket_assigned')).length === 1, 'editing does not notify again', r.json);

// My day and the morning alert
const myDay = async (who) => (await who.call('/api/admin/my-work')).json?.data?.tickets ?? [];
let mine = await myDay(bob);
ok(mine[0]?.id === ticket.id && mine[0].due_date === tunis(-1) && mine.length === 2, 'My day lists open tasks, overdue first, for someone with no orders permission', mine);
await sql('select private.daily_alerts()');
let due = await notes(bob, 'tickets_due');
ok(due.length === 1 && due[0].title.en.startsWith('1 task') && due[0].url === '/admin/tickets', 'an overdue task alerts its assignee', due);

// Moved along, it stays open; done, it stops nagging and leaves My day.
r = await bob.call(BOARD, 'PUT', { id: ticket.id, status: 'in_progress' });
ok(r.json?.data?.status === 'in_progress' && r.json.data.done_at === null, 'moved to in progress', r.json);
r = await bob.call(BOARD, 'PUT', { id: ticket.id, status: 'done' });
const doneAt = r.json?.data?.done_at;
ok(r.json?.data?.status === 'done' && doneAt, 'moved to done', r.json);
r = await bob.call(BOARD, 'PUT', { id: ticket.id, status: 'done', description: 'Finished' });
ok(r.json?.data?.done_at === doneAt, 'done_at keeps the first time', r.json);
ok(!(await myDay(bob)).some((t) => t.id === ticket.id), 'a done task leaves My day');
await sql('select private.daily_alerts()');
ok((await notes(bob, 'tickets_due')).length === 1, 'a done task sends no more alerts');
r = await bob.call(BOARD, 'PUT', { id: ticket.id, status: 'todo' });
ok(r.json?.data?.done_at === null, 'reopening clears done_at', r.json);

// Someone who left: the task falls back to its author, who is not forgotten either.
await sql('update back_office_users set deleted_at = now() where user_id = $1', [bob.id]);
await sql('select private.daily_alerts()');
ok((await notes(alice, 'tickets_due')).length === 1 && (await notes(bob, 'tickets_due')).length === 1, 'the author is alerted when the assignee left');
await sql('update back_office_users set deleted_at = null where user_id = $1', [bob.id]);

// Reassigning notifies the new person; the first one is not told again.
r = await bob.call(BOARD, 'PUT', { id: ticket.id, assigned_to: alice.id });
ok(r.status === 200 && (await notes(alice, 'ticket_assigned')).length === 2, 'reassigning notifies the new assignee', r.json);
r = await bob.call(BOARD, 'PUT', { id: ticket.id, assigned_to: null });
ok(r.json?.data?.assigned_to === null && r.json.data.assigned_to_email === null, 'a task can be unassigned', r.json);

// Soft delete: its author or the delete permission.
r = await bob.call(`${BOARD}?id=${ticket.id}`, 'DELETE');
ok(r.status === 403, 'someone else cannot delete it', r.status);
r = await alice.call(`${BOARD}?id=${ticket.id}`, 'DELETE');
ok(r.status === 200, 'the author deletes it', r.json);
ok((await sql('select deleted_at from team_tickets where id = $1', [ticket.id]))[0]?.deleted_at, 'the row is kept, soft-deleted');
ok(!(await alice.call(BOARD)).json?.data?.some((t) => t.id === ticket.id), 'a deleted task leaves the board');
r = await alice.call(BOARD, 'PUT', { id: ticket.id, title: 'Back' });
ok(r.status === 404, 'a deleted task cannot be edited', r.status);
r = await owner.call(`${BOARD}?id=not-a-uuid`, 'DELETE');
ok(r.status === 400, 'a bad id is refused', r.status);

// The board: tasks have a short number, and dragging one sets its place in the column.
const a = (await bob.call(BOARD, 'POST', { title: `First ${run}` })).json.data;
const b = (await bob.call(BOARD, 'POST', { title: `Second ${run}` })).json.data;
ok(Number.isInteger(a.ticket_number) && b.ticket_number > a.ticket_number && b.position >= a.position, 'new tasks are numbered and go last', [a, b]);
r = await bob.call(BOARD, 'PUT', { id: b.id, position: a.position - 1000 });
const order = (await bob.call(BOARD)).json.data.map((t) => t.id);
ok(r.status === 200 && order.indexOf(b.id) < order.indexOf(a.id), 'a dragged task keeps its new place', order.slice(0, 4));
r = await bob.call(BOARD, 'PUT', { id: b.id, position: 'top' });
ok(r.status === 400, 'a bad position is refused', r.status);

// Comments and images: any team member, on a live task; assignee and author are told.
const task = (await alice.call(BOARD, 'POST', { title: `Photo ${run}`, assigned_to: bob.id })).json.data;
const CURL = `${BOARD}/comments`;
r = await bob.call(CURL, 'POST', { ticket_id: task.id, body: 'On it' });
ok(r.status >= 200 && r.status < 300, 'comment added', r.json);
ok((await notes(alice, 'ticket_comment')).length === 1 && (await notes(bob, 'ticket_comment')).length === 0, 'the author is told, not the one who wrote it');
r = await bob.call(CURL, 'POST', { ticket_id: task.id, body: '   ' });
ok(r.status === 400, 'an empty comment is refused', r.status);
r = await shopper.call(`${CURL}?ticket_id=${task.id}`);
ok(r.status === 403, 'a shopper cannot read comments', r.status);
const post = (who, form) => fetch(`${process.env.APP_URL ?? 'http://localhost:3000'}${CURL}`, { method: 'POST', headers: { cookie: who.cookie }, body: form });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const upload = (bytes, type, name) => { const f = new FormData(); f.append('ticket_id', task.id); f.append('file', new Blob([bytes], { type }), name); return f; };
let res = await post(alice, upload(PNG, 'image/png', 'shelf.png'));
ok(res.ok, 'an image is attached by staff without products or marketing', res.status);
res = await post(alice, upload(Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg'));
ok(res.status === 400, 'an SVG is refused', res.status);
res = await post(alice, upload(Buffer.alloc(6 * 1024 * 1024), 'image/png', 'big.png'));
ok(res.status >= 400 && res.status < 500, 'an image over 5 MB is refused', res.status);
let rows = (await bob.call(`${CURL}?ticket_id=${task.id}`)).json?.data ?? [];
ok(rows.length === 2 && rows[0].body === 'On it' && !('image_path' in rows[0]), 'comments listed, oldest first', rows);
const link = rows[1]?.image_url;
ok(link && (await fetch(link)).ok, 'the image link works', link);
ok(link && (await fetch(link.split('?')[0])).status >= 400, 'the image is private without the signed link', link);
ok((await alice.call(BOARD)).json?.data?.find((t) => t.id === task.id)?.comment_count === 2, 'the board counts comments');
r = await alice.call(`${CURL}?id=${rows[0].id}`, 'DELETE');
ok(r.status === 403, "someone else cannot delete a comment", r.status);
r = await bob.call(`${CURL}?id=${rows[0].id}`, 'DELETE');
ok(r.status === 200 && (await bob.call(`${CURL}?ticket_id=${task.id}`)).json.data.length === 1, 'its author deletes a comment', r.json);

// The owner clears the Done column; staff cannot clear other people's tasks.
await owner.call(BOARD, 'PUT', { id: task.id, status: 'done' });
const other = (await bob.call(BOARD, 'POST', { title: `Other ${run}`, status: 'done' })).json.data;
r = await alice.call(`${BOARD}?ids=${task.id},${other.id}`, 'DELETE');
ok(r.status === 403 && (await sql('select 1 from team_tickets where id = any($1) and deleted_at is null', [[task.id, other.id]])).length === 2, 'staff cannot bulk-delete others\' tasks', r.status);
r = await owner.call(`${BOARD}?ids=${task.id},${other.id}`, 'DELETE');
ok(r.status === 200 && r.json.data.ids.length === 2, 'the owner deletes the done tasks', r.json);

// Restore: owners only, from Deleted items.
const TRASH = '/api/admin/trash';
const purger = await user(`purger-${run}@test.local`, { role: 'staff', permissions: ['delete', 'hard_delete', 'products'] });
r = await purger.call(`${TRASH}?table=team_tickets&ids=${task.id}`, 'PUT');
ok(r.status === 403, 'staff with hard_delete cannot restore', r.status);
r = await owner.call(`${TRASH}?table=team_tickets`);
ok(r.json?.data?.rows?.some((row) => row.id === task.id && row.label === `Photo ${run}`), 'deleted tasks are listed', r.json);
r = await owner.call(`${TRASH}?table=users&ids=${task.id}`, 'PUT');
ok(r.status === 400, 'a table outside the list is refused', r.status);
r = await owner.call(`${TRASH}?table=team_tickets&ids=${task.id}`, 'PUT');
ok(r.json?.data?.restored === 1 && (await owner.call(BOARD)).json.data.some((t) => t.id === task.id), 'the owner restores a task', r.json);
r = await owner.call(`${TRASH}?table=team_tickets&ids=${task.id}`, 'PUT');
ok(r.json?.data?.restored === 0, 'restoring a live row does nothing', r.json);
const restoreLog = await sql("select action, actor_id from activity_log where entity = 'team_tickets' and entity_id = $1 and action = 'restore'", [task.id]);
ok(restoreLog[0]?.actor_id === owner.id, 'a restore is in the activity log', restoreLog);

const slug = `e2e-restore-${run}`;
const product = (await sql("insert into products (name, slug, base_price, status, deleted_at) values ($1, $1, 10, 'archived', now()) returning id", [slug]))[0];
r = await owner.call(`${TRASH}?table=products&ids=${product.id}`, 'PUT');
let back = (await sql('select status, deleted_at from products where id = $1', [product.id]))[0];
ok(r.json?.data?.restored === 1 && back.status === 'inactive' && !back.deleted_at, 'a product comes back inactive', back);
const variant = (await sql('insert into product_variants (product_id, price) values ($1, 10) returning id', [product.id]))[0];
await sql("insert into product_images (product_id, variant_id, image_url) values ($1, $2, 'https://example.com/a.png')", [product.id, variant.id]);
await sql("select public.delete_variant($1)", [variant.id]);
await owner.call(`${TRASH}?table=product_variants&ids=${variant.id}`, 'PUT');
back = (await sql('select v.deleted_at, v.is_available, (select count(*)::int from product_images i where i.variant_id = v.id and i.deleted_at is null) as photos from product_variants v where v.id = $1', [variant.id]))[0];
ok(!back.deleted_at && back.is_available && back.photos === 1, 'a variant comes back with its photos', back);
const name = `Restore supplier ${run}`;
const supplier = (await sql('insert into suppliers (name, deleted_at) values ($1, now()) returning id', [name]))[0];
await sql('insert into suppliers (name) values ($1)', [name]);
r = await owner.call(`${TRASH}?table=suppliers&ids=${supplier.id}`, 'PUT');
ok(r.status === 409, 'a name taken since cannot be restored', r.status);

// Activity log
const log = await sql("select action, actor_id from activity_log where entity = 'team_tickets' and entity_id = $1 order by created_at", [ticket.id]);
ok(log[0]?.action === 'create' && log[0].actor_id === alice.id && log.at(-1)?.action === 'delete', 'changes are in the activity log', log);

// An owner's task kept for themselves (assigned to nobody or to them) is a private note.
const otherOwner = await user(`owner2-${run}@test.local`, { role: 'owner' });
const note = (await owner.call(BOARD, 'POST', { title: `Private note ${run}` })).json.data;
const selfNote = (await owner.call(BOARD, 'POST', { title: `Self note ${run}`, assigned_to: owner.id })).json.data;
const seen = async (who, id) => (await who.call(BOARD)).json.data.some((t) => t.id === id);
ok(await seen(owner, note.id) && await seen(owner, selfNote.id), 'the owner sees their own notes');
ok(!(await seen(alice, note.id)) && !(await seen(alice, selfNote.id)) && !(await seen(otherOwner, note.id)), 'nobody else sees an owner\'s notes, other owners included');
ok((await alice.call(BOARD, 'PUT', { id: note.id, title: 'Peek' })).status === 404, 'a note can\'t be edited by someone else');
ok((await otherOwner.call(`${BOARD}?id=${note.id}`, 'DELETE')).status === 404, 'a note can\'t be deleted by someone else');
ok((await alice.call(`${BOARD}/comments?ticket_id=${note.id}`)).status === 404, 'a note\'s comments stay private');
const aliceNote = (await alice.call(BOARD, 'POST', { title: `Staff task ${run}` })).json.data;
ok(await seen(bob, aliceNote.id), 'a staff member\'s unassigned task stays visible to the team');
await owner.call(BOARD, 'PUT', { id: note.id, assigned_to: bob.id });
ok(await seen(bob, note.id) && await seen(alice, note.id), 'assigning a note to someone shares it');

done();
