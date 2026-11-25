# CLAUDE.md

Guidance for Claude Code in this repository. `AGENTS.md` holds the repository conventions (naming, commit style, PR expectations) and applies here as well.

This file stays short on purpose: it loads into every message.
Detailed notes live in `docs/agent/`; read the file for an area **before** changing that area (index below).

## Commands
  
- `npm run dev`: Turbopack dev server on http://localhost:3000. It sets `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000` because Node's default 250 ms connect attempt times out on slow networks, which made requests fail at random. Use the same flag for `next start` and Node scripts.
- `npm run lint`: ESLint (flat config in `eslint.config.mjs`)
- `npm run build`: production build with Turbopack
- `npm run import:woocommerce -- --dry-run`: preview a re-import of the WooCommerce export (`kachabiti-products.csv`); drop `--dry-run` to write. It is idempotent: products are upserted by slug, variants are matched by color + size and updated in place (never touching stock), and images and discounts are replaced. English/French text lives in `scripts/import/translations.json` and `descriptions.json`, and color hexes in `colors.json`.
- Local copy in Docker (docs/DOCKER.md): `npm run docker:env`, `docker compose up -d db storage`, optionally `npm run docker:import` (copies a database read-only, e.g. the server's), then `npm run docker:up` (web on :3000, NestJS on :4000, Postgres on :5433, files on :9000).
- `cd api && DATABASE_URL=… node scripts/migrate.mjs [--dry-run]`: apply the migrations in `supabase/migrations` the database doesn't have yet (recorded in `supabase_migrations.schema_migrations`).
- Production (docs/DEPLOY.md): Terraform in `infra/terraform/` (one AWS EC2 server running the API, Postgres and Caddy; S3 buckets; disk snapshots; a budget alert), server files in `deploy/` (`docker-compose.prod.yml`, `deploy.sh`, `backup.sh`), GitHub Actions in `.github/workflows/` (`ci.yml` on PRs; `deploy.yml` on push to `main`, the production branch of both the site and the API: CI, then the API only when it changed, with no downtime). Vercel skips site builds for backend-only pushes (`vercel.json`). An empty database is built from `db/baseline.sql` by `api/scripts/migrate.mjs`.
- `DATABASE_URL=… node scripts/import/old-colissimo.mjs <livres_payes.csv> <colis_rows.csv> [--dry-run] [--account=bank|cash]`: import the Colissimo parcels of the tools used before this system (as `COL-` orders, customers and payouts, through `import_colissimo_history`); re-runs skip what is already there.
- `node scripts/db/move-database.mjs`: copy a whole database to another Postgres (`SOURCE_DATABASE_URL` → `TARGET_DATABASE_URL`) and compare row counts; used for the move off Supabase and for backups/restores.
- `npx tsc --noEmit`: type-check. **Run this yourself**: `next.config.ts` sets `ignoreBuildErrors` and `ignoreDuringBuilds`, so `npm run build` succeeds even when there are type or lint errors.

The repo has no test runner. To verify a change, run lint and a type-check, then exercise the affected localized, admin, and API routes in the dev server.

## Architecture in one paragraph

Kachabity is a Next.js 15 App Router storefront for handcrafted Tunisian products: React 19, Tailwind v4, Ant Design 6 (admin only). Every `/api` request is served by the NestJS 11 app in `api/` on plain Postgres 17, with files in S3-compatible storage (AWS S3). Supabase is no longer used. The site deploys on Vercel and the API on one AWS server (docs/DEPLOY.md). Locales are `en`, `fr`, `ar`, default `ar` (RTL).

## Rules for every change

- New back-office page: add a rule in `PAGE_PERMISSIONS` and `MENU_PERMISSIONS`. New API route or method: a rule in `apiRequirement` or a decorator. The guard denies routes with neither.
- Writes that touch several rows or tables together are one Postgres function called with `db.call()`, never chained calls.
- No hard deletes: set `deleted_at`, and every read (embeds included) filters `deleted_at is null`.
- Never write `product_variants.stock` or `inventory_levels` directly; record `stock_movements`.
- Checkout is re-priced on the server by `priceOrder()`; if the storefront price logic changes, change it too.
- Every admin write route calls `invalidateCatalog()`.
- Never import `antd` outside `components/admin` / `app/admin`.
- Every new admin UI string gets a row in `lib/admin-translations.ts`.
- New schema: `supabase/migrations/<yyyymmddhhmmss>_<name>.sql`, applied with `api/scripts/migrate.mjs`.
- API shape change: update `lib/openapi.ts`.
- Read the environment through `lib/app-env.ts`, not `NODE_ENV`. Never pass customer details to Sentry.
- The many top-level `*.md` files are historical notes, not the source of truth.

## Read before working on

| Area | File |
|---|---|
| Auth, roles, permissions, sessions, middleware | `docs/agent/auth-and-access.md` |
| Translations, locales, home page config | `docs/agent/i18n.md` |
| Database, transactions, soft delete, activity log, notifications, files | `docs/agent/database.md` |
| Prices, checkout, cart, stock, orders, Colissimo | `docs/agent/commerce-and-stock.md` |
| ERP: CRM, till, purchasing, accounting, objectives, tickets, alerts | `docs/agent/erp.md` |
| Caching and performance | `docs/agent/caching.md` |
| Admin UI and admin translations | `docs/agent/admin.md` |
| NestJS API, OpenAPI | `docs/agent/nestjs-api.md` |
| Env vars, fonts, images, Sentry | `docs/agent/config.md` |

## Handoff between sessions

@.claude/handoff.md
