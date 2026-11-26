-- "Injoignable" (unreachable): an order whose customer doesn't answer. It is still waiting for
-- confirmation, like "to confirm": its stock stays in, it counts with the orders to confirm, it can be
-- edited, and it can't be validated or sent before the customer confirms.

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'unreachable', 'confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'));


create or replace function private.order_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_from = p_to or case p_from
    when 'pending'    then p_to in ('unreachable', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
    -- Not answering: tried again later, then confirmed or cancelled.
    when 'unreachable' then p_to in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
    when 'confirmed'  then p_to in ('pending', 'unreachable', 'processing', 'shipped', 'delivered', 'cancelled')
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
  if new_status is not null and new_status not in ('pending', 'unreachable', 'confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled') then
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
  elsif new_status in ('pending', 'unreachable', 'confirmed', 'returned', 'cancelled') then
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

create or replace function private.daily_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := coalesce((select value from public.erp_settings where key = 'sales'), '{}'::jsonb);
  pending_hours integer := coalesce((cfg->>'pending_alert_hours')::integer, 24);
  late_days integer := coalesce((cfg->>'late_delivery_days')::integer, 6);
  n integer;
  amount numeric;
  sent integer := 0;
  t record;
begin
  select count(*) into n from public.orders
   where deleted_at is null and status in ('pending', 'unreachable', 'confirmed') and created_at < now() - make_interval(hours => pending_hours);
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients('orders'), 'order', 'orders_waiting', 'warning',
      private.i18n('{count} order(s) waiting for confirmation', '{count} commande(s) en attente de confirmation', '{count} طلب بانتظار التأكيد', jsonb_build_object('count', n)),
      private.i18n('Older than {hours} h', 'Depuis plus de {hours} h', 'منذ أكثر من {hours} ساعة', jsonb_build_object('hours', pending_hours)),
      '/admin/orders?status=pending', '{}'::jsonb);
  end if;

  select count(*) into n from public.orders o
   where o.deleted_at is null and o.status in ('processing', 'shipped')
     and coalesce(o.confirmed_at, o.created_at) < now() - make_interval(days => late_days);
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients('orders'), 'order', 'late_deliveries', 'warning',
      private.i18n('{count} late delivery(ies)', '{count} livraison(s) en retard', '{count} توصيل متأخر', jsonb_build_object('count', n)),
      private.i18n('Sent more than {days} days ago and not delivered', 'Envoyées il y a plus de {days} jours, non livrées', 'أرسلت منذ أكثر من {days} أيام ولم تسلم', jsonb_build_object('days', late_days)),
      '/admin/delivery', '{}'::jsonb);
  end if;

  for t in
    select assigned_to, count(*) as due
      from public.crm_tasks
     where deleted_at is null and done_at is null and assigned_to is not null and due_at < now() + interval '1 day'
     group by assigned_to
  loop
    sent := sent + private.notify(array[t.assigned_to], 'system', 'tasks_due', 'info',
      private.i18n('{count} follow-up(s) due today', '{count} relance(s) à faire aujourd''hui', '{count} متابعة اليوم', jsonb_build_object('count', t.due)),
      null, '/admin/my-work', '{}'::jsonb);
  end loop;

  -- Every morning until it's done. A ticket with nobody (still) on the team goes to its author.
  for t in
    select coalesce(m.user_id, k.created_by) as recipient, count(*) as due
      from public.team_tickets k
      left join public.back_office_users m on m.user_id = k.assigned_to and m.deleted_at is null
     where k.deleted_at is null and k.status <> 'done'
       and k.due_date <= (now() at time zone 'Africa/Tunis')::date
     group by 1
  loop
    sent := sent + private.notify(array[t.recipient], 'system', 'tickets_due', 'warning',
      private.i18n('{count} task(s) overdue or due today', '{count} tâche(s) en retard ou à faire aujourd''hui', '{count} مهمة متأخرة أو مستحقة اليوم', jsonb_build_object('count', t.due)),
      null, '/admin/tickets', '{}'::jsonb);
  end loop;

  select count(*), coalesce(sum(total - paid_amount), 0) into n, amount from public.bills
   where deleted_at is null and status <> 'paid' and due_date <= current_date + 3;
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients('finance'), 'system', 'bills_due', 'warning',
      private.i18n('{count} bill(s) due within 3 days', '{count} facture(s) à payer sous 3 jours', '{count} فاتورة مستحقة خلال 3 أيام', jsonb_build_object('count', n)),
      private.i18n('{amount} TND to pay (overdue included)', '{amount} TND à payer (retards compris)', '{amount} د.ت للدفع (مع المتأخرات)', jsonb_build_object('amount', trim(to_char(amount, 'FM999999990.000')))),
      '/admin/finance/bills', '{}'::jsonb);
  end if;

  select count(*) into n from public.documents where deleted_at is null and expires_on between current_date and current_date + 15;
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients('finance'), 'system', 'documents_expiring', 'info',
      private.i18n('{count} document(s) expire within 15 days', '{count} document(s) expirent sous 15 jours', '{count} وثيقة تنتهي خلال 15 يوما', jsonb_build_object('count', n)),
      null, '/admin/finance/documents', '{}'::jsonb);
  end if;
  return sent;
