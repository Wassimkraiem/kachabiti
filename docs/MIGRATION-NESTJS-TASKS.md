# NestJS migration: phase 0 and the first module, task by task

Executable breakdown of phases 0 and 1 of [MIGRATION-NESTJS.md](MIGRATION-NESTJS.md). Each task
ends with a check you can run. Later modules repeat the pattern of tasks 1.1–1.3.

**Status (2026-10-23):** 0.1–0.8, 0.10, 1.1 and 1.2 done and checked against a local Supabase:
the categories and ERP e2e suites pass with `NEST_ROUTES=categories` and with it empty, and both
servers return identical `GET /api/categories` JSON. The whole app also runs in Docker with a copy
of the live data (docs/DOCKER.md). Open: deploying NestJS (0.9: pick the host, check Sentry),
0.11 and 0.12, merging the ERP work and applying its migrations live, then 1.3 in production. Differences from the text below: config is plain zod
(`api/src/config.ts`, no `@nestjs/config`); `withActor()` is a method of `Database`
(`api/src/db/database.ts`); the guard and error checks are e2e suites (`api/test/e2e/*.mjs`) rather
than Jest specs; no `docker-compose.yml` (one service, `docker build -f api/Dockerfile .`).

## Decisions taken here (smaller than the overview)

- **No repo reshuffle.** The Next.js app stays at the repo root (Netlify keeps building it as
  today). NestJS goes in a new folder `api/` with its own `package.json`. Shared code is imported
  from the root with a TypeScript path alias (`@shared/*` → `../lib/*`), so `lib/erp/constants.ts`,
  `lib/admin-auth.ts` and the zod schemas serve both apps without moving. A separate `packages/`
  workspace is only worth it if the alias causes trouble.
- **No database change in phase 1.** NestJS connects to the current Supabase Postgres directly.
  The activity log keeps working because NestJS sets the same two settings PostgREST sets today
  (task 0.5). Auth stays Supabase Auth: NestJS verifies the same JWT cookie.
- **Pilot module: categories** (`app/api/categories/route.ts`, 152 lines: public reads, gated
  writes, cache invalidation). Products come next; same pattern, more fields.

## Phase 0: set up (2–3 days)

### 0.1 Start from the ERP code
- Once the `feature/erp-modules` pull request is merged: `git switch kachabiti-nest && git rebase main`.
- Until then, base the work on it: `git rebase feature/erp-modules`.
- **Check:** `git log --oneline -3` shows the ERP commit under the plan commits; `npx tsc --noEmit` passes.

### 0.2 Create the NestJS app
```bash
npx @nestjs/cli@11 new api --package-manager npm --skip-git --strict
cd api
npm i @nestjs/config kysely pg jose zod @sentry/nestjs
npm i -D kysely-codegen @types/pg
```
- `api/tsconfig.json`: add `"paths": { "@shared/*": ["../lib/*"] }` so the shared files compile.
- Root `tsconfig.json`: exclude `api/` so the Next.js type-check doesn't pick it up.
- **Check:** `cd api && npm run build && npm run start` answers on `http://localhost:4000`.

### 0.3 Config
`api/src/config.ts` validates the environment with zod at boot and exits on a missing variable:

| Variable | Value during phase 1 |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** URL (port 6543) of project `hwxgibxahqdxkzuvfxvz` |
| `SUPABASE_URL` | same as today; used only for the JWKS (`/auth/v1/.well-known/jwks.json`) |
| `SUPABASE_JWKS` | optional, same value as today (avoids fetching the keys) |
| `OWNER_EMAILS`, `ADMIN_EMAILS` | same as today |
| `SENTRY_DSN`, `ENV`, `PORT` (4000) | |

- Never commit values; `api/.env.example` lists the names only.
- **Check:** starting without `DATABASE_URL` says which variable is missing and exits.

### 0.4 Database module
- `api/src/db/db.module.ts`: one Kysely instance on a `pg` Pool (max 10 connections).
- Generate types from the live schema after every migration:
  `npx kysely-codegen --url "$DATABASE_URL" --include-pattern "public.*" --out-file src/db/types.ts`
- Helper `notDeleted(qb)` adding `where deleted_at is null`: the direct connection bypasses RLS
  like the service role does today, so every read must filter.
