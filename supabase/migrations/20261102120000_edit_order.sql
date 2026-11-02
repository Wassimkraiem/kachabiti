-- Editing an order after it was taken (Admin → order page): customer, address, products, delivery
-- fee, discount and notes. Only while it is still to confirm or confirmed: once validated it has a
-- Colissimo parcel and has left stock, and the parcel is edited from the delivery card instead.

-- A new phone moves the order to that phone's customer (creating it), like a new order.
create or replace function private.link_order_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(new.customer_phone);
  v_id uuid;
begin
  if tg_op = 'UPDATE' and v_phone is distinct from public.normalize_phone(old.customer_phone) then
    new.customer_id := null;
  end if;
  if new.customer_id is not null or v_phone is null then
    return new;
  end if;
  select id into v_id from public.customers where phone = v_phone and deleted_at is null;
  if v_id is null then
    insert into public.customers (phone, full_name, email, governorate, city, address, channel, stage,
                                  assigned_to, assigned_to_email, user_id, created_by, created_by_email)
    values (v_phone, trim(concat_ws(' ', new.customer_first_name, new.customer_last_name)), new.customer_email,
            new.shipping_state, new.shipping_city, new.shipping_address, new.channel, 'to_confirm',
            new.assigned_to, new.assigned_to_email, new.user_id, new.created_by, new.created_by_email)
    on conflict (phone) where deleted_at is null and phone is not null do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.customers where phone = v_phone and deleted_at is null;
    end if;
  else
    -- Fill in what the customer record is missing.
    update public.customers c
       set email = coalesce(c.email, new.customer_email),
           governorate = coalesce(c.governorate, new.shipping_state),
           city = coalesce(c.city, new.shipping_city),
           address = coalesce(c.address, new.shipping_address),
           user_id = coalesce(c.user_id, new.user_id),
           full_name = case when c.full_name = '' then trim(concat_ws(' ', new.customer_first_name, new.customer_last_name)) else c.full_name end
     where c.id = v_id;
  end if;
  new.customer_id := v_id;
  return new;
end;
$$;

drop trigger if exists orders_link_customer on public.orders;
create trigger orders_link_customer
  before insert or update of customer_phone on public.orders
  for each row execute function private.link_order_customer();

-- p_order: the order columns to change (customer, shipping, amounts, notes). p_items: the new lines
-- (same shape as create_order's), or null to keep them. Order and lines change together or not at all.
create or replace function public.edit_order(p_order_id uuid, p_order jsonb, p_items jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ord public.orders;
begin
  select * into ord from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if ord.status not in ('pending', 'confirmed') or ord.stock_deducted then
    raise exception 'order_not_editable' using errcode = 'P0001';
  end if;

  update public.orders o
     set customer_first_name = coalesce(p_order->>'customer_first_name', o.customer_first_name),
         customer_last_name = coalesce(p_order->>'customer_last_name', o.customer_last_name),
         customer_email = case when p_order ? 'customer_email' then nullif(p_order->>'customer_email', '') else o.customer_email end,
         customer_phone = coalesce(p_order->>'customer_phone', o.customer_phone),
         shipping_address = coalesce(p_order->>'shipping_address', o.shipping_address),
         shipping_city = coalesce(p_order->>'shipping_city', o.shipping_city),
         shipping_state = coalesce(p_order->>'shipping_state', o.shipping_state),
         order_notes = case when p_order ? 'order_notes' then nullif(p_order->>'order_notes', '') else o.order_notes end,
         subtotal = coalesce((p_order->>'subtotal')::numeric, o.subtotal),
         shipping_cost = coalesce((p_order->>'shipping_cost')::numeric, o.shipping_cost),
         discount_amount = coalesce((p_order->>'discount_amount')::numeric, o.discount_amount),
         total = coalesce((p_order->>'total')::numeric, o.total)
   where o.id = p_order_id
   returning * into ord;

  if p_items is not null then
    -- Order lines have no deleted_at: replacing them is the one place lines of a live order go.
    perform set_config('app.purge', 'on', true);
    delete from public.order_items where order_id = p_order_id;
    perform set_config('app.purge', '', true);
    insert into public.order_items (
      order_id, product_id, variant_id, variant_label, product_name, product_name_ar, product_name_fr,
      product_image, quantity, price, subtotal
    )
    select p_order_id, i.product_id, i.variant_id, i.variant_label, i.product_name, i.product_name_ar, i.product_name_fr,
           i.product_image, i.quantity, i.price, i.subtotal
      from jsonb_to_recordset(p_items) as i (
        product_id uuid, variant_id uuid, variant_label text, product_name text, product_name_ar text,
        product_name_fr text, product_image text, quantity integer, price numeric, subtotal numeric
      );
  end if;

  return to_jsonb(ord);
end;
$$;
