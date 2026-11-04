-- Where a website shopper came from before ordering (google, facebook, instagram, tiktok, direct,
-- or the referring site), remembered by the storefront for 30 days and sent with the order
-- (POST /api/orders). Orders typed in by agents have their channel instead and leave it empty.
alter table public.orders
  add column if not exists traffic_source text
  constraint orders_traffic_source_check check (traffic_source ~ '^[a-z0-9._-]{1,40}$');
