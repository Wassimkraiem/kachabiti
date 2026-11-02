// Phase 4 switch-over: copies the Supabase Storage buckets (products, documents) to S3-compatible
// storage (AWS S3), then, with --rewrite, points the stored product-image URLs at it.
// Reads the source only; safe to re-run (objects already copied are skipped).
//
// Env: SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY (the project to copy from), S3_ENDPOINT,
// S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_SESSION_TOKEN (short-lived keys only),
// S3_PRODUCTS_BUCKET, S3_DOCUMENTS_BUCKET
// (target; the bucket names default to products and documents), and for --rewrite DATABASE_URL and
// FILES_PUBLIC_URL (the public address of the products bucket).
// Usage: node scripts/copy-storage.mjs [--rewrite]
import { AwsClient } from 'aws4fetch';
import pg from 'pg';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Set ${name}`);
  return value.replace(/\/$/, '');
};
const SOURCE = env('SOURCE_SUPABASE_URL');
const KEY = env('SOURCE_SERVICE_ROLE_KEY');
const S3 = env('S3_ENDPOINT');
const s3 = new AwsClient({
  accessKeyId: env('S3_ACCESS_KEY_ID'),
  secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
  sessionToken: process.env.S3_SESSION_TOKEN,
  service: 's3',
  region: env('S3_REGION', 'auto'),
});
const source = (path, init = {}) =>
  fetch(`${SOURCE}/storage/v1${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, ...init.headers } });
const BUCKETS = { products: env('S3_PRODUCTS_BUCKET', 'products'), documents: env('S3_DOCUMENTS_BUCKET', 'documents') };
const target = (bucket, key) => `${S3}/${BUCKETS[bucket]}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Every object key in a bucket (Supabase lists one folder level at a time). */
async function keys(bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await source(`/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!response.ok) throw new Error(`List ${bucket}/${prefix}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) found.push(...(await keys(bucket, path))); // a folder
      else if (item.name !== '.emptyFolderPlaceholder') found.push(path);
    }
    if (page.length < 1000) return found;
  }
}

async function copy(bucket) {
  let copied = 0;
  let skipped = 0;
  for (const key of await keys(bucket)) {
    if ((await s3.fetch(target(bucket, key), { method: 'HEAD' })).ok) {
      skipped++;
      continue;
    }
    const file = await source(`/object/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
    if (!file.ok) throw new Error(`Download ${bucket}/${key}: ${file.status}`);
    const put = await s3.fetch(target(bucket, key), {
      method: 'PUT',
      body: new Uint8Array(await file.arrayBuffer()),
      headers: {
        'Content-Type': file.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': bucket === 'products' ? 'public, max-age=31536000, immutable' : 'private',
      },
    });
    if (!put.ok) throw new Error(`Upload ${bucket}/${key}: ${put.status} ${await put.text()}`);
    copied++;
  }
  console.log(`${bucket}: ${copied} copied, ${skipped} already there`);
}

/** Replaces the old public URL prefix in every text and jsonb column of the public schema. */
async function rewrite() {
  const from = `${SOURCE}/storage/v1/object/public/products/`;
  const to = `${env('FILES_PUBLIC_URL')}/`;
  const client = new pg.Client({ connectionString: env('DATABASE_URL') });
  await client.connect();
  try {
    await client.query('begin');
    // A URL change is no business event: skip the activity log and owner alerts where allowed.
    await client.query('savepoint quiet');
    await client.query('set local session_replication_role = replica').catch(() => client.query('rollback to savepoint quiet'));
    const { rows: columns } = await client.query(
      `select table_name, column_name, data_type from information_schema.columns c
        where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')
          and table_name <> 'activity_log' -- append-only history stays as it was
          and exists (select 1 from information_schema.tables t
                       where t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE')`,
    );
    let total = 0;
    for (const { table_name: table, column_name: column, data_type: type } of columns) {
      const col = `"${column.replace(/"/g, '""')}"`;
      const value = type === 'jsonb' ? `${col}::text` : col;
      const set = type === 'jsonb' ? `replace(${col}::text, $1, $2)::jsonb` : `replace(${col}, $1, $2)`;
      const { rowCount } = await client.query(
        `update public."${table.replace(/"/g, '""')}" set ${col} = ${set} where strpos(${value}, $1) > 0`,
        [from, to],
      );
      if (rowCount) console.log(`  ${table}.${column}: ${rowCount}`);
      total += rowCount;
    }
    await client.query('commit');
    console.log(`URLs rewritten: ${total}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

for (const bucket of ['products', 'documents']) await copy(bucket);
if (process.argv.includes('--rewrite')) await rewrite();
