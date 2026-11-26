// Meta ads: the ad account's campaigns, and the conversations and sales their ads brought, against a
// stand-in for Meta. Start the API as for media.e2e.mjs.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { APP, done, ok, sql, user } from './helpers.mjs';

const stamp = Date.now();
const calls = [];
let scopes = ['pages_messaging', 'pages_manage_metadata', 'ads_read'];
const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    req.on('data', () => undefined).on('end', () => {
        calls.push({ path: url.pathname, token: req.headers.authorization?.slice(7), q: Object.fromEntries(url.searchParams) });
        const json = (b, s = 200) => res.writeHead(s, { 'Content-Type': 'application/json' }).end(JSON.stringify(b));
        const p = url.pathname;
        if (p === '/oauth/access_token') return json({ access_token: 'person-token' });
        if (p === '/me/accounts') return json({ data: [{ id: '111', name: 'Shop', access_token: 'page-token', instagram_business_account: { id: '999', username: 'shop' } }] });
        if (p === '/debug_token') return json({ data: { is_valid: true, app_id: 'app', expires_at: 0, scopes } });
        if (p === '/me/adaccounts') return json({ data: [{ id: 'act_42', name: 'Kachabiti ads', currency: 'TND', account_status: 1 }] });
        if (p === '/act_42/insights') return json({ data: [
            { campaign_id: 'c1', campaign_name: 'Kachabia winter', spend: '120.50', impressions: '10000', reach: '7000', clicks: '300', ctr: '3', cpc: '0.40', cpm: '12.05', frequency: '1.4', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '25' }] },
        ] });
        if (p === '/act_42/campaigns') return json({ data: [
            { id: 'c1', name: 'Kachabia winter', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '2000' },
            { id: 'c2', name: 'Old summer', status: 'PAUSED', effective_status: 'PAUSED' },
            { id: 'c3', name: 'Burnous', status: 'ACTIVE', effective_status: 'ACTIVE' },
        ] });
        if (p === '/' && url.searchParams.get('ids')) return json(Object.fromEntries(url.searchParams.get('ids').split(',').map((id) => [id, id.startsWith('ad-c1') ? { campaign_id: 'c1' } : { error: 'gone' }]).filter(([, v]) => v.campaign_id)));
        json({ success: true });
    });
});
await new Promise((resolve) => server.listen(9200, '127.0.0.1', resolve));

await sql("update meta_connection set deleted_at = now(), token_encrypted = ''");
const owner = await user('owner@test.local', { role: 'owner' });
const marketer = await user('marketer@test.local', { role: 'staff', permissions: ['marketing'] });
const agent = await user('agent@test.local', { role: 'staff', permissions: ['customers'] });
const today = new Date().toISOString().slice(0, 10);
const report = (who = marketer) => who.call(`/api/marketing/meta-ads?from=${today}&to=${today}`);

