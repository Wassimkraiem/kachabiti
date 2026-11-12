-- Which parcels Colissimo's website still lists for the account, so Admin → Delivery matches its
-- dashboard: parcels this system sent, and those the account sync (POST /api/owner/colissimo/sync,
-- also nightly) finds. Parcels from the tools used before (scripts/import/old-colissimo.mjs) that
-- the account doesn't list become false: staff don't see them, owners and admins can switch to
-- "All my data". True until the first sync, so nothing disappears before then.
alter table public.deliveries
  add column if not exists in_colissimo boolean not null default true;

create index if not exists deliveries_in_colissimo
  on public.deliveries (in_colissimo, created_at desc) where deleted_at is null;
