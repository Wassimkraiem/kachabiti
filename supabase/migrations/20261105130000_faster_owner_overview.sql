-- owner_overview took about 10 seconds on 12,000 orders, and My day, Business overview and
-- Objectives all wait for it. Almost all of it was Postgres compiling the query (JIT): the planner
-- overestimates this query, so it spent 7.6 s compiling what runs in 0.3 s. JIT is now off for this
-- function. The daily chart also re-scanned all orders for each day; each figure is now summed per
-- day once, and line costs are worked out for delivered orders only. The result is unchanged.

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
      'pending_now', (select count(*) from o where o.status in ('pending', 'confirmed')),
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