ok((await report()).status === 409, 'no Page connected: refused');
// Connect: the person's token is kept for the ads
const login = await fetch(`${APP}/api/admin/meta/login`, { redirect: 'manual', headers: { cookie: owner.cookie } });
const pair = (r, name) => r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`)).split(';')[0];
const back = await fetch(`${APP}/api/admin/meta/callback?code=x&state=${new URL(login.headers.get('location')).searchParams.get('state')}`, { redirect: 'manual', headers: { cookie: `${owner.cookie}; ${pair(login, 'kb_meta_state')}` } });
await fetch(`${APP}/api/admin/meta`, { method: 'POST', headers: { cookie: `${owner.cookie}; ${pair(back, 'kb_meta_login')}`, 'Content-Type': 'application/json' }, body: '{"page_id":"111"}' });
let [row] = await sql('select * from meta_connection where deleted_at is null');
ok(row?.user_token_encrypted && !row.user_token_encrypted.includes('person-token'), "the person's token is kept, encrypted", row?.page_id);

let r = await report();
ok(r.status === 409 && r.json.code === 'NO_AD_ACCOUNT', 'no ad account chosen yet', r.json);
ok((await marketer.call('/api/admin/meta/ad-accounts')).status === 403, 'only owners and admins choose the account');
r = await owner.call('/api/admin/meta/ad-accounts');
ok(r.json?.data?.[0]?.id === 'act_42' && calls.at(-1).token === 'person-token', "ad accounts read with the person's token", r.json);
ok((await owner.call('/api/admin/meta/ad-account', 'POST', { id: 'act_7' })).status === 404, 'an account not granted is refused');
r = await owner.call('/api/admin/meta/ad-account', 'POST', { id: 'act_42' });
ok(r.status === 201 && (await owner.call('/api/admin/meta')).json.data.page.ad_account.currency === 'TND', 'ad account chosen', r.json);

// Someone writes after clicking an ad of c1, another after an ad Meta no longer lists
const webhook = (object, event) => {
    const raw = JSON.stringify({ object, entry: [{ id: object === 'page' ? '111' : '999', messaging: [{ timestamp: Date.now(), ...event }] }] });
    return fetch(`${APP}/api/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}` }, body: raw });
};
const referral = (ad) => ({ source: 'ADS', type: 'OPEN_THREAD', ad_id: ad, ads_context_data: { ad_title: 'Winter kachabia -20%' } });
await webhook('page', { sender: { id: `fan${stamp}` }, recipient: { id: '111' }, referral: referral(`ad-c1-${stamp}`), message: { mid: `m1${stamp}`, text: 'prix ?' } });
await webhook('instagram', { sender: { id: `ig${stamp}` }, recipient: { id: '999' }, message: { mid: `m2${stamp}`, text: 'salam', referral: referral(`ad-c1-b${stamp}`) } });
await webhook('page', { sender: { id: `old${stamp}` }, recipient: { id: '111' }, referral: referral(`ad-x-${stamp}`) });
await webhook('page', { sender: { id: `fan${stamp}` }, recipient: { id: '111' }, referral: referral(`ad-c1-${stamp}`), message: { mid: `m1${stamp}`, text: 'prix ?' } });
const refs = await sql('select r.*, c.external_ids from ad_referrals r join customers c on c.id = r.customer_id where r.ad_id like $1', [`%${stamp}`]);
ok(refs.length === 3, 'referrals kept once, on Messenger, Instagram and alone', refs.map((x) => x.ad_id));
const fan = refs.find((x) => x.external_ids.messenger === `fan${stamp}`);
const inbox = (await agent.call('/api/crm/interactions?inbox=1&channel=facebook')).json.data.threads.find((t) => t.customer_id === fan.customer_id);
ok(inbox?.ad === 'Winter kachabia -20%', 'Messenger shows the ad', inbox?.ad);

// The fan orders and it is delivered
await sql("insert into orders (order_number, customer_id, customer_first_name, customer_last_name, customer_phone, subtotal, total, status) values ($2, $1, 'Fan', '', '20000000', 100, 108, 'delivered')", [fan.customer_id, `ADS-${stamp}`]);
r = await report();
const c1 = r.json?.data?.campaigns.find((c) => c.id === 'c1');
ok(c1?.meta.spend === 120.5 && c1.meta.conversations_started === 25 && c1.daily_budget === 20, "Meta's figures", c1?.meta);
ok(c1?.crm.conversations === 2 && c1.crm.orders === 1 && c1.crm.delivered === 1 && c1.crm.revenue === 108, 'what the CRM saw from its two ads', c1?.crm);
ok(r.json.data.campaigns.map((c) => c.id).join() === 'c1,c3', 'the period: campaigns with figures or running, not paused ones without', r.json.data.campaigns.map((c) => c.id));
ok(r.json.data.other.conversations === 1, 'an ad Meta no longer lists counts apart');
ok(calls.filter((c) => c.path === '/act_42/insights').every((c) => c.token === 'person-token'), "insights read with the person's token");
const insightsCalls = calls.filter((c) => c.path === '/act_42/insights').length;
await report();
ok(calls.filter((c) => c.path === '/act_42/insights').length === insightsCalls, "Meta's figures are kept 5 minutes");
ok((await report(agent)).status === 403, 'needs the marketing permission');
ok((await marketer.call('/api/marketing/meta-ads?from=2026-02-01&to=2026-01-01')).status === 400, 'a backward period is refused');

// Messenger filters: unassigned, assigned to others
const unassigned = (await agent.call('/api/crm/interactions?inbox=1&assigned=none')).json.data.threads.some((t) => t.customer_id === fan.customer_id);
await agent.call('/api/crm/interactions/claim', 'POST', { customer_id: fan.customer_id });
const other = await user('other@test.local', { role: 'staff', permissions: ['customers'] });
const view = async (who, f) => (await who.call(`/api/crm/interactions?inbox=1&assigned=${f}`)).json.data.threads.some((t) => t.customer_id === fan.customer_id);
ok(unassigned && !(await view(agent, 'none')) && (await view(other, 'others')) && !(await view(agent, 'others')) && (await view(agent, 'me')), 'unassigned, assigned to others and mine are apart');

// Check names the ads lines; disconnecting forgets the person's token
r = await owner.call('/api/admin/meta/check');
ok(r.json.data.checks.some((c) => c.id === 'scope_ads' && c.ok) && r.json.data.checks.some((c) => c.id === 'ad_account' && c.ok), 'Check shows the ads permission and account');
await owner.call('/api/admin/meta', 'DELETE');
[row] = await sql('select * from meta_connection');
ok(row.user_token_encrypted === null && row.ad_account_id === null, "disconnecting forgets the person's token and account");

server.close();
done();
