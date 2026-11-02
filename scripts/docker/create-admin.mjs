// Creates (or resets) the local owner account for the Docker setup (docs/DOCKER.md):
// admin@kachabity.local with LOCAL_PASSWORD from .env.docker, in the compose db service.
// Usage: node scripts/docker/create-admin.mjs   (import-live-data.mjs runs it after each import)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const env = existsSync('.env.docker') ? readFileSync('.env.docker', 'utf8') : '';
const value = (name) => process.env[name] || env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
const password = value('LOCAL_PASSWORD') || 'Kachabity-local-1';
const email = 'admin@kachabity.local';
const quote = (text) => `'${text.replace(/'/g, "''")}'`;

// Accounts live in public.users (bcrypt hashes, as the NestJS auth API checks them).
const sql = `insert into public.users (email, name, password_hash, app_metadata, email_confirmed_at)
values (${quote(email)}, 'Admin', extensions.crypt(${quote(password)}, extensions.gen_salt('bf', 10)), '{"role":"owner"}', now())
on conflict (lower(email)) where deleted_at is null do update
   set password_hash = excluded.password_hash, app_metadata = excluded.app_metadata, email_confirmed_at = now();`;
const result = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-q', '-U', 'kachabity', '-d', 'kachabity', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
});
if (result.status !== 0) throw new Error('Could not create the local owner account.');
console.log(`Local owner account: ${email} (password: LOCAL_PASSWORD in .env.docker)`);