- **Check:** a temporary `GET /api/health/db` returns `select count(*) from categories`.

### 0.5 Writes carry the staff member (`withActor`)
`api/src/db/with-actor.ts` is the only way to open a write transaction:
```ts
// The activity log (private.log_activity → private.trusted_request_headers) reads these two
// settings, exactly as PostgREST sets them today.
await sql`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'service_role' })}, true),
                 set_config('request.headers', ${JSON.stringify({
                   'x-actor-id': actor.userId, 'x-actor-email': actor.email, 'x-actor-role': actor.role,
                 })}, true)`.execute(trx);
```
- `true` makes them transaction-local, so they never leak to another request on a pooled connection.
- Reads stay outside `withActor()`; a write without it is logged as `source = 'database'`, which
  the review checklist treats as a bug.
- **Check:** create a category through NestJS, then
  `select actor_email, action from activity_log order by created_at desc limit 1` shows your e-mail.

### 0.6 Auth guard (port of `requirementFor` in `middleware.ts`)
- Global `AuthGuard`: reads the Supabase session cookie (`sb-<ref>-auth-token`, possibly split into
  `.0` / `.1` chunks), verifies the JWT with `jose` against the JWKS, and builds the actor with
  `getAdminRole()` / `getPermissions()` from `@shared/admin-auth`.
- **Deny by default:** a route without a decorator answers 403. Decorators: `@Public()`,
  `@Requires('products')`, `@RequiresAll('products', 'delete')`, `@AdminOnly()`, `@OwnerOnly()`,
  plus `@CurrentActor()` for handlers.
- Keep the refusal log (`access_denied` row in `activity_log`).
- **Check (`api/test/auth.guard.spec.ts`):** no cookie → 401; staff without `products` → 403 on a
  `@Requires('products')` route; owner → 200; a forged `x-admin-*` header is ignored.

### 0.7 Responses and errors (port of `lib/erp/api.ts`)
- `ApiResponseInterceptor` wraps results as `{ success: true, data }`.
- `ApiExceptionFilter`: `HttpException` → `{ success: false, error, code }`; zod errors → 400;
  Postgres errors mapped with the same `DB_MESSAGES` table (moved to `lib/erp/db-messages.ts` so
  both apps import it); anything else → 500 and Sentry, without customer data.
- `ZodValidationPipe` for bodies and query strings.
- **Check:** a body with a missing field returns `400 { success: false, error: "name: Required" }`,
  the same shape as today.

### 0.8 Send requests to NestJS one area at a time
In `next.config.ts`:
```ts
// Areas already served by NestJS; everything else stays in app/api.
const NEST_ROUTES = (process.env.NEST_ROUTES ?? '').split(',').filter(Boolean);
// ...
async rewrites() {
  return {
    beforeFiles: NEST_ROUTES.map((area) => ({
      source: `/api/${area}/:path*`,
      destination: `${process.env.NEST_URL}/api/${area}/:path*`,
    })),
  };
},
```
- `beforeFiles` makes the rewrite win over the existing route file.
- Rollback for any area: remove it from `NEST_ROUTES` and redeploy; the old route file is still there.
- **Check:** with `NEST_ROUTES=health`, `curl localhost:3000/api/health` is answered by NestJS.

### 0.9 Run and deploy NestJS
- `api/Dockerfile` (Node 22, `npm ci --omit=dev`, `node dist/main`) and a root
  `docker-compose.yml` to run it locally (Next.js keeps `npm run dev`).
- Host (proposed in MIGRATION-NESTJS.md → Hosting and cost): a small VPS behind Cloudflare, which
  later also takes Postgres and `web`. Free Node hosts sleep when idle, and Workers can't run NestJS.
  `NEST_URL` points there; it can move later.
- **Check:** the deployed `/api/health` answers over HTTPS; Sentry receives a test error.

### 0.10 Test suite in the repo
- Move the end-to-end script used for the ERP work into `api/test/e2e/` (it signs in test users
  on a local Supabase and calls the API: 74 checks across orders, payments, till, purchasing,
  accounting, goals and permissions).
- `npm run test:e2e` runs it against `APP_URL` (default `http://localhost:3000`), so it tests through
  the rewrites whichever server answers.
- **Check:** all 74 checks pass with `NEST_ROUTES` empty (everything still on Next.js).