end;
$$;

create or replace function private.sync_customer_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_id is null or new.deleted_at is not null then
    return null;
  end if;
  if exists (select 1 from public.orders o
              where o.customer_id = new.customer_id and o.deleted_at is null and o.created_at > new.created_at) then
    return null; -- an older order changed; the latest one decides
  end if;
  update public.customers c
     set stage = case new.status
           when 'pending' then 'to_confirm'
    when 'unreachable' then 'to_confirm'
           when 'confirmed' then 'confirmed'
           when 'processing' then 'confirmed'
           when 'shipped' then 'shipped'
           when 'delivered' then 'delivered'
           else 'cancelled'
         end
   where c.id = new.customer_id and c.deleted_at is null;
  return null;
end;
$$;

create or replace function public.agent_performance(p_from timestamptz, p_to timestamptz, p_channel text default null)
returns table (
  agent_id uuid,
  agent_email text,
  agent_role text,
  orders integer,
  revenue numeric,
  confirmed integer,
  delivered integer,
  delivered_revenue numeric,
  paid integer,
  in_progress integer,
  cancelled integer,
  returned integer,
  items integer,
  last_order_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select o.*, coalesce(o.assigned_to, o.created_by) as agent,
           coalesce(o.assigned_to_email, o.created_by_email) as agent_mail,
           (select coalesce(sum(oi.quantity), 0) from public.order_items oi where oi.order_id = o.id) as item_count
      from public.orders o
     where o.deleted_at is null and o.created_at >= p_from and o.created_at < p_to
       and (p_channel is null or o.channel = p_channel)
  )
  select s.agent,
         coalesce(max(s.agent_mail), max(b.email)),
         max(b.role),
         count(*)::integer,
         coalesce(sum(s.total) filter (where s.status not in ('cancelled', 'returned')), 0),
         (count(*) filter (where s.confirmed_at is not null))::integer,
         (count(*) filter (where s.status = 'delivered'))::integer,
         coalesce(sum(s.total) filter (where s.status = 'delivered'), 0),
         (count(*) filter (where s.payment_status = 'paid'))::integer,
         (count(*) filter (where s.status in ('pending', 'unreachable', 'confirmed', 'processing', 'shipped')))::integer,
         (count(*) filter (where s.status = 'cancelled'))::integer,
         (count(*) filter (where s.status = 'returned'))::integer,
         coalesce(sum(s.item_count), 0)::integer,
         max(s.created_at)
    from scoped s
    left join public.back_office_users b on b.user_id = s.agent
   group by s.agent
   order by s.agent is null, count(*) desc;
$$;

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
  if ord.status not in ('pending', 'unreachable', 'confirmed') or ord.stock_deducted then
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

create or replace function public.find_order_duplicates(p_phone text, p_exclude uuid default null, p_days integer default 30)
returns table (id uuid, order_number text, status text, total numeric, created_at timestamptz, channel text,
               customer_first_name text, customer_last_name text)
