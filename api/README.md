# Kachabity API (NestJS)

The backend behind every `/api` request (Next.js rewrites `/api/:path*` to `NEST_URL`), on plain
Postgres 17 and S3-compatible file storage. How it got here: [docs/MIGRATION-NESTJS.md](../docs/MIGRATION-NESTJS.md).

## Run

```bash
npm ci
npm run build
npm run start:prod   # needs the variables in .env.example
```

`npm run start:dev` rebuilds on change. Migrations: `DATABASE_URL=… node scripts/migrate.mjs`
applies the files in `../supabase/migrations` the database doesn't have yet.

## How it fits

- **Shared code:** `@shared/*` is the root `lib/` folder (`lib/admin-auth.ts`, `lib/erp/db-messages.ts`),
  compiled into `dist/lib`. Shared files may only use relative imports.
- **Access (`src/auth`):** deny by default. Every route needs `@Public()`, `@Requires(...)`,
  `@RequiresAll(...)`, `@AdminOnly()` or `@OwnerOnly()`, and/or a rule in `apiRequirement`
  (`lib/api-access.ts`). The guard verifies the session (`kb_access` cookie or bearer, `AUTH_SECRET`;
  issued by `src/auth/auth.controller.ts`).
- **Database (`src/db`):** Kysely on `pg`. The connection owns the tables (RLS doesn't apply), so every read filters
  `deleted_at is null`. Every write goes through `db.withActor(actor, trx => ...)` so the activity
  log records the staff member. Regenerate `src/db/types.ts` after a migration:
  `npm run db:types -- --url "$DATABASE_URL"`.
- **Responses (`src/common/api.ts`):** `{ success, data }` / `{ success: false, error, code }`, as in
  before; validate bodies with `@Body(new Zod(schema))`.
- **Catalog writes** call `invalidateCatalog()` (`src/catalog/revalidate.ts`) so the storefront cache refreshes.

## Tests

End-to-end suites in `test/e2e/`, run against the local Docker stack (docs/DOCKER.md): the app at
`APP_URL` (default `http://localhost:3000`) and its database (`DATABASE_URL`, default the local
`db` on port 5433; local databases only, they write data):

```bash
npm run test:e2e
```

The ERP suite checks running totals, so it needs freshly imported data (`npm run docker:import`).

## Docker

From the repository root (the API compiles files from `lib/`):

```bash
docker build -f api/Dockerfile -t kachabity-api .
```