### 0.11 CI and monitoring
- GitHub Actions job on pull requests touching `api/` or `lib/`: `npm ci`, `npm run build` and
  `npm run lint` in `api/`, plus the root `npx tsc --noEmit` (shared `lib/` files feed both apps).
- Uptime check on the deployed `/api/health` that alerts the owner. NestJS has no automatic
  fallback; rollback is removing the area from `NEST_ROUTES` and redeploying.
- **Check:** a pull request with a type error in `lib/admin-auth.ts` fails CI.

### 0.12 Rewrites on Netlify
- On a deploy preview with `NEST_ROUTES=categories` and `NEST_URL` set to the deployed API, check
  that `/api/categories` is answered by NestJS (`x-powered-by: Express`) and that cookies and the
  query string reach it. Rewrites are fixed at build time, so changing `NEST_ROUTES` needs a redeploy.
- Compare response times with and without the rewrite (the extra hop should cost well under 100 ms
  with NestJS in the database's region).

## Phase 1, first module: categories (2–3 days)

### 1.1 Port
`api/src/catalog/categories.controller.ts` and `categories.service.ts`, behaviour copied from
`app/api/categories/route.ts`:
- `GET /api/categories` `@Public()`: live categories, nested by `parent_id`, same fields and order.
- `POST`, `PUT` `@Requires('products')`; `DELETE` `@RequiresAll('products', 'delete')`, soft delete only.
- Writes go through `withActor()`.

### 1.2 Cache invalidation
Today the route calls `invalidateCatalog()` (`revalidateTag('catalog')`) inside Next.js, which
NestJS can't do. Add `app/api/internal/revalidate/route.ts` to Next.js: `POST` with a shared secret
header (`REVALIDATE_SECRET`) that calls `invalidateCatalog()`. NestJS calls it after every catalog
write and logs, without failing the write, if it can't reach it.
- **Check:** rename a category in the admin; the storefront shows the new name on the next load.

### 1.3 Switch, compare, then remove the old route
- Set `NEST_ROUTES=categories`; run `npm run test:e2e` and click through Admin → Categories (list,
  create, edit, delete, nested parent) in English and Arabic.
- Compare the two servers: `GET /api/categories` must return identical JSON
  (`diff <(curl -s $NEXT/api/categories) <(curl -s $NEST/api/categories)`).
- After a week in production without issues, delete `app/api/categories/route.ts`.

### 1.4 Repeat for the next areas
Same steps (port → invalidation if catalog → switch → compare → remove) in the order of the
overview: products and the rest of the catalog, stock, orders, delivery, customers, till and
purchasing, finance, owner/team/notifications, small routes. One pull request per area.

Things the later areas need that categories didn't:
- **Every catalog area** (products, variants, images, colors, sizes, promotions, banners, reels,
  landing): call `invalidateCatalog()` after each write.
- **Stock:** `GET /api/stock/inventory` also accepts `x-api-key` = `STOCK_API_KEY` (external
  system). Add an `@ApiKey()` option to the guard (constant-time compare) before switching `stock`.
- **Orders (checkout):** the guard builds an actor for back-office users only. `POST /api/orders`
  takes the shopper's id from the `Authorization: Bearer` token. Add a `@CurrentUser()` that
  returns any verified user (shopper or staff), and keep orders public for guests.
- **Team (`/api/admin/team`):** it calls the Supabase Auth admin API (create, update, soft-delete
  users) and `logActivity()` for changes the database can't see. Until phase 3 it keeps using
  Supabase Auth through `@supabase/supabase-js` with the service key, server-side only.
- **Uploads and documents:** keep Supabase Storage until phase 4; same client, server-side only.
- **API docs:** update `lib/openapi*.ts` for each ported route (or switch to `@nestjs/swagger`).
- Keep the area's rule in `requirementFor` (middleware still runs first) and add the area to the
  e2e suites if they don't cover it yet.

## Done when (phase 0 and the pilot)

- NestJS is deployed and serves `/api/categories` in production through the rewrite.
- The activity log shows the right staff member for category changes made through NestJS.
- The 74 end-to-end checks and the auth guard tests pass.
- Removing `categories` from `NEST_ROUTES` sends traffic back to Next.js with no other change.