language sql
stable
set search_path = ''
as $$
  select o.id, o.order_number, o.status, o.total, o.created_at, o.channel, o.customer_first_name, o.customer_last_name
    from public.orders o
   where public.normalize_phone(o.customer_phone) = public.normalize_phone(p_phone)
     and o.deleted_at is null
     and o.id is distinct from p_exclude
     and o.status in ('pending', 'unreachable', 'confirmed', 'processing', 'shipped')
     and o.created_at > now() - make_interval(days => greatest(p_days, 1))
   order by o.created_at desc;
$$;

create or replace function public.owner_overview(p_from timestamptz, p_to timestamptz, p_channel text default null,
                                                 p_agent uuid default null, p_product uuid default null, p_campaign uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
set jit = off
as $$
declare
  cfg jsonb := private.accounting_settings();
  rate numeric := case when coalesce((cfg->>'vat_registered')::boolean, true) then coalesce((cfg->>'sales_vat_rate')::numeric, 19) else 0 end;
  result jsonb;
begin
  with o as (
    select o.*, coalesce(o.assigned_to, o.created_by) as agent
      from public.orders o
     where o.deleted_at is null
       and (p_channel is null or o.channel = p_channel)
       and (p_agent is null or coalesce(o.assigned_to, o.created_by) = p_agent)
       and (p_campaign is null or o.campaign_id = p_campaign)
       and (p_product is null or exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product_id = p_product))
  ), delivered as (
    select o.* from o where o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to
  ), delivered_lines as (
    -- Each line's cost: the product's cost when it was ordered, else its cost now.
    select oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.subtotal,
           coalesce(oi.unit_cost, pc.cost, public.variant_unit_cost(oi.variant_id)) as unit_cost
      from public.order_items oi join delivered d on d.id = oi.order_id
      left join public.product_costs pc on pc.product_id = oi.product_id and pc.deleted_at is null
     where p_product is null or oi.product_id = p_product
  ), finished as (
    select o.* from o
     where (o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to)
        or (o.status = 'returned' and o.returned_at >= p_from and o.returned_at < p_to)
  ), spend as (
    select coalesce(sum(s.amount), 0) as total from public.ad_spend s
     where s.deleted_at is null and s.spend_date >= p_from::date and s.spend_date < p_to::date + 1
       and (p_campaign is null or s.campaign_id = p_campaign)
  ), expenses as (
    select coalesce(sum(b.amount_ht + b.stamp) filter (where b.category not in ('purchase_goods', 'purchase_materials')), 0) as operating,
           coalesce(sum(b.amount_ht + b.stamp) filter (where b.category not in ('purchase_goods', 'purchase_materials') and b.cost_type = 'fixed'), 0) as fixed,
           coalesce(sum(b.amount_ht + b.stamp) filter (where b.category in ('purchase_goods', 'purchase_materials')), 0) as purchases
      from public.bills b
     where b.deleted_at is null and b.bill_date >= p_from::date and b.bill_date < p_to::date + 1
  ), fees as (
    select coalesce(sum(r.fees), 0) as total from public.cod_remittances r
     where r.deleted_at is null and r.received_on >= p_from::date and r.received_on < p_to::date + 1
  ), revenue as (
    select coalesce(case when p_product is null then sum(d.total) else (select sum(subtotal) from delivered_lines) end, 0) as ttc,
           coalesce(case when p_product is null then sum(d.total - d.shipping_cost) else (select sum(subtotal) from delivered_lines) end, 0) as goods,
           count(*) as orders
      from delivered d
  ), cogs as (
    select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) as total,
           count(*) filter (where unit_cost is null) as missing
      from delivered_lines
  ), days as (
    select generate_series(date_trunc('day', p_from), date_trunc('day', p_to - interval '1 second'), interval '1 day')::date as day
  ), created_daily as (
    select o.created_at::date as day, count(*) as n from o group by 1
  ), confirmed_daily as (
    select o.confirmed_at::date as day, count(*) as n from o group by 1
  ), delivered_daily as (
    select x.delivered_at::date as day, count(*) as n, sum(x.total) as revenue from delivered x group by 1
  ), returned_daily as (
    select o.returned_at::date as day, count(*) as n from o where o.status = 'returned' group by 1
  ), collected_daily as (
    select p.received_at::date as day, sum(p.amount) as amount
      from public.order_payments p join o on o.id = p.order_id
     where p.deleted_at is null group by 1
  ), spend_daily as (
    select s.spend_date as day, sum(s.amount) as amount from public.ad_spend s
     where s.deleted_at is null and (p_campaign is null or s.campaign_id = p_campaign) group by 1
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'orders', jsonb_build_object(
      'created', (select count(*) from o where o.created_at >= p_from and o.created_at < p_to),
      'created_value', (select coalesce(sum(total), 0) from o where o.created_at >= p_from and o.created_at < p_to),
      'confirmed', (select count(*) from o where o.confirmed_at >= p_from and o.confirmed_at < p_to),
      'delivered', (select orders from revenue),
      'returned', (select count(*) from o where o.status = 'returned' and o.returned_at >= p_from and o.returned_at < p_to),
      'cancelled', (select count(*) from o where o.status = 'cancelled' and o.cancelled_at >= p_from and o.cancelled_at < p_to),
      'pending_now', (select count(*) from o where o.status in ('pending', 'unreachable', 'confirmed')),
      'in_delivery_now', (select count(*) from o where o.status in ('processing', 'shipped')),
      'finished', (select count(*) from finished)
    ),
    'money', jsonb_build_object(
      'delivered_revenue', (select ttc from revenue),
      'delivered_revenue_ht', round((select goods from revenue) / (1 + rate / 100), 3),
      'cogs', (select total from cogs),
      'missing_cost_lines', (select missing from cogs),
      'gross_margin', round((select goods from revenue) / (1 + rate / 100), 3) - (select total from cogs),
      'ad_spend', (select total from spend),
      'operating_expenses', (select operating from expenses),
      'fixed_expenses', (select fixed from expenses),
      'purchases', (select purchases from expenses),
      'delivery_fees', (select total from fees),
      'net_margin', round((select goods from revenue) / (1 + rate / 100), 3) - (select total from cogs)
                    - (select total from spend) - (select operating from expenses) - (select total from fees),
      'collected', (select coalesce(sum(p.amount), 0) from public.order_payments p join o on o.id = p.order_id
                     where p.deleted_at is null and p.received_at >= p_from and p.received_at < p_to),
      'receivable', (select coalesce(sum(o.total - o.paid_amount), 0) from o where o.status = 'delivered' and o.total > o.paid_amount),
      'cost_per_delivered_sale', case when (select orders from revenue) > 0 then round((select total from spend) / (select orders from revenue), 3) end,
      'vat_rate', rate
    ),
    'treasury', public.treasury_balances() || jsonb_build_object(
      'supplier_debt', (select coalesce(sum(total - paid_amount), 0) from public.bills where deleted_at is null and status <> 'paid'),
      'due_7_days', (select coalesce(sum(total - paid_amount), 0) from public.bills
                      where deleted_at is null and status <> 'paid' and due_date <= current_date + 7),
      'overdue', (select coalesce(sum(total - paid_amount), 0) from public.bills
                   where deleted_at is null and status <> 'paid' and due_date < current_date)
    ),
    'stock', jsonb_build_object(
      'value', (select coalesce(sum(value), 0) from public.stock_valuation()),
      'units', (select coalesce(sum(units), 0) from public.stock_valuation()),
      'materials_value', (select coalesce(round(sum(stock * coalesce(avg_cost, 0)), 3), 0) from public.raw_materials where deleted_at is null),
      'low', (select count(*) from public.product_variants v join public.products p on p.id = v.product_id
               where v.deleted_at is null and p.deleted_at is null and p.stock_tracked and v.stock <= v.reorder_point),
      'out', (select count(*) from public.product_variants v join public.products p on p.id = v.product_id
               where v.deleted_at is null and p.deleted_at is null and p.stock_tracked and v.stock <= 0),
      -- Live products without a purchase cost: their margin can't be computed.
      'products_without_cost', (select count(*) from public.products p
               where p.deleted_at is null and p.status = 'active'
                 and not exists (select 1 from public.product_costs pc where pc.product_id = p.id and pc.deleted_at is null))
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'created', coalesce(cr.n, 0),
        'confirmed', coalesce(co.n, 0),
        'delivered', coalesce(de.n, 0),
        'revenue', coalesce(de.revenue, 0),
        'returned', coalesce(re.n, 0),
        'collected', coalesce(pa.amount, 0),
        'ad_spend', coalesce(sp.amount, 0)
      ) order by d.day), '[]'::jsonb)
        from days d
        left join created_daily cr on cr.day = d.day
        left join confirmed_daily co on co.day = d.day
        left join delivered_daily de on de.day = d.day
        left join returned_daily re on re.day = d.day
        left join collected_daily pa on pa.day = d.day
        left join spend_daily sp on sp.day = d.day
    ),
    'channels', (
      select coalesce(jsonb_agg(c order by c->>'channel'), '[]'::jsonb) from (
        select jsonb_build_object('channel', o.channel,
          'created', count(*) filter (where o.created_at >= p_from and o.created_at < p_to),
          'confirmed', count(*) filter (where o.confirmed_at >= p_from and o.confirmed_at < p_to),
          'delivered', count(*) filter (where o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to),
          'returned', count(*) filter (where o.status = 'returned' and o.returned_at >= p_from and o.returned_at < p_to),
          'revenue', coalesce(sum(o.total) filter (where o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to), 0)
        ) as c
          from o group by o.channel
      ) x
    ),
    'products', (
      select coalesce(jsonb_agg(p order by (p->>'revenue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('product_id', l.product_id, 'name', max(l.product_name),
          'quantity', sum(l.quantity), 'revenue', sum(l.subtotal),
          'cost', sum(l.quantity * coalesce(l.unit_cost, 0)),
          'margin', round(sum(l.subtotal) / (1 + rate / 100), 3) - sum(l.quantity * coalesce(l.unit_cost, 0)),
          'missing_cost', bool_or(l.unit_cost is null)) as p
          from delivered_lines l group by l.product_id
         order by sum(l.subtotal) desc limit 15
      ) x
    ),
    'agents', (
      select coalesce(jsonb_agg(a order by (a->>'delivered_revenue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('agent_id', o.agent,
          'email', coalesce(max(o.assigned_to_email), max(o.created_by_email), max(b.email)),
          'created', count(*) filter (where o.created_at >= p_from and o.created_at < p_to),
          'confirmed', count(*) filter (where o.confirmed_at >= p_from and o.confirmed_at < p_to),
          'delivered', count(*) filter (where o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to),
          'returned', count(*) filter (where o.status = 'returned' and o.returned_at >= p_from and o.returned_at < p_to),
          'delivered_revenue', coalesce(sum(o.total) filter (where o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to), 0)
        ) as a
          from o left join public.back_office_users b on b.user_id = o.agent
         where o.agent is not null
         group by o.agent
      ) x
    ),
    'campaigns', (
      select coalesce(jsonb_agg(c order by (c->>'spend')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('campaign_id', c.id, 'name', c.name, 'platform', c.platform,
          'spend', coalesce((select sum(s.amount) from public.ad_spend s where s.campaign_id = c.id and s.deleted_at is null
                              and s.spend_date >= p_from::date and s.spend_date < p_to::date + 1), 0),
          'orders', (select count(*) from o where o.campaign_id = c.id and o.created_at >= p_from and o.created_at < p_to),
          'delivered', (select count(*) from o where o.campaign_id = c.id and o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to),
          'revenue', (select coalesce(sum(o.total), 0) from o where o.campaign_id = c.id and o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to)
        ) as c
          from public.ad_campaigns c
         where c.deleted_at is null and (p_campaign is null or c.id = p_campaign)
      ) x
    )
  ) into result;
  return result;
end;
$$;
