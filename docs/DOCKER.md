# Run the whole app locally in Docker

A local copy of the site to test on, made of the same containers the server runs: storefront +
admin (Next.js, `web`), the NestJS API (`api`), Postgres 17 (`db`) and S3-compatible file storage
standing in for Cloudflare R2 (`storage`). Nothing here writes to the live site: a live database is
only read, by the import script.

Needs Docker Desktop and Node 22.

## 1. Create `.env.docker`

```bash
npm run docker:env
```

It writes `.env.docker` (git-ignored) with local-only values. Set `OWNER_EMAILS` there to your
e-mail to get the owner role.

## 2. Start the database and the file storage

```bash
docker compose up -d db storage storage-buckets
```

Postgres is at `localhost:5433` (user and database `kachabity`, password `kachabity-local`); the
storage at http://localhost:9000, buckets `products` (public) and `documents` (private).

## 3. Copy a database (needed once, the local one starts empty)

Set `SOURCE_DATABASE_URL` in `.env.docker` to the database to copy, read only: the server's
Postgres, e.g. `postgresql://user:password@host:5432/kachabity` (it is used from a container, so a
database on this machine is `host.docker.internal`). Then:

```bash
npm run docker:import
```

It copies every table (`scripts/db/move-database.mjs`, which compares row counts afterwards),
applies newer migrations (`api/scripts/migrate.mjs`), gives **every account the local password
`Kachabity-local-1`** (`LOCAL_PASSWORD`), signs out copied sessions and voids e-mailed links, and
creates the local owner `admin@kachabity.local`. The dump is kept in `.docker-data/` (git-ignored).
It holds customer data, so delete it when you're done.

Product photos keep the URLs stored in the database. To serve them from the local storage, copy the
files too and point the URLs at it (`api/scripts/copy-storage.mjs`; it reads the Supabase buckets
during the move off Supabase).

## 4. Build and start the app

```bash
npm run docker:up
```

- Site and admin: http://localhost:3000 (admin: http://localhost:3000/admin). Owner account:
  `admin@kachabity.local` with `LOCAL_PASSWORD` (`npm run docker:admin` recreates it).
- NestJS API: http://localhost:4000/api/health. Every `/api` request goes through it.

The first build takes a few minutes. Rebuild after code changes with the same command. After
changing only `.env.docker`, run `docker compose build --no-cache web`, then `npm run docker:up`:
`NEXT_PUBLIC_*`, `NEST_URL` and `FILES_PUBLIC_URL` are fixed at build time, and Docker doesn't
notice a change in that file on its own. Stop with `docker compose down`.

## Tests

The end-to-end suites run against this stack and its database (they write data, local only):

```bash
cd api && node test/e2e/auth.e2e.mjs
```

Suites: `auth`, `categories`, `catalog`, `stock`, `files`, `erp`, `objectives` (`npm run test:e2e` in `api/` runs them all, ERP before objectives). The ERP suite checks running totals, so run it on a fresh `npm run docker:import`, before the others that deliver orders (objectives). The sign-up limit (5 per hour per address) is in memory: `docker compose restart api` clears it between repeated runs.

## Notes

- The API talks to a Colissimo stand-in (`colissimo`, `scripts/docker/colissimo-mock.mjs`, on :9100), never to the
  real account: parcels live in its memory, and tests change them through `/__mock`.
- `web` and `api` run inside the small `gateway` container, which forwards its `localhost:9000` to
  the storage. File URLs and signed links therefore work the same in the browser, in the web
  container's image optimizer and in the api.
- Without Gmail settings, account e-mails (confirm, reset) aren't sent: sign-ups are confirmed at
  once and reset links are printed in the api log (`docker compose logs api`).
- E-mail (Gmail), Colissimo, Meta, Web Push and Sentry are off unless you add their variables to
  `.env.docker`. Leave them off: with them on, actions in the local copy would send real e-mails,
  parcels and notifications.
- New migrations: add a file to `supabase/migrations/`, then
  `cd api && DATABASE_URL=postgresql://kachabity:kachabity-local@127.0.0.1:5433/kachabity node scripts/migrate.mjs`.
