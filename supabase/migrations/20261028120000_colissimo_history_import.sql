-- The past of the Colissimo account (parcels made before this system, or on Colissimo's website)
-- as orders and money: POST /api/owner/colissimo/sync first adds every parcel deliveries doesn't
-- have, then calls import_colissimo_history with Colissimo's payouts ("Mes paiements").

-- Imports create orders by the thousand: no "New order" notification for those.
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
    'items', items
  );
  recipients := private.notification_recipients('orders');
  if new.assigned_to is not null then
    recipients := array_append(recipients, new.assigned_to);
  end if;
  perform private.notify(
    recipients,
    'order', 'new_order', 'info',
    private.i18n('New order {number}', 'Nouvelle commande {number}', 'طلب جديد {number}', vals),
    private.i18n('{name} · {city} · {items} item(s) · {total} TND',
                 '{name} · {city} · {items} article(s) · {total} TND',
                 '{name} · {city} · {items} قطعة · {total} د.ت', vals),
    '/admin/orders/' || new.id,
    jsonb_build_object('order_id', new.id, 'order_number', new.order_number, 'total', new.total)
  );
  return null;
end;
$$;

-- 1. Every Colissimo parcel without an order gets one (COL-<barcode>, channel "other", no lines:
--    Colissimo's list doesn't say what was inside), with the status and dates of its parcel, so
--    sales, returns and the business's objectives count them on their day. No agent: they earn
--    no commission.
-- 2. Each payout (p_payouts: [{reference, date, gross, fees, account, parcels: [{barcode, status,
--    date}]}]) becomes a carrier payout: its delivered parcels' orders get their payment held by
--    Colissimo (as tracking records it), and the payout moves them to cash or bank, fees apart.
--    A payout already imported (same reference) is skipped, so this can run again.
-- One transaction: all or nothing. Returns {orders, payments, payouts, carrier_open}.
create function public.import_colissimo_history(p_payouts jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d record;
  payout jsonb;
  parcel jsonb;
  st text;
  who text;
  new_id uuid;
  v_order uuid;
  v_owed numeric;
  pay_ids uuid[];
  orders_added integer := 0;
  payments_added integer := 0;
  payouts_added integer := 0;
begin
  perform set_config('kachabity.importing', 'on', true);

  for d in
    select * from public.deliveries
     where deliveries.order_id is null and barcode is not null and deleted_at is null and provider = 'colissimo'
     order by created_at
  loop
    st := case
      when d.status in ('Livre', 'Livre paye', 'Livrer', 'Echange') then 'delivered'
      when d.status in ('Retour Expediteur', 'Retour depot', 'Retour definitif', 'Retour paye', 'Retour recu paye',
                        'Rtn depot', 'Rtn client/agence', 'Rtn definitif', 'Retour recu', 'Retour') then 'returned'
      when d.status in ('sending', 'En attente', 'A enlever') then 'processing'
      when d.status = 'Supprime' then 'cancelled'
      else 'shipped'
    end;
    who := trim(coalesce(d.recipient_name, ''));
    new_id := null;
    insert into public.orders (order_number, customer_first_name, customer_last_name, customer_phone,
                               subtotal, total, status, channel, order_notes,
                               created_at, confirmed_at, delivered_at, returned_at, cancelled_at)
    values ('COL-' || d.barcode,
            coalesce(nullif(split_part(who, ' ', 1), ''), '—'),
            trim(substr(who, length(split_part(who, ' ', 1)) + 1)),
            coalesce(split_part(d.phone, ' / ', 1), ''),
            coalesce(d.cod_amount, 0), coalesce(d.cod_amount, 0), st, 'other', 'Imported from Colissimo',
            d.created_at, d.created_at,
            case when st = 'delivered' then coalesce(d.status_changed_at, d.created_at) end,
            case when st = 'returned' then coalesce(d.status_changed_at, d.created_at) end,
            case when st = 'cancelled' then coalesce(d.status_changed_at, d.created_at) end)
    on conflict (order_number) do nothing
    returning id into new_id;
    if new_id is not null then
      update public.deliveries set order_id = new_id, updated_at = now() where id = d.id;
      orders_added := orders_added + 1;
    end if;
  end loop;

  for payout in select * from jsonb_array_elements(coalesce(p_payouts, '[]'::jsonb)) loop
    if exists (select 1 from public.cod_remittances
                where reference = payout->>'reference' and deleted_at is null) then
      continue;
    end if;
    pay_ids := '{}';
    for parcel in select * from jsonb_array_elements(coalesce(payout->'parcels', '[]'::jsonb)) loop
      -- Returns in a payout only carry their fee; the delivered ones are the money.
      continue when parcel->>'status' <> 'delivered';
      v_order := null;
      select o.id, o.total - o.paid_amount into v_order, v_owed
        from public.deliveries dd join public.orders o on o.id = dd.order_id
       where dd.barcode = parcel->>'barcode' and dd.deleted_at is null and o.deleted_at is null
       limit 1;
      continue when v_order is null;
      if v_owed > 0 and not exists (select 1 from public.order_payments op
                                     where op.order_id = v_order and op.account = 'carrier'
                                       and op.remittance_id is null and op.deleted_at is null) then
        insert into public.order_payments (order_id, amount, method, account, reference, note, received_at)
        values (v_order, v_owed, 'cod', 'carrier', parcel->>'barcode', 'Colissimo: delivered and paid',
                coalesce(nullif(parcel->>'date', '')::date, (payout->>'date')::date) + time '12:00');
        payments_added := payments_added + 1;
      end if;
      pay_ids := pay_ids || array(select op.id from public.order_payments op
                                   where op.order_id = v_order and op.account = 'carrier'
                                     and op.remittance_id is null and op.deleted_at is null);
    end loop;
    perform public.record_remittance(
      jsonb_build_object('provider', 'colissimo', 'reference', payout->>'reference', 'received_on', payout->>'date',
                         'gross_amount', payout->>'gross', 'fees', payout->>'fees', 'account', payout->>'account',
                         'note', 'Imported from Colissimo'),
      array(select distinct unnest(pay_ids)));
    payouts_added := payouts_added + 1;
  end loop;

  return jsonb_build_object(
    'orders', orders_added,
    'payments', payments_added,
    'payouts', payouts_added,
    'carrier_open', (select coalesce(sum(amount), 0) from public.order_payments
                      where account = 'carrier' and remittance_id is null and deleted_at is null));
end;
$$;
