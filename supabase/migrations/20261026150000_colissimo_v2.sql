-- Colissimo v2 API (lib/colissimo.ts): tracking reports the payment separately ("payee") and the
-- driver's live report (pre-état); parcels are handed over with a manifest; a printed parcel's
-- price changes through a request Colissimo answers later. The v2 status names differ from v1's
-- ("Livrer" instead of "Livre" / "Livre paye", "Rtn definitif", "Retour recu"…); older parcels
-- keep their v1 names, so both are understood.

alter table public.deliveries
  add column paid boolean not null default false,
  add column driver_status text,
  add column driver_reason text,
  add column manifest_id integer,
  add column handed_over_at timestamptz,
  -- The last price change asked of Colissimo: {request_id, old_price, new_price, reason, at}.
  add column price_change jsonb;

comment on column public.deliveries.paid is 'Colissimo marks the parcel paid (v2 tracking: status "payee").';
comment on column public.deliveries.driver_status is 'What the driver reported on the spot (v2 pre-etat), before Colissimo confirms it.';

drop function public.record_delivery_status(uuid, text, text, uuid, text);

-- A parcel's status from Colissimo. Moves its order: picked up / on the way → shipped, delivered →
-- delivered, final return → returned (its stock comes back). Delivered and paid ("Livre paye" in
-- v1; "Livrer" + paid in v2) records the cash still owed as a payment held by the carrier, once.
-- Returns true when the status, reason or payment changed (driver reports alone don't count).
create function public.record_delivery_status(
  p_id uuid, p_status text, p_reason text, p_actor uuid default null, p_actor_email text default null,
  p_paid boolean default null, p_driver_status text default null, p_driver_reason text default null)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  row public.deliveries;
  ord public.orders;
  changes jsonb := '{}'::jsonb;
  owed numeric;
  changed boolean;
begin
  select * into row from public.deliveries where id = p_id and deleted_at is null for update;
  if not found then
    return false;
  end if;
  changed := row.status is distinct from p_status
    or row.status_reason is distinct from nullif(p_reason, '')
    or (p_paid is not null and row.paid is distinct from p_paid);

  if changed
     or row.driver_status is distinct from nullif(p_driver_status, '')
     or row.driver_reason is distinct from nullif(p_driver_reason, '') then
    update public.deliveries
       set status = p_status,
           status_reason = nullif(p_reason, ''),
           status_changed_at = case when row.status is distinct from p_status then now() else status_changed_at end,
           paid = coalesce(p_paid, paid),
           driver_status = nullif(p_driver_status, ''),
           driver_reason = nullif(p_driver_reason, ''),
           updated_at = now()
     where id = p_id
    returning * into row;
  end if;
  if not changed then
    return false;
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id and deleted_at is null;
    if found then
      if p_status in ('Enleve', 'Au depot', 'Au magasin', 'En cours', 'Retour Inter Agence') and ord.status = 'processing' then
        changes := changes || '{"status": "shipped"}'::jsonb;
      elsif p_status in ('Livre', 'Livre paye', 'Livrer') and ord.status in ('confirmed', 'processing', 'shipped') then
        changes := changes || '{"status": "delivered"}'::jsonb;
      elsif p_status in ('Retour definitif', 'Retour paye', 'Retour recu paye', 'Rtn definitif', 'Retour recu')
            and ord.status in ('processing', 'shipped', 'delivered') then
        changes := changes || '{"status": "returned"}'::jsonb;
      end if;
      if changes <> '{}'::jsonb then
        perform public.set_order_status(row.order_id, changes, p_actor, p_actor_email);
      end if;
      if p_status = 'Livre paye' or (p_status = 'Livrer' and row.paid) then
        select total - paid_amount into owed from public.orders where id = row.order_id;
        if owed > 0 then
          insert into public.order_payments (order_id, amount, method, account, reference, note, created_by, created_by_email)
          values (row.order_id, owed, 'cod', 'carrier', row.barcode, 'Colissimo: delivered and paid', p_actor, p_actor_email);
        end if;
      end if;
    end if;
  end if;
  return true;
end;
$$;
