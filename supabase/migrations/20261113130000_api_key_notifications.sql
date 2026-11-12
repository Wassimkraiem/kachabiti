-- Orders and parcels made with an API key (a chatbot, an outside system) say so in the team's
-- notifications: "New order ORD-… by chatbot-api", "Parcel … created by chatbot-api". A key's writes
-- carry created_by_email = 'api-key:<name>' (AuthGuard.apiKeyActor in the API), and its orders are
-- assigned to the key itself (assigned_to = the key's id), so they count as the chatbot's.

create or replace function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  items integer;
  vals jsonb;
  recipients uuid[];
  source text := case when new.created_by_email like 'api-key:%' then substr(new.created_by_email, 9) end;
begin
  if new.channel = 'store' or current_setting('kachabity.importing', true) = 'on' then
    return null;
  end if;
  select coalesce(sum(quantity), 0) into items from public.order_items where order_id = new.id;
  vals := jsonb_build_object(
    'number', new.order_number,
    'name', trim(concat_ws(' ', new.customer_first_name, new.customer_last_name)),
    'city', coalesce(nullif(new.shipping_city, ''), nullif(new.shipping_state, ''), '—'),
    'total', trim(to_char(new.total, 'FM999999990.##')),
    'items', items,
    'source', coalesce(source, '')
  );
  recipients := private.notification_recipients('orders');
  -- The assigned agent, when it's a person (an API key's own orders are assigned to the key).
  if new.assigned_to is not null and coalesce(new.assigned_to_email, '') not like 'api-key:%' then
    recipients := array_append(recipients, new.assigned_to);
  end if;
  perform private.notify(
    recipients,
    'order', 'new_order', 'info',
    case when source is null
      then private.i18n('New order {number}', 'Nouvelle commande {number}', 'طلب جديد {number}', vals)
      else private.i18n('New order {number} by {source}', 'Nouvelle commande {number} par {source}', 'طلب جديد {number} من {source}', vals)
    end,
    private.i18n('{name} · {city} · {items} item(s) · {total} TND',
                 '{name} · {city} · {items} article(s) · {total} TND',
                 '{name} · {city} · {items} قطعة · {total} د.ت', vals),
    '/admin/orders/' || new.id,
    jsonb_build_object('order_id', new.id, 'order_number', new.order_number, 'total', new.total, 'source', source)
  );
  return null;
end;
$$;

-- A parcel an API key got its Colissimo barcode for (New parcel, or validating an order).
create or replace function private.notify_api_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vals jsonb;
  number text;
begin
  if new.created_by_email is null or new.created_by_email not like 'api-key:%'
     or new.barcode is null or (tg_op = 'UPDATE' and old.barcode is not null) then
    return null;
  end if;
  select order_number into number from public.orders where id = new.order_id;
  vals := jsonb_build_object('barcode', new.barcode, 'source', substr(new.created_by_email, 9),
                             'order', coalesce(number, '—'), 'name', coalesce(new.recipient_name, '—'));
  perform private.notify(
    private.notification_recipients('orders'),
    'order', 'api_parcel', 'info',
    private.i18n('Parcel {barcode} created by {source}', 'Colis {barcode} créé par {source}', 'الطرد {barcode} أنشأه {source}', vals),
    private.i18n('Order {order} · {name}', 'Commande {order} · {name}', 'الطلب {order} · {name}', vals),
    case when new.order_id is not null then '/admin/orders/' || new.order_id else '/admin/delivery' end,
    jsonb_build_object('delivery_id', new.id, 'order_id', new.order_id, 'source', substr(new.created_by_email, 9))
  );
  return null;
end;
$$;

revoke all on function private.notify_api_parcel() from public;

drop trigger if exists deliveries_notify_api_parcel on public.deliveries;
create trigger deliveries_notify_api_parcel
  after insert or update of barcode on public.deliveries
  for each row execute function private.notify_api_parcel();
