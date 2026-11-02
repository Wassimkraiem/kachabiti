// Regenerates src/db/types.ts from a database, matching the value parsers in src/db/database.ts
// (numbers for numeric/int8, PostgREST-style strings for dates and timestamps).
// Usage: npm run db:types -- <database url>   (or DATABASE_URL in the environment)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) throw new Error('Pass the database URL or set DATABASE_URL.');
const file = 'src/db/types.ts';
execFileSync(
  'npx',
  ['kysely-codegen', '--dialect', 'postgres', '--url', url, '--include-pattern', 'public.*', '--numeric-parser', 'number', '--date-parser', 'string', '--out-file', file],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
const types = readFileSync(file, 'utf8')
  .replace(/export type Int8 = ColumnType<\s*string,/, 'export type Int8 = ColumnType<\n  number,')
  .replace('export type Timestamp = ColumnType<Date, Date | string, Date | string>;', 'export type Timestamp = ColumnType<string, Date | string, Date | string>;');
writeFileSync(file, types);
