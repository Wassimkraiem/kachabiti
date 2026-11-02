// Copies a database (read only: SOURCE_DATABASE_URL in .env.docker, e.g. the server's Postgres)
// into the local Docker db, applies newer migrations, and makes the copy safe to use locally:
// every account's password becomes LOCAL_PASSWORD and copied sessions and e-mailed links stop
// working. Then (re)creates the local owner admin@kachabity.local.
// Usage: npm run docker:import   (docker compose up -d db first)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const env = existsSync('.env.docker') ? readFileSync('.env.docker', 'utf8') : '';
const value = (name) => process.env[name] || env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
const source = value('SOURCE_DATABASE_URL');
if (!source) throw new Error('Set SOURCE_DATABASE_URL in .env.docker (the database to copy, read only).');
const password = value('LOCAL_PASSWORD') || 'Kachabity-local-1';

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.status !== 0) throw new Error(`${command} ${args[0]} failed`);
};
const node = (script, extraEnv, args = [], cwd) =>
    run(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...extraEnv } });

node('scripts/db/move-database.mjs', {
    SOURCE_DATABASE_URL: source,
    TARGET_DATABASE_URL: 'postgresql://kachabity:kachabity-local@host.docker.internal:5433/kachabity',
}, ['--replace']);
node('scripts/migrate.mjs', { DATABASE_URL: 'postgresql://kachabity:kachabity-local@127.0.0.1:5433/kachabity' }, [], 'api');

const quote = (text) => `'${text.replace(/'/g, "''")}'`;
run('docker', ['compose', 'exec', '-T', 'db', 'psql', '-q', '-U', 'kachabity', '-d', 'kachabity', '-v', 'ON_ERROR_STOP=1'], {
    input: `update public.users set password_hash = extensions.crypt(${quote(password)}, extensions.gen_salt('bf', 10)) where password_hash is not null;
update public.user_sessions set revoked_at = now() where revoked_at is null;
update public.auth_tokens set used_at = now() where used_at is null;`,
    stdio: ['pipe', 'inherit', 'inherit'],
});
node('scripts/docker/create-admin.mjs', {});
console.log(`Done. Every account's local password: ${password}. Restart the site to drop cached pages: docker compose restart web`);
