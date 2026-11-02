// Phase 5: copies the database (schemas public, private and the migration history) to a plain
// Postgres 17, then compares row counts table by table. The source is only read.
//
// SOURCE_DATABASE_URL  the Supabase database (Connect → Session pooler or direct, not port 6543)
// TARGET_DATABASE_URL  the new database, as the role the API will use: it becomes the owner of
//                      every table, so RLS (still enabled, no policies) doesn't filter it. It must
//                      be empty, or pass --replace to drop public/private/supabase_migrations first.
// Both URLs are used from inside a Docker container: for a database on this machine write
// host.docker.internal instead of localhost.
//
// Usage: node scripts/db/move-database.mjs [--replace]
// At the switch-over: site read-only → apply the last migrations to the source → run this →
// point DATABASE_URL at the target → smoke test → reopen (docs/MIGRATION-NESTJS.md, phase 5).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const IMAGE = 'postgres:17.6-alpine';
const SCHEMAS = ['public', 'private', 'supabase_migrations'];
const source = process.env.SOURCE_DATABASE_URL;
const target = process.env.TARGET_DATABASE_URL;
if (!source || !target) throw new Error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL');
if (source === target) throw new Error('Source and target are the same database');

const work = resolve('.docker-data/move');
mkdirSync(work, { recursive: true });
const docker = (args, input) => {
    const result = spawnSync('docker', ['run', '--rm', '-i', '-v', `${work.replace(/\\/g, '/')}:/work`, IMAGE, ...args], {
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
        maxBuffer: 1 << 28,
    });
    if (result.status !== 0) throw new Error(`${args[0]} failed (exit ${result.status})`);
    return result.stdout;
};
const psql = (url, sql) => docker(['psql', url, '-v', 'ON_ERROR_STOP=1', '-qtA'], sql);

// Exact row counts of every table in the copied schemas, as "schema.table count" lines.
const COUNTS = `
do $$
declare r record; n bigint;
begin
  create temp table counts (name text, n bigint);
  for r in select schemaname, tablename from pg_tables where schemaname in (${SCHEMAS.map((s) => `'${s}'`).join(', ')}) loop
    execute format('select count(*) from %I.%I', r.schemaname, r.tablename) into n;
    insert into counts values (r.schemaname || '.' || r.tablename, n);
  end loop;
end $$;
select name || ' ' || n from counts order by name;`;

console.log('Preparing the target…');
const existing = psql(target, `select count(*) from pg_tables where schemaname in ('public', 'private')`).trim();
if (existing !== '0') {
    if (!process.argv.includes('--replace')) throw new Error(`The target already has ${existing} tables; pass --replace to drop them`);
}
// The dump creates these schemas itself (an empty database already has `public`).
psql(target, SCHEMAS.map((s) => `drop schema if exists ${s} cascade;`).join('\n'));
// The functions call these extensions schema-qualified (extensions.unaccent…), as on Supabase.
psql(target, `create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists pg_trgm schema extensions;
create extension if not exists unaccent schema extensions;
create extension if not exists "uuid-ossp" schema extensions;`);

console.log('Dumping the source…');
rmSync(`${work}/database.dump`, { force: true });
docker([
    'pg_dump', source, '--format=custom', '--file=/work/database.dump',
    '--no-owner', '--no-privileges', '--no-publications', '--no-subscriptions',
    ...SCHEMAS.flatMap((s) => ['--schema', s]),
]);

console.log('Restoring into the target…');
// Triggers and foreign keys are created after the data (post-data section), so loading the rows
// fires no activity log or alert.
docker(['pg_restore', '--dbname', target, '--no-owner', '--no-privileges', '--exit-on-error', '/work/database.dump']);

console.log('Comparing row counts…');
const before = psql(source, COUNTS).trim().split('\n');
const after = new Map(psql(target, COUNTS).trim().split('\n').map((line) => line.split(' ')));
const differences = before.filter((line) => {
    const [name, n] = line.split(' ');
    return after.get(name) !== n;
});
console.log(`${before.length} tables compared.`);
if (differences.length) {
    console.error(`Different row counts:\n${differences.map((d) => `  ${d} (target ${after.get(d.split(' ')[0]) ?? 'missing'})`).join('\n')}`);
    process.exit(1);
}
console.log('Every table has the same number of rows.');
