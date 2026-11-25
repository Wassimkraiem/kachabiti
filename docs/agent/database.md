# Database access, transactions, soft deletes, activity log, notifications, schema

Moved verbatim from CLAUDE.md so it loads only when needed. Keep it accurate when you change this area.

### Database access

NestJS connects to Postgres as the owner of the tables (`api/src/db/database.ts`: Kysely on `pg`), so row-level security (still enabled, no policies) doesn't filter it and no other role can read anything. Browsers never reach the database: everything goes through `/api`.
- Every read must filter `deleted_at is null` itself, embeds included (`one()` / `many()` in `api/src/db/embed.ts`).
- Writes go through `db.withActor(actor | null, trx => …)`, which sets the settings the activity log reads (see Activity log). `null` (checkout, webhooks, scripts) means no staff member: the change isn't logged.
- `db.call(name, params, trx)` calls a database function with named arguments, encoded by their declared types.
- Checkout: `lib/orders.ts` `createOrder` calls `POST /api/orders`, which takes `user_id` from the session cookie.

**Related writes must be one transaction.** Any operation that writes more than one row/table that belong together is a Postgres function (`supabase/migrations/20261001170000_transactional_writes.sql` and later ones), called from NestJS with `db.call()`:
- `create_order` (order + lines)
- `set_order_status` (status + stock movement)
- `delete_orders` (stock restore + mark cancelled and deleted, one or many)
- `save_product` (product, variants, variant photos, photos, opening stock, tracking, importer discount; create and update)
- `record_stock_movements` (all movement types, counts across locations, tracking flag)
- `save_landing_page` (Admin → Landing page: a section's picks, `landing_config` and featured categories)
- `delete_variant` (variant + its photos)
- `edit_order` (an order still to confirm or confirmed: customer, amounts, notes and, optionally, its lines; `PATCH /api/sales/orders` action `edit`, the order page's "Edit order")
- `purge_deleted` (permanent deletes, see below)

If any step fails, nothing is written. Bulk deletes send `?ids=a,b` and run one statement. When you add a write that touches several rows or tables together, add or extend such a function rather than chaining client calls.

**No hard deletes.** Deleting means `deleted_at = now()`, plus `status = 'archived'` / `active = false` / `is_available = false` where the table has one (orders become `cancelled`). The trigger `private.prevent_hard_delete` rejects `DELETE` on every business table with `hard_delete_not_allowed`. The one way past it is `public.purge_deleted(table, ids)` (NestJS only), which erases rows that are **already** soft-deleted, along with what cascades from them, and logs each one as `purge`. Admins and staff with the `hard_delete` permission use it from Admin → Deleted items (`/api/admin/trash`, which also needs the table's area permission; the table list is `lib/trash-tables.ts` and must match the function's). Owners can also bring rows back there (`PUT /api/admin/trash`, `public.restore_deleted(table, ids)`, same table list, logged as `restore`): products return `inactive`, banners, reels and discounts stay inactive, and orders stay `cancelled`, so nothing goes live or moves stock by itself. The only exception is `inventory_levels`, which the stock trigger maintains; accounts are `public.users` rows, soft-deleted like the rest (their sessions revoked). Every read must add `deleted_at is null`, including on embeds. Favorites are removed by setting `deleted_at` and re-added by upsert. Team members are soft-deleted by the Team API (`api/src/admin/team.controller.ts`).

**Activity log.** `activity_log` is append-only and filled by the trigger `private.log_activity` on business tables. Each row records the staff member, the action (create/update/delete/restore) and the changed columns as before → after. The actor comes from the transaction settings `request.jwt.claims` / `request.headers` (`x-actor-*`), read by `private.trusted_request_headers()`; NestJS sets them in `db.withActor()` (the names come from the PostgREST days). Writes without a staff member (checkout, scripts that set the same settings, like the WooCommerce importer) aren't logged; direct database edits are logged with `source = 'database'`. Team changes are logged by the Team API itself (action create/update/remove_access/delete, entity `team_member`). Admins browse the log in Admin → Activity (`/api/admin/activity`). The identity comes from the verified session, never from request headers.

**Notifications.** The `notifications` table holds one row per recipient, with the title and body stored in en/fr/ar (`private.i18n`).
- **New orders:** a deferred trigger on `orders` notifies the owners, the admins, and staff with `orders`.
- **Owner alerts:** the trigger `private.owner_alerts` on `activity_log` notifies owners about what admins and staff do: deletes (grouped per person over 10 minutes, plus a critical alert past 10), purges, blocked attempts (middleware logs `access_denied`), team changes, price cuts of 50% or more, discounts of 50% or more, stock adjustments of 20+ units, settings changes, cancelled or refunded orders, and restores. Owners' own actions don't alert. Admins receive these alerts while no owner exists.
- **Recipients:** they come from `back_office_users`, which `GET /api/admin/me` and the Team API keep in sync (it includes roles set through `OWNER_EMAILS` / `ADMIN_EMAILS`).
- **Delivery (NestJS, `api/src/notifications/notification-events.ts`):** the trigger `private.announce_notification` sends each new or changed row's id on the Postgres channel `notifications`. NestJS LISTENs (`LISTEN_DATABASE_URL` when `DATABASE_URL` is a transaction pooler), streams the row to the recipient's open admin tabs through `GET /api/admin/notifications/stream` (SSE, `{ op, row }`, closed every 15 minutes so the session is re-checked), and sends new rows as Web Push. One API instance is assumed.
- **In the admin:** the header bell (`components/admin/NotificationBell.tsx`) loads `/api/admin/notifications`, listens on the stream (pop-up and sound), and reloads every 60 seconds as a safety net.
- **Desktop push:** NestJS sends Web Push (`web-push`) to the recipient's `push_subscriptions`, shown by `public/admin-sw.js`, with `VAPID_KEYS` (JWK pair, the Edge Function's format) and `VAPID_SUBJECT`. The browser key is the `vapid_public_key` row in `site_settings`; it must match `VAPID_KEYS`. Expired subscriptions (404/410) are soft-deleted.
- **Adding an alert:** add a rule to `private.owner_alerts`, or call `private.notify(recipients, …)` from SQL.

**The schema source of truth is `supabase/migrations/`.** The legacy SQL scripts from the old project have been removed. Categories are nested (`categories.parent_id`): use `getDescendantCategoryIds` (`lib/utils/product-utils.ts`) wherever products are filtered by category. For a new migration, add `supabase/migrations/<yyyymmddhhmmss>_<name>.sql` (plain Postgres SQL; the folder keeps its old name) and apply it with `api/scripts/migrate.mjs`. The older migrations are the history and only applied on Supabase; a new database is built by copying one with `scripts/db/move-database.mjs`. **Files** live in S3-compatible storage (AWS S3, signed with the server's instance role; a local SeaweedFS in Docker), through `api/src/common/storage.ts`: bucket `products` (public, at `FILES_PUBLIC_URL`; real names in `S3_PRODUCTS_BUCKET` / `S3_DOCUMENTS_BUCKET`; uploads through `POST /api/upload/image`) and `documents` (private). `api/scripts/copy-storage.mjs` copied the Supabase buckets over and, with `--rewrite`, replaced the old image URLs in the database (not in `activity_log`).
