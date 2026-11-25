# API docs and the NestJS API

Moved verbatim from CLAUDE.md so it loads only when needed. Keep it accurate when you change this area.

### API docs

`lib/openapi.ts` builds an OpenAPI spec by hand (ERP routes in `lib/openapi-erp.ts`). `/api/docs` serves it and `/api-docs` renders it with swagger-ui. If you change an API route's shape, update this spec too.

### NestJS API

`api/` is the NestJS 11 app behind every `/api` request (conventions in `api/README.md`; the history of the move is in `docs/MIGRATION-NESTJS.md`). `next.config.ts` rewrites `/api/:path*` to `NEST_URL` (afterFiles, so `app/api/internal/revalidate`, the one route left in Next.js, still answers). The storefront needs NestJS running wherever it is deployed.
- Access rules: a decorator on the route (`@Public`, `@Requires`, `@RequiresAll`, `@AdminOnly`, `@OwnerOnly`) and/or `apiRequirement` in `lib/api-access.ts`; the guard (`api/src/auth/auth.guard.ts`) applies both and denies a route that has neither.
- NestJS catalog writes refresh the storefront cache through `POST /api/internal/revalidate` (`REVALIDATE_SECRET`).
- The storefront's public reads come from `/api/storefront/*` through `lib/storefront-api.ts`: on the server via `NEST_URL`, in the browser through the rewrite.
- `api/` imports root `lib/` files as `@shared/*`; a shared file may only use relative imports (`lib/admin-auth.ts`, `lib/erp/db-messages.ts`, `lib/stock.ts`).
- Root `npx tsc --noEmit` and lint skip `api/`; check it with `npm run build` and `npm run lint` in `api/`. `api/test/e2e` holds the end-to-end suites (`node test/e2e/<suite>.e2e.mjs` in `api/`, against the local Docker stack and its database only).
