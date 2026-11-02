# Migration plan: Next.js + NestJS + plain Postgres

Branch: `kachabiti-nest`. Goal: move off Supabase to a NestJS API and a plain Postgres database,
keeping the Next.js storefront and admin, without a big-bang rewrite and without downtime beyond
one short database cut-over.

Task-by-task steps for phase 0 and the first module: [MIGRATION-NESTJS-TASKS.md](MIGRATION-NESTJS-TASKS.md).

**Decided (2026-10-23): the full migration, phases 0–6.** The end state is no Supabase: NestJS for
the API, auth, files, realtime, push, jobs and e-mail, and a plain Postgres. Hosting: see
[Hosting and cost](#hosting-and-cost).

## Where we start (measured on this branch)

| Piece | Today | Size |
|---|---|---|
| API | Next.js route handlers in `app/api/*` | 65 routes |
| Business logic | Postgres functions and triggers in `supabase/migrations/` (orders, stock, payments, accounting, reports) | ~50 functions called by RPC, plus triggers |
| Data access | `supabase-js` (PostgREST): `supabase.from` 211 calls, `supabase.rpc` 63 calls | `app/api`, `lib/*` |
| Browser reads | storefront reads the catalog directly with the publishable key, protected by RLS | `lib/*` data modules |
| Auth | Supabase Auth, email + password only (no Google/Facebook); admin roles in `app_metadata`; `auth.uid()` in 12 RLS policies; 7 foreign keys to `auth.users`; a trigger on `auth.users` (`customer_accounts` migration) fills the existing `public.users` profile table (name, avatar) | 38 `supabase.auth` calls |
| Other access | `GET /api/stock/inventory` also accepts an `x-api-key` (`STOCK_API_KEY`) for an external system, checked in `middleware.ts`; checkout sends the shopper's Supabase token as `Authorization: Bearer` | |
| Files | Supabase Storage: `products` (public), `documents` (private, signed links) | 5 call sites |
| Realtime | notification bell listens to `notifications` | 1 channel |
| Jobs | `pg_cron` (daily alerts), `pg_net` + Vault + Edge Function `send-push` (desktop push) | |
| Activity log | actor read from PostgREST request headers (`private.trusted_request_headers()`) | |
| Hosting | Netlify (serverless functions) + Supabase | |

The key fact: most of the logic already lives in Postgres and moves with the database as it is.
NestJS replaces PostgREST, Supabase Auth, Storage, Realtime and the Edge Function, not the
business rules.

## Target architecture

```
kachabity/
  (root)            Next.js (storefront + admin UI), unchanged; app/api empties as areas move
  api/              NestJS: every /api route, auth, files, notifications, jobs
  lib/              shared by both apps (NestJS imports it through the @shared/* path alias)
  supabase/migrations/  stays the schema source; made Supabase-free in phase 3–5
```

- **Database access in NestJS: Kysely**, a typed query builder with types generated from the live
  schema by `kysely-codegen`. It reads like today's `supabase.from(...)` chains, keeps raw SQL easy
  for the many `select fn(...)` calls, and doesn't take over migrations. Migrations stay plain SQL
  files, run with `dbmate`.
- **One server**: `web` and `api` in Docker Compose on one VPS behind Cloudflare; Postgres managed or on the
  same machine with daily backups; files on Cloudflare R2 (S3-compatible, free egress).
- **Routing**: the browser keeps calling `/api/...`; Next.js rewrites `/api/:path*` to the NestJS
  server. Front-end URLs don't change, and routes can move one at a time.

## Supabase features and their replacements

| Supabase feature | Replacement | Notes |
|---|---|---|
| PostgREST + RLS | NestJS controllers + guards | RLS stops being the security layer: every query filters `deleted_at` and checks permissions in code. Keep RLS on as a second line during the transition. |
| Auth (users, passwords, sessions) | NestJS `AuthModule`: `users` table, httpOnly cookie sessions (access + refresh JWT), `@nestjs/jwt`, `argon2` for new passwords | Supabase stores **bcrypt** hashes in `auth.users.encrypted_password`: copy them as they are, verify with bcrypt, re-hash with argon2 at the next sign-in. Nobody has to reset a password. |
| `app_metadata.role / permissions` | `users.role`, `users.permissions` columns | `lib/admin-auth.ts` ports unchanged; it only reads these two fields. |
| `requirementFor()` in `middleware.ts` | NestJS global guard + `@Requires('orders')`, `@OwnerOnly()` decorators | Same rule table, moved to the API. Next.js middleware keeps only page redirects and locale prefixing. |
| Storage `products` (public) | R2 bucket behind a CDN domain (e.g. `media.kachabiti.com`) | Copy files, then rewrite stored URLs (`product_images.image_url`, reels, hero sections…) in one SQL update. Add the domain to `images.remotePatterns` in `next.config.ts` first. |
| Storage `documents` (private) | private R2 bucket + presigned URLs (5 min) | Same behaviour as today's signed links. |
| Realtime (notification bell) | Server-Sent Events endpoint in NestJS fed by Postgres `LISTEN/NOTIFY` | One trigger `pg_notify('notifications', recipient_id)`; simpler than WebSockets. |
| `pg_cron` daily alerts | `@nestjs/schedule` cron calling `select private.daily_alerts()` | Or keep pg_cron if the Postgres host offers it. |
| `pg_net` + Vault + Edge Function `send-push` | NestJS `NotificationsModule` with the `web-push` library, triggered by the same `LISTEN/NOTIFY` | Drop `private.dispatch_push`; VAPID keys move to env vars. |
| Activity-log actor headers | `set_config('app.actor_id', …, true)` at the start of each transaction | Rewrite `private.trusted_request_headers()` to read these settings. Every NestJS write goes through one `withActor(actor, trx => …)` helper. |
| `service_role` / `anon` / `authenticated` grants | one application role (`kachabity_app`) + one read-only role for reporting | Grants rewritten in one migration. |
| Extensions `pg_trgm`, `unaccent`, `pg_cron` | available on standard Postgres 17 | `pg_net` and Vault are dropped. |
| Auth e-mails (confirm sign-up, reset password) and rate limits | NestJS sends them with nodemailer in en/fr/ar; `@nestjs/throttler` on sign-in, sign-up and reset | Supabase did both for free; check the live "Confirm email" setting and copy its behaviour. |
| E-mail in general (order confirmation, abandoned cart, auth) | One NestJS `MailModule` around the existing nodemailer code (`lib/order-confirmation-email.ts`, `lib/abandoned-cart-email.ts`), same `GMAIL_USER` / `GMAIL_APP_PASSWORD` | NestJS has no mailer of its own; nodemailer is already a dependency and works the same in NestJS, so no new library. If Gmail's daily sending limit is reached, swap the transport for an SMTP provider (Brevo, Resend…) without touching the templates. |
| `/api-docs` (OpenAPI built by hand in `lib/openapi*.ts`) | `@nestjs/swagger` generated from the controllers | Until then, keep `lib/openapi*.ts` in step with each ported route. |

## Database changes (one migration set, written once)

1. **Extend the existing `public.users`** (today a profile table: id = `auth.users.id`, name,
   avatar_url, deleted_at) with email, password_hash, role, permissions, email_confirmed_at,
   last_sign_in_at, and fill it from `auth.users`, keeping the **same uuid**. Shoppers with no
   profile row get one. Drop the trigger on `auth.users` that fills the profile; the NestJS sign-up
   writes the row instead.
2. Repoint the 7 foreign keys from `auth.users` to `public.users`; replace `auth.uid()` in the 12
   RLS policies with `current_setting('app.user_id', true)::uuid`.
3. Replace `private.trusted_request_headers()` (actor from settings, see above).
4. Drop `private.dispatch_push`, the `pg_net` / Vault dependency and the `supabase_realtime`
   publication; add the `pg_notify` trigger on `notifications`.
5. Replace the Supabase role grants with the application role. Give it `bypassrls` (as the service
   role has today), or every read silently returns nothing.
6. Remove the `insert into storage.buckets` statements (two migrations) and the
   `supabase_realtime` publication line, so the migrations apply to a plain Postgres.

Keeping ids identical means orders, `created_by`, `assigned_to`, the activity log and notifications
keep pointing at the right people, with no data rewrite.

## Phases

Each phase ships on its own and can be rolled back. The site keeps running on Supabase until
phase 5.

### Phase 0: Prepare (2–3 days)
- **Start from the ERP code.** The ERP work is committed on `feature/erp-modules` (its pull request
  goes to `main`; its migrations aren't applied to the live database yet). Rebase `kachabiti-nest`
  on it once merged, so the migration starts from the code that's live.
- Create `api/` (NestJS 11, Node 22) next to the Next.js app, sharing `lib/` through a path alias.
- NestJS basics: config module (env validated with zod), Kysely connected to the **current
  Supabase Postgres** through the pooler, Sentry, health check, Dockerfile.
- Next.js `rewrites()` for `/api/:path*` → NestJS, behind a per-route allow-list so routes switch
  one at a time.
- **Still open:** pick and set up the NestJS host (in the same region as the database), an uptime
  check on `/api/health`, and a CI job (GitHub Actions) that builds and lints `api/`. Prove on a
  Netlify deploy preview that the external rewrite works there (it does locally and in Docker).
- **Prerequisite for production:** merge the ERP pull request and apply its three migrations to the
  live database. They applied cleanly to a copy of the live data (`npm run docker:import`).

### Phase 1: Move the API, area by area (3–5 weeks)
Same Supabase database, same Supabase Auth: NestJS verifies Supabase JWTs (JWKS), so sign-in is
untouched. Port in this order, lowest risk first, moving each group from `app/api` to a NestJS
module and flipping its rewrite:

| Order | NestJS module | Routes today |
|---|---|---|
| 1 | `CatalogModule` | products, categories, colors, sizes, variants, product-images, promotions, sale-banners, reels, landing, products/top, products/promo |
| 2 | `StockModule` | stock/* |
| 3 | `OrdersModule` (pricing, confirmation email) | orders, sales/orders, sales/payments, sales/remittances |
| 4 | `DeliveryModule` (Colissimo) | delivery |
| 5 | `CustomersModule` | customers, crm/*, webhooks/meta |
| 6 | `PosModule`, `PurchasingModule` | pos, purchasing/* |
| 7 | `FinanceModule` | finance/* (bills, treasury, invoices, accounting, reports, bank, documents) |
| 8 | `OwnerModule`, `TeamModule`, `NotificationsModule` | owner/*, admin/* |
| 9 | small routes | contact, newsletter, cart/*, upload/image, docs |

Rules while porting:
- Keep the response shapes (`{ success, data }` / `{ success: false, error, code }`) so the admin
  screens don't change. `lib/erp/api.ts` (`route`, `readBody`, `must`, `DB_MESSAGES`) becomes a
  NestJS exception filter and validation pipe.
- Keep every `rpc(...)` as `select fn(...)`; don't rewrite database functions in TypeScript.
- Bring the end-to-end test suite (74 checks: orders, payments, till, purchasing, accounting,
  goals, permissions) into the `api` package first and run it after each area moves.
- Every catalog write calls `invalidateCatalog()` (the Next.js revalidate endpoint), like categories.
- Before `OrdersModule`: the guard only builds an actor for back-office users. Checkout needs the
  **shopper's** id from the bearer token (`POST /api/orders` sets `user_id` from it), so add a
  shopper identity (`@CurrentUser()`) for public routes.
- Before `StockModule`: support the `x-api-key` (`STOCK_API_KEY`) rule for `GET /api/stock/inventory`
  in the guard (e.g. an `@ApiKey()` decorator, compared in constant time).
- Keep each moved area's rule in `requirementFor` too, because middleware still runs first.

### Phase 2: Browser and server components stop calling Supabase (1–2 weeks)
- Replace the `lib/*` data modules that use the publishable key (storefront catalog, reviews,
  favorites, customer orders) with calls to the NestJS API. Server components call the API over
  the internal network; keep `unstable_cache` + `invalidateCatalog()` (the API calls
  `revalidateTag` through a small authenticated Next.js endpoint).
- After this phase, only auth and storage still talk to Supabase from the browser.

### Phase 3: Auth (1–2 weeks)
**Done (local, 2026-10-23)**, migration `20261023204053_own_auth_accounts` (not applied live yet):
accounts in `public.users` (bcrypt hashes copied by `private.copy_auth_users()`; re-run it at the
switch-over for accounts created in between), `user_sessions`, `auth_tokens`, the seven foreign keys
and `private.notification_recipients` moved off `auth.users`. NestJS `/api/auth/*` (sign-in, sign-up
with e-mail confirmation, confirm, forgot, reset, refresh, sign-out, me, password, profile),
`/api/account/*` (favorites, orders, reviews) and `/api/admin/team`; the guard and middleware read
the `kb_access` cookie (`AUTH_SECRET`) and middleware renews it from `kb_refresh`; the storefront,
settings, checkout and admin login use them; Origin check on API writes; `auth.e2e.mjs` (45 checks).
Decisions: refresh tokens are not rotated (concurrent refreshes from several tabs would sign people
out); they are revoked at sign-out, on password change/reset and on team changes instead. Until
phase 4 the admin bell polls every 60 seconds instead of using Supabase Realtime. Rolling back
after the switch loses accounts created since (they only exist in `public.users`).
- Database changes 1–2; copy `auth.users` into `public.users` with their bcrypt hashes.
- NestJS endpoints: sign-in, sign-out, refresh, shopper sign-up, password reset by e-mail
  (nodemailer is already in place), change password; port team management (`/api/admin/team`).
- Switch the admin login and the storefront account pages; both use httpOnly cookies (today the
  storefront session sits in localStorage).
- What Supabase Auth did that NestJS must now do: rate limits on sign-in, sign-up and reset; e-mail
  confirmation if the live project requires it; reset and confirmation e-mails in en/fr/ar;
  refresh-token rotation and revocation at sign-out and when a team member is removed; `SameSite`
  cookies plus an origin check against CSRF.
- Replace every other `supabase.auth` caller: `middleware.ts` (`getClaims` for the admin page gate
  and the API rules), `StaticHeader`/`MobileHeader`, the checkout's bearer token (`lib/orders.ts`),
  the settings page (change password), and `NotificationBell` (session for realtime).
- The e2e helper creates test users with the Supabase Auth admin API; switch it to the new endpoints.
- Rollback: leave Supabase Auth untouched until the new sign-in has run for a week.

### Phase 4: Files, realtime, push, jobs (1 week)
**Done (local, 2026-10-24)**, migration `20261023214627_notifications_from_nestjs`: files on
S3-compatible storage (`api/src/common/storage.ts`; R2 in production, SeaweedFS in Docker since
MinIO no longer publishes images), `upload/image` and `finance/documents` in NestJS,
`api/scripts/copy-storage.mjs` (copy the buckets, `--rewrite` the URLs; tested on the local copy:
374 images, 1,563 URLs). `private.announce_notification` (pg_notify) replaces `dispatch_push`;
NestJS streams notifications (SSE) and sends Web Push (`web-push`, same `VAPID_KEYS`); the daily
alerts run from NestJS, and the pg_cron job is removed. `files.e2e.mjs` (18 checks).
At the switch: create the R2 buckets (`documents` private, `products` public behind a custom domain
= `FILES_PUBLIC_URL`), run the copy with `--rewrite`, set `LISTEN_DATABASE_URL` while the database
is still behind Supabase's transaction pooler, and retire the `send-push` Edge Function.
- Copy the `products` and `documents` buckets to R2 (`rclone`), rewrite URLs, switch uploads.
- SSE notification stream + `pg_notify` trigger; port `NotificationBell`.
- Push sending in NestJS (`web-push`); daily alerts cron in NestJS.

### Phase 5: Move the database (2–3 days, plus a one-night cut-over)
**Done (local, 2026-10-24)**, migration `20261024134433_plain_postgres_ready` (drops the RLS policies
that named Supabase roles and the `auth.users` helpers). `scripts/db/move-database.mjs` dumps
`public`, `private` and the migration history with `pg_dump` 17 (from Docker), restores them as the
API's role on plain Postgres 17 and compares every table's row count; rehearsed from the local copy
of the live data (66 tables, identical counts), and all six e2e suites pass on the result.
`api/scripts/migrate.mjs` applies later migrations (no Supabase CLI).

**Switch-over runbook** (one evening; every staff member and shopper signs in again afterwards,
because sessions are new cookies):
1. Before: the server runs `web`, `api` and `db` (docker compose as in docs/DOCKER.md, minus
   `storage`), with the production `.env` (`DATABASE_URL`, `AUTH_SECRET`, `NEST_URL`, `S3_*`,
   `FILES_PUBLIC_URL`, `VAPID_*`, `GMAIL_*`, Colissimo, Meta, Sentry). R2 has a private `documents`
   bucket and a public `products` bucket on a custom domain (`FILES_PUBLIC_URL`).
2. `cd api && node scripts/copy-storage.mjs` (copies the files; safe to run the day before too).
3. Stop orders on the old site (maintenance page on Netlify).
4. Apply the migrations the live database doesn't have yet, in order, with
   `supabase db query --linked -f <file>` (the ERP ones first if still pending, then
   `20261023204053_own_auth_accounts`, `20261023214627_notifications_from_nestjs`,
   `20261024134433_plain_postgres_ready`).
5. `SOURCE_DATABASE_URL=<Supabase session pooler> TARGET_DATABASE_URL=<server> node scripts/db/move-database.mjs`.
6. `cd api && DATABASE_URL=<server> … node scripts/copy-storage.mjs --rewrite` (points the image URLs at R2).
7. Start `api` and `web`, check: sign in as owner, open the dashboard, a product page, place and
   cancel a test order, upload an image, download a document, receive the test notification.
8. Point the domain at the server (Cloudflare), reopen. Keep the Supabase project paused, not
   deleted, for a month.
- Provision Postgres 17 (managed, or on the VPS with WAL backups to R2); run the Supabase-free
  migrations on an empty database to prove they apply from zero.
- Rehearse: `pg_dump` the live data (schemas `public` and `private`, with the users copy), restore,
  run the end-to-end suite against it.
- Cut-over (about 30 minutes, at night): site in read-only mode, final dump and restore, switch
  `DATABASE_URL`, smoke test, reopen.
- Keep the Supabase project paused, not deleted, for a month as a fallback.

### Phase 6: Clean up (2–3 days)
**Done (local, 2026-10-24):** every `app/api` route is gone except `internal/revalidate` (NestJS serves
all of `/api`, so `NEST_ROUTES` is gone too); middleware gates admin pages only and logs refusals
through NestJS; `@supabase/*`, `lib/supabase*.ts`, `lib/resilient-fetch.ts`, the libs only those
routes used, `supabase/config.toml`, `supabase/functions` and the Supabase env vars are removed;
the WooCommerce importer writes with `pg` and S3; the local Docker setup runs on plain Postgres
(`db`) with `scripts/docker/import-database.mjs`; the e2e suites use SQL instead of Supabase's REST
API. Still to do, with the hosting: move the Next.js app off Netlify to the server.
- Remove `@supabase/*`, `lib/supabase*.ts`, `supabase/functions` and the Supabase-only env vars.
- Move the Next.js app from Netlify to the VPS (same `docker compose` as the local setup in
  docs/DOCKER.md, minus Supabase); update `CLAUDE.md`.

**Total: about 9–14 weeks for one developer**, most of it in phase 1.

## Hosting and cost

Set up as code: see docs/DEPLOY.md (Terraform for AWS, GitHub Actions CI/CD).

**Recommended: one small VPS + Cloudflare's free plan.** The VPS runs `web`, `api` and Postgres
with Docker Compose (the setup already proven locally, docs/DOCKER.md). Cloudflare sits in front for
DNS, HTTPS, the CDN and caching, and R2 holds the product photos and documents.

| Item | Option | Rough monthly cost |
|---|---|---|
| Server (web + api + Postgres) | Hetzner (2–4 vCPU, 4–8 GB) or an OVH equivalent; upgrade in place as traffic grows | ~5–15 € |
| DNS, HTTPS, CDN, cache | Cloudflare free plan | 0 € |
| Files | Cloudflare R2 (free allowance, no egress fees) | ~0 € at this size |
| Backups | nightly `pg_dump` + WAL to R2 | ~0–1 € |

Prices are estimates; confirm them before ordering.

Free hosting options checked (October 2026) and why they're not the plan:
- **Vercel Hobby:** free, but Vercel's fair-use rules restrict Hobby to non-commercial projects, and
  a shop that takes orders is commercial. That means Pro (about $20/month per seat, plus usage), and
  NestJS and Postgres would still need a host elsewhere.
- **Cloudflare Workers / Pages for Next.js (OpenNext):** a possible home for `web`, but the free
  plan caps a Worker at 3 MiB compressed. With antd in the admin, this app likely needs the paid
  plan (10 MiB, about $5/month). Measure it with `opennextjs-cloudflare build` before choosing.
- **NestJS on Cloudflare Workers:** not a fit. Workers isn't Node.js: no long-lived `pg` pool, no
  native modules (argon2/bcrypt), and the SSE stream and cron jobs need a server. Cloudflare
  Containers is paid.
- **Free Node hosts:** Render's free web services sleep when idle and take 30–60 s to wake, so
  checkout and the admin would stall. Fly.io and Railway only give trial credit. Free-tier
  Postgres services (Render, Neon…) expire, sleep, or cap storage.

A VPS costs a few euros a month, and nothing on it sleeps or hits a size cap. It also runs the same
containers as the local setup.

## Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| A permission check is lost when RLS stops protecting data | Deny-by-default global guard (a route needs a decorator to be reachable); the e2e suite checks refusals for agent, cashier and owner |
| Soft-deleted rows leak into lists | A Kysely helper that adds `deleted_at is null`; a review checklist item |
| The activity log loses the actor | `withActor()` is the only way to open a write transaction; e2e asserts activity rows have an actor |
| Password migration fails | Same uuids, bcrypt verification, Supabase Auth kept as a fallback for a week |
| Data loss at cut-over | Rehearsed restore, read-only window, Supabase kept paused for a month |
| Losing serverless auto-scaling | One Node server handles this shop's traffic; add a second API container behind the proxy if needed |
| NestJS is down while areas point to it | No automatic fallback: uptime alert on `/api/health`, and rollback is removing the area from `NEST_ROUTES` (needs a redeploy, since rewrites are fixed at build time) |
| Extra hop (Netlify → NestJS → database) slows pages | Host NestJS in the database's region; compare response times before and after each area |

## Decisions

Taken:
- Full migration, phases 0–6 (2026-10-23).
- E-mail moves into NestJS with the existing nodemailer code.

Proposed, to confirm:
1. **Hosting:** one VPS (Hetzner or OVH) behind Cloudflare's free plan, Postgres on the same VPS
   with nightly backups to R2. During phase 1, NestJS runs on that VPS and Netlify keeps serving
   `web`; in phase 6, `web` moves to the VPS too.
2. **ERP work:** merge it to `main` and apply its migrations to the live database before phase 1
   goes to production. They already applied cleanly to a copy of the live data.
