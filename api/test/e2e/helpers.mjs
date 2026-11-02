import { hashSync } from 'bcryptjs';
import pg from 'pg';

// Shared by the end-to-end suites. They sign in test users through /api/auth and call the site
// through APP_URL; sql() reads and prepares rows directly in the database.
// Env: DATABASE_URL (default: the local Docker Postgres), APP_URL (default http://localhost:3000).
// Never point them at the live database: they write data.
export const APP = process.env.APP_URL ?? 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://kachabity:kachabity-local@127.0.0.1:5433/kachabity';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL)) throw new Error('The e2e suites only run against a local database');
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

/** Rows of a query, e.g. sql('select id from products where slug = $1', [slug]). */
export const sql = async (text, params = []) => (await pool.query(text, params)).rows;

let failures = 0;
export const ok = (cond, label, extra) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : ''}`);
    if (!cond) failures++;
};
export const done = () => {
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    pool.end().finally(() => process.exit(failures ? 1 : 0));
};

const PASSWORD = 'Test-pass-123!';
const PASSWORD_HASH = hashSync(PASSWORD, 10);

/** A confirmed account with these app_metadata (role, permissions), signed in through /api/auth/sign-in. */
export async function user(email, appMeta = {}) {
    const updated = await sql(
        'update users set app_metadata = $2, password_hash = $3, email_confirmed_at = now() where lower(email) = $1 and deleted_at is null returning id',
        [email, appMeta, PASSWORD_HASH],
    );
    if (updated.length === 0)
        await sql('insert into users (email, name, app_metadata, password_hash, email_confirmed_at) values ($1, $2, $3, $4, now())', [email, email.split('@')[0], appMeta, PASSWORD_HASH]);
    const signIn = await fetch(`${APP}/api/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    const s = await signIn.json();
    if (!signIn.ok) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(s)}`);
    const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const call = async (path, method = 'GET', body) => {
        const r = await fetch(`${APP}${path}`, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
        let json = null;
        try { json = await r.json(); } catch { /* page */ }
        return { status: r.status, json, location: r.headers.get('location') };
    };
    await call('/api/admin/me'); // syncs back_office_users
    return { id: s.data?.id, call, cookie };
}
