// Applies the migrations a plain-Postgres database doesn't have yet (replaces `supabase db push`).
// Each file runs in its own transaction and is recorded in supabase_migrations.schema_migrations,
// the history the database brought from Supabase (scripts/db/move-database.mjs). An empty database
// (CI, a new server) first gets db/baseline.sql: the schema and seed rows up to its last migration.
// Usage: DATABASE_URL=… node scripts/migrate.mjs [migrations folder] [--dry-run]
// Env: BASELINE (default ../db/baseline.sql, next to the migrations folder's parent).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const folder = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '../supabase/migrations');
const dryRun = process.argv.includes('--dry-run');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL');

const baseline = resolve(process.env.BASELINE ?? join(folder, '../../db/baseline.sql'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const [{ ready }] = (await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null as ready")).rows;
  if (!ready) {
    console.log(`${dryRun ? 'Would load' : 'Empty database: loading'} the schema baseline (${baseline})`);
    if (dryRun) process.exit(0);
    await client.query('begin');
    try {
      // The functions call these schema-qualified (extensions.unaccent…), as on Supabase.
      await client.query(`create schema if not exists extensions;
        create extension if not exists pgcrypto schema extensions;
        create extension if not exists pg_trgm schema extensions;
        create extension if not exists unaccent schema extensions;
        create extension if not exists "uuid-ossp" schema extensions;`);
      await client.query(readFileSync(baseline, 'utf8'));
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`baseline: ${error.message}`);
    }
    await client.query('reset all'); // the dump changes search_path and other settings
  }
  const { rows } = await client.query('select version from supabase_migrations.schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const pending = readdirSync(folder)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .filter((f) => !applied.has(f.split('_')[0]));
  if (pending.length === 0) console.log('Up to date.');
  for (const file of pending) {
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
    console.log(`${dryRun ? 'Would apply' : 'Applying'} ${file}`);
    if (dryRun) continue;
    await client.query('begin');
    try {
      await client.query(readFileSync(join(folder, file), 'utf8'));
      await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [version, rest.join('_')]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`${file}: ${error.message}`);
    }
  }
} finally {
  await client.end();
}
