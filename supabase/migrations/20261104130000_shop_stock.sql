-- Shops: locations with a caisse, each with its own low-stock limit (Admin → Stock settings).

alter table public.locations
  add column is_shop boolean not null default false,
  add column low_stock_limit integer check (low_stock_limit >= 0); -- null: each variant's reorder point

-- Locations that already ran a till stay available at the caisse.
update public.locations l
   set is_shop = true
 where exists (select 1 from public.pos_sessions s where s.location_id = l.id);

-- Audience 'pos': cashiers, for alerts about their shops.
create or replace function private.notification_recipients(p_audience text)
 returns uuid[]
 language sql
 stable security definer
 set search_path to ''
as $function$
  with live as (
    select b.*
      from public.back_office_users b
      join public.users u on u.id = b.user_id
     where b.deleted_at is null and u.deleted_at is null
  )
  select coalesce(array_agg(user_id), '{}')
    from live
   where case p_audience
           when 'owner' then role = 'owner'
                          or (role = 'admin' and not exists (select 1 from live where role = 'owner'))
           when 'orders' then role in ('owner', 'admin') or 'orders' = any (permissions)
           when 'stock' then role in ('owner', 'admin') or 'stock' = any (permissions) or 'purchasing' = any (permissions)
           when 'finance' then role in ('owner', 'admin') or 'finance' = any (permissions)
           when 'customers' then role in ('owner', 'admin') or 'customers' = any (permissions)
           when 'pos' then 'pos' = any (permissions)
           else false
         end;
$function$;

-- A variant falling to its location's limit, else its reorder point. Cashiers can't open the
-- stock pages, so at a shop those who aren't already told get a link to the caisse's Stock tab.
create or replace function private.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  vals jsonb;
  threshold integer;
  severity text;
  title jsonb;
  body jsonb;
  data jsonb;
  stock_team uuid[];
begin
  select pv.reorder_point, pv.sku, p.name, p.id as product_id, p.stock_tracked,
         l.name as location, l.is_shop, l.low_stock_limit
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.locations l on l.id = new.location_id
   where pv.id = new.variant_id and pv.deleted_at is null and p.deleted_at is null;
  if not found or not v.stock_tracked then
    return null;
  end if;
  threshold := coalesce(v.low_stock_limit, v.reorder_point);
  if new.available <= threshold and old.available > threshold then
    vals := jsonb_build_object('name', v.name, 'sku', coalesce(v.sku, ''), 'left', new.available, 'location', v.location);
    severity := case when new.available = 0 then 'warning' else 'info' end;
    title := private.i18n('Low stock: {name}', 'Stock bas : {name}', 'مخزون منخفض: {name}', vals);
    body := private.i18n('{sku} · {left} left at {location}', '{sku} · plus que {left} à {location}', '{sku} · بقي {left} في {location}', vals);
    data := jsonb_build_object('variant_id', new.variant_id, 'product_id', v.product_id, 'location_id', new.location_id);
    stock_team := private.notification_recipients('stock');
    perform private.notify(stock_team, 'system', 'low_stock', severity, title, body,
                           '/admin/stock?search=' || coalesce(v.sku, ''), data);
    if v.is_shop then
      perform private.notify(
        array(select unnest(private.notification_recipients('pos')) except select unnest(stock_team)),
        'system', 'low_stock', severity, title, body,
        '/admin/pos?tab=stock&location=' || new.location_id, data);
    end if;
  end if;
  return null;
end;
$$;
