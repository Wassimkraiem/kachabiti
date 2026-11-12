-- Order statuses as one explicit state machine, enforced where every status change goes through
-- (set_order_status: the orders list and order page, confirm, validate, the till, Colissimo tracking).
--
-- Before, any status could follow any other. Moving a shipped or delivered order back to
-- "to confirm", "confirmed" or "cancelled" put its stock back although the customer has the goods,
-- and undid the sale's journal entry; a deleted order could be revived by setting a status.
-- The rule: once goods have left (shipped, delivered), stock only comes back through "returned".
-- Corrections that keep the stock out (delivered → shipped, shipped → validated…) stay allowed.

create or replace function private.order_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_from = p_to or case p_from
    when 'pending'    then p_to in ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
    when 'confirmed'  then p_to in ('pending', 'processing', 'shipped', 'delivered', 'cancelled')
    -- Validated: the goods are still here, so the validation can be undone.
    when 'processing' then p_to in ('pending', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled')
    when 'shipped'    then p_to in ('processing', 'delivered', 'returned')
    when 'delivered'  then p_to in ('processing', 'shipped', 'returned')
    -- The goods are back: re-sent / corrected (stock out again), or closed as cancelled (no stock change).
    when 'returned'   then p_to in ('processing', 'shipped', 'delivered', 'cancelled')
    -- Reopened: it goes through confirmation (and Validate) again.
    when 'cancelled'  then p_to in ('pending', 'confirmed')
    else false
  end;
$$;

create or replace function public.set_order_status(p_order_id uuid, p_changes jsonb, p_actor uuid default null, p_actor_email text default null)
returns public.orders
language plpgsql
set search_path to ''
as $$
declare
  new_status text := nullif(p_changes->>'status', '');
  ord public.orders;
begin
  if new_status is not null and new_status not in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  select * into ord from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if new_status is not null and not private.order_transition_allowed(ord.status, new_status) then
    if ord.status in ('shipped', 'delivered') then
      raise exception 'order_already_sent:%:%', ord.status, new_status;
    end if;
    raise exception 'order_status_not_allowed:%:%', ord.status, new_status;
  end if;

  if new_status in ('processing', 'shipped', 'delivered') then
    perform public.apply_order_stock(p_order_id, 'deduct', p_actor, p_actor_email);
  elsif new_status in ('pending', 'confirmed', 'returned', 'cancelled') then
    perform public.apply_order_stock(p_order_id, 'restore', p_actor, p_actor_email);
  end if;

  -- payment_status is no longer taken from p_changes: it follows the payments (private.refresh_order_paid).
  update public.orders
     set status = coalesce(new_status, status),
         order_notes = case when p_changes ? 'order_notes' then nullif(p_changes->>'order_notes', '') else order_notes end,
         confirmed_at = case
           when new_status in ('confirmed', 'processing', 'shipped', 'delivered') then coalesce(confirmed_at, now())
           when new_status = 'pending' then null
           else confirmed_at end,
         confirmed_by = case
           when new_status in ('confirmed', 'processing', 'shipped', 'delivered') and confirmed_at is null then p_actor
           when new_status = 'pending' then null
           else confirmed_by end,
         confirmed_by_email = case
           when new_status in ('confirmed', 'processing', 'shipped', 'delivered') and confirmed_at is null then p_actor_email
           when new_status = 'pending' then null
           else confirmed_by_email end,
         delivered_at = case
           when new_status = 'delivered' then coalesce(delivered_at, now())
           when new_status is not null then null
           else delivered_at end,
         returned_at = case
           when new_status = 'returned' then coalesce(returned_at, now())
           when new_status is not null then null
           else returned_at end,
         cancelled_at = case
           when new_status = 'cancelled' then coalesce(cancelled_at, now())
           when new_status is not null then null
           else cancelled_at end,
         updated_at = now()
   where id = p_order_id
  returning * into ord;
  return ord;
end;
$$;
