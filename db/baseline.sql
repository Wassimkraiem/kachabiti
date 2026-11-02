-- Schema baseline: the whole database as the migrations up to 20261024160000 build it, with the
-- seed rows they insert (chart of accounts, settings, locations, rates) and no business data.
-- api/scripts/migrate.mjs loads it into an empty database (CI, a new server), creating the
-- extensions first; later migrations in supabase/migrations then apply on top.
-- Generated from a fresh migration run with pg_dump 17 (--inserts); do not edit by hand.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA supabase_migrations;


--
-- Name: stock_movement_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_movement_type AS ENUM (
    'sale',
    'restock',
    'adjustment',
    'return',
    'transfer'
);


--
-- Name: accounting_settings(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.accounting_settings() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select value from public.erp_settings where key = 'accounting'), '{}'::jsonb);
$$;


--
-- Name: acct(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.acct(p_key text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(private.accounting_settings()->'accounts'->>p_key,
    case p_key
      when 'customers' then '411' when 'carrier' then '4118' when 'suppliers' then '401'
      when 'cash' then '541' when 'bank' then '532' when 'transfer' then '581'
      when 'sales' then '707' when 'shipping_income' then '708' when 'vat_collected' then '4366'
      when 'vat_deductible' then '4367' when 'stamp' then '4368' when 'delivery_fees' then '6241'
      when 'advertising' then '623' when 'stock' then '37' when 'stock_variation' then '6037'
      when 'materials' then '31' when 'materials_variation' then '6031' when 'owner' then '108'
      when 'loan' then '164' when 'other_income' then '758' when 'other_expense' then '658'
    end);
$$;


--
-- Name: announce_notification(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.announce_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform pg_notify('notifications', json_build_object('id', new.id, 'recipient_id', new.recipient_id, 'op', lower(tg_op))::text);
  return null;
end;
$$;


--
-- Name: apply_material_movement(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.apply_material_movement() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  m public.raw_materials;
begin
  select * into m from public.raw_materials where id = new.material_id for update;
  if not found then
    raise exception 'material_not_found';
  end if;
  if m.stock + new.quantity < 0 then
    raise exception 'insufficient_material:%:%', m.name, m.stock using errcode = 'P0001';
  end if;
  if new.type = 'purchase' and new.unit_cost is not null then
    update public.raw_materials
       set stock = m.stock + new.quantity,
           avg_cost = case when m.avg_cost is null or m.stock <= 0 then new.unit_cost
                           else round((m.stock * m.avg_cost + new.quantity * new.unit_cost) / (m.stock + new.quantity), 4) end
     where id = m.id;
  else
    new.unit_cost := coalesce(new.unit_cost, m.avg_cost);
    update public.raw_materials set stock = m.stock + new.quantity where id = m.id;
  end if;
  return new;
end;
$$;


--
-- Name: apply_stock_movement(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.apply_stock_movement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_available integer;
  online boolean;
begin
  if new.variant_id is null then
    raise exception 'variant_id is required';
  end if;

  select v.sku, p.name
    into new.sku, new.product_name
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = new.variant_id;

  insert into public.inventory_levels (variant_id, location_id)
  values (new.variant_id, new.location_id)
  on conflict (variant_id, location_id) do nothing;

  select available into current_available
    from public.inventory_levels
   where variant_id = new.variant_id and location_id = new.location_id
   for update;

  if current_available + new.quantity < 0 then
    -- Parsed by the admin API into a readable message.
    raise exception 'insufficient_stock:%:%', coalesce(nullif(new.sku, ''), new.variant_id::text), current_available
      using errcode = 'P0001';
  end if;

  update public.inventory_levels
     set available = current_available + new.quantity,
         updated_at = now()
   where variant_id = new.variant_id and location_id = new.location_id;

  select sells_online into online from public.locations where id = new.location_id;
  if online then
    update public.product_variants
       set stock = current_available + new.quantity
     where id = new.variant_id;
  end if;

  return new;
end;
$$;


--
-- Name: bill_category_account(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.bill_category_account(p_category text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case p_category
    when 'purchase_goods' then '607' when 'purchase_materials' then '601' when 'rent' then '613'
    when 'salaries' then '640' when 'social_charges' then '647' when 'utilities' then '6061'
    when 'packaging' then '6068' when 'delivery' then '6241' when 'transport' then '624'
    when 'telecom' then '626' when 'bank_fees' then '627' when 'insurance' then '616'
    when 'maintenance' then '615' when 'fees' then '622' when 'taxes' then '66' else '628'
  end;
$$;


--
-- Name: bill_status(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.bill_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.status := case when new.paid_amount >= (new.amount_ht + new.vat_amount + new.stamp) - 0.0005 and (new.amount_ht + new.vat_amount + new.stamp) > 0 then 'paid'
                     when new.paid_amount > 0 then 'partial' else 'unpaid' end;
  return new;
end;
$$;


--
-- Name: book(text, date, text, text, uuid, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book(p_journal text, p_date date, p_label text, p_source_type text, p_source_id uuid, p_event text, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cfg jsonb := private.accounting_settings();
  actor jsonb := private.request_actor();
  e uuid;
  d numeric;
  c numeric;
  lines jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, true) then
    return null;
  end if;
  if p_date < coalesce(nullif(cfg->>'start_date', '')::date, '1900-01-01'::date) then
    return null;
  end if;
  if exists (select 1 from public.journal_entries
              where source_type = p_source_type and source_id = p_source_id and source_event = p_event
                and deleted_at is null and reversed_at is null and reversal_of is null) then
    return null;
  end if;

  -- Normalized lines: one side each, rounded, zero lines dropped.
  select coalesce(jsonb_agg(n order by (n->>'pos')::integer), '[]'::jsonb) into lines
    from (
      select jsonb_build_object(
               'account', l->>'account', 'label', coalesce(nullif(l->>'label', ''), p_label),
               'debit', greatest(round(coalesce((l->>'debit')::numeric, 0) - coalesce((l->>'credit')::numeric, 0), 3), 0),
               'credit', greatest(round(coalesce((l->>'credit')::numeric, 0) - coalesce((l->>'debit')::numeric, 0), 3), 0),
               'partner_type', nullif(l->>'partner_type', ''), 'partner_id', nullif(l->>'partner_id', ''),
               'partner_name', nullif(l->>'partner_name', ''), 'pos', ord) as n
        from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
    ) s
   where (n->>'debit')::numeric <> 0 or (n->>'credit')::numeric <> 0;
  select coalesce(sum((l->>'debit')::numeric), 0), coalesce(sum((l->>'credit')::numeric), 0) into d, c
    from jsonb_array_elements(lines) l;
  if d = 0 then
    return null;
  end if;
  if d <> c then
    raise exception 'unbalanced_entry:% (% / %)', p_label, d, c using errcode = 'P0001';
  end if;

  insert into public.journal_entries (journal, entry_date, label, source_type, source_id, source_event, created_by, created_by_email)
  values (p_journal, p_date, left(p_label, 300), p_source_type, p_source_id, p_event,
          nullif(actor->>'id', '')::uuid, actor->>'email')
  returning id into e;
  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select e, l.account, left(l.label, 300), l.debit, l.credit, l.partner_type, l.partner_id, l.partner_name, l.pos
    from jsonb_to_recordset(lines) as l (account text, label text, debit numeric, credit numeric, partner_type text,
                                         partner_id uuid, partner_name text, pos integer);

  if coalesce((cfg->>'auto_post')::boolean, false) then
    perform public.post_journal_entries(array[e], nullif(actor->>'id', '')::uuid, actor->>'email');
  end if;
  return e;
end;
$$;


--
-- Name: book_ad_spend(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_ad_spend() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  campaign text;
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook('ad_spend', new.id, 'booked');
    return null;
  end if;
  if tg_op <> 'INSERT' then
    return null;
  end if;
  select name into campaign from public.ad_campaigns where id = new.campaign_id;
  perform private.book(case new.account when 'cash' then 'CA' when 'bank' then 'BQ' else 'OD' end, new.spend_date,
    'Ads' || coalesce(' – ' || campaign, ''), 'ad_spend', new.id, 'booked', jsonb_build_array(
      jsonb_build_object('account', private.acct('advertising'), 'debit', new.amount),
      jsonb_build_object('account', case new.account when 'payable' then private.acct('suppliers') else private.acct(new.account) end,
                         'credit', new.amount)
    ));
  return null;
end;
$$;


--
-- Name: book_bill(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_bill() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  who text;
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      perform private.unbook('bill', new.id, 'booked');
      return null;
    end if;
    if (old.amount_ht, old.vat_amount, old.stamp, old.account_code, old.bill_date, old.supplier_id)
       is not distinct from (new.amount_ht, new.vat_amount, new.stamp, new.account_code, new.bill_date, new.supplier_id) then
      return null;
    end if;
    perform private.unbook('bill', new.id, 'booked', new.bill_date);
  end if;
  if new.deleted_at is not null then
    return null;
  end if;
  select coalesce((select name from public.suppliers where id = new.supplier_id), new.payee, '') into who;
  perform private.book('AC', new.bill_date,
    'Bill ' || coalesce(new.supplier_reference, new.number) || case when who <> '' then ' – ' || who else '' end,
    'bill', new.id, 'booked', jsonb_build_array(
      jsonb_build_object('account', new.account_code, 'debit', new.amount_ht + new.stamp),
      jsonb_build_object('account', private.acct('vat_deductible'), 'debit', new.vat_amount),
      jsonb_build_object('account', private.acct('suppliers'), 'credit', new.amount_ht + new.vat_amount + new.stamp,
                         'partner_type', 'supplier', 'partner_id', new.supplier_id, 'partner_name', nullif(who, ''))
    ));
  return null;
end;
$$;


--
-- Name: book_bill_payment(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_bill_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  b public.bills;
  who text;
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook('bill_payment', new.id, 'paid');
    return null;
  end if;
  if tg_op <> 'INSERT' then
    return null;
  end if;
  select * into b from public.bills where id = new.bill_id;
  select coalesce((select name from public.suppliers where id = b.supplier_id), b.payee, '') into who;
  perform private.book(case new.account when 'cash' then 'CA' else 'BQ' end, new.paid_on,
    'Paid ' || coalesce(b.supplier_reference, b.number) || case when who <> '' then ' – ' || who else '' end,
    'bill_payment', new.id, 'paid', jsonb_build_array(
      jsonb_build_object('account', private.acct('suppliers'), 'debit', new.amount, 'partner_type', 'supplier',
                         'partner_id', b.supplier_id, 'partner_name', nullif(who, '')),
      jsonb_build_object('account', private.acct(new.account), 'credit', new.amount)
    ));
  return null;
end;
$$;


--
-- Name: book_invoice_stamp(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_invoice_stamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.stamp = 0 then
    return null;
  end if;
  perform private.book('OD', new.invoice_date, 'Stamp duty ' || new.number, 'sales_invoice', new.id, 'stamp', jsonb_build_array(
    jsonb_build_object('account', private.acct('customers'), 'debit', new.stamp, 'partner_type', 'customer', 'partner_name', new.customer_name),
    jsonb_build_object('account', private.acct('stamp'), 'credit', new.stamp)
  ));
  return null;
end;
$$;


--
-- Name: book_order(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cfg jsonb := private.accounting_settings();
  rate numeric := case when coalesce((cfg->>'vat_registered')::boolean, true) then coalesce((cfg->>'sales_vat_rate')::numeric, 19) else 0 end;
  goods numeric;
  goods_ht numeric;
  ship_ht numeric;
  who text := trim(concat_ws(' ', new.customer_first_name, new.customer_last_name));
begin
  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status is distinct from 'delivered') and new.deleted_at is null then
    goods := new.total - new.shipping_cost;
    goods_ht := round(goods / (1 + rate / 100), 3);
    ship_ht := round(new.shipping_cost / (1 + rate / 100), 3);
    perform private.book('VT', coalesce(new.delivered_at, now())::date, 'Sale ' || new.order_number || ' – ' || who,
      'order', new.id, 'delivered', jsonb_build_array(
        jsonb_build_object('account', private.acct('customers'), 'debit', new.total, 'partner_type', 'customer',
                           'partner_id', new.customer_id, 'partner_name', who),
        jsonb_build_object('account', private.acct('sales'), 'credit', goods_ht),
        jsonb_build_object('account', private.acct('shipping_income'), 'credit', ship_ht),
        jsonb_build_object('account', private.acct('vat_collected'), 'credit', new.total - goods_ht - ship_ht)
      ));
  elsif tg_op = 'UPDATE' and old.status = 'delivered' and new.status is distinct from 'delivered' then
    perform private.unbook('order', new.id, 'delivered');
  end if;
  return null;
end;
$$;


--
-- Name: book_order_payment(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_order_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  ord public.orders;
  who text;
  treasury text := private.acct(new.account);
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook('order_payment', new.id, 'received');
    return null;
  end if;
  if tg_op <> 'INSERT' or new.deleted_at is not null then
    return null;
  end if;
  select * into ord from public.orders where id = new.order_id;
  who := trim(concat_ws(' ', ord.customer_first_name, ord.customer_last_name));
  perform private.book(case new.account when 'cash' then 'CA' when 'bank' then 'BQ' else 'OD' end,
    new.received_at::date,
    case when new.amount < 0 then 'Refund ' else 'Payment ' end || ord.order_number || ' – ' || who,
    'order_payment', new.id, 'received', jsonb_build_array(
      jsonb_build_object('account', treasury, 'debit', new.amount,
                         'partner_type', case when new.account = 'carrier' then 'carrier' end,
                         'partner_name', case when new.account = 'carrier' then 'Colissimo' end),
      jsonb_build_object('account', private.acct('customers'), 'credit', new.amount, 'partner_type', 'customer',
                         'partner_id', ord.customer_id, 'partner_name', who)
    ));
  return null;
end;
$$;


--
-- Name: book_remittance(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_remittance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook('cod_remittance', new.id, 'received');
    return null;
  end if;
  if tg_op <> 'INSERT' then
    return null;
  end if;
  perform private.book(case new.account when 'cash' then 'CA' else 'BQ' end, new.received_on,
    'Payout ' || new.provider || coalesce(' ' || new.reference, ''), 'cod_remittance', new.id, 'received', jsonb_build_array(
      jsonb_build_object('account', private.acct(new.account), 'debit', new.net_amount),
      jsonb_build_object('account', private.acct('delivery_fees'), 'debit', new.fees),
      jsonb_build_object('account', private.acct('carrier'), 'credit', new.gross_amount, 'partner_type', 'carrier', 'partner_name', new.provider)
    ));
  return null;
end;
$$;


--
-- Name: book_treasury_movement(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.book_treasury_movement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  other text;
  signed numeric;
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook('treasury_movement', new.id, 'booked');
    return null;
  end if;
  if tg_op <> 'INSERT' then
    return null;
  end if;
  other := case new.category
    when 'opening_balance' then private.acct('owner')
    when 'owner_contribution' then private.acct('owner')
    when 'owner_withdrawal' then private.acct('owner')
    when 'transfer' then private.acct('transfer')
    when 'loan' then private.acct('loan')
    when 'loan_repayment' then private.acct('loan')
    when 'other_income' then private.acct('other_income')
    when 'other_expense' then private.acct('other_expense')
    else case when new.direction = 'in' then private.acct('other_income') else private.acct('other_expense') end
  end;
  signed := case when new.direction = 'in' then new.amount else -new.amount end;
  perform private.book(case new.account when 'cash' then 'CA' else 'BQ' end, new.occurred_on,
    coalesce(nullif(new.label, ''), new.category), 'treasury_movement', new.id, 'booked', jsonb_build_array(
      jsonb_build_object('account', private.acct(new.account), 'debit', signed),
      jsonb_build_object('account', other, 'credit', signed)
    ));
  return null;
end;
$$;


--
-- Name: daily_alerts(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.daily_alerts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
   where deleted_at is null and status in ('pending', 'confirmed') and created_at < now() - make_interval(hours => pending_hours);
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


--
-- Name: entity_names(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.entity_names(p_entity text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case p_entity
    when 'products' then '{"en":"product","fr":"produit","ar":"منتج"}'
    when 'product_variants' then '{"en":"variant","fr":"variante","ar":"متغير"}'
    when 'product_images' then '{"en":"product photo","fr":"photo produit","ar":"صورة منتج"}'
    when 'categories' then '{"en":"category","fr":"catégorie","ar":"فئة"}'
    when 'colors' then '{"en":"color","fr":"couleur","ar":"لون"}'
    when 'sizes' then '{"en":"size","fr":"taille","ar":"مقاس"}'
    when 'product_discounts' then '{"en":"product discount","fr":"remise produit","ar":"تخفيض منتج"}'
    when 'promotions' then '{"en":"sale banner","fr":"bannière promo","ar":"لافتة تخفيض"}'
    when 'reels' then '{"en":"video reel","fr":"vidéo","ar":"فيديو"}'
    when 'orders' then '{"en":"order","fr":"commande","ar":"طلب"}'
    when 'locations' then '{"en":"stock location","fr":"emplacement","ar":"موقع مخزون"}'
    when 'suppliers' then '{"en":"supplier","fr":"fournisseur","ar":"مورّد"}'
    when 'collections' then '{"en":"collection","fr":"collection","ar":"مجموعة"}'
    when 'product_costs' then '{"en":"purchase cost","fr":"coût d''achat","ar":"تكلفة شراء"}'
    when 'landing_products' then '{"en":"home page pick","fr":"choix page d''accueil","ar":"اختيار الصفحة الرئيسية"}'
    when 'site_settings' then '{"en":"setting","fr":"réglage","ar":"إعداد"}'
    when 'erp_settings' then '{"en":"business setting","fr":"réglage de gestion","ar":"إعداد إداري"}'
    when 'shipping_rates' then '{"en":"shipping rate","fr":"tarif de livraison","ar":"سعر شحن"}'
    when 'country_tax_rates' then '{"en":"tax rate","fr":"taux de taxe","ar":"نسبة ضريبة"}'
    when 'reviews' then '{"en":"review","fr":"avis","ar":"تقييم"}'
    when 'team_member' then '{"en":"team account","fr":"compte d''équipe","ar":"حساب فريق"}'
    when 'customers' then '{"en":"customer","fr":"client","ar":"عميل"}'
    when 'customer_interactions' then '{"en":"conversation note","fr":"échange client","ar":"محادثة"}'
    when 'crm_tasks' then '{"en":"follow-up","fr":"relance","ar":"متابعة"}'
    when 'order_payments' then '{"en":"payment","fr":"encaissement","ar":"دفعة"}'
    when 'cod_remittances' then '{"en":"carrier payout","fr":"versement transporteur","ar":"تحويل شركة التوصيل"}'
    when 'treasury_movements' then '{"en":"cash/bank movement","fr":"mouvement de trésorerie","ar":"حركة خزينة"}'
    when 'ad_campaigns' then '{"en":"campaign","fr":"campagne","ar":"حملة"}'
    when 'ad_spend' then '{"en":"ad spend","fr":"dépense publicitaire","ar":"مصروف إشهار"}'
    when 'agent_goals' then '{"en":"objective","fr":"objectif","ar":"هدف"}'
    when 'business_goals' then '{"en":"monthly goal","fr":"objectif du mois","ar":"هدف الشهر"}'
    when 'raw_materials' then '{"en":"raw material","fr":"matière première","ar":"مادة أولية"}'
    when 'purchase_orders' then '{"en":"purchase order","fr":"commande d''achat","ar":"طلب شراء"}'
    when 'purchase_receipts' then '{"en":"goods receipt","fr":"réception","ar":"استلام"}'
    when 'pos_sessions' then '{"en":"till session","fr":"session de caisse","ar":"جلسة صندوق"}'
    when 'bills' then '{"en":"bill","fr":"facture fournisseur","ar":"فاتورة مورد"}'
    when 'bill_payments' then '{"en":"bill payment","fr":"règlement fournisseur","ar":"دفع فاتورة"}'
    when 'sales_invoices' then '{"en":"invoice","fr":"facture","ar":"فاتورة"}'
    when 'journal_entries' then '{"en":"journal entry","fr":"écriture","ar":"قيد محاسبي"}'
    when 'accounts' then '{"en":"account","fr":"compte","ar":"حساب"}'
    when 'documents' then '{"en":"document","fr":"document","ar":"وثيقة"}'
    else jsonb_build_object('en', p_entity, 'fr', p_entity, 'ar', p_entity)::text
  end::jsonb;
$$;


--
-- Name: fill_order_item_costs(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.fill_order_item_costs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.deleted_at is null and new.cost is not null then
    update public.order_items set unit_cost = new.cost
     where product_id = new.product_id and unit_cost is null;
  end if;
  return null;
end;
$$;


--
-- Name: i18n(text, text, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.i18n(p_en text, p_fr text, p_ar text, p_values jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  k text;
  v text;
  en text := p_en;
  fr text := p_fr;
  ar text := p_ar;
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_values, '{}'::jsonb)) loop
    en := replace(en, '{' || k || '}', coalesce(v, ''));
    fr := replace(fr, '{' || k || '}', coalesce(v, ''));
    ar := replace(ar, '{' || k || '}', coalesce(v, ''));
  end loop;
  return jsonb_build_object('en', en, 'fr', fr, 'ar', ar);
end;
$$;


--
-- Name: link_order_customer(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.link_order_customer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_phone text := public.normalize_phone(new.customer_phone);
  v_id uuid;
begin
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


--
-- Name: log_activity(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.log_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  headers jsonb := private.trusted_request_headers();
  v_actor uuid;
  v_source text := 'admin';
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_changes jsonb;
  v_action text;
begin
  if headers is null then
    v_source := 'database';
  else
    begin
      v_actor := nullif(headers->>'x-actor-id', '')::uuid;
    exception when others then
      v_actor := null;
    end;
    if v_actor is null then
      return null;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'create';
    v_changes := v_new;
  else
    v_old := to_jsonb(old);
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_changes
      from jsonb_each(v_new) n
      join jsonb_each(v_old) o using (key)
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'search_text', 'search_name');
    if v_changes is null then
      return null;
    end if;
    v_action := case
      when v_old->>'deleted_at' is null and v_new->>'deleted_at' is not null then 'delete'
      when v_old->>'deleted_at' is not null and v_new->>'deleted_at' is null then 'restore'
      else 'update'
    end;
  end if;

  insert into public.activity_log (actor_id, actor_email, actor_role, source, action, entity, entity_id, label, changes)
  values (
    v_actor,
    nullif(headers->>'x-actor-email', ''),
    nullif(headers->>'x-actor-role', ''),
    v_source,
    v_action,
    tg_table_name,
    coalesce(v_new->>'id', v_new->>'product_id', v_new->>'setting_key'),
    coalesce(v_new->>'order_number', v_new->>'name', v_new->>'title', v_new->>'sku', v_new->>'setting_key',
             v_new->>'product_name', v_new->>'section'),
    v_changes
  );
  return null;
end;
$$;


--
-- Name: next_number(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.next_number(p_key text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  n integer;
begin
  insert into public.document_counters (key, value) values (p_key, 1)
  on conflict (key) do update set value = public.document_counters.value + 1
  returning value into n;
  return n;
end;
$$;


--
-- Name: notification_recipients(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notification_recipients(p_audience text) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
           else false
         end;
$$;


--
-- Name: notify(uuid[], text, text, text, jsonb, jsonb, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify(p_recipients uuid[], p_kind text, p_type text, p_severity text, p_title jsonb, p_body jsonb, p_url text, p_data jsonb DEFAULT '{}'::jsonb) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with inserted as (
    insert into public.notifications (recipient_id, kind, type, severity, title, body, url, data)
    select distinct r, p_kind, p_type, p_severity, p_title, p_body, p_url, coalesce(p_data, '{}'::jsonb)
      from unnest(p_recipients) as r
     where r is not null
    returning 1
  )
  select count(*)::integer from inserted;
$$;


--
-- Name: notify_customer_message(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify_customer_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  c public.customers;
  vals jsonb;
begin
  if new.direction <> 'in' then
    return null;
  end if;
  select * into c from public.customers where id = new.customer_id;
  vals := jsonb_build_object('name', coalesce(nullif(c.full_name, ''), new.sender_name, c.phone, '?'), 'channel', initcap(new.channel),
                             'text', left(new.body, 120));
  perform private.notify(
    case when c.assigned_to is not null then array[c.assigned_to] else private.notification_recipients('customers') end,
    'order', 'customer_message', 'info',
    private.i18n('{channel} message from {name}', 'Message {channel} de {name}', 'رسالة {channel} من {name}', vals),
    private.i18n('{text}', '{text}', '{text}', vals),
    '/admin/customers/' || new.customer_id,
    jsonb_build_object('customer_id', new.customer_id)
  );
  return null;
end;
$$;


--
-- Name: notify_low_stock(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify_low_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v record;
  vals jsonb;
begin
  select pv.reorder_point, pv.sku, p.name, p.id as product_id, p.stock_tracked, l.name as location
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.locations l on l.id = new.location_id
   where pv.id = new.variant_id and pv.deleted_at is null and p.deleted_at is null;
  if not found or not v.stock_tracked then
    return null;
  end if;
  if new.available <= v.reorder_point and old.available > v.reorder_point then
    vals := jsonb_build_object('name', v.name, 'sku', coalesce(v.sku, ''), 'left', new.available, 'location', v.location);
    perform private.notify(
      private.notification_recipients('stock'),
      'system', 'low_stock', case when new.available = 0 then 'warning' else 'info' end,
      private.i18n('Low stock: {name}', 'Stock bas : {name}', 'مخزون منخفض: {name}', vals),
      private.i18n('{sku} · {left} left at {location}', '{sku} · plus que {left} à {location}', '{sku} · بقي {left} في {location}', vals),
      '/admin/stock?search=' || coalesce(v.sku, ''),
      jsonb_build_object('variant_id', new.variant_id, 'product_id', v.product_id)
    );
  end if;
  return null;
end;
$$;


--
-- Name: notify_new_order(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify_new_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  items integer;
  vals jsonb;
  recipients uuid[];
begin
  if new.channel = 'store' then
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


--
-- Name: on_online_location_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.on_online_location_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.sync_online_stock(null);
  return null;
end;
$$;


--
-- Name: on_order_payment_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.on_order_payment_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.refresh_order_paid(new.order_id);
  if tg_op = 'UPDATE' and old.order_id <> new.order_id then
    perform private.refresh_order_paid(old.order_id);
  end if;
  return null;
end;
$$;


--
-- Name: on_product_tracking_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.on_product_tracking_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.stock_tracked and not old.stock_tracked then
    perform private.sync_online_stock(array[new.id]);
  end if;
  return new;
end;
$$;


--
-- Name: owner_alerts(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_alerts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  owners uuid[];
  who text := coalesce(nullif(new.actor_email, ''), 'Someone');
  what jsonb := private.entity_names(new.entity);
  item text := coalesce(nullif(new.label, ''), new.entity_id, '');
  url text := '/admin/activity?actor=' || coalesce(new.actor_id::text, '');
  vals jsonb;
  ch jsonb := coalesce(new.changes, '{}'::jsonb);
  old_price numeric;
  new_price numeric;
  pct numeric;
  qty integer;
  recent integer;
  existing bigint;
begin
  -- The owner's own actions, and direct database edits (migrations, SQL editor), don't alert.
  if new.source <> 'admin' or new.actor_role = 'owner' or new.actor_id is null then
    return null;
  end if;

  owners := private.notification_recipients('owner');
  if cardinality(owners) = 0 then
    return null;
  end if;

  vals := jsonb_build_object('who', who, 'item', item,
    'what_en', what->>'en', 'what_fr', what->>'fr', 'what_ar', what->>'ar');

  -- Deletes (soft): one alert per person every 10 minutes, counting further deletes into it.
  if new.action = 'delete' then
    select n.id into existing
      from public.notifications n
     where n.kind = 'security' and n.type = 'delete' and n.recipient_id = owners[1]
       and n.data->>'actor_id' = new.actor_id::text
       and n.created_at > now() - interval '10 minutes' and n.deleted_at is null
     order by n.created_at desc
     limit 1;

    if existing is not null then
      select count(*) into recent
        from public.activity_log a
       where a.actor_id = new.actor_id and a.action = 'delete' and a.created_at > now() - interval '10 minutes';
      update public.notifications n
         set title = private.i18n('{who} deleted {count} items', '{who} a supprimé {count} éléments', '{who} حذف {count} عناصر',
                                  vals || jsonb_build_object('count', recent)),
             body = private.i18n('Latest: {what_en} “{item}”', 'Dernier : {what_fr} « {item} »', 'آخرها: {what_ar} «{item}»', vals),
             data = n.data || jsonb_build_object('count', recent),
             read_at = null
       where n.kind = 'security' and n.type = 'delete' and n.recipient_id = any (owners)
         and n.data->>'actor_id' = new.actor_id::text
         and n.created_at > now() - interval '10 minutes' and n.deleted_at is null;

      -- Many deletes in a short time: a separate, critical alert (sent once per threshold).
      if recent in (10, 25, 50, 100, 250) then
        perform private.notify(owners, 'security', 'bulk_delete', 'critical',
          private.i18n('{who} deleted {count} items in 10 minutes', '{who} a supprimé {count} éléments en 10 minutes',
                       '{who} حذف {count} عنصراً خلال 10 دقائق', vals || jsonb_build_object('count', recent)),
          private.i18n('Check the activity history. Deleted items can be restored from Deleted items.',
                       'Vérifiez l''historique. Les éléments supprimés peuvent être restaurés depuis Éléments supprimés.',
                       'راجع سجل النشاط. يمكن استعادة العناصر المحذوفة من صفحة العناصر المحذوفة.', vals),
          url, jsonb_build_object('actor_id', new.actor_id, 'count', recent));
      end if;
      return null;
    end if;

    perform private.notify(owners, 'security', 'delete', 'warning',
      private.i18n('{who} deleted a {what_en}', '{who} a supprimé : {what_fr}', '{who} حذف {what_ar}', vals),
      private.i18n('“{item}”', '« {item} »', '«{item}»', vals),
      url, jsonb_build_object('actor_id', new.actor_id, 'entity', new.entity, 'entity_id', new.entity_id, 'count', 1));
    return null;
  end if;

  -- Permanent erase.
  if new.action = 'purge' then
    perform private.notify(owners, 'security', 'purge', 'critical',
      private.i18n('{who} permanently erased a {what_en}', '{who} a effacé définitivement : {what_fr}', '{who} حذف نهائياً {what_ar}', vals),
      private.i18n('“{item}” can no longer be restored.', '« {item} » ne peut plus être restauré.', 'لم يعد بالإمكان استعادة «{item}».', vals),
      url, jsonb_build_object('actor_id', new.actor_id, 'entity', new.entity, 'entity_id', new.entity_id));
    return null;
  end if;

  -- Blocked attempt (logged by middleware): once per person and target per hour.
  if new.action = 'access_denied' then
    if exists (
      select 1 from public.notifications n
       where n.kind = 'security' and n.type = 'access_denied' and n.recipient_id = owners[1]
         and n.data->>'actor_id' = new.actor_id::text and n.data->>'target' = item
         and n.created_at > now() - interval '1 hour'
    ) then
      return null;
    end if;
    perform private.notify(owners, 'security', 'access_denied', 'warning',
      private.i18n('{who} tried something they are not allowed to do', '{who} a tenté une action non autorisée', '{who} حاول القيام بعملية غير مسموح بها', vals),
      private.i18n('Blocked: {item}', 'Bloqué : {item}', 'تم الحظر: {item}', vals),
      url, jsonb_build_object('actor_id', new.actor_id, 'target', item));
    return null;
  end if;

  -- Team and access changes.
  if new.entity = 'team_member' then
    perform private.notify(owners, 'security', 'team_' || new.action,
      case when new.action in ('delete', 'remove_access') then 'warning' else 'info' end,
      case new.action
        when 'create' then private.i18n('{who} added {item} to the team', '{who} a ajouté {item} à l''équipe', '{who} أضاف {item} إلى الفريق', vals)
        when 'delete' then private.i18n('{who} deleted the account of {item}', '{who} a supprimé le compte de {item}', '{who} حذف حساب {item}', vals)
        when 'remove_access' then private.i18n('{who} removed the access of {item}', '{who} a retiré l''accès de {item}', '{who} أزال صلاحيات {item}', vals)
        else private.i18n('{who} changed the role or permissions of {item}', '{who} a modifié le rôle ou les permissions de {item}', '{who} غيّر دور أو صلاحيات {item}', vals)
      end,
      private.i18n('Role: {role}', 'Rôle : {role}', 'الدور: {role}',
        jsonb_build_object('role', coalesce(ch #>> '{role,to}', ch->>'role', '—'))),
      url, jsonb_build_object('actor_id', new.actor_id, 'member', new.entity_id));
    return null;
  end if;

  -- Price cut by half or more (product base price or a variant's own price).
  if new.action = 'update' and new.entity in ('products', 'product_variants') then
    begin
      old_price := coalesce(ch #>> '{base_price,from}', ch #>> '{price,from}')::numeric;
      new_price := coalesce(ch #>> '{base_price,to}', ch #>> '{price,to}')::numeric;
    exception when others then
      old_price := null;
    end;
    if old_price is not null and old_price > 0 and new_price is not null and new_price <= old_price * 0.5 then
      pct := round((1 - new_price / old_price) * 100);
      perform private.notify(owners, 'security', 'price_cut', 'warning',
        private.i18n('{who} cut a price by {pct}%', '{who} a baissé un prix de {pct} %', '{who} خفّض سعراً بنسبة {pct}%', vals || jsonb_build_object('pct', pct)),
        private.i18n('{item}: {from} → {to} TND', '{item} : {from} → {to} TND', '{item}: {from} ← {to} د.ت',
          vals || jsonb_build_object('from', old_price, 'to', new_price)),
        url, jsonb_build_object('actor_id', new.actor_id, 'entity', new.entity, 'entity_id', new.entity_id));
    end if;
    return null;
  end if;

  -- Discount of 50% or more.
  if new.entity = 'product_discounts' and new.action in ('create', 'update') then
    begin
      pct := coalesce(ch #>> '{discount_percent,to}', ch->>'discount_percent')::numeric;
    exception when others then
      pct := null;
    end;
    if pct is not null and pct >= 50 then
      select p.name into item
        from public.products p
       where p.id = coalesce(ch #>> '{product_id,to}', ch->>'product_id',
                             (select d.product_id::text from public.product_discounts d where d.id::text = new.entity_id))::uuid;
      perform private.notify(owners, 'security', 'big_discount', 'warning',
        private.i18n('{who} set a {pct}% discount', '{who} a mis une remise de {pct} %', '{who} وضع تخفيضاً بنسبة {pct}%', vals || jsonb_build_object('pct', pct)),
        private.i18n('{item}', '{item}', '{item}', jsonb_build_object('item', coalesce(item, '—'))),
        url, jsonb_build_object('actor_id', new.actor_id, 'entity_id', new.entity_id));
    end if;
    return null;
  end if;

  -- Large manual stock adjustment (20 units or more at once).
  if new.entity = 'stock_movements' and new.action = 'create' and ch->>'type' = 'adjustment' then
    begin
      qty := (ch->>'quantity')::integer;
    exception when others then
      qty := null;
    end;
    if qty is not null and abs(qty) >= 20 then
      perform private.notify(owners, 'security', 'stock_adjustment', 'warning',
        private.i18n('{who} adjusted stock by {qty}', '{who} a ajusté le stock de {qty}', '{who} عدّل المخزون بمقدار {qty}', vals || jsonb_build_object('qty', qty)),
        private.i18n('{item}', '{item}', '{item}', jsonb_build_object('item', coalesce(ch->>'product_name', ch->>'sku', item))),
        url, jsonb_build_object('actor_id', new.actor_id, 'entity_id', new.entity_id));
    end if;
    return null;
  end if;

  -- Cancelled or refunded orders.
  if new.entity = 'orders' and new.action = 'update' then
    if ch #>> '{payment_status,to}' = 'refunded' or ch #>> '{status,to}' = 'cancelled' then
      perform private.notify(owners, 'security',
        case when ch #>> '{payment_status,to}' = 'refunded' then 'order_refunded' else 'order_cancelled' end, 'info',
        case when ch #>> '{payment_status,to}' = 'refunded'
          then private.i18n('{who} marked order {item} refunded', '{who} a marqué la commande {item} remboursée', '{who} سجّل الطلب {item} كمسترد', vals)
          else private.i18n('{who} cancelled order {item}', '{who} a annulé la commande {item}', '{who} ألغى الطلب {item}', vals)
        end,
        null, '/admin/orders/' || new.entity_id, jsonb_build_object('actor_id', new.actor_id, 'order_id', new.entity_id));
    end if;
    return null;
  end if;

  -- Shop settings (prices, shipping, taxes, home page config).
  if new.entity in ('site_settings', 'shipping_rates', 'country_tax_rates') and new.action in ('create', 'update') then
    perform private.notify(owners, 'security', 'settings_change', 'info',
      private.i18n('{who} changed a {what_en}', '{who} a modifié : {what_fr}', '{who} غيّر {what_ar}', vals),
      private.i18n('“{item}”', '« {item} »', '«{item}»', vals),
      url, jsonb_build_object('actor_id', new.actor_id, 'entity', new.entity, 'entity_id', new.entity_id));
    return null;
  end if;

  -- Restores are worth knowing about too.
  if new.action = 'restore' then
    perform private.notify(owners, 'security', 'restore', 'info',
      private.i18n('{who} restored a {what_en}', '{who} a restauré : {what_fr}', '{who} استعاد {what_ar}', vals),
      private.i18n('“{item}”', '« {item} »', '«{item}»', vals),
      url, jsonb_build_object('actor_id', new.actor_id, 'entity', new.entity, 'entity_id', new.entity_id));
  end if;

  return null;
end;
$$;


--
-- Name: prevent_activity_log_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prevent_activity_log_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'activity_log_is_append_only' using errcode = 'P0001';
end;
$$;


--
-- Name: prevent_hard_delete(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prevent_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- Set (transaction-local) by public.purge_deleted() only. Also lets the rows its delete
  -- cascades to (variants, photos, order lines…) go.
  if current_setting('app.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'hard_delete_not_allowed: set deleted_at on %.% instead', tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;


--
-- Name: prevent_movement_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prevent_movement_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'append_only: record a correcting movement instead' using errcode = 'P0001';
end;
$$;


--
-- Name: protect_posted_entry(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_posted_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.status = 'posted' then
    if (to_jsonb(new) - 'reversed_at' - 'updated_at') is distinct from (to_jsonb(old) - 'reversed_at' - 'updated_at') then
      raise exception 'entry_posted: posted entries can''t be changed; reverse them instead' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: protect_posted_lines(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_posted_lines() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  if current_setting('app.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.journal_entries where id = v_entry and status = 'posted') then
    raise exception 'entry_posted: posted entries can''t be changed; reverse them instead' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;


--
-- Name: refresh_bill_paid(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_bill_paid() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  paid numeric;
begin
  select coalesce(sum(amount), 0) into paid from public.bill_payments where bill_id = new.bill_id and deleted_at is null;
  update public.bills b
     set paid_amount = paid,
         status = case when paid >= b.total - 0.0005 and b.total > 0 then 'paid' when paid > 0 then 'partial' else 'unpaid' end
   where b.id = new.bill_id
     and (b.paid_amount is distinct from paid);
  return null;
end;
$$;


--
-- Name: refresh_category_search(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_category_search() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.products p
     set category_id = p.category_id
   where p.category_id = new.id
      or p.category_id in (select c.id from public.categories c where c.parent_id = new.id);
  return null;
end;
$$;


--
-- Name: refresh_order_paid(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_order_paid(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  paid numeric;
  any_refund boolean;
begin
  select coalesce(sum(amount), 0), bool_or(amount < 0) into paid, any_refund
    from public.order_payments where order_id = p_order_id and deleted_at is null;
  update public.orders o
     set paid_amount = paid,
         payment_status = case
           when paid >= o.total - 0.0005 and o.total > 0 then 'paid'
           when paid > 0 then 'partial'
           when any_refund then 'refunded'
           when o.payment_status in ('paid', 'partial') then 'pending'
           else o.payment_status
         end,
         updated_at = now()
   where o.id = p_order_id
     and (o.paid_amount is distinct from paid or o.payment_status is distinct from case
           when paid >= o.total - 0.0005 and o.total > 0 then 'paid'
           when paid > 0 then 'partial'
           when any_refund then 'refunded'
           when o.payment_status in ('paid', 'partial') then 'pending'
           else o.payment_status
         end);
end;
$$;


--
-- Name: request_actor(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.request_actor() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  h jsonb := private.trusted_request_headers();
begin
  if h is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('id', nullif(h->>'x-actor-id', ''), 'email', nullif(h->>'x-actor-email', ''));
end;
$$;


--
-- Name: set_order_item_cost(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_order_item_cost() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.unit_cost is null then
    if new.variant_id is not null then
      new.unit_cost := public.variant_unit_cost(new.variant_id);
    elsif new.product_id is not null then
      select coalesce(
               (select pc.cost from public.product_costs pc where pc.product_id = new.product_id and pc.deleted_at is null),
               (select avg(v.avg_cost) from public.product_variants v where v.product_id = new.product_id and v.avg_cost is not null))
        into new.unit_cost;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: set_product_code(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_product_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  prefix text;
begin
  if new.code is null or new.code = '' then
    select upper(left(regexp_replace(coalesce(c.slug, ''), '[^a-zA-Z]', '', 'g'), 3))
      into prefix
      from public.categories c
     where c.id = new.category_id;
    new.code := coalesce(nullif(prefix, ''), 'PRD') || '-' || lpad(nextval('public.product_code_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;


--
-- Name: set_product_search(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_product_search() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  category_words text := '';
begin
  select concat_ws(' ', c.name, c.name_ar, c.name_fr, parent.name, parent.name_ar, parent.name_fr)
    into category_words
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
   where c.id = new.category_id;

  new.search_name := public.normalize_search_text(concat_ws(' ', new.name, new.name_ar, new.name_fr));
  new.search_text := public.normalize_search_text(concat_ws(' ',
    new.name, new.name_ar, new.name_fr, new.code,
    new.description, new.description_ar, new.description_fr,
    category_words
  ));
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_variant_sku(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_variant_sku() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.sku is null or trim(new.sku) = '' then
    new.sku := private.variant_sku(new);
  end if;
  return new;
end;
$$;


--
-- Name: stock_movement_cost(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.stock_movement_cost() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  units_after integer;
  units_before integer;
  avg_now numeric;
begin
  if new.type = 'restock' and new.unit_cost is not null then
    select avg_cost into avg_now from public.product_variants where id = new.variant_id;
    select coalesce(sum(available), 0) into units_after from public.inventory_levels where variant_id = new.variant_id;
    units_before := units_after - new.quantity;
    update public.product_variants
       set avg_cost = case
             when avg_now is null or units_before <= 0 then new.unit_cost
             else round((units_before * avg_now + new.quantity * new.unit_cost) / (units_before + new.quantity), 3)
           end
     where id = new.variant_id;
  else
    new.unit_cost := coalesce(new.unit_cost, public.variant_unit_cost(new.variant_id));
  end if;
  return new;
end;
$$;


--
-- Name: sync_customer_stage(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_customer_stage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: sync_online_stock(uuid[]); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_online_stock(product_ids uuid[] DEFAULT NULL::uuid[]) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update public.product_variants v
     set stock = coalesce((
       select il.available
         from public.inventory_levels il
         join public.locations l on l.id = il.location_id and l.sells_online
        where il.variant_id = v.id
     ), 0)
    from public.products p
   where p.id = v.product_id
     and p.stock_tracked
     and (product_ids is null or v.product_id = any (product_ids));
$$;


--
-- Name: trusted_request_headers(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trusted_request_headers() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  headers jsonb;
  claims jsonb;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
  if headers is null then
    return null;
  end if;
  if coalesce(claims->>'role', '') <> 'service_role' then
    return '{}'::jsonb;
  end if;
  return headers;
end;
$$;


--
-- Name: unbook(text, uuid, text, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.unbook(p_source_type text, p_source_id uuid, p_event text, p_date date DEFAULT CURRENT_DATE) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  e public.journal_entries;
  actor jsonb := private.request_actor();
  r uuid;
begin
  select * into e from public.journal_entries
   where source_type = p_source_type and source_id = p_source_id and source_event = p_event
     and deleted_at is null and reversed_at is null and reversal_of is null;
  if not found then
    return null;
  end if;
  if e.status = 'draft' then
    update public.journal_entries set deleted_at = now() where id = e.id;
    return null;
  end if;
  insert into public.journal_entries (journal, entry_date, label, source_type, source_id, source_event, reversal_of, created_by, created_by_email)
  values (e.journal, greatest(p_date, e.entry_date), left('Reversal: ' || e.label, 300), e.source_type, e.source_id, e.source_event, e.id,
          nullif(actor->>'id', '')::uuid, actor->>'email')
  returning id into r;
  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select r, account_code, label, credit, debit, partner_type, partner_id, partner_name, position
    from public.journal_lines where entry_id = e.id;
  update public.journal_entries set reversed_at = now() where id = e.id;
  if coalesce((private.accounting_settings()->>'auto_post')::boolean, false) then
    perform public.post_journal_entries(array[r], nullif(actor->>'id', '')::uuid, actor->>'email');
  end if;
  return r;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    size_id uuid,
    color_id uuid,
    sku text,
    price numeric(10,2),
    stock integer DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reorder_point integer DEFAULT 5 NOT NULL,
    avg_cost numeric(12,3),
    CONSTRAINT product_variants_avg_cost_check CHECK ((avg_cost >= (0)::numeric)),
    CONSTRAINT product_variants_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT product_variants_reorder_point_check CHECK ((reorder_point >= 0)),
    CONSTRAINT product_variants_stock_check CHECK ((stock >= 0))
);


--
-- Name: variant_sku(public.product_variants); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.variant_sku(p_variant public.product_variants) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  base text;
  candidate text;
begin
  select concat_ws('-',
           p.code,
           nullif(upper(left(regexp_replace(coalesce(c.name, ''), '[^a-zA-Z0-9]', '', 'g'), 6)), ''),
           nullif(upper(regexp_replace(coalesce(s.name, ''), '[^a-zA-Z0-9]', '', 'g')), ''))
    into base
    from public.products p
    left join public.colors c on c.id = p_variant.color_id
    left join public.sizes s on s.id = p_variant.size_id
   where p.id = p_variant.product_id;

  candidate := coalesce(nullif(base, ''), 'SKU');
  if exists (select 1 from public.product_variants where sku = candidate and id <> p_variant.id) then
    candidate := candidate || '-' || left(replace(p_variant.id::text, '-', ''), 4);
  end if;
  return upper(candidate);
end;
$$;


--
-- Name: activity_actors(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activity_actors() RETURNS TABLE(actor_id uuid, actor_email text, last_at timestamp with time zone, entries bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select a.actor_id, max(a.actor_email), max(a.created_at), count(*)
    from public.activity_log a
   where a.actor_id is not null
   group by a.actor_id
   order by max(a.created_at) desc;
$$;


--
-- Name: agent_performance(timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agent_performance(p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text) RETURNS TABLE(agent_id uuid, agent_email text, agent_role text, orders integer, revenue numeric, confirmed integer, delivered integer, delivered_revenue numeric, paid integer, in_progress integer, cancelled integer, returned integer, items integer, last_order_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
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
         (count(*) filter (where s.status in ('pending', 'confirmed', 'processing', 'shipped')))::integer,
         (count(*) filter (where s.status = 'cancelled'))::integer,
         (count(*) filter (where s.status = 'returned'))::integer,
         coalesce(sum(s.item_count), 0)::integer,
         max(s.created_at)
    from scoped s
    left join public.back_office_users b on b.user_id = s.agent
   group by s.agent
   order by s.agent is null, count(*) desc;
$$;


--
-- Name: anonymize_customer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anonymize_customer(p_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if exists (select 1 from public.orders where customer_id = p_id and deleted_at is null
               and status in ('pending', 'confirmed', 'processing', 'shipped')) then
    raise exception 'customer_has_open_orders';
  end if;
  update public.customers
     set phone = null, phone_alt = null, full_name = 'Anonymized', email = null, address = null,
         notes = null, external_ids = '{}'::jsonb, tags = '{}', anonymized_at = now()
   where id = p_id;
  update public.orders
     set customer_first_name = 'Anonymized', customer_last_name = '', customer_phone = '00000000',
         customer_email = null, shipping_address = null, order_notes = null
   where customer_id = p_id;
  update public.customer_interactions set body = '—', sender_name = null where customer_id = p_id;
end;
$$;


--
-- Name: apply_order_stock(uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_order_stock(p_order_id uuid, p_direction text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  ord public.orders;
  source_location uuid;
  lines integer := 0;
  item record;
  on_hand integer;
  take integer;
begin
  select * into ord from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if p_direction = 'deduct' then
    if ord.stock_deducted then return 0; end if;
    source_location := ord.location_id;
    if source_location is null then
      select id into source_location from public.locations where sells_online;
    end if;
    if source_location is null then
      raise exception 'no_online_location';
    end if;
    for item in
      select oi.variant_id, sum(oi.quantity)::integer as quantity
        from public.order_items oi
        join public.product_variants v on v.id = oi.variant_id
        join public.products p on p.id = v.product_id
       where oi.order_id = p_order_id and p.stock_tracked
       group by oi.variant_id
    loop
      select available into on_hand
        from public.inventory_levels
       where variant_id = item.variant_id and location_id = source_location
         for update;
      take := least(item.quantity, greatest(coalesce(on_hand, 0), 0));
      if take > 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
        values (item.variant_id, source_location, 'sale', -take, ord.order_number, p_order_id, p_actor, p_actor_email);
        lines := lines + 1;
      end if;
    end loop;
    update public.orders set stock_deducted = true where id = p_order_id;
  elsif p_direction = 'restore' then
    if not ord.stock_deducted then return 0; end if;
    for item in
      select variant_id, location_id, sum(-quantity)::integer as qty
        from public.stock_movements
       where order_id = p_order_id and variant_id is not null
       group by variant_id, location_id
      having sum(-quantity) > 0
    loop
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
      values (item.variant_id, item.location_id, 'return', item.qty, ord.order_number, p_order_id, p_actor, p_actor_email);
      lines := lines + 1;
    end loop;
    update public.orders set stock_deducted = false where id = p_order_id;
  else
    raise exception 'invalid_direction';
  end if;
  return lines;
end;
$$;


--
-- Name: assign_orders(uuid[], uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_orders(p_order_ids uuid[], p_user uuid, p_user_email text) RETURNS integer
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  with changed as (
    update public.orders
       set assigned_to = p_user, assigned_to_email = case when p_user is null then null else p_user_email end,
           assigned_at = case when p_user is null then null else now() end, updated_at = now()
     where id = any (p_order_ids) and deleted_at is null and assigned_to is distinct from p_user
    returning 1
  )
  select count(*)::integer from changed;
$$;


--
-- Name: auto_match_bank(integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_match_bank(p_days integer DEFAULT 5, p_actor uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  s record;
  l uuid;
  matched integer := 0;
  bank text := private.acct('bank');
begin
  for s in select * from public.bank_statement_lines where matched_line_id is null and deleted_at is null order by statement_date loop
    select jl.id into l
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id and je.deleted_at is null
     where jl.account_code = bank
       and (jl.debit - jl.credit) = s.amount
       and abs(je.entry_date - s.statement_date) <= p_days
       and not exists (select 1 from public.bank_statement_lines b where b.matched_line_id = jl.id and b.deleted_at is null)
     order by abs(je.entry_date - s.statement_date), je.entry_date
     limit 1;
    if l is not null then
      update public.bank_statement_lines set matched_line_id = l, matched_at = now(), matched_by = p_actor where id = s.id;
      matched := matched + 1;
    end if;
  end loop;
  return matched;
end;
$$;


--
-- Name: deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    provider text DEFAULT 'colissimo'::text NOT NULL,
    barcode text,
    label_url text,
    label_zebra_url text,
    status text DEFAULT 'sending'::text NOT NULL,
    status_reason text,
    status_changed_at timestamp with time zone,
    recipient_name text,
    phone text,
    governorate text,
    city text,
    address text,
    cod_amount numeric(10,3),
    items_count integer,
    designation text,
    request jsonb,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: begin_delivery(uuid, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_delivery(p_order_id uuid, p_request jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.deliveries
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  ord public.orders;
  row public.deliveries;
begin
  select * into ord from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if ord.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id and deleted_at is null) then
    raise exception 'delivery_exists';
  end if;

  insert into public.deliveries (order_id, status, recipient_name, phone, governorate, city, address,
                                 cod_amount, items_count, designation, request, created_by, created_by_email)
  values (p_order_id, 'sending', p_request->>'nom', p_request->>'tel', p_request->>'gouvernerat', p_request->>'ville',
          p_request->>'adresse', nullif(p_request->>'prix', '')::numeric, nullif(p_request->>'nb_article', '')::integer,
          p_request->>'designation', p_request, p_actor, p_actor_email)
  returning * into row;
  return row;
end;
$$;


--
-- Name: book_stock_variation(date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.book_stock_variation(p_date date DEFAULT CURRENT_DATE, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  goods_value numeric;
  materials_value numeric;
  goods_booked numeric;
  materials_booked numeric;
  ref uuid := gen_random_uuid();
  e1 uuid;
  e2 uuid;
begin
  select coalesce(sum(value), 0) into goods_value from public.stock_valuation();
  select coalesce(round(sum(stock * coalesce(avg_cost, 0)), 3), 0) into materials_value from public.raw_materials where deleted_at is null;
  select coalesce(sum(jl.debit - jl.credit), 0) into goods_booked
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id and je.deleted_at is null
   where jl.account_code = private.acct('stock') and je.entry_date <= p_date;
  select coalesce(sum(jl.debit - jl.credit), 0) into materials_booked
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id and je.deleted_at is null
   where jl.account_code = private.acct('materials') and je.entry_date <= p_date;

  e1 := private.book('OD', p_date, 'Stock variation (goods) at ' || to_char(p_date, 'YYYY-MM-DD'), 'stock_variation', ref, 'goods',
    jsonb_build_array(
      jsonb_build_object('account', private.acct('stock'), 'debit', goods_value - goods_booked),
      jsonb_build_object('account', private.acct('stock_variation'), 'credit', goods_value - goods_booked)));
  e2 := private.book('OD', p_date, 'Stock variation (raw materials) at ' || to_char(p_date, 'YYYY-MM-DD'), 'stock_variation', ref, 'materials',
    jsonb_build_array(
      jsonb_build_object('account', private.acct('materials'), 'debit', materials_value - materials_booked),
      jsonb_build_object('account', private.acct('materials_variation'), 'credit', materials_value - materials_booked)));
  return jsonb_build_object('goods_value', goods_value, 'goods_change', goods_value - goods_booked, 'goods_entry', e1,
                            'materials_value', materials_value, 'materials_change', materials_value - materials_booked, 'materials_entry', e2);
end;
$$;


--
-- Name: sales_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    kind text DEFAULT 'invoice'::text NOT NULL,
    order_id uuid,
    credit_note_for uuid,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    customer_name text NOT NULL,
    customer_phone text,
    customer_address text,
    customer_tax_id text,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    amount_ht numeric(14,3) NOT NULL,
    vat_rate numeric(5,2) DEFAULT 0 NOT NULL,
    vat_amount numeric(14,3) NOT NULL,
    stamp numeric(14,3) DEFAULT 0 NOT NULL,
    total numeric(14,3) NOT NULL,
    status text DEFAULT 'issued'::text NOT NULL,
    notes text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT sales_invoices_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'credit_note'::text]))),
    CONSTRAINT sales_invoices_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'cancelled'::text])))
);


--
-- Name: cancel_invoice(uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_invoice(p_id uuid, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.sales_invoices
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  inv public.sales_invoices;
  credit public.sales_invoices;
begin
  select * into inv from public.sales_invoices where id = p_id and kind = 'invoice' and deleted_at is null for update;
  if not found then
    raise exception 'invoice_not_found';
  end if;
  if inv.status = 'cancelled' then
    raise exception 'invoice_already_cancelled';
  end if;
  insert into public.sales_invoices (number, kind, order_id, credit_note_for, invoice_date, customer_name, customer_phone,
                                     customer_address, customer_tax_id, lines, amount_ht, vat_rate, vat_amount, stamp, total, notes,
                                     created_by, created_by_email)
  values ('AV-' || to_char(current_date, 'YYYY') || '-' || lpad(private.next_number('credit_note:' || to_char(current_date, 'YYYY'))::text, 5, '0'),
          'credit_note', inv.order_id, inv.id, current_date, inv.customer_name, inv.customer_phone, inv.customer_address,
          inv.customer_tax_id, inv.lines, -inv.amount_ht, inv.vat_rate, -inv.vat_amount, -inv.stamp, -inv.total, nullif(p_reason, ''),
          p_actor, p_actor_email)
  returning * into credit;
  update public.sales_invoices set status = 'cancelled' where id = inv.id;
  return credit;
end;
$$;


--
-- Name: cancel_remittance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_remittance(p_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.order_payments set remittance_id = null, updated_at = now() where remittance_id = p_id;
  update public.cod_remittances set deleted_at = now() where id = p_id and deleted_at is null;
  if not found then
    raise exception 'remittance_not_found';
  end if;
end;
$$;


--
-- Name: pos_session_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pos_session_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pos_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text DEFAULT ('CS-'::text || lpad((nextval('public.pos_session_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    location_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opened_by uuid,
    opened_by_email text,
    opening_float numeric(12,3) DEFAULT 0 NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    closed_by_email text,
    expected_cash numeric(12,3),
    counted_cash numeric(12,3),
    difference numeric(12,3),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT pos_sessions_opening_float_check CHECK ((opening_float >= (0)::numeric)),
    CONSTRAINT pos_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);


--
-- Name: close_pos_session(uuid, numeric, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_pos_session(p_session_id uuid, p_counted numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.pos_sessions
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  s public.pos_sessions;
  expected numeric;
  diff numeric;
begin
  select * into s from public.pos_sessions where id = p_session_id and deleted_at is null for update;
  if not found or s.status <> 'open' then
    raise exception 'session_not_open';
  end if;
  expected := public.pos_expected_cash(s.id);
  diff := round(coalesce(p_counted, 0) - expected, 3);
  if diff <> 0 then
    insert into public.treasury_movements (account, direction, amount, category, label, pos_session_id, created_by, created_by_email)
    values ('cash', case when diff > 0 then 'in' else 'out' end, abs(diff), 'pos_difference',
            'Till difference ' || s.number, s.id, p_actor, p_actor_email);
  end if;
  update public.pos_sessions
     set status = 'closed', closed_at = now(), closed_by = p_actor, closed_by_email = p_actor_email,
         expected_cash = expected, counted_cash = coalesce(p_counted, 0), difference = diff, notes = nullif(p_notes, '')
   where id = s.id
  returning * into s;
  return s;
end;
$$;


--
-- Name: complete_delivery(uuid, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_delivery(p_id uuid, p_barcode text, p_label_url text, p_label_zebra_url text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  row public.deliveries;
  ord public.orders;
  warning text;
begin
  update public.deliveries
     set barcode = p_barcode, label_url = p_label_url, label_zebra_url = p_label_zebra_url,
         status = 'En attente', status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
  returning * into row;
  if not found then
    raise exception 'delivery_not_found';
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id;
    if ord.status in ('pending', 'confirmed') then
      begin
        select * into ord from public.set_order_status(row.order_id, '{"status": "processing"}'::jsonb, p_actor, p_actor_email);
      exception when others then
        warning := sqlerrm;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'delivery', to_jsonb(row),
    'order', case when ord.id is null then null else jsonb_build_object('status', ord.status, 'stock_deducted', ord.stock_deducted) end,
    'warning', warning
  );
end;
$$;


--
-- Name: create_order(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_order(p_order jsonb, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  ord public.orders;
begin
  insert into public.orders (
    order_number, user_id, customer_email, customer_first_name, customer_last_name, customer_phone,
    shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country,
    subtotal, shipping_cost, total, order_notes, status, payment_status,
    channel, campaign_id, customer_id, assigned_to, assigned_to_email, assigned_at,
    created_by, created_by_email, discount_amount, location_id, pos_session_id
  ) values (
    p_order->>'order_number', nullif(p_order->>'user_id', '')::uuid, nullif(p_order->>'customer_email', ''),
    p_order->>'customer_first_name', p_order->>'customer_last_name', p_order->>'customer_phone',
    nullif(p_order->>'shipping_address', ''), nullif(p_order->>'shipping_city', ''), nullif(p_order->>'shipping_state', ''),
    nullif(p_order->>'shipping_zip', ''), nullif(p_order->>'shipping_country', ''),
    (p_order->>'subtotal')::numeric, (p_order->>'shipping_cost')::numeric, (p_order->>'total')::numeric,
    nullif(p_order->>'order_notes', ''), 'pending', 'pending',
    coalesce(nullif(p_order->>'channel', ''), 'website'), nullif(p_order->>'campaign_id', '')::uuid,
    nullif(p_order->>'customer_id', '')::uuid,
    nullif(p_order->>'assigned_to', '')::uuid, nullif(p_order->>'assigned_to_email', ''),
    case when nullif(p_order->>'assigned_to', '') is not null then now() end,
    nullif(p_order->>'created_by', '')::uuid, nullif(p_order->>'created_by_email', ''),
    coalesce(nullif(p_order->>'discount_amount', '')::numeric, 0),
    nullif(p_order->>'location_id', '')::uuid, nullif(p_order->>'pos_session_id', '')::uuid
  )
  returning * into ord;

  insert into public.order_items (
    order_id, product_id, variant_id, variant_label, product_name, product_name_ar, product_name_fr,
    product_image, quantity, price, subtotal
  )
  select ord.id, i.product_id, i.variant_id, i.variant_label, i.product_name, i.product_name_ar, i.product_name_fr,
         i.product_image, i.quantity, i.price, i.subtotal
    from jsonb_to_recordset(p_items) as i (
      product_id uuid, variant_id uuid, variant_label text, product_name text, product_name_ar text,
      product_name_fr text, product_image text, quantity integer, price numeric, subtotal numeric
    );

  return jsonb_build_object(
    'order', to_jsonb(ord),
    'items', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = ord.id), '[]'::jsonb)
  );
end;
$$;


--
-- Name: create_order_with_delivery(jsonb, jsonb, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_order_with_delivery(p_order jsonb, p_items jsonb, p_delivery jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  created jsonb;
  order_id uuid;
  row public.deliveries;
  ord public.orders;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order_items_required';
  end if;

  created := public.create_order(p_order, p_items);
  order_id := (created->'order'->>'id')::uuid;
  update public.orders set created_by = p_actor, created_by_email = p_actor_email where id = order_id;

  insert into public.deliveries (order_id, barcode, label_url, label_zebra_url, status, status_changed_at,
                                 recipient_name, phone, governorate, city, address, cod_amount, items_count,
                                 designation, request, created_by, created_by_email)
  values (order_id, p_delivery->>'barcode', p_delivery->>'label_url', p_delivery->>'label_zebra_url', 'En attente', now(),
          p_delivery->'request'->>'nom', p_delivery->'request'->>'tel', p_delivery->'request'->>'gouvernerat',
          p_delivery->'request'->>'ville', p_delivery->'request'->>'adresse',
          nullif(p_delivery->'request'->>'prix', '')::numeric, nullif(p_delivery->'request'->>'nb_article', '')::integer,
          p_delivery->'request'->>'designation', p_delivery->'request', p_actor, p_actor_email)
  returning * into row;

  select * into ord from public.set_order_status(order_id, '{"status": "processing"}'::jsonb, p_actor, p_actor_email);

  return jsonb_build_object(
    'delivery', to_jsonb(row),
    'order', jsonb_build_object('id', ord.id, 'order_number', ord.order_number, 'status', ord.status, 'stock_deducted', ord.stock_deducted)
  );
end;
$$;


--
-- Name: bill_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text DEFAULT ('BILL-'::text || lpad((nextval('public.bill_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    supplier_id uuid,
    payee text,
    purchase_order_id uuid,
    supplier_reference text,
    category text DEFAULT 'purchase_goods'::text NOT NULL,
    cost_type text DEFAULT 'variable'::text NOT NULL,
    account_code text NOT NULL,
    bill_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    amount_ht numeric(14,3) NOT NULL,
    vat_amount numeric(14,3) DEFAULT 0 NOT NULL,
    stamp numeric(14,3) DEFAULT 0 NOT NULL,
    total numeric(14,3) GENERATED ALWAYS AS (((amount_ht + vat_amount) + stamp)) STORED,
    paid_amount numeric(14,3) DEFAULT 0 NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    notes text,
    document_id uuid,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT bills_amount_ht_check CHECK ((amount_ht >= (0)::numeric)),
    CONSTRAINT bills_category_check CHECK ((category = ANY (ARRAY['purchase_goods'::text, 'purchase_materials'::text, 'rent'::text, 'salaries'::text, 'social_charges'::text, 'utilities'::text, 'packaging'::text, 'delivery'::text, 'transport'::text, 'telecom'::text, 'bank_fees'::text, 'insurance'::text, 'maintenance'::text, 'fees'::text, 'taxes'::text, 'other'::text]))),
    CONSTRAINT bills_cost_type_check CHECK ((cost_type = ANY (ARRAY['fixed'::text, 'variable'::text]))),
    CONSTRAINT bills_stamp_check CHECK ((stamp >= (0)::numeric)),
    CONSTRAINT bills_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text]))),
    CONSTRAINT bills_vat_amount_check CHECK ((vat_amount >= (0)::numeric))
);


--
-- Name: create_paid_bill(jsonb, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_paid_bill(p_bill jsonb, p_account text, p_method text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.bills
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  b public.bills;
begin
  insert into public.bills (supplier_id, payee, purchase_order_id, supplier_reference, category, cost_type, account_code,
                            bill_date, due_date, amount_ht, vat_amount, stamp, notes, document_id, created_by, created_by_email)
  values (nullif(p_bill->>'supplier_id', '')::uuid, nullif(p_bill->>'payee', ''), nullif(p_bill->>'purchase_order_id', '')::uuid,
          nullif(p_bill->>'supplier_reference', ''), p_bill->>'category', coalesce(nullif(p_bill->>'cost_type', ''), 'variable'),
          p_bill->>'account_code', coalesce(nullif(p_bill->>'bill_date', '')::date, current_date), nullif(p_bill->>'due_date', '')::date,
          (p_bill->>'amount_ht')::numeric, coalesce(nullif(p_bill->>'vat_amount', '')::numeric, 0), coalesce(nullif(p_bill->>'stamp', '')::numeric, 0),
          nullif(p_bill->>'notes', ''), nullif(p_bill->>'document_id', '')::uuid, p_actor, p_actor_email)
  returning * into b;
  if b.total > 0 then
    insert into public.bill_payments (bill_id, amount, paid_on, account, method, created_by, created_by_email)
    values (b.id, b.total, b.bill_date, p_account, p_method, p_actor, p_actor_email);
  end if;
  select * into b from public.bills where id = b.id;
  return b;
end;
$$;


--
-- Name: create_pos_sale(uuid, jsonb, jsonb, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_pos_sale(p_session_id uuid, p_order jsonb, p_items jsonb, p_payments jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  s public.pos_sessions;
  created jsonb;
  v_order_id uuid;
  ord public.orders;
  pay jsonb;
  paid numeric := 0;
begin
  select * into s from public.pos_sessions where id = p_session_id and deleted_at is null for update;
  if not found or s.status <> 'open' then
    raise exception 'session_not_open';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order_items_required';
  end if;
  select coalesce(sum((x->>'amount')::numeric), 0) into paid from jsonb_array_elements(p_payments) x;
  if paid < (p_order->>'total')::numeric - 0.0005 then
    raise exception 'payment_short';
  end if;

  created := public.create_order(
    p_order || jsonb_build_object('channel', 'store', 'location_id', s.location_id, 'pos_session_id', s.id,
                                  'created_by', p_actor, 'created_by_email', p_actor_email,
                                  'assigned_to', p_actor, 'assigned_to_email', p_actor_email),
    p_items);
  v_order_id := (created->'order'->>'id')::uuid;
  perform public.set_order_status(v_order_id, '{"status": "delivered"}'::jsonb, p_actor, p_actor_email);

  for pay in select * from jsonb_array_elements(p_payments) loop
    if (pay->>'amount')::numeric <> 0 then
      insert into public.order_payments (order_id, amount, method, account, reference, pos_session_id, created_by, created_by_email)
      values (v_order_id, (pay->>'amount')::numeric, coalesce(nullif(pay->>'method', ''), 'cash'),
              case when coalesce(nullif(pay->>'method', ''), 'cash') = 'cash' then 'cash' else 'bank' end,
              nullif(pay->>'reference', ''), s.id, p_actor, p_actor_email);
    end if;
  end loop;

  select * into ord from public.orders where id = v_order_id;
  return jsonb_build_object('order', to_jsonb(ord),
    'items', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = v_order_id), '[]'::jsonb));
end;
$$;


--
-- Name: purchase_receipt_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_receipt_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text DEFAULT ('GR-'::text || lpad((nextval('public.purchase_receipt_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    purchase_order_id uuid NOT NULL,
    received_on date DEFAULT CURRENT_DATE NOT NULL,
    location_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    validated_at timestamp with time zone,
    validated_by uuid,
    validated_by_email text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT purchase_receipts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'validated'::text, 'cancelled'::text])))
);


--
-- Name: create_purchase_receipt(uuid, jsonb, jsonb, boolean, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_purchase_receipt(p_po_id uuid, p_receipt jsonb, p_lines jsonb, p_validate boolean, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.purchase_receipts
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  po public.purchase_orders;
  rec public.purchase_receipts;
  line jsonb;
begin
  select * into po from public.purchase_orders where id = p_po_id and deleted_at is null for update;
  if not found then
    raise exception 'purchase_order_not_found';
  end if;
  if po.status in ('draft', 'rfq', 'cancelled', 'received') then
    raise exception 'purchase_order_not_open';
  end if;

  insert into public.purchase_receipts (purchase_order_id, received_on, location_id, notes, created_by, created_by_email)
  values (po.id, coalesce(nullif(p_receipt->>'received_on', '')::date, current_date),
          coalesce(nullif(p_receipt->>'location_id', '')::uuid, po.location_id), nullif(p_receipt->>'notes', ''), p_actor, p_actor_email)
  returning * into rec;

  for line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((line->>'quantity_accepted')::numeric, 0) + coalesce((line->>'quantity_rejected')::numeric, 0) > 0 then
      if not exists (select 1 from public.purchase_order_lines
                      where id = (line->>'po_line_id')::uuid and purchase_order_id = po.id and deleted_at is null) then
        raise exception 'line_not_on_order';
      end if;
      insert into public.purchase_receipt_lines (receipt_id, po_line_id, quantity_accepted, quantity_rejected, reject_reason)
      values (rec.id, (line->>'po_line_id')::uuid, coalesce((line->>'quantity_accepted')::numeric, 0),
              coalesce((line->>'quantity_rejected')::numeric, 0), nullif(line->>'reject_reason', ''));
    end if;
  end loop;
  if not exists (select 1 from public.purchase_receipt_lines where receipt_id = rec.id) then
    raise exception 'receipt_empty';
  end if;

  if p_validate then
    rec := public.validate_purchase_receipt(rec.id, p_actor, p_actor_email);
  end if;
  return rec;
end;
$$;


--
-- Name: delete_orders(uuid[], uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_orders(p_order_ids uuid[], p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_order_id uuid;
  deleted integer := 0;
begin
  foreach v_order_id in array p_order_ids loop
    if exists (select 1 from public.orders where id = v_order_id and deleted_at is null) then
      perform public.apply_order_stock(v_order_id, 'restore', p_actor, p_actor_email);
      update public.orders
         set status = 'cancelled', deleted_at = now(), updated_at = now()
       where id = v_order_id;
      deleted := deleted + 1;
    end if;
  end loop;
  return deleted;
end;
$$;


--
-- Name: delete_treasury_movement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_treasury_movement(p_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  m public.treasury_movements;
  n integer;
begin
  select * into m from public.treasury_movements where id = p_id and deleted_at is null;
  if not found then
    raise exception 'movement_not_found';
  end if;
  if m.category = 'pos_difference' then
    raise exception 'pos_difference_locked';
  end if;
  update public.treasury_movements set deleted_at = now()
   where deleted_at is null and (id = p_id or (m.transfer_id is not null and transfer_id = m.transfer_id));
  get diagnostics n = row_count;
  return n;
end;
$$;


--
-- Name: delete_variant(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_variant(p_variant_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.product_variants
     set deleted_at = now(), is_available = false
   where id = p_variant_id and deleted_at is null;
  update public.product_images
     set deleted_at = now()
   where variant_id = p_variant_id and deleted_at is null;
end;
$$;


--
-- Name: fail_delivery(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_delivery(p_id uuid, p_error text) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  update public.deliveries
     set status = 'failed', status_reason = left(p_error, 500), deleted_at = now(), updated_at = now()
   where id = p_id and status = 'sending' and deleted_at is null;
$$;


--
-- Name: find_customer_duplicates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_customer_duplicates() RETURNS TABLE(customer_id uuid, duplicate_id uuid, reason text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select a.id, b.id,
         case when lower(a.email) = lower(b.email) then 'email'
              when a.phone_alt is not null and (a.phone_alt = b.phone or a.phone_alt = b.phone_alt) then 'phone'
              else 'name' end
    from public.customers a
    join public.customers b on b.id > a.id and b.deleted_at is null
   where a.deleted_at is null
     and (
       (a.email is not null and lower(a.email) = lower(b.email))
       or (a.phone_alt is not null and (a.phone_alt = b.phone or a.phone_alt = b.phone_alt))
       or (b.phone_alt is not null and b.phone_alt = a.phone)
       or (a.full_name <> '' and lower(a.full_name) = lower(b.full_name) and lower(coalesce(a.city, '')) = lower(coalesce(b.city, '')))
     )
   limit 500;
$$;


--
-- Name: find_order_duplicates(text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_order_duplicates(p_phone text, p_exclude uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30) RETURNS TABLE(id uuid, order_number text, status text, total numeric, created_at timestamp with time zone, channel text, customer_first_name text, customer_last_name text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select o.id, o.order_number, o.status, o.total, o.created_at, o.channel, o.customer_first_name, o.customer_last_name
    from public.orders o
   where public.normalize_phone(o.customer_phone) = public.normalize_phone(p_phone)
     and o.deleted_at is null
     and o.id is distinct from p_exclude
     and o.status in ('pending', 'confirmed', 'processing', 'shipped')
     and o.created_at > now() - make_interval(days => greatest(p_days, 1))
   order by o.created_at desc;
$$;


--
-- Name: issue_invoice(uuid, text, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_invoice(p_order_id uuid, p_customer_tax_id text DEFAULT NULL::text, p_date date DEFAULT NULL::date, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.sales_invoices
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cfg jsonb := private.accounting_settings();
  rate numeric := case when coalesce((cfg->>'vat_registered')::boolean, true) then coalesce((cfg->>'sales_vat_rate')::numeric, 19) else 0 end;
  stamp numeric := coalesce((cfg->>'invoice_stamp')::numeric, 0);
  ord public.orders;
  inv public.sales_invoices;
  ht numeric;
  v_date date := coalesce(p_date, current_date);
begin
  select * into ord from public.orders where id = p_order_id and deleted_at is null;
  if not found then
    raise exception 'order_not_found';
  end if;
  if ord.status in ('cancelled', 'returned') then
    raise exception 'order_not_invoiceable';
  end if;
  if exists (select 1 from public.sales_invoices where order_id = ord.id and kind = 'invoice' and status = 'issued' and deleted_at is null) then
    raise exception 'invoice_exists';
  end if;
  ht := round(ord.total / (1 + rate / 100), 3);

  insert into public.sales_invoices (number, kind, order_id, invoice_date, customer_name, customer_phone, customer_address,
                                     customer_tax_id, lines, amount_ht, vat_rate, vat_amount, stamp, total, created_by, created_by_email)
  values (
    'FA-' || to_char(v_date, 'YYYY') || '-' || lpad(private.next_number('invoice:' || to_char(v_date, 'YYYY'))::text, 5, '0'),
    'invoice', ord.id, v_date, trim(concat_ws(' ', ord.customer_first_name, ord.customer_last_name)), ord.customer_phone,
    concat_ws(', ', ord.shipping_address, ord.shipping_city, ord.shipping_state), nullif(p_customer_tax_id, ''),
    coalesce((select jsonb_agg(jsonb_build_object(
                'description', oi.product_name || coalesce(' (' || nullif(oi.variant_label, '') || ')', ''),
                'quantity', oi.quantity,
                'unit_price_ht', round(oi.price / (1 + rate / 100), 3),
                'total_ht', round(oi.subtotal / (1 + rate / 100), 3)) order by oi.created_at)
              from public.order_items oi where oi.order_id = ord.id), '[]'::jsonb)
      || case when ord.discount_amount > 0 then jsonb_build_array(jsonb_build_object('description', 'Remise', 'quantity', 1,
            'unit_price_ht', -round(ord.discount_amount / (1 + rate / 100), 3), 'total_ht', -round(ord.discount_amount / (1 + rate / 100), 3))) else '[]'::jsonb end
      || case when ord.shipping_cost > 0 then jsonb_build_array(jsonb_build_object('description', 'Livraison', 'quantity', 1,
            'unit_price_ht', round(ord.shipping_cost / (1 + rate / 100), 3), 'total_ht', round(ord.shipping_cost / (1 + rate / 100), 3))) else '[]'::jsonb end,
    ht, rate, ord.total - ht, stamp, ord.total + stamp, p_actor, p_actor_email
  )
  returning * into inv;
  return inv;
end;
$$;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    phone_alt text,
    full_name text DEFAULT ''::text NOT NULL,
    email text,
    governorate text,
    city text,
    address text,
    channel text DEFAULT 'website'::text NOT NULL,
    stage text DEFAULT 'new'::text NOT NULL,
    assigned_to uuid,
    assigned_to_email text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    user_id uuid,
    external_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    anonymized_at timestamp with time zone,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT customers_channel_check CHECK ((channel = ANY (ARRAY['website'::text, 'facebook'::text, 'instagram'::text, 'tiktok'::text, 'whatsapp'::text, 'phone'::text, 'store'::text, 'other'::text]))),
    CONSTRAINT customers_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'interested'::text, 'to_confirm'::text, 'confirmed'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text])))
);


--
-- Name: merge_customers(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_customers(p_keep uuid, p_remove uuid) RETURNS public.customers
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  kept public.customers;
  gone public.customers;
begin
  if p_keep = p_remove then
    raise exception 'same_customer';
  end if;
  select * into kept from public.customers where id = p_keep and deleted_at is null for update;
  select * into gone from public.customers where id = p_remove and deleted_at is null for update;
  if kept.id is null or gone.id is null then
    raise exception 'customer_not_found';
  end if;
  update public.orders set customer_id = p_keep where customer_id = p_remove;
  update public.customer_interactions set customer_id = p_keep where customer_id = p_remove;
  update public.crm_tasks set customer_id = p_keep where customer_id = p_remove;
  update public.customers set deleted_at = now(), notes = concat_ws(E'\n', notes, 'Merged into ' || p_keep::text)
   where id = p_remove;
  update public.customers
     set phone_alt = coalesce(phone_alt, case when gone.phone is distinct from kept.phone then gone.phone end),
         email = coalesce(email, gone.email),
         governorate = coalesce(governorate, gone.governorate),
         city = coalesce(city, gone.city),
         address = coalesce(address, gone.address),
         tags = (select coalesce(array_agg(distinct t), '{}') from unnest(tags || gone.tags) t),
         external_ids = gone.external_ids || external_ids,
         notes = concat_ws(E'\n', notes, gone.notes)
   where id = p_keep
  returning * into kept;
  return kept;
end;
$$;


--
-- Name: normalize_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_phone(p_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
  select nullif(case
    when d ~ '^00216\d{8}$' then substr(d, 6)
    when d ~ '^216\d{8}$' then substr(d, 4)
    else d
  end, '')
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) s;
$_$;


--
-- Name: normalize_search_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_search_text(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select trim(regexp_replace(
    translate(
      regexp_replace(
        lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, ''))),
        '[ً-ٰٟـ]', '', 'g'
      ),
      'أإآٱةىؤئ', 'ااااهيوي'
    ),
    '[[:space:][:punct:]«»،؛؟“”‘’…–—]+', ' ', 'g'
  ));
$$;


--
-- Name: open_pos_session(uuid, numeric, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_pos_session(p_location_id uuid, p_opening_float numeric, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.pos_sessions
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  s public.pos_sessions;
begin
  if exists (select 1 from public.pos_sessions where location_id = p_location_id and status = 'open' and deleted_at is null) then
    raise exception 'session_already_open';
  end if;
  insert into public.pos_sessions (location_id, opening_float, opened_by, opened_by_email)
  values (p_location_id, coalesce(p_opening_float, 0), p_actor, p_actor_email)
  returning * into s;
  return s;
end;
$$;


--
-- Name: owner_overview(timestamp with time zone, timestamp with time zone, text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_overview(p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_agent uuid DEFAULT NULL::uuid, p_product uuid DEFAULT NULL::uuid, p_campaign uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  ), lines as (
    -- Each line's cost: the product's cost when it was ordered, else its cost now.
    select oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.subtotal,
           coalesce(oi.unit_cost, pc.cost, public.variant_unit_cost(oi.variant_id)) as unit_cost
      from public.order_items oi join o on o.id = oi.order_id
      left join public.product_costs pc on pc.product_id = oi.product_id and pc.deleted_at is null
     where p_product is null or oi.product_id = p_product
  ), delivered as (
    select o.* from o where o.status = 'delivered' and o.delivered_at >= p_from and o.delivered_at < p_to
  ), delivered_lines as (
    select l.* from lines l join delivered d on d.id = l.order_id
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
        'created', (select count(*) from o where o.created_at::date = d.day),
        'confirmed', (select count(*) from o where o.confirmed_at::date = d.day),
        'delivered', (select count(*) from delivered x where x.delivered_at::date = d.day),
        'revenue', (select coalesce(sum(x.total), 0) from delivered x where x.delivered_at::date = d.day),
        'returned', (select count(*) from o where o.status = 'returned' and o.returned_at::date = d.day),
        'collected', (select coalesce(sum(p.amount), 0) from public.order_payments p join o on o.id = p.order_id
                       where p.deleted_at is null and p.received_at::date = d.day),
        'ad_spend', (select coalesce(sum(s.amount), 0) from public.ad_spend s where s.deleted_at is null and s.spend_date = d.day
                      and (p_campaign is null or s.campaign_id = p_campaign))
      ) order by d.day), '[]'::jsonb) from days d
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


--
-- Name: pos_expected_cash(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pos_expected_cash(p_session_id uuid) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select s.opening_float
         + coalesce((select sum(p.amount) from public.order_payments p
                      where p.pos_session_id = s.id and p.account = 'cash' and p.deleted_at is null), 0)
         + coalesce((select sum(case when m.direction = 'in' then m.amount else -m.amount end) from public.treasury_movements m
                      where m.pos_session_id = s.id and m.account = 'cash' and m.deleted_at is null and m.category <> 'pos_difference'), 0)
    from public.pos_sessions s
   where s.id = p_session_id;
$$;


--
-- Name: post_journal_entries(uuid[], uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_journal_entries(p_ids uuid[], p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  e public.journal_entries;
  d numeric;
  c numeric;
  posted integer := 0;
begin
  for e in select * from public.journal_entries where id = any (p_ids) and status = 'draft' and deleted_at is null
            order by entry_date, created_at for update loop
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from public.journal_lines where entry_id = e.id;
    if d = 0 or d <> c then
      raise exception 'unbalanced_entry:%', coalesce(e.label, e.id::text) using errcode = 'P0001';
    end if;
    update public.journal_entries
       set status = 'posted', posted_at = now(), posted_by = p_actor, posted_by_email = p_actor_email,
           number = e.journal || '-' || to_char(e.entry_date, 'YYYY') || '-'
                    || lpad(private.next_number('journal:' || e.journal || ':' || to_char(e.entry_date, 'YYYY'))::text, 5, '0')
     where id = e.id;
    posted := posted + 1;
  end loop;
  return posted;
end;
$$;


--
-- Name: product_cost_prices(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_cost_prices() RETURNS TABLE(product_id uuid, product_name text, code text, base_price numeric, materials_cost numeric, labor_cost numeric, overhead_cost numeric, stock_avg_cost numeric, purchase_cost numeric, cost_price numeric, margin numeric, margin_percent numeric)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with bom as (
    select b.product_id, sum(b.quantity * coalesce(m.avg_cost, 0)) as materials
      from public.product_bom b
      join public.raw_materials m on m.id = b.material_id
     where b.deleted_at is null
     group by b.product_id
  ), avgc as (
    select v.product_id, avg(v.avg_cost) as avg_cost
      from public.product_variants v
     where v.deleted_at is null and v.avg_cost is not null
     group by v.product_id
  ), base as (
    select p.id, p.name, p.code, p.base_price,
           round(bom.materials, 3) as materials,
           coalesce(pc.labor_cost, 0) as labor, coalesce(pc.overhead_cost, 0) as overhead,
           round(avgc.avg_cost, 3) as avg_cost, cost.cost as purchase,
           case when bom.product_id is not null then round(bom.materials + coalesce(pc.labor_cost, 0) + coalesce(pc.overhead_cost, 0), 3)
                else coalesce(cost.cost, round(avgc.avg_cost, 3)) end as cost_price
      from public.products p
      left join bom on bom.product_id = p.id
      left join avgc on avgc.product_id = p.id
      left join public.product_costing pc on pc.product_id = p.id and pc.deleted_at is null
      left join public.product_costs cost on cost.product_id = p.id and cost.deleted_at is null
     where p.deleted_at is null
  )
  select id, name, code, base_price, materials, labor, overhead, avg_cost, purchase, cost_price,
         case when cost_price is null then null else base_price - cost_price end,
         case when cost_price is null or base_price = 0 then null else round((base_price - cost_price) / base_price * 100, 1) end
    from base
   order by name;
$$;


--
-- Name: purchase_price_comparison(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_price_comparison(p_variant_id uuid DEFAULT NULL::uuid, p_material_id uuid DEFAULT NULL::uuid) RETURNS TABLE(item_key text, item_name text, supplier_id uuid, supplier_name text, last_unit_cost numeric, min_unit_cost numeric, avg_unit_cost numeric, times integer, total_quantity numeric, last_date date)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with lines as (
    select coalesce('v:' || l.variant_id, 'm:' || l.material_id, 'd:' || lower(l.description)) as item_key,
           coalesce(p.name || coalesce(' · ' || nullif(v.sku, ''), ''), m.name, l.description) as item_name,
           po.supplier_id, s.name as supplier_name, l.unit_cost, l.quantity, po.order_date, po.created_at
      from public.purchase_order_lines l
      join public.purchase_orders po on po.id = l.purchase_order_id and po.deleted_at is null and po.status <> 'cancelled'
      join public.suppliers s on s.id = po.supplier_id
      left join public.product_variants v on v.id = l.variant_id
      left join public.products p on p.id = v.product_id
      left join public.raw_materials m on m.id = l.material_id
     where l.deleted_at is null
       and (p_variant_id is null or l.variant_id = p_variant_id)
       and (p_material_id is null or l.material_id = p_material_id)
  )
  select item_key, max(item_name), supplier_id, max(supplier_name),
         (array_agg(unit_cost order by order_date desc, created_at desc))[1],
         min(unit_cost), round(avg(unit_cost), 4), count(*)::integer, sum(quantity), max(order_date)
    from lines
   group by item_key, supplier_id
   order by max(item_name), min(unit_cost);
$$;


--
-- Name: purge_deleted(text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_deleted(p_table text, p_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  headers jsonb := private.trusted_request_headers();
  v_actor uuid;
  v_count integer;
begin
  if p_table not in (
    'products', 'product_variants', 'categories', 'colors', 'sizes', 'product_discounts',
    'promotions', 'reels', 'hero_sections', 'small_cards', 'orders', 'locations',
    'suppliers', 'collections'
  ) then
    raise exception 'purge_not_allowed: %', p_table using errcode = 'P0001';
  end if;

  begin
    v_actor := nullif(headers->>'x-actor-id', '')::uuid;
  exception when others then
    v_actor := null;
  end;

  -- Still used by live rows.
  if (p_table = 'colors' and exists (
        select 1 from public.product_variants v where v.color_id = any (p_ids) and v.deleted_at is null))
     or (p_table = 'sizes' and exists (
        select 1 from public.product_variants v where v.size_id = any (p_ids) and v.deleted_at is null))
     or (p_table = 'categories' and (
        exists (select 1 from public.products p where p.category_id = any (p_ids) and p.deleted_at is null)
        or exists (select 1 from public.categories c where c.parent_id = any (p_ids) and c.deleted_at is null)))
     or (p_table = 'suppliers' and exists (
        select 1 from public.products p where p.supplier_id = any (p_ids) and p.deleted_at is null))
     or (p_table = 'collections' and exists (
        select 1 from public.products p where p.collection_id = any (p_ids) and p.deleted_at is null))
  then
    raise exception 'in_use: % still used by live records', p_table using errcode = '23503';
  end if;

  -- Stock only changes through stock_movements; erasing a variant would drop its levels.
  if p_table in ('products', 'product_variants') and exists (
    select 1
      from public.inventory_levels il
      join public.product_variants v on v.id = il.variant_id
     where il.available <> 0
       and (case when p_table = 'products' then v.product_id else v.id end) = any (p_ids)
  ) then
    raise exception 'has_stock: record a movement to bring the stock to 0 first' using errcode = 'P0001';
  end if;

  perform set_config('app.purge', 'on', true);

  -- Home page picks point at products without a cascade; they go with the product.
  if p_table = 'products' then
    delete from public.landing_products l
     using public.products p
     where l.product_id = p.id and p.id = any (p_ids) and p.deleted_at is not null;
  end if;

  execute format(
    'with erased as (
       delete from public.%1$I t where t.id = any ($1) and t.deleted_at is not null returning t.*
     ), logged as (
       insert into public.activity_log (actor_id, actor_email, actor_role, source, action, entity, entity_id, label, changes)
       select $2, nullif($3->>''x-actor-email'', ''''), nullif($3->>''x-actor-role'', ''''),
              case when $3 is null then ''database'' else ''admin'' end,
              ''purge'', %1$L, e.id::text,
              coalesce(to_jsonb(e)->>''order_number'', to_jsonb(e)->>''name'', to_jsonb(e)->>''title'', to_jsonb(e)->>''sku''),
              to_jsonb(e)
         from erased e
       returning 1
     )
     select count(*) from logged', p_table)
    using p_ids, v_actor, headers
    into v_count;

  perform set_config('app.purge', '', true);
  return v_count;
end;
$_$;


--
-- Name: record_cash_transfer(text, numeric, date, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_cash_transfer(p_from text, p_amount numeric, p_date date, p_label text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_transfer uuid := gen_random_uuid();
  v_to text := case p_from when 'cash' then 'bank' when 'bank' then 'cash' end;
begin
  if v_to is null then
    raise exception 'invalid_account';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'invalid_quantity';
  end if;
  insert into public.treasury_movements (account, direction, amount, category, occurred_on, label, transfer_id, created_by, created_by_email)
  values (p_from, 'out', p_amount, 'transfer', coalesce(p_date, current_date), coalesce(nullif(p_label, ''), 'Transfer to ' || v_to), v_transfer, p_actor, p_actor_email),
         (v_to, 'in', p_amount, 'transfer', coalesce(p_date, current_date), coalesce(nullif(p_label, ''), 'Transfer from ' || p_from), v_transfer, p_actor, p_actor_email);
  return v_transfer;
end;
$$;


--
-- Name: record_delivery_status(uuid, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_delivery_status(p_id uuid, p_status text, p_reason text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  row public.deliveries;
  ord public.orders;
  changes jsonb := '{}'::jsonb;
  owed numeric;
begin
  update public.deliveries
     set status = p_status, status_reason = nullif(p_reason, ''), status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
     and (status is distinct from p_status or status_reason is distinct from nullif(p_reason, ''))
  returning * into row;
  if not found then
    return false;
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id and deleted_at is null;
    if found then
      if p_status in ('Enleve', 'Au depot', 'En cours', 'Retour Inter Agence') and ord.status = 'processing' then
        changes := changes || '{"status": "shipped"}'::jsonb;
      elsif p_status in ('Livre', 'Livre paye') and ord.status in ('confirmed', 'processing', 'shipped') then
        changes := changes || '{"status": "delivered"}'::jsonb;
      elsif p_status in ('Retour definitif', 'Retour paye', 'Retour recu paye') and ord.status in ('processing', 'shipped', 'delivered') then
        changes := changes || '{"status": "returned"}'::jsonb;
      end if;
      if changes <> '{}'::jsonb then
        perform public.set_order_status(row.order_id, changes, p_actor, p_actor_email);
      end if;
      if p_status = 'Livre paye' then
        owed := ord.total - ord.paid_amount;
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


--
-- Name: record_production(uuid, integer, uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_production(p_variant_id uuid, p_quantity integer, p_location_id uuid, p_note text DEFAULT ''::text, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_product uuid;
  v_ref text := 'PROD-' || to_char(now(), 'YYMMDDHH24MISS');
  v_prod uuid := gen_random_uuid();
  materials numeric := 0;
  extra numeric := 0;
  line record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;
  select product_id into v_product from public.product_variants where id = p_variant_id and deleted_at is null;
  if v_product is null then
    raise exception 'variant_not_found';
  end if;
  if not exists (select 1 from public.product_bom where product_id = v_product and deleted_at is null) then
    raise exception 'no_bill_of_materials';
  end if;

  for line in
    select b.material_id, b.quantity, m.avg_cost
      from public.product_bom b join public.raw_materials m on m.id = b.material_id
     where b.product_id = v_product and b.deleted_at is null
  loop
    insert into public.material_movements (material_id, type, quantity, reference, note, production_id, created_by, created_by_email)
    values (line.material_id, 'consumption', -(line.quantity * p_quantity), v_ref, coalesce(p_note, ''), v_prod, p_actor, p_actor_email);
    materials := materials + line.quantity * coalesce(line.avg_cost, 0);
  end loop;
  select coalesce(labor_cost, 0) + coalesce(overhead_cost, 0) into extra
    from public.product_costing where product_id = v_product and deleted_at is null;

  insert into public.stock_movements (variant_id, location_id, type, quantity, unit_cost, reference, note, created_by, created_by_email)
  values (p_variant_id, p_location_id, 'restock', p_quantity, round(materials + coalesce(extra, 0), 3), v_ref,
          coalesce(nullif(p_note, ''), 'Production'), p_actor, p_actor_email);
  update public.products set stock_tracked = true where id = v_product and not stock_tracked;

  return jsonb_build_object('reference', v_ref, 'unit_cost', round(materials + coalesce(extra, 0), 3));
end;
$$;


--
-- Name: cod_remittances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cod_remittances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'colissimo'::text NOT NULL,
    reference text,
    received_on date DEFAULT CURRENT_DATE NOT NULL,
    gross_amount numeric(12,3) NOT NULL,
    fees numeric(12,3) DEFAULT 0 NOT NULL,
    net_amount numeric(12,3) GENERATED ALWAYS AS ((gross_amount - fees)) STORED,
    account text DEFAULT 'bank'::text NOT NULL,
    note text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT cod_remittances_account_check CHECK ((account = ANY (ARRAY['bank'::text, 'cash'::text]))),
    CONSTRAINT cod_remittances_fees_check CHECK ((fees >= (0)::numeric)),
    CONSTRAINT cod_remittances_gross_amount_check CHECK ((gross_amount >= (0)::numeric))
);


--
-- Name: record_remittance(jsonb, uuid[], uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_remittance(p_remittance jsonb, p_payment_ids uuid[], p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.cod_remittances
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  row public.cod_remittances;
  linked integer;
begin
  insert into public.cod_remittances (provider, reference, received_on, gross_amount, fees, account, note, created_by, created_by_email)
  values (coalesce(nullif(p_remittance->>'provider', ''), 'colissimo'), nullif(p_remittance->>'reference', ''),
          coalesce(nullif(p_remittance->>'received_on', '')::date, current_date),
          (p_remittance->>'gross_amount')::numeric, coalesce(nullif(p_remittance->>'fees', '')::numeric, 0),
          coalesce(nullif(p_remittance->>'account', ''), 'bank'), nullif(p_remittance->>'note', ''), p_actor, p_actor_email)
  returning * into row;

  update public.order_payments
     set remittance_id = row.id, updated_at = now()
   where id = any (coalesce(p_payment_ids, '{}')) and account = 'carrier' and remittance_id is null and deleted_at is null;
  get diagnostics linked = row_count;
  if linked <> coalesce(cardinality(p_payment_ids), 0) then
    raise exception 'payments_not_open';
  end if;
  return row;
end;
$$;


--
-- Name: record_stock_movements(text, uuid, jsonb, uuid, text, text, boolean, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_stock_movements(p_type text, p_location_id uuid, p_items jsonb, p_to_location_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT ''::text, p_note text DEFAULT ''::text, p_track boolean DEFAULT false, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  item jsonb;
  item_location uuid;
  qty integer;
  current_qty integer;
  delta integer;
  recorded integer := 0;
  v_ref text := coalesce(p_reference, '');
  v_note text := coalesce(p_note, '');
  v_cost numeric;
begin
  if p_type not in ('restock', 'return', 'sale', 'adjustment', 'transfer', 'count') then
    raise exception 'invalid_movement_type';
  end if;
  if p_type = 'transfer' and (p_to_location_id is null or p_to_location_id = p_location_id) then
    raise exception 'invalid_transfer';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    qty := (item->>'quantity')::integer;
    item_location := coalesce(nullif(item->>'location_id', '')::uuid, p_location_id);
    v_cost := nullif(item->>'unit_cost', '')::numeric;

    if p_type = 'count' then
      if qty < 0 then
        raise exception 'negative_count';
      end if;
      select l.available into current_qty
        from public.inventory_levels l
       where l.variant_id = (item->>'variant_id')::uuid and l.location_id = item_location
       for update;
      delta := qty - coalesce(current_qty, 0);
      if delta <> 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>'variant_id')::uuid, item_location, 'adjustment', delta, coalesce(nullif(v_ref, ''), 'Stock count'), v_note, p_actor, p_actor_email);
        recorded := recorded + 1;
      end if;
    elsif p_type = 'transfer' then
      qty := abs(qty);
      if qty > 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>'variant_id')::uuid, item_location, 'transfer', -qty, v_ref, v_note, p_actor, p_actor_email),
               ((item->>'variant_id')::uuid, p_to_location_id, 'transfer', qty, v_ref, v_note, p_actor, p_actor_email);
        recorded := recorded + 2;
      end if;
    else
      qty := case p_type when 'sale' then -abs(qty) when 'adjustment' then qty else abs(qty) end;
      if qty <> 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, unit_cost, reference, note, created_by, created_by_email)
        values ((item->>'variant_id')::uuid, item_location, p_type::public.stock_movement_type, qty,
                case when p_type = 'restock' then v_cost end, v_ref, v_note, p_actor, p_actor_email);
        recorded := recorded + 1;
      end if;
    end if;
  end loop;

  if p_track then
    update public.products p
       set stock_tracked = true
     where not p.stock_tracked
       and p.id in (select pv.product_id from public.product_variants pv
                     where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) as i));
  end if;

  return recorded;
end;
$$;


--
-- Name: reverse_journal_entry(uuid, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_journal_entry(p_id uuid, p_date date DEFAULT CURRENT_DATE, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  e public.journal_entries;
  r uuid;
begin
  select * into e from public.journal_entries where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'entry_not_found';
  end if;
  if e.status <> 'posted' or e.reversed_at is not null or e.reversal_of is not null then
    raise exception 'entry_not_reversible';
  end if;
  insert into public.journal_entries (journal, entry_date, label, source_type, source_id, source_event, reversal_of, created_by, created_by_email)
  values (e.journal, greatest(coalesce(p_date, current_date), e.entry_date), left('Reversal: ' || e.label, 300),
          e.source_type, e.source_id, e.source_event, e.id, p_actor, p_actor_email)
  returning id into r;
  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select r, account_code, label, credit, debit, partner_type, partner_id, partner_name, position
    from public.journal_lines where entry_id = e.id;
  update public.journal_entries set reversed_at = now() where id = e.id;
  return r;
end;
$$;


--
-- Name: save_landing_page(text, uuid[], jsonb, uuid[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_landing_page(p_section text DEFAULT NULL::text, p_product_ids uuid[] DEFAULT NULL::uuid[], p_config jsonb DEFAULT NULL::jsonb, p_featured_category_ids uuid[] DEFAULT NULL::uuid[], p_actor uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if p_section is not null then
    perform public.set_landing_products(p_section, p_product_ids, p_actor);
  end if;
  if p_config is not null then
    insert into public.site_settings (setting_key, setting_value, setting_type)
    values ('landing_config', p_config::text, 'json')
    on conflict (setting_key) do update set setting_value = excluded.setting_value, setting_type = excluded.setting_type;
  end if;
  if p_featured_category_ids is not null then
    perform public.set_featured_categories(p_featured_category_ids);
  end if;
end;
$$;


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal text NOT NULL,
    number text,
    entry_date date NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_id uuid,
    source_event text DEFAULT 'booked'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    posted_at timestamp with time zone,
    posted_by uuid,
    posted_by_email text,
    reversal_of uuid,
    reversed_at timestamp with time zone,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT journal_entries_journal_check CHECK ((journal = ANY (ARRAY['VT'::text, 'AC'::text, 'CA'::text, 'BQ'::text, 'OD'::text]))),
    CONSTRAINT journal_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text])))
);


--
-- Name: save_manual_entry(uuid, jsonb, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_manual_entry(p_id uuid, p_entry jsonb, p_lines jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.journal_entries
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  e public.journal_entries;
  d numeric;
  c numeric;
begin
  if p_id is null then
    insert into public.journal_entries (journal, entry_date, label, source_type, created_by, created_by_email)
    values (coalesce(nullif(p_entry->>'journal', ''), 'OD'), coalesce(nullif(p_entry->>'entry_date', '')::date, current_date),
            coalesce(p_entry->>'label', ''), 'manual', p_actor, p_actor_email)
    returning * into e;
  else
    select * into e from public.journal_entries where id = p_id and deleted_at is null for update;
    if not found then
      raise exception 'entry_not_found';
    end if;
    if e.status = 'posted' then
      raise exception 'entry_posted: posted entries can''t be changed; reverse them instead' using errcode = 'P0001';
    end if;
    update public.journal_entries
       set journal = coalesce(nullif(p_entry->>'journal', ''), journal),
           entry_date = coalesce(nullif(p_entry->>'entry_date', '')::date, entry_date),
           label = coalesce(p_entry->>'label', label)
     where id = e.id
    returning * into e;
    delete from public.journal_lines where entry_id = e.id;
  end if;

  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select e.id, l->>'account', coalesce(l->>'label', ''),
         round(coalesce((l->>'debit')::numeric, 0), 3), round(coalesce((l->>'credit')::numeric, 0), 3),
         nullif(l->>'partner_type', ''), nullif(l->>'partner_id', '')::uuid, nullif(l->>'partner_name', ''), ord::integer
    from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
   where round(coalesce((l->>'debit')::numeric, 0), 3) <> 0 or round(coalesce((l->>'credit')::numeric, 0), 3) <> 0;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from public.journal_lines where entry_id = e.id;
  if d = 0 or d <> c then
    raise exception 'unbalanced_entry:% (% / %)', e.label, d, c using errcode = 'P0001';
  end if;
  return e;
end;
$$;


--
-- Name: save_product(uuid, jsonb, jsonb, jsonb, boolean, numeric, boolean, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_product(p_product_id uuid, p_product jsonb, p_variants jsonb DEFAULT NULL::jsonb, p_images jsonb DEFAULT NULL::jsonb, p_replace_discount boolean DEFAULT false, p_discount numeric DEFAULT NULL::numeric, p_keep_stocked_variants boolean DEFAULT false, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_product_id uuid := p_product_id;
  creating boolean := p_product_id is null;
  v jsonb;
  v_variant_id uuid;
  claimed uuid[] := '{}';
  opening jsonb := '[]'::jsonb;
  stocked integer;
  online_location uuid;
begin
  if creating then
    insert into public.products (
      name, slug, description, name_ar, name_fr, description_ar, description_fr, category_id,
      base_price, status, code, supplier_id, collection_id, stock_tracked
    ) values (
      p_product->>'name', p_product->>'slug', nullif(p_product->>'description', ''),
      nullif(p_product->>'name_ar', ''), nullif(p_product->>'name_fr', ''),
      nullif(p_product->>'description_ar', ''), nullif(p_product->>'description_fr', ''),
      nullif(p_product->>'category_id', '')::uuid, coalesce(nullif(p_product->>'base_price', '')::numeric, 0),
      coalesce(nullif(p_product->>'status', ''), 'active'), nullif(trim(p_product->>'code'), ''),
      nullif(p_product->>'supplier_id', '')::uuid, nullif(p_product->>'collection_id', '')::uuid,
      coalesce((p_product->>'stock_tracked')::boolean, false)
    )
    returning id into v_product_id;
  else
    update public.products p
       set name = case when p_product ? 'name' then p_product->>'name' else p.name end,
           slug = case when p_product ? 'slug' then p_product->>'slug' else p.slug end,
           description = case when p_product ? 'description' then nullif(p_product->>'description', '') else p.description end,
           name_ar = case when p_product ? 'name_ar' then nullif(p_product->>'name_ar', '') else p.name_ar end,
           name_fr = case when p_product ? 'name_fr' then nullif(p_product->>'name_fr', '') else p.name_fr end,
           description_ar = case when p_product ? 'description_ar' then nullif(p_product->>'description_ar', '') else p.description_ar end,
           description_fr = case when p_product ? 'description_fr' then nullif(p_product->>'description_fr', '') else p.description_fr end,
           category_id = case when p_product ? 'category_id' then nullif(p_product->>'category_id', '')::uuid else p.category_id end,
           base_price = case when p_product ? 'base_price' then (p_product->>'base_price')::numeric else p.base_price end,
           status = case when p_product ? 'status' then p_product->>'status' else p.status end,
           code = case when p_product ? 'code' then nullif(trim(p_product->>'code'), '') else p.code end,
           supplier_id = case when p_product ? 'supplier_id' then nullif(p_product->>'supplier_id', '')::uuid else p.supplier_id end,
           collection_id = case when p_product ? 'collection_id' then nullif(p_product->>'collection_id', '')::uuid else p.collection_id end,
           stock_tracked = case when p_product ? 'stock_tracked' then (p_product->>'stock_tracked')::boolean else p.stock_tracked end,
           deleted_at = case when p_product ? 'restore' and (p_product->>'restore')::boolean then null else p.deleted_at end,
           updated_at = now()
     where p.id = v_product_id;
    if not found then
      raise exception 'product_not_found';
    end if;
  end if;

  if p_variants is not null then
    -- Variant photos are rewritten from the payload below (the old rows are kept, marked deleted).
    update public.product_images pi set deleted_at = now()
     where pi.product_id = v_product_id and pi.variant_id is not null and pi.deleted_at is null;

    for v in select * from jsonb_array_elements(p_variants) loop
      v_variant_id := null;
      if nullif(v->>'id', '') is not null then
        select pv.id into v_variant_id
          from public.product_variants pv
         where pv.id = (v->>'id')::uuid and pv.product_id = v_product_id and not (pv.id = any (claimed));
      end if;
      if v_variant_id is null then
        select pv.id into v_variant_id
          from public.product_variants pv
         where pv.product_id = v_product_id
           and pv.color_id is not distinct from nullif(v->>'color_id', '')::uuid
           and pv.size_id is not distinct from nullif(v->>'size_id', '')::uuid
           and not (pv.id = any (claimed))
         order by pv.deleted_at nulls first
         limit 1;
      end if;

      if v_variant_id is null then
        insert into public.product_variants (product_id, color_id, size_id, sku, price, is_available, reorder_point)
        values (
          v_product_id, nullif(v->>'color_id', '')::uuid, nullif(v->>'size_id', '')::uuid,
          nullif(trim(v->>'sku'), ''), nullif(v->>'price', '')::numeric,
          coalesce((v->>'is_available')::boolean, true), coalesce(nullif(v->>'reorder_point', '')::integer, 5)
        )
        returning id into v_variant_id;
        if creating and coalesce(nullif(v->>'stock', '')::integer, 0) > 0 then
          opening := opening || jsonb_build_object('variant_id', v_variant_id, 'quantity', (v->>'stock')::integer);
        end if;
      else
        update public.product_variants pv
           set color_id = nullif(v->>'color_id', '')::uuid,
               size_id = nullif(v->>'size_id', '')::uuid,
               sku = coalesce(nullif(trim(v->>'sku'), ''), pv.sku),
               price = nullif(v->>'price', '')::numeric,
               is_available = coalesce((v->>'is_available')::boolean, true),
               reorder_point = coalesce(nullif(v->>'reorder_point', '')::integer, pv.reorder_point),
               deleted_at = null,
               updated_at = now()
         where pv.id = v_variant_id;
      end if;
      claimed := claimed || v_variant_id;

      if jsonb_typeof(v->'images') = 'array' then
        insert into public.product_images (product_id, variant_id, image_url, alt_text, is_main, position)
        select v_product_id, v_variant_id,
               coalesce(img->>'url', img #>> '{}'), img->>'alt',
               ord = 1 or coalesce((img->>'is_main')::boolean, false),
               coalesce(nullif(img->>'position', '')::integer, (ord - 1)::integer)
          from jsonb_array_elements(v->'images') with ordinality as t (img, ord)
         where coalesce(img->>'url', img #>> '{}') is not null;
      end if;
    end loop;

    -- Variants left out of the list are removed, but never while they hold stock.
    select count(*) into stocked
      from public.product_variants pv
     where pv.product_id = v_product_id and not (pv.id = any (claimed)) and pv.deleted_at is null
       and exists (select 1 from public.inventory_levels l where l.variant_id = pv.id and l.available > 0);
    if stocked > 0 and not p_keep_stocked_variants then
      raise exception 'variants_with_stock:%', stocked using errcode = 'P0001';
    end if;
    update public.product_variants pv
       set deleted_at = now(), is_available = false
     where pv.product_id = v_product_id and not (pv.id = any (claimed)) and pv.deleted_at is null
       and not exists (select 1 from public.inventory_levels l where l.variant_id = pv.id and l.available > 0);
  end if;

  if p_images is not null then
    update public.product_images pi set deleted_at = now()
     where pi.product_id = v_product_id and pi.variant_id is null and pi.deleted_at is null;
    insert into public.product_images (product_id, variant_id, image_url, alt_text, is_main, position)
    select v_product_id, null,
           coalesce(img->>'url', img #>> '{}'), img->>'alt',
           ord = 1 or coalesce((img->>'is_main')::boolean, false),
           coalesce(nullif(img->>'position', '')::integer, (ord - 1)::integer)
      from jsonb_array_elements(p_images) with ordinality as t (img, ord)
     where coalesce(img->>'url', img #>> '{}') is not null;
  end if;

  if jsonb_array_length(opening) > 0 then
    select id into online_location from public.locations where sells_online;
    if online_location is not null then
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, created_by, created_by_email)
      select (o->>'variant_id')::uuid, online_location, 'restock', (o->>'quantity')::integer, 'Opening stock', p_actor, p_actor_email
        from jsonb_array_elements(opening) as o;
      update public.products p set stock_tracked = true where p.id = v_product_id;
    end if;
  end if;

  if p_replace_discount then
    update public.product_discounts d set deleted_at = now(), active = false
     where d.product_id = v_product_id and d.deleted_at is null;
    if p_discount is not null and p_discount > 0 then
      insert into public.product_discounts (product_id, discount_percent, active) values (v_product_id, p_discount, true);
    end if;
  end if;

  return v_product_id;
end;
$$;


--
-- Name: save_product_costing(uuid, numeric, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_product_costing(p_product_id uuid, p_labor numeric, p_overhead numeric, p_notes text, p_bom jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  line jsonb;
  keep uuid[] := '{}';
begin
  if not exists (select 1 from public.products where id = p_product_id and deleted_at is null) then
    raise exception 'product_not_found';
  end if;
  insert into public.product_costing (product_id, labor_cost, overhead_cost, notes)
  values (p_product_id, coalesce(p_labor, 0), coalesce(p_overhead, 0), nullif(p_notes, ''))
  on conflict (product_id) do update
    set labor_cost = excluded.labor_cost, overhead_cost = excluded.overhead_cost, notes = excluded.notes, deleted_at = null;

  for line in select * from jsonb_array_elements(coalesce(p_bom, '[]'::jsonb)) loop
    keep := keep || (line->>'material_id')::uuid;
    update public.product_bom set quantity = (line->>'quantity')::numeric
     where product_id = p_product_id and material_id = (line->>'material_id')::uuid and deleted_at is null;
    if not found then
      insert into public.product_bom (product_id, material_id, quantity)
      values (p_product_id, (line->>'material_id')::uuid, (line->>'quantity')::numeric);
    end if;
  end loop;
  update public.product_bom set deleted_at = now()
   where product_id = p_product_id and deleted_at is null and not (material_id = any (keep));

  -- A product made in the workshop costs its materials + labor + overhead: that becomes its
  -- purchase cost, the one cost margins and statistics use.
  if exists (select 1 from public.product_bom where product_id = p_product_id and deleted_at is null) then
    insert into public.product_costs (product_id, cost)
    select p_product_id, round(coalesce(sum(b.quantity * coalesce(m.avg_cost, 0)), 0) + coalesce(p_labor, 0) + coalesce(p_overhead, 0), 3)
      from public.product_bom b join public.raw_materials m on m.id = b.material_id
     where b.product_id = p_product_id and b.deleted_at is null
    on conflict (product_id) do update set cost = excluded.cost, deleted_at = null, updated_at = now();
  end if;
end;
$$;


--
-- Name: purchase_order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text DEFAULT ('PO-'::text || lpad((nextval('public.purchase_order_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    supplier_id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    expected_date date,
    location_id uuid,
    notes text,
    subtotal numeric(14,3) DEFAULT 0 NOT NULL,
    vat_amount numeric(14,3) DEFAULT 0 NOT NULL,
    total numeric(14,3) DEFAULT 0 NOT NULL,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'rfq'::text, 'ordered'::text, 'partial'::text, 'received'::text, 'cancelled'::text])))
);


--
-- Name: save_purchase_order(uuid, jsonb, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_purchase_order(p_id uuid, p_po jsonb, p_lines jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.purchase_orders
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  po public.purchase_orders;
  line jsonb;
  pos integer := 0;
  keep uuid[] := '{}';
begin
  if p_id is null then
    insert into public.purchase_orders (supplier_id, status, order_date, expected_date, location_id, notes, created_by, created_by_email)
    values ((p_po->>'supplier_id')::uuid, coalesce(nullif(p_po->>'status', ''), 'draft'),
            coalesce(nullif(p_po->>'order_date', '')::date, current_date), nullif(p_po->>'expected_date', '')::date,
            nullif(p_po->>'location_id', '')::uuid, nullif(p_po->>'notes', ''), p_actor, p_actor_email)
    returning * into po;
  else
    select * into po from public.purchase_orders where id = p_id and deleted_at is null for update;
    if not found then
      raise exception 'purchase_order_not_found';
    end if;
    if po.status in ('received', 'cancelled') and p_lines is not null then
      raise exception 'purchase_order_closed';
    end if;
    update public.purchase_orders
       set supplier_id = coalesce(nullif(p_po->>'supplier_id', '')::uuid, supplier_id),
           status = coalesce(nullif(p_po->>'status', ''), status),
           order_date = coalesce(nullif(p_po->>'order_date', '')::date, order_date),
           expected_date = case when p_po ? 'expected_date' then nullif(p_po->>'expected_date', '')::date else expected_date end,
           location_id = case when p_po ? 'location_id' then nullif(p_po->>'location_id', '')::uuid else location_id end,
           notes = case when p_po ? 'notes' then nullif(p_po->>'notes', '') else notes end
     where id = p_id
    returning * into po;
  end if;

  if p_lines is not null then
    for line in select * from jsonb_array_elements(p_lines) loop
      pos := pos + 1;
      if nullif(line->>'id', '') is not null then
        update public.purchase_order_lines
           set variant_id = nullif(line->>'variant_id', '')::uuid, material_id = nullif(line->>'material_id', '')::uuid,
               description = coalesce(line->>'description', ''), quantity = (line->>'quantity')::numeric,
               unit_cost = coalesce(nullif(line->>'unit_cost', '')::numeric, 0),
               vat_rate = coalesce(nullif(line->>'vat_rate', '')::numeric, 19), position = pos
         where id = (line->>'id')::uuid and purchase_order_id = po.id;
        keep := keep || (line->>'id')::uuid;
      else
        insert into public.purchase_order_lines (purchase_order_id, variant_id, material_id, description, quantity, unit_cost, vat_rate, position)
        values (po.id, nullif(line->>'variant_id', '')::uuid, nullif(line->>'material_id', '')::uuid, coalesce(line->>'description', ''),
                (line->>'quantity')::numeric, coalesce(nullif(line->>'unit_cost', '')::numeric, 0),
                coalesce(nullif(line->>'vat_rate', '')::numeric, 19), pos)
        returning array_append(keep, id) into keep;
      end if;
    end loop;
    if exists (select 1 from public.purchase_order_lines
                where purchase_order_id = po.id and deleted_at is null and not (id = any (keep)) and received_quantity > 0) then
      raise exception 'line_already_received';
    end if;
    update public.purchase_order_lines set deleted_at = now()
     where purchase_order_id = po.id and deleted_at is null and not (id = any (keep));
  end if;

  update public.purchase_orders p
     set subtotal = t.subtotal, vat_amount = t.vat, total = t.subtotal + t.vat
    from (
      select coalesce(round(sum(quantity * unit_cost), 3), 0) as subtotal,
             coalesce(round(sum(quantity * unit_cost * vat_rate / 100), 3), 0) as vat
        from public.purchase_order_lines where purchase_order_id = po.id and deleted_at is null
    ) t
   where p.id = po.id
  returning p.* into po;
  return po;
end;
$$;


--
-- Name: search_products(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products(p_query text, p_limit integer DEFAULT 200) RETURNS TABLE(product_id uuid, rank real)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with q as (
    select public.normalize_search_text(p_query) as phrase
  ),
  words as (
    select distinct w
      from q, regexp_split_to_table(q.phrase, ' ') as w
     where length(w) >= 2 or (length(w) = 1 and w ~ '[0-9]')
  ),
  word_count as (
    select count(*) as n from words
  ),
  live as (
    select p.id, p.search_name, p.search_text, p.sold_count
      from public.products p
     where p.deleted_at is null and p.status = 'active'
  ),
  scored as (
    select l.id,
           count(*) filter (where position(w in l.search_text) > 0) as exact_hits,
           count(*) filter (where position(w in l.search_text) > 0
                               or extensions.word_similarity(w, l.search_text) >= 0.5) as fuzzy_hits,
           sum(case
                 when position(w in l.search_name) > 0 then 3
                 when position(w in l.search_text) > 0 then 1
                 else extensions.word_similarity(w, l.search_text)
               end) as score,
           max(l.sold_count) as sold_count,
           bool_or(position(q.phrase in l.search_name) > 0) as phrase_in_name
      from live l
      cross join words
      cross join q
     group by l.id
  ),
  exact as (
    select s.* from scored s, word_count wc where s.exact_hits = wc.n
  ),
  matched as (
    select * from exact
    union all
    select s.* from scored s, word_count wc
     where s.fuzzy_hits = wc.n and not exists (select 1 from exact)
  )
  select m.id,
         (m.score + case when m.phrase_in_name then 5 else 0 end + least(m.sold_count, 100) / 1000.0)::real
    from matched m
   order by 2 desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;


--
-- Name: agent_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    user_email text,
    month date NOT NULL,
    target_orders integer,
    target_confirmed integer,
    target_delivered integer,
    target_revenue numeric(12,3),
    commission_type text DEFAULT 'none'::text NOT NULL,
    commission_value numeric(12,3) DEFAULT 0 NOT NULL,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    prize_tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT agent_goals_commission_type_check CHECK ((commission_type = ANY (ARRAY['none'::text, 'percent'::text, 'per_order'::text, 'tiers'::text]))),
    CONSTRAINT agent_goals_commission_value_check CHECK ((commission_value >= (0)::numeric)),
    CONSTRAINT agent_goals_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
    CONSTRAINT agent_goals_prize_tiers_check CHECK ((jsonb_typeof(prize_tiers) = 'array'::text)),
    CONSTRAINT agent_goals_target_confirmed_check CHECK ((target_confirmed >= 0)),
    CONSTRAINT agent_goals_target_delivered_check CHECK ((target_delivered >= 0)),
    CONSTRAINT agent_goals_target_orders_check CHECK ((target_orders >= 0)),
    CONSTRAINT agent_goals_target_revenue_check CHECK ((target_revenue >= (0)::numeric))
);


--
-- Name: set_agent_goal(uuid, text, date[], jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_agent_goal(p_user uuid, p_user_email text, p_months date[], p_goal jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS SETOF public.agent_goals
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.agent_goals set deleted_at = now()
   where user_id = p_user and month = any (p_months) and deleted_at is null;
  return query
  insert into public.agent_goals (user_id, user_email, month, target_orders, target_confirmed, target_delivered, target_revenue,
                                  commission_type, commission_value, prize_tiers, created_by, created_by_email)
  select p_user, p_user_email, m, nullif(p_goal->>'target_orders', '')::integer, nullif(p_goal->>'target_confirmed', '')::integer,
         nullif(p_goal->>'target_delivered', '')::integer, nullif(p_goal->>'target_revenue', '')::numeric,
         coalesce(nullif(p_goal->>'commission_type', ''), 'none'), coalesce(nullif(p_goal->>'commission_value', '')::numeric, 0),
         case when jsonb_typeof(p_goal->'prize_tiers') = 'array' then p_goal->'prize_tiers' else '[]'::jsonb end,
         p_actor, p_actor_email
    from unnest(p_months) as m
  returning *;
end;
$$;


--
-- Name: set_featured_categories(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_featured_categories(p_category_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  ids uuid[] := coalesce(p_category_ids, '{}');
begin
  update public.categories c
     set is_featured = false, featured_position = null
   where c.is_featured and not (c.id = any (ids));

  update public.categories c
     set is_featured = true, featured_position = array_position(ids, c.id) - 1
   where c.id = any (ids)
     and (not c.is_featured or c.featured_position is distinct from array_position(ids, c.id) - 1);

  return coalesce(array_length(ids, 1), 0);
end;
$$;


--
-- Name: set_landing_products(text, uuid[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_landing_products(p_section text, p_product_ids uuid[], p_actor uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  ids uuid[] := coalesce(p_product_ids, '{}');
  i integer;
begin
  if p_section not in ('new_arrivals', 'showcase', 'ring', 'top_products', 'promo_products', 'spotlight') then
    raise exception 'invalid_section';
  end if;

  update public.landing_products lp
     set deleted_at = now()
   where lp.section = p_section and lp.deleted_at is null and not (lp.product_id = any (ids));

  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    update public.landing_products lp
       set position = i - 1
     where lp.section = p_section and lp.product_id = ids[i] and lp.deleted_at is null;
    if not found then
      insert into public.landing_products (section, product_id, position, created_by)
      values (p_section, ids[i], i - 1, p_actor);
    end if;
  end loop;

  return coalesce(array_length(ids, 1), 0);
end;
$$;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number text NOT NULL,
    user_id uuid,
    customer_email text,
    customer_first_name text NOT NULL,
    customer_last_name text NOT NULL,
    customer_phone text NOT NULL,
    shipping_address text,
    shipping_city text,
    shipping_state text,
    shipping_zip text,
    shipping_country text,
    subtotal numeric(10,2) NOT NULL,
    shipping_cost numeric(10,2) DEFAULT 0 NOT NULL,
    total numeric(10,2) NOT NULL,
    order_notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stock_deducted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    created_by_email text,
    channel text DEFAULT 'website'::text NOT NULL,
    campaign_id uuid,
    customer_id uuid,
    assigned_to uuid,
    assigned_to_email text,
    assigned_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    confirmed_by uuid,
    confirmed_by_email text,
    delivered_at timestamp with time zone,
    returned_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    discount_amount numeric(12,3) DEFAULT 0 NOT NULL,
    location_id uuid,
    pos_session_id uuid,
    paid_amount numeric(12,3) DEFAULT 0 NOT NULL,
    CONSTRAINT orders_channel_check CHECK ((channel = ANY (ARRAY['website'::text, 'facebook'::text, 'instagram'::text, 'tiktok'::text, 'whatsapp'::text, 'phone'::text, 'store'::text, 'other'::text]))),
    CONSTRAINT orders_discount_amount_check CHECK ((discount_amount >= (0)::numeric)),
    CONSTRAINT orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text, 'failed'::text, 'refunded'::text]))),
    CONSTRAINT orders_shipping_cost_check CHECK ((shipping_cost >= (0)::numeric)),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'returned'::text, 'cancelled'::text]))),
    CONSTRAINT orders_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: set_order_status(uuid, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_order_status(p_order_id uuid, p_changes jsonb, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.orders
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  new_status text := nullif(p_changes->>'status', '');
  ord public.orders;
begin
  if new_status is not null and new_status not in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled') then
    raise exception 'invalid_status';
  end if;
  if new_status in ('processing', 'shipped', 'delivered') then
    perform public.apply_order_stock(p_order_id, 'deduct', p_actor, p_actor_email);
  elsif new_status in ('pending', 'confirmed', 'returned', 'cancelled') then
    perform public.apply_order_stock(p_order_id, 'restore', p_actor, p_actor_email);
  end if;

  update public.orders
     set status = coalesce(new_status, status),
         payment_status = case when p_changes ? 'payment_status' then p_changes->>'payment_status' else payment_status end,
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

  if not found then
    raise exception 'order_not_found';
  end if;
  return ord;
end;
$$;


--
-- Name: stock_valuation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stock_valuation() RETURNS TABLE(variant_id uuid, product_id uuid, product_name text, sku text, location_id uuid, units integer, unit_cost numeric, value numeric)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select v.id, p.id, p.name, v.sku, il.location_id, il.available,
         public.variant_unit_cost(v.id),
         round(il.available * coalesce(public.variant_unit_cost(v.id), 0), 3)
    from public.inventory_levels il
    join public.product_variants v on v.id = il.variant_id and v.deleted_at is null
    join public.products p on p.id = v.product_id and p.deleted_at is null
    join public.locations l on l.id = il.location_id and l.deleted_at is null
   where il.available > 0;
$$;


--
-- Name: treasury_balances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treasury_balances() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with flows as (
    select account, amount from public.order_payments where deleted_at is null and account in ('cash', 'bank')
    union all
    select account, net_amount from public.cod_remittances where deleted_at is null
    union all
    select account, case when direction = 'in' then amount else -amount end from public.treasury_movements where deleted_at is null
    union all
    select account, -amount from public.bill_payments where deleted_at is null
    union all
    select account, -amount from public.ad_spend where deleted_at is null and account in ('cash', 'bank')
  )
  select jsonb_build_object(
    'cash', coalesce((select sum(amount) from flows where account = 'cash'), 0),
    'bank', coalesce((select sum(amount) from flows where account = 'bank'), 0),
    'carrier', coalesce((select sum(amount) from public.order_payments
                          where deleted_at is null and account = 'carrier' and remittance_id is null), 0),
    'open_tills', coalesce((select sum(opening_float) from public.pos_sessions where status = 'open' and deleted_at is null), 0)
  );
$$;


--
-- Name: trial_balance(date, date, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trial_balance(p_from date, p_to date, p_include_drafts boolean DEFAULT false) RETURNS TABLE(account_code text, account_name text, account_class smallint, account_type text, opening numeric, debit numeric, credit numeric, closing numeric)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with lines as (
    select jl.account_code, je.entry_date, jl.debit, jl.credit
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id
     where je.deleted_at is null and je.entry_date <= p_to
       and (p_include_drafts or je.status = 'posted')
  ), sums as (
    select account_code,
           coalesce(sum(debit - credit) filter (where entry_date < p_from), 0) as opening,
           coalesce(sum(debit) filter (where entry_date >= p_from), 0) as debit,
           coalesce(sum(credit) filter (where entry_date >= p_from), 0) as credit
      from lines group by account_code
  )
  select a.code, a.name, a.class, a.type, s.opening, s.debit, s.credit, s.opening + s.debit - s.credit
    from sums s join public.accounts a on a.code = s.account_code
   order by a.code;
$$;


--
-- Name: validate_purchase_receipt(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_purchase_receipt(p_receipt_id uuid, p_actor uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text) RETURNS public.purchase_receipts
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  rec public.purchase_receipts;
  po public.purchase_orders;
  line record;
  v_location uuid;
begin
  select * into rec from public.purchase_receipts where id = p_receipt_id and deleted_at is null for update;
  if not found then
    raise exception 'receipt_not_found';
  end if;
  if rec.status <> 'pending' then
    raise exception 'receipt_not_pending';
  end if;
  select * into po from public.purchase_orders where id = rec.purchase_order_id for update;
  v_location := coalesce(rec.location_id, po.location_id);

  for line in
    select rl.*, pl.variant_id, pl.material_id, pl.unit_cost
      from public.purchase_receipt_lines rl
      join public.purchase_order_lines pl on pl.id = rl.po_line_id
     where rl.receipt_id = rec.id
  loop
    if line.quantity_accepted > 0 then
      if line.variant_id is not null then
        if v_location is null then
          raise exception 'receipt_location_required';
        end if;
        if line.quantity_accepted <> trunc(line.quantity_accepted) then
          raise exception 'product_quantity_must_be_whole';
        end if;
        insert into public.stock_movements (variant_id, location_id, type, quantity, unit_cost, reference, note, created_by, created_by_email)
        values (line.variant_id, v_location, 'restock', line.quantity_accepted::integer, round(line.unit_cost, 3),
                po.number, 'Goods receipt ' || rec.number, p_actor, p_actor_email);
        update public.products set stock_tracked = true
         where id = (select product_id from public.product_variants where id = line.variant_id) and not stock_tracked;
      elsif line.material_id is not null then
        insert into public.material_movements (material_id, type, quantity, unit_cost, reference, note, purchase_receipt_id, created_by, created_by_email)
        values (line.material_id, 'purchase', line.quantity_accepted, line.unit_cost, po.number, 'Goods receipt ' || rec.number, rec.id, p_actor, p_actor_email);
      end if;
    end if;
    update public.purchase_order_lines
       set received_quantity = received_quantity + line.quantity_accepted,
           rejected_quantity = rejected_quantity + line.quantity_rejected
     where id = line.po_line_id;
  end loop;

  update public.purchase_receipts
     set status = 'validated', validated_at = now(), validated_by = p_actor, validated_by_email = p_actor_email
   where id = rec.id
  returning * into rec;

  update public.purchase_orders p
     set status = case when not exists (
                    select 1 from public.purchase_order_lines l
                     where l.purchase_order_id = p.id and l.deleted_at is null and l.received_quantity < l.quantity)
                  then 'received' else 'partial' end
   where p.id = po.id;
  return rec;
end;
$$;


--
-- Name: variant_unit_cost(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.variant_unit_cost(p_variant_id uuid) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(pc.cost, v.avg_cost)
    from public.product_variants v
    left join public.product_costs pc on pc.product_id = v.product_id and pc.deleted_at is null
   where v.id = p_variant_id;
$$;


--
-- Name: vat_summary(date, date, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vat_summary(p_from date, p_to date, p_include_drafts boolean DEFAULT false) RETURNS TABLE(month date, collected numeric, deductible numeric, due numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select date_trunc('month', je.entry_date)::date,
         coalesce(sum(jl.credit - jl.debit) filter (where jl.account_code = private.acct('vat_collected')), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code = private.acct('vat_deductible')), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where jl.account_code = private.acct('vat_collected')), 0)
           - coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code = private.acct('vat_deductible')), 0)
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
   where je.deleted_at is null and je.entry_date between p_from and p_to
     and (p_include_drafts or je.status = 'posted')
     and jl.account_code in (private.acct('vat_collected'), private.acct('vat_deductible'))
   group by 1
   order by 1;
$$;


--
-- Name: abandoned_carts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.abandoned_carts AS
SELECT
    NULL::uuid AS id,
    NULL::uuid AS user_id,
    NULL::text AS session_id,
    NULL::timestamp with time zone AS last_activity_at,
    NULL::timestamp with time zone AS created_at,
    NULL::bigint AS item_count,
    NULL::numeric AS estimated_value,
    NULL::jsonb AS items;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    code text NOT NULL,
    name text NOT NULL,
    name_en text,
    name_ar text,
    class smallint GENERATED ALWAYS AS ((substr(code, 1, 1))::smallint) STORED,
    type text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT accounts_code_check CHECK ((code ~ '^[1-7][0-9A-Za-z]*$'::text)),
    CONSTRAINT accounts_type_check CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text, 'income'::text, 'expense'::text])))
);


--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_email text,
    actor_role text,
    source text DEFAULT 'admin'::text NOT NULL,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    label text,
    changes jsonb,
    CONSTRAINT activity_log_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'database'::text])))
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    platform text DEFAULT 'facebook'::text NOT NULL,
    starts_on date,
    ends_on date,
    budget numeric(12,3),
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ad_campaigns_budget_check CHECK ((budget >= (0)::numeric)),
    CONSTRAINT ad_campaigns_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT ad_campaigns_platform_check CHECK ((platform = ANY (ARRAY['facebook'::text, 'instagram'::text, 'tiktok'::text, 'google'::text, 'whatsapp'::text, 'influencer'::text, 'other'::text])))
);


--
-- Name: ad_spend; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_spend (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    spend_date date DEFAULT CURRENT_DATE NOT NULL,
    amount numeric(12,3) NOT NULL,
    account text DEFAULT 'bank'::text NOT NULL,
    note text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ad_spend_account_check CHECK ((account = ANY (ARRAY['bank'::text, 'cash'::text, 'payable'::text]))),
    CONSTRAINT ad_spend_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: auth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_tokens (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    purpose text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT auth_tokens_purpose_check CHECK ((purpose = ANY (ARRAY['confirm'::text, 'reset'::text])))
);


--
-- Name: back_office_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.back_office_users (
    user_id uuid NOT NULL,
    email text,
    role text NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT back_office_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])))
);


--
-- Name: bank_statement_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statement_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    statement_date date NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    amount numeric(14,3) NOT NULL,
    reference text,
    import_batch text,
    matched_line_id uuid,
    matched_at timestamp with time zone,
    matched_by uuid,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT bank_statement_lines_amount_check CHECK ((amount <> (0)::numeric))
);


--
-- Name: bill_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bill_id uuid NOT NULL,
    amount numeric(14,3) NOT NULL,
    paid_on date DEFAULT CURRENT_DATE NOT NULL,
    account text DEFAULT 'bank'::text NOT NULL,
    method text DEFAULT 'bank_transfer'::text NOT NULL,
    reference text,
    note text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT bill_payments_account_check CHECK ((account = ANY (ARRAY['cash'::text, 'bank'::text]))),
    CONSTRAINT bill_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT bill_payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'check'::text, 'card'::text, 'other'::text])))
);


--
-- Name: business_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    month date NOT NULL,
    target_revenue numeric(14,3),
    target_orders integer,
    target_confirmed integer,
    target_delivered integer,
    target_gross_margin numeric(14,3),
    max_return_rate numeric(5,2),
    ad_budget numeric(14,3),
    notes text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT business_goals_ad_budget_check CHECK ((ad_budget >= (0)::numeric)),
    CONSTRAINT business_goals_max_return_rate_check CHECK (((max_return_rate >= (0)::numeric) AND (max_return_rate <= (100)::numeric))),
    CONSTRAINT business_goals_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
    CONSTRAINT business_goals_target_confirmed_check CHECK ((target_confirmed >= 0)),
    CONSTRAINT business_goals_target_delivered_check CHECK ((target_delivered >= 0)),
    CONSTRAINT business_goals_target_gross_margin_check CHECK ((target_gross_margin >= (0)::numeric)),
    CONSTRAINT business_goals_target_orders_check CHECK ((target_orders >= 0)),
    CONSTRAINT business_goals_target_revenue_check CHECK ((target_revenue >= (0)::numeric))
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    price_at_add numeric(10,2),
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id text,
    status text DEFAULT 'active'::text NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    converted_to_order_id uuid,
    device_info jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT carts_check CHECK (((user_id IS NOT NULL) OR (session_id IS NOT NULL))),
    CONSTRAINT carts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'abandoned'::text, 'converted'::text, 'merged'::text])))
);


--
-- Name: cart_analytics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cart_analytics WITH (security_invoker='true') AS
 SELECT ((c.created_at AT TIME ZONE 'utc'::text))::date AS date,
    count(*) AS total_carts,
    count(*) FILTER (WHERE (c.status = 'converted'::text)) AS converted_carts,
    count(*) FILTER (WHERE (c.status = 'abandoned'::text)) AS abandoned_carts,
    avg(t.item_count) AS avg_items_per_cart,
    avg(t.total_value) AS avg_cart_value
   FROM (public.carts c
     LEFT JOIN ( SELECT cart_items.cart_id,
            count(*) AS item_count,
            sum(((cart_items.quantity)::numeric * cart_items.price_at_add)) AS total_value
           FROM public.cart_items
          GROUP BY cart_items.cart_id) t ON ((t.cart_id = c.id)))
  GROUP BY (((c.created_at AT TIME ZONE 'utc'::text))::date);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_ar text,
    name_fr text,
    slug text NOT NULL,
    description text,
    image_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id uuid,
    featured_position integer,
    CONSTRAINT categories_parent_not_self CHECK (((parent_id IS NULL) OR (parent_id <> id)))
);


--
-- Name: collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT collections_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.colors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    hex_code text,
    rgb_code text,
    display_name text,
    sort_order integer DEFAULT 0 NOT NULL,
    description text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: country_tax_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country_tax_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country text NOT NULL,
    country_code text NOT NULL,
    tax_rate numeric(5,4) NOT NULL,
    tax_name text,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT country_tax_rates_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate < (1)::numeric)))
);


--
-- Name: crm_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    order_id uuid,
    title text NOT NULL,
    notes text,
    due_at timestamp with time zone NOT NULL,
    assigned_to uuid,
    assigned_to_email text,
    done_at timestamp with time zone,
    done_by uuid,
    reminded_at timestamp with time zone,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT crm_tasks_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: customer_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    channel text DEFAULT 'phone'::text NOT NULL,
    direction text DEFAULT 'note'::text NOT NULL,
    body text NOT NULL,
    order_id uuid,
    external_id text,
    sender_name text,
    read_at timestamp with time zone,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT customer_interactions_body_check CHECK ((length(body) > 0)),
    CONSTRAINT customer_interactions_channel_check CHECK ((channel = ANY (ARRAY['website'::text, 'facebook'::text, 'instagram'::text, 'tiktok'::text, 'whatsapp'::text, 'phone'::text, 'store'::text, 'email'::text, 'other'::text]))),
    CONSTRAINT customer_interactions_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text, 'note'::text])))
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variant_id uuid,
    sku text DEFAULT ''::text NOT NULL,
    product_name text DEFAULT ''::text NOT NULL,
    location_id uuid NOT NULL,
    type public.stock_movement_type NOT NULL,
    quantity integer NOT NULL,
    reference text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    order_id uuid,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    unit_cost numeric(12,3),
    CONSTRAINT stock_movements_direction CHECK ((((type = ANY (ARRAY['restock'::public.stock_movement_type, 'return'::public.stock_movement_type])) AND (quantity > 0)) OR ((type = 'sale'::public.stock_movement_type) AND (quantity < 0)) OR (type = ANY (ARRAY['adjustment'::public.stock_movement_type, 'transfer'::public.stock_movement_type])))),
    CONSTRAINT stock_movements_quantity_check CHECK ((quantity <> 0)),
    CONSTRAINT stock_movements_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
);


--
-- Name: daily_movement_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.daily_movement_stats WITH (security_invoker='true') AS
 SELECT (d.day)::date AS day,
    (COALESCE(sum((- m.quantity)) FILTER (WHERE (m.type = 'sale'::public.stock_movement_type)), (0)::bigint))::integer AS sales,
    (COALESCE(sum(m.quantity) FILTER (WHERE (m.type = 'restock'::public.stock_movement_type)), (0)::bigint))::integer AS restocks,
    (COALESCE(sum(m.quantity) FILTER (WHERE (m.type = 'return'::public.stock_movement_type)), (0)::bigint))::integer AS returns,
    (COALESCE(sum(abs(m.quantity)) FILTER (WHERE (m.type = ANY (ARRAY['adjustment'::public.stock_movement_type, 'transfer'::public.stock_movement_type]))), (0)::bigint))::integer AS adjustments
   FROM (generate_series(((CURRENT_DATE - 29))::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 day'::interval) d(day)
     LEFT JOIN public.stock_movements m ON (((m.created_at)::date = (d.day)::date)))
  GROUP BY d.day
  ORDER BY d.day;


--
-- Name: document_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_counters (
    key text NOT NULL,
    value integer DEFAULT 0 NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    title text NOT NULL,
    storage_path text,
    file_name text,
    mime_type text,
    size_bytes bigint,
    related_type text,
    related_id uuid,
    partner_name text,
    document_date date,
    expires_on date,
    notes text,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT documents_kind_check CHECK ((kind = ANY (ARRAY['contract'::text, 'supplier_invoice'::text, 'sales_invoice'::text, 'delivery_note'::text, 'certificate'::text, 'receipt'::text, 'tax'::text, 'payroll'::text, 'other'::text]))),
    CONSTRAINT documents_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: erp_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hero_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hero_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    title_ar text,
    title_fr text,
    subtitle text,
    subtitle_ar text,
    subtitle_fr text,
    sub_subtitle text,
    sub_subtitle_ar text,
    sub_subtitle_fr text,
    cta_label text,
    cta_label_ar text,
    cta_label_fr text,
    cta_href text,
    image_url text,
    left_image_url text,
    background_image_url text,
    bg_color text,
    text_color text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: inventory_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_levels (
    variant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    available integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_levels_available_check CHECK ((available >= 0))
);


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    account_code text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    debit numeric(14,3) DEFAULT 0 NOT NULL,
    credit numeric(14,3) DEFAULT 0 NOT NULL,
    partner_type text,
    partner_id uuid,
    partner_name text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journal_lines_check CHECK (((debit = (0)::numeric) <> (credit = (0)::numeric))),
    CONSTRAINT journal_lines_credit_check CHECK ((credit >= (0)::numeric)),
    CONSTRAINT journal_lines_debit_check CHECK ((debit >= (0)::numeric)),
    CONSTRAINT journal_lines_partner_type_check CHECK ((partner_type = ANY (ARRAY['customer'::text, 'supplier'::text, 'carrier'::text])))
);


--
-- Name: landing_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.landing_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    section text NOT NULL,
    product_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT landing_products_section_check CHECK ((section = ANY (ARRAY['new_arrivals'::text, 'showcase'::text, 'ring'::text, 'top_products'::text, 'promo_products'::text, 'spotlight'::text])))
);


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sells_online boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT locations_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: material_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    type text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,4),
    reference text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    purchase_receipt_id uuid,
    production_id uuid,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_movements_direction CHECK ((((type = 'purchase'::text) AND (quantity > (0)::numeric)) OR ((type = 'consumption'::text) AND (quantity < (0)::numeric)) OR (type = ANY (ARRAY['adjustment'::text, 'return'::text])))),
    CONSTRAINT material_movements_quantity_check CHECK ((quantity <> (0)::numeric)),
    CONSTRAINT material_movements_type_check CHECK ((type = ANY (ARRAY['purchase'::text, 'consumption'::text, 'adjustment'::text, 'return'::text]))),
    CONSTRAINT material_movements_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
);


--
-- Name: newsletter_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now(),
    unsubscribed_at timestamp with time zone,
    ip_address text,
    user_agent text,
    referrer text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT newsletter_subscribers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'unsubscribed'::text, 'bounced'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_id uuid NOT NULL,
    kind text NOT NULL,
    type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title jsonb NOT NULL,
    body jsonb,
    url text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT notifications_kind_check CHECK ((kind = ANY (ARRAY['order'::text, 'security'::text, 'system'::text]))),
    CONSTRAINT notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_name_ar text,
    product_name_fr text,
    product_image text,
    quantity integer NOT NULL,
    price numeric(10,2) NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_id uuid,
    variant_label text,
    unit_cost numeric(12,3),
    CONSTRAINT order_items_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT order_items_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
);


--
-- Name: order_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    amount numeric(12,3) NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    account text DEFAULT 'cash'::text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    reference text,
    note text,
    remittance_id uuid,
    pos_session_id uuid,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT order_payments_account_check CHECK ((account = ANY (ARRAY['cash'::text, 'bank'::text, 'carrier'::text]))),
    CONSTRAINT order_payments_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT order_payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'bank_transfer'::text, 'check'::text, 'cod'::text, 'mobile'::text, 'other'::text])))
);


--
-- Name: product_bom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_bom (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(14,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT product_bom_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: product_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_costing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_costing (
    product_id uuid NOT NULL,
    labor_cost numeric(12,3) DEFAULT 0 NOT NULL,
    overhead_cost numeric(12,3) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT product_costing_labor_cost_check CHECK ((labor_cost >= (0)::numeric)),
    CONSTRAINT product_costing_overhead_cost_check CHECK ((overhead_cost >= (0)::numeric))
);


--
-- Name: product_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_costs (
    product_id uuid NOT NULL,
    cost numeric(10,2) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT product_costs_cost_check CHECK ((cost >= (0)::numeric))
);


--
-- Name: product_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT product_discounts_check CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT product_discounts_discount_percent_check CHECK (((discount_percent > (0)::numeric) AND (discount_percent <= (100)::numeric)))
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    image_url text NOT NULL,
    alt_text text,
    is_main boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_ar text,
    name_fr text,
    slug text NOT NULL,
    description text,
    description_ar text,
    description_fr text,
    category_id uuid,
    base_price numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    sold_count integer DEFAULT 0 NOT NULL,
    product_details text[],
    weight numeric(10,2),
    shipping_info text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code text,
    supplier_id uuid,
    collection_id uuid,
    stock_tracked boolean DEFAULT false NOT NULL,
    search_name text DEFAULT ''::text NOT NULL,
    search_text text DEFAULT ''::text NOT NULL,
    CONSTRAINT products_base_price_check CHECK ((base_price >= (0)::numeric)),
    CONSTRAINT products_sold_count_check CHECK ((sold_count >= 0)),
    CONSTRAINT products_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    subtitle text,
    badge_text text,
    discount_percent integer DEFAULT 0 NOT NULL,
    image_url text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT promotions_discount_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 100)))
);


--
-- Name: purchase_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    variant_id uuid,
    material_id uuid,
    description text DEFAULT ''::text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,4) DEFAULT 0 NOT NULL,
    vat_rate numeric(5,2) DEFAULT 19 NOT NULL,
    received_quantity numeric(14,3) DEFAULT 0 NOT NULL,
    rejected_quantity numeric(14,3) DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT purchase_order_lines_check CHECK (((variant_id IS NOT NULL) OR (material_id IS NOT NULL) OR (length(description) > 0))),
    CONSTRAINT purchase_order_lines_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT purchase_order_lines_unit_cost_check CHECK ((unit_cost >= (0)::numeric)),
    CONSTRAINT purchase_order_lines_vat_rate_check CHECK ((vat_rate >= (0)::numeric))
);


--
-- Name: purchase_receipt_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_receipt_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    po_line_id uuid NOT NULL,
    quantity_accepted numeric(14,3) DEFAULT 0 NOT NULL,
    quantity_rejected numeric(14,3) DEFAULT 0 NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT purchase_receipt_lines_check CHECK (((quantity_accepted + quantity_rejected) > (0)::numeric)),
    CONSTRAINT purchase_receipt_lines_quantity_accepted_check CHECK ((quantity_accepted >= (0)::numeric)),
    CONSTRAINT purchase_receipt_lines_quantity_rejected_check CHECK ((quantity_rejected >= (0)::numeric))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    user_agent text,
    last_success_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT push_subscriptions_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'fr'::text, 'ar'::text])))
);


--
-- Name: raw_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raw_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text,
    unit text DEFAULT 'unit'::text NOT NULL,
    supplier_id uuid,
    stock numeric(14,3) DEFAULT 0 NOT NULL,
    avg_cost numeric(14,4),
    reorder_point numeric(14,3) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT raw_materials_avg_cost_check CHECK ((avg_cost >= (0)::numeric)),
    CONSTRAINT raw_materials_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT raw_materials_reorder_point_check CHECK ((reorder_point >= (0)::numeric)),
    CONSTRAINT raw_materials_stock_check CHECK ((stock >= (0)::numeric)),
    CONSTRAINT raw_materials_unit_check CHECK ((unit = ANY (ARRAY['unit'::text, 'm'::text, 'cm'::text, 'kg'::text, 'g'::text, 'l'::text, 'ml'::text, 'roll'::text, 'pack'::text])))
);


--
-- Name: reels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    username text DEFAULT '@kachabiti'::text,
    thumbnail_url text NOT NULL,
    video_url text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    is_new boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    user_id uuid,
    user_name text,
    rating smallint NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviews_comment_check CHECK ((char_length(comment) <= 2000)),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT reviews_user_name_check CHECK ((char_length(user_name) <= 100))
);


--
-- Name: shipping_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country text NOT NULL,
    country_code text NOT NULL,
    shipping_method text DEFAULT 'standard'::text NOT NULL,
    base_rate numeric(10,2) DEFAULT 0 NOT NULL,
    free_shipping_threshold numeric(10,2),
    estimated_days_min integer DEFAULT 2,
    estimated_days_max integer DEFAULT 5,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipping_rates_base_rate_check CHECK ((base_rate >= (0)::numeric)),
    CONSTRAINT shipping_rates_shipping_method_check CHECK ((shipping_method = ANY (ARRAY['standard'::text, 'express'::text, 'overnight'::text])))
);


--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    setting_key text NOT NULL,
    setting_value text NOT NULL,
    setting_type text DEFAULT 'string'::text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT site_settings_setting_type_check CHECK ((setting_type = ANY (ARRAY['string'::text, 'number'::text, 'boolean'::text, 'json'::text])))
);


--
-- Name: sizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sizes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text,
    sort_order integer DEFAULT 0 NOT NULL,
    description text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: small_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.small_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    title_ar text,
    title_fr text,
    subtitle text,
    subtitle_ar text,
    subtitle_fr text,
    sub_subtitle text,
    sub_subtitle_ar text,
    sub_subtitle_fr text,
    cta_href text,
    image_url text,
    background_image_url text,
    bg_color text DEFAULT 'bg-gray-100'::text NOT NULL,
    text_color text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    contact_name text,
    address text,
    tax_id text,
    bank_details text,
    payment_terms_days integer DEFAULT 0 NOT NULL,
    kind text DEFAULT 'goods'::text NOT NULL,
    CONSTRAINT suppliers_kind_check CHECK ((kind = ANY (ARRAY['goods'::text, 'materials'::text, 'services'::text, 'other'::text]))),
    CONSTRAINT suppliers_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT suppliers_payment_terms_days_check CHECK ((payment_terms_days >= 0))
);


--
-- Name: treasury_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treasury_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account text NOT NULL,
    direction text NOT NULL,
    amount numeric(12,3) NOT NULL,
    category text DEFAULT 'other'::text NOT NULL,
    occurred_on date DEFAULT CURRENT_DATE NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    reference text,
    pos_session_id uuid,
    transfer_id uuid,
    created_by uuid,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT treasury_movements_account_check CHECK ((account = ANY (ARRAY['cash'::text, 'bank'::text]))),
    CONSTRAINT treasury_movements_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT treasury_movements_category_check CHECK ((category = ANY (ARRAY['opening_balance'::text, 'owner_contribution'::text, 'owner_withdrawal'::text, 'transfer'::text, 'loan'::text, 'loan_repayment'::text, 'other_income'::text, 'other_expense'::text, 'pos_difference'::text, 'other'::text]))),
    CONSTRAINT treasury_movements_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])))
);


--
-- Name: user_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    email text,
    password_hash text,
    app_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    email_confirmed_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    user_metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: -
--

CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text
);


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.accounts VALUES ('101', 'Capital social', 'Share capital', 'رأس المال', DEFAULT, 'equity', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('108', 'Compte de l''exploitant', 'Owner''s account', 'حساب المستغل', DEFAULT, 'equity', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('110', 'Résultats reportés', 'Retained earnings', 'نتائج مؤجلة', DEFAULT, 'equity', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('120', 'Résultat de l''exercice', 'Profit or loss for the year', 'نتيجة السنة', DEFAULT, 'equity', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('164', 'Emprunts', 'Loans', 'قروض', DEFAULT, 'liability', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('22', 'Immobilisations corporelles', 'Fixed assets', 'أصول ثابتة', DEFAULT, 'asset', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('31', 'Matières premières', 'Raw materials', 'مواد أولية', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('35', 'Stocks de produits finis', 'Finished goods', 'منتجات تامة', DEFAULT, 'asset', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('37', 'Stocks de marchandises', 'Goods for resale', 'بضائع', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('401', 'Fournisseurs d''exploitation', 'Suppliers', 'المزودون', DEFAULT, 'liability', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('411', 'Clients', 'Customers', 'الحرفاء', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('4118', 'Transporteur – encaissements à reverser', 'Delivery company – cash to pay out', 'شركة التوصيل – مبالغ للتحويل', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('421', 'Personnel – rémunérations dues', 'Wages payable', 'أجور مستحقة', DEFAULT, 'liability', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('431', 'CNSS', 'Social security (CNSS)', 'الضمان الاجتماعي', DEFAULT, 'liability', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('4366', 'TVA collectée', 'VAT collected', 'أداء على القيمة المضافة المحصل', DEFAULT, 'liability', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('4367', 'TVA déductible', 'VAT deductible', 'أداء على القيمة المضافة القابل للطرح', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('4368', 'Droit de timbre à payer', 'Stamp duty payable', 'معلوم الطابع', DEFAULT, 'liability', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('4371', 'Retenues à la source', 'Withholding tax', 'الخصم من المورد', DEFAULT, 'liability', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('467', 'Autres débiteurs et créditeurs', 'Other receivables and payables', 'مدينون ودائنون آخرون', DEFAULT, 'liability', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('532', 'Banques', 'Bank', 'البنك', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('541', 'Caisse', 'Cash', 'الصندوق', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('581', 'Virements internes', 'Internal transfers', 'تحويلات داخلية', DEFAULT, 'asset', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('601', 'Achats de matières premières', 'Raw material purchases', 'شراءات مواد أولية', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('6031', 'Variation des stocks de matières premières', 'Change in raw material stock', 'تغير مخزون المواد الأولية', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('6037', 'Variation des stocks de marchandises', 'Change in stock of goods', 'تغير مخزون البضائع', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('6061', 'Eau, électricité, carburant', 'Utilities and fuel', 'ماء وكهرباء ومحروقات', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('6068', 'Emballages et petites fournitures', 'Packaging and supplies', 'تغليف ولوازم', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('607', 'Achats de marchandises', 'Purchases of goods', 'شراءات بضائع', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('613', 'Locations', 'Rent', 'كراء', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('615', 'Entretien et réparations', 'Maintenance and repairs', 'صيانة وإصلاح', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('616', 'Assurances', 'Insurance', 'تأمين', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('622', 'Honoraires', 'Professional fees', 'أتعاب', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('623', 'Publicité', 'Advertising', 'إشهار', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('624', 'Transports', 'Transport', 'نقل', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('6241', 'Frais de livraison', 'Delivery fees', 'مصاريف التوصيل', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('626', 'Frais postaux et télécommunications', 'Phone and internet', 'هاتف وإنترنت', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('627', 'Services bancaires', 'Bank charges', 'خدمات بنكية', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('628', 'Autres services extérieurs', 'Other external services', 'خدمات خارجية أخرى', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('640', 'Salaires', 'Salaries', 'أجور', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('647', 'Charges sociales', 'Social charges', 'أعباء اجتماعية', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('66', 'Impôts et taxes', 'Taxes and duties', 'ضرائب ورسوم', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('651', 'Charges d''intérêts', 'Interest', 'فوائد', DEFAULT, 'expense', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('658', 'Autres charges', 'Other expenses', 'أعباء أخرى', DEFAULT, 'expense', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('701', 'Ventes de produits finis', 'Sales of finished goods', 'مبيعات منتجات تامة', DEFAULT, 'income', true, false, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('707', 'Ventes de marchandises', 'Sales of goods', 'مبيعات بضائع', DEFAULT, 'income', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('708', 'Produits des activités annexes (port facturé)', 'Shipping charged', 'معاليم شحن مفوترة', DEFAULT, 'income', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);
INSERT INTO public.accounts VALUES ('758', 'Autres produits', 'Other income', 'إيرادات أخرى', DEFAULT, 'income', true, true, '2026-10-24 16:37:46.069293+00', '2026-10-24 16:37:46.069293+00', NULL);


--
-- Data for Name: ad_campaigns; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: ad_spend; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: agent_goals; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: auth_tokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: back_office_users; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bank_statement_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bill_payments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: business_goals; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cart_items; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: carts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cod_remittances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: collections; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: colors; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: country_tax_rates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.country_tax_rates VALUES ('38d1dab1-1c1e-4f4f-8259-4b8959acb193', 'Tunisia', 'TN', 0.0000, 'TVA', 'Tax-free / Exonéré de taxe', true, '2026-10-24 16:37:45.410482+00', '2026-10-24 16:37:45.410482+00');


--
-- Data for Name: crm_tasks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: customer_interactions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: deliveries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: document_counters; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: erp_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.erp_settings VALUES ('sales', '{"late_delivery_days": 6, "pending_alert_hours": 24, "duplicate_window_days": 30}', '2026-10-24 16:37:45.977427+00');
INSERT INTO public.erp_settings VALUES ('pos', '{"max_discount_percent": 10}', '2026-10-24 16:37:45.977427+00');
INSERT INTO public.erp_settings VALUES ('accounting', '{"company": {"rc": "", "name": "Kachabity", "email": "", "phone": "", "tax_id": "", "address": ""}, "enabled": true, "accounts": {"bank": "532", "cash": "541", "loan": "164", "owner": "108", "sales": "707", "stamp": "4368", "stock": "37", "carrier": "4118", "transfer": "581", "customers": "411", "materials": "31", "suppliers": "401", "advertising": "623", "other_income": "758", "delivery_fees": "6241", "other_expense": "658", "vat_collected": "4366", "vat_deductible": "4367", "shipping_income": "708", "stock_variation": "6037", "materials_variation": "6031"}, "auto_post": false, "start_date": "2026-10-24", "invoice_stamp": 0, "sales_vat_rate": 19, "vat_registered": true, "valuation_method": "cmup"}', '2026-10-24 16:37:46.069293+00');
INSERT INTO public.erp_settings VALUES ('analytics', '{"start_date": null}', '2026-10-24 16:37:46.149259+00');


--
-- Data for Name: hero_sections; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: inventory_levels; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: journal_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: journal_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: landing_products; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.locations VALUES ('bbba6db6-1aac-497f-9dbb-7d97662b47bb', 'Main warehouse', true, '2026-10-24 16:37:45.504764+00', '2026-10-24 16:37:45.504764+00', NULL);
INSERT INTO public.locations VALUES ('b65d3df9-0d14-41e7-a061-feb6319ea580', 'Kachabiti monastir', false, '2026-10-24 16:37:45.504764+00', '2026-10-24 16:37:45.504764+00', NULL);


--
-- Data for Name: material_movements; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: newsletter_subscribers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: order_payments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_sessions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: product_bom; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: product_costing; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: product_costs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: product_discounts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: product_images; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: product_variants; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: promotions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: purchase_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: purchase_orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: purchase_receipt_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: purchase_receipts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: push_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: raw_materials; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: reels; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: reviews; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sales_invoices; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: shipping_rates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.shipping_rates VALUES ('45cbf781-b582-4240-957c-2412fdb5720b', 'Tunisia', 'TN', 'standard', 8.00, NULL, 2, 5, true, 0, '2026-10-24 16:37:45.480996+00', '2026-10-24 16:37:45.897591+00');


--
-- Data for Name: site_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.site_settings VALUES ('9aaddfc7-cc6b-4ee6-9c1f-812d4c3c9016', 'global_free_shipping_threshold', '500', 'number', 'Order subtotal above which shipping is free', '2026-10-24 16:37:45.410482+00', '2026-10-24 16:37:45.410482+00');
INSERT INTO public.site_settings VALUES ('7427de74-83ac-4bbf-87fa-da93a58ac7b3', 'free_shipping_enabled', 'true', 'boolean', 'Whether free shipping over the threshold applies', '2026-10-24 16:37:45.410482+00', '2026-10-24 16:37:45.410482+00');
INSERT INTO public.site_settings VALUES ('3c1ef516-4898-49af-a049-24724804b132', 'shipping_tax_rate', '0', 'number', 'Tax rate applied to shipping', '2026-10-24 16:37:45.410482+00', '2026-10-24 16:37:45.410482+00');
INSERT INTO public.site_settings VALUES ('aab70b18-70a2-423b-a1d0-dbc5b8e47727', 'general_tax_rate', '0', 'number', 'Tax rate when no country rate matches', '2026-10-24 16:37:45.410482+00', '2026-10-24 16:37:45.410482+00');
INSERT INTO public.site_settings VALUES ('9597f274-a32a-4e94-88c7-05546bba9010', 'landing_config', '{"lists": {"new_arrivals": {"count": 10, "autofill": true}}}', 'json', 'Home page layout and product lists (Admin → Landing page)', '2026-10-24 16:37:45.675302+00', '2026-10-24 16:37:45.675302+00');
INSERT INTO public.site_settings VALUES ('8791d5f5-5f79-4f9e-85f2-62b86541014a', 'default_shipping_cost', '8', 'number', 'Shipping cost when no country rate matches', '2026-10-24 16:37:45.410482+00', '2026-10-24 16:37:45.897591+00');


--
-- Data for Name: sizes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: small_cards; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_movements; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: treasury_movements; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_favorites; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: supabase_migrations; Owner: -
--

INSERT INTO supabase_migrations.schema_migrations VALUES ('20260928135357', '{"-- Rebuild of the storefront schema for the new Supabase project.
--
-- Derived from what the application code reads and writes (the scripts/ folder
-- was incomplete and contradictory). Access model:
--   * Catalog and content tables: public read of live rows only.
--   * All catalog/admin writes go through app/api/* with the service-role key,
--     behind the admin gate in middleware.ts, so there are no write policies.
--   * Customers: may insert reviews, manage their own favorites, read their own orders.
--   * Orders are created server-side (POST /api/orders) with the service-role key.

create schema if not exists private","create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$","-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  name_fr text,
  slug text not null unique,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_featured boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  name_fr text,
  slug text not null unique,
  description text,
  description_ar text,
  description_fr text,
  category_id uuid references public.categories (id) on delete set null,
  base_price numeric(10, 2) not null default 0 check (base_price >= 0),
  status text not null default ''active'' check (status in (''active'', ''inactive'', ''archived'')),
  sold_count integer not null default 0 check (sold_count >= 0),
  product_details text[],
  weight numeric(10, 2),
  shipping_info text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create index products_category_id_idx on public.products (category_id)","create index products_live_created_at_idx on public.products (created_at desc)
  where deleted_at is null and status = ''active''","create index products_live_sold_count_idx on public.products (sold_count desc)
  where deleted_at is null and status = ''active''","create table public.colors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex_code text,
  rgb_code text,
  display_name text,
  sort_order integer not null default 0,
  description text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.sizes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text,
  sort_order integer not null default 0,
  description text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","-- sku keeps the default constraint name product_variants_sku_key, which
-- app/api/products/route.ts matches on to show a friendly duplicate-SKU error.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  size_id uuid references public.sizes (id) on delete set null,
  color_id uuid references public.colors (id) on delete set null,
  sku text unique,
  price numeric(10, 2) check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  is_available boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create index product_variants_product_id_idx on public.product_variants (product_id)","create index product_variants_size_id_idx on public.product_variants (size_id)","create index product_variants_color_id_idx on public.product_variants (color_id)","create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  image_url text not null,
  alt_text text,
  is_main boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create index product_images_product_id_position_idx on public.product_images (product_id, position)","create index product_images_variant_id_idx on public.product_images (variant_id)","create table public.product_discounts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  discount_percent numeric(5, 2) not null check (discount_percent > 0 and discount_percent <= 100),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
)","create index product_discounts_active_product_id_idx on public.product_discounts (product_id)
  where active","-- ---------------------------------------------------------------------------
-- Storefront content
-- ---------------------------------------------------------------------------

-- Sale banners (app/api/sale-banners, components/sections/SaleBanner.tsx).
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  badge_text text,
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  image_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.reels (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  username text default ''@kachabiti'',
  thumbnail_url text not null,
  video_url text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  is_new boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.hero_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  title_ar text,
  title_fr text,
  subtitle text,
  subtitle_ar text,
  subtitle_fr text,
  sub_subtitle text,
  sub_subtitle_ar text,
  sub_subtitle_fr text,
  cta_label text,
  cta_label_ar text,
  cta_label_fr text,
  cta_href text,
  image_url text,
  left_image_url text,
  background_image_url text,
  bg_color text,
  text_color text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.small_cards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  title_ar text,
  title_fr text,
  subtitle text,
  subtitle_ar text,
  subtitle_fr text,
  sub_subtitle text,
  sub_subtitle_ar text,
  sub_subtitle_fr text,
  cta_href text,
  image_url text,
  background_image_url text,
  bg_color text not null default ''bg-gray-100'',
  text_color text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

-- Public profile used by review embeds (reviews -> users). Deliberately has no
-- email column: this table is publicly readable.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  user_name text check (char_length(user_name) <= 100),
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create index reviews_product_id_created_at_idx on public.reviews (product_id, created_at desc)","create index reviews_user_id_idx on public.reviews (user_id)","create table public.user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
)","create index user_favorites_product_id_idx on public.user_favorites (product_id)","create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid references auth.users (id) on delete set null,
  customer_email text,
  customer_first_name text not null,
  customer_last_name text not null,
  customer_phone text not null,
  shipping_address text,
  shipping_city text,
  shipping_state text,
  shipping_zip text,
  shipping_country text,
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  shipping_cost numeric(10, 2) not null default 0 check (shipping_cost >= 0),
  total numeric(10, 2) not null check (total >= 0),
  order_notes text,
  status text not null default ''pending''
    check (status in (''pending'', ''processing'', ''shipped'', ''delivered'', ''cancelled'')),
  payment_status text not null default ''pending''
    check (payment_status in (''pending'', ''paid'', ''failed'', ''refunded'')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create index orders_user_id_created_at_idx on public.orders (user_id, created_at desc)","create index orders_created_at_idx on public.orders (created_at desc)","-- product_id is kept nullable so order history survives product deletion.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  product_name_ar text,
  product_name_fr text,
  product_image text,
  quantity integer not null check (quantity > 0),
  price numeric(10, 2) not null check (price >= 0),
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
)","create index order_items_order_id_idx on public.order_items (order_id)","create index order_items_product_id_idx on public.order_items (product_id)","create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default ''active'' check (status in (''active'', ''unsubscribed'', ''bounced'')),
  subscribed_at timestamptz default now(),
  unsubscribed_at timestamptz,
  ip_address text,
  user_agent text,
  referrer text,
  metadata jsonb not null default ''{}''::jsonb
)","-- Cart analytics (admin dashboard). Nothing in the app writes carts yet.
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  session_id text unique,
  status text not null default ''active'' check (status in (''active'', ''abandoned'', ''converted'', ''merged'')),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz default now() + interval ''30 days'',
  converted_to_order_id uuid references public.orders (id) on delete set null,
  device_info jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or session_id is not null)
)","create index carts_user_id_idx on public.carts (user_id)","create index carts_converted_to_order_id_idx on public.carts (converted_to_order_id)","create index carts_active_last_activity_idx on public.carts (last_activity_at) where status = ''active''","create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  price_at_add numeric(10, 2),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
)","create index cart_items_product_id_idx on public.cart_items (product_id)","-- security_invoker so the views respect RLS on carts (service role only).
create view public.abandoned_carts with (security_invoker = true) as
select
  c.id,
  c.user_id,
  c.session_id,
  c.last_activity_at,
  c.created_at,
  count(ci.id) as item_count,
  sum(ci.quantity * ci.price_at_add) as estimated_value,
  coalesce(
    jsonb_agg(
      jsonb_build_object(''product_id'', ci.product_id, ''quantity'', ci.quantity, ''price'', ci.price_at_add)
    ) filter (where ci.id is not null),
    ''[]''::jsonb
  ) as items
from public.carts c
left join public.cart_items ci on ci.cart_id = c.id
where c.status = ''active''
  and c.last_activity_at < now() - interval ''1 hour''
  and c.last_activity_at > now() - interval ''30 days''
  and c.user_id is not null
group by c.id","create view public.cart_analytics with (security_invoker = true) as
select
  (c.created_at at time zone ''utc'')::date as date,
  count(*) as total_carts,
  count(*) filter (where c.status = ''converted'') as converted_carts,
  count(*) filter (where c.status = ''abandoned'') as abandoned_carts,
  avg(t.item_count) as avg_items_per_cart,
  avg(t.total_value) as avg_cart_value
from public.carts c
left join (
  select cart_id, count(*) as item_count, sum(quantity * price_at_add) as total_value
  from public.cart_items
  group by cart_id
) t on t.cart_id = c.id
group by 1","-- ---------------------------------------------------------------------------
-- Settings, shipping, tax
-- ---------------------------------------------------------------------------

create table public.site_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value text not null,
  setting_type text not null default ''string'' check (setting_type in (''string'', ''number'', ''boolean'', ''json'')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  country_code text not null,
  shipping_method text not null default ''standard'' check (shipping_method in (''standard'', ''express'', ''overnight'')),
  base_rate numeric(10, 2) not null default 0 check (base_rate >= 0),
  free_shipping_threshold numeric(10, 2),
  estimated_days_min integer default 2,
  estimated_days_max integer default 5,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, shipping_method)
)","create table public.country_tax_rates (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  country_code text not null unique,
  tax_rate numeric(5, 4) not null check (tax_rate >= 0 and tax_rate < 1),
  tax_name text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    ''categories'', ''products'', ''colors'', ''sizes'', ''product_variants'', ''product_images'',
    ''product_discounts'', ''promotions'', ''reels'', ''hero_sections'', ''small_cards'', ''users'',
    ''reviews'', ''orders'', ''carts'', ''cart_items'', ''site_settings'', ''shipping_rates'',
    ''country_tax_rates''
  ]
  loop
    execute format(
      ''create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()'', t);
  end loop;
end;
$$","-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security","alter table public.products enable row level security","alter table public.colors enable row level security","alter table public.sizes enable row level security","alter table public.product_variants enable row level security","alter table public.product_images enable row level security","alter table public.product_discounts enable row level security","alter table public.promotions enable row level security","alter table public.reels enable row level security","alter table public.hero_sections enable row level security","alter table public.small_cards enable row level security","alter table public.users enable row level security","alter table public.reviews enable row level security","alter table public.user_favorites enable row level security","alter table public.orders enable row level security","alter table public.order_items enable row level security","alter table public.newsletter_subscribers enable row level security","alter table public.carts enable row level security","alter table public.cart_items enable row level security","alter table public.site_settings enable row level security","alter table public.shipping_rates enable row level security","alter table public.country_tax_rates enable row level security","-- Public catalog reads (live rows only).
create policy \"Public can read live categories\" on public.categories
  for select to anon, authenticated using (deleted_at is null)","create policy \"Public can read active products\" on public.products
  for select to anon, authenticated using (deleted_at is null and status = ''active'')","create policy \"Public can read live colors\" on public.colors
  for select to anon, authenticated using (deleted_at is null)","create policy \"Public can read live sizes\" on public.sizes
  for select to anon, authenticated using (deleted_at is null)","create policy \"Public can read live variants\" on public.product_variants
  for select to anon, authenticated using (deleted_at is null)","create policy \"Public can read product images\" on public.product_images
  for select to anon, authenticated using (true)","create policy \"Public can read active discounts\" on public.product_discounts
  for select to anon, authenticated using (active)","create policy \"Public can read active sale banners\" on public.promotions
  for select to anon, authenticated using (active)","create policy \"Public can read active reels\" on public.reels
  for select to anon, authenticated using (active)","create policy \"Public can read active hero sections\" on public.hero_sections
  for select to anon, authenticated using (is_active)","create policy \"Public can read active small cards\" on public.small_cards
  for select to anon, authenticated using (is_active)","create policy \"Public can read site settings\" on public.site_settings
  for select to anon, authenticated using (true)","create policy \"Public can read active shipping rates\" on public.shipping_rates
  for select to anon, authenticated using (is_active)","create policy \"Public can read active tax rates\" on public.country_tax_rates
  for select to anon, authenticated using (is_active)","-- Profiles and reviews.
create policy \"Public can read profiles\" on public.users
  for select to anon, authenticated using (true)","create policy \"Public can read reviews\" on public.reviews
  for select to anon, authenticated using (true)","create policy \"Anyone can post a review as themselves\" on public.reviews
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()))","-- Favorites: owner only.
create policy \"Users can read their favorites\" on public.user_favorites
  for select to authenticated using (user_id = (select auth.uid()))","create policy \"Users can add their favorites\" on public.user_favorites
  for insert to authenticated with check (user_id = (select auth.uid()))","create policy \"Users can remove their favorites\" on public.user_favorites
  for delete to authenticated using (user_id = (select auth.uid()))","-- Orders: owners can read their own history; creation happens server-side.
create policy \"Users can read their orders\" on public.orders
  for select to authenticated using (user_id = (select auth.uid()))","create policy \"Users can read their order items\" on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = (select auth.uid())
    )
  )","-- newsletter_subscribers, carts, cart_items: no policies (service role only).

-- ---------------------------------------------------------------------------
-- Grants (explicit, so exposure does not depend on project Data API defaults)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated","grant select on
  public.categories, public.products, public.colors, public.sizes,
  public.product_variants, public.product_images, public.product_discounts,
  public.promotions, public.reels, public.hero_sections, public.small_cards,
  public.site_settings, public.shipping_rates, public.country_tax_rates,
  public.users, public.reviews
to anon, authenticated","grant insert (product_id, user_id, user_name, rating, comment) on public.reviews to anon, authenticated","grant select, insert, delete on public.user_favorites to authenticated","grant select on public.orders, public.order_items to authenticated","grant all on all tables in schema public to service_role","-- ---------------------------------------------------------------------------
-- Storage: product/content images, uploaded via app/api/upload/image
-- (service role). Public bucket, so files are served by public URL; no
-- storage.objects policies means clients cannot list, upload or delete.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  ''products'', ''products'', true, 5242880,
  array[''image/jpeg'', ''image/png'', ''image/webp'', ''image/gif'']
)
on conflict (id) do nothing","-- ---------------------------------------------------------------------------
-- Baseline settings (values match the fallbacks in lib/get-site-settings.ts,
-- except tax, which scripts/FIX-TAX-TO-ZERO.sql had set to 0 for Tunisia).
-- ---------------------------------------------------------------------------

insert into public.site_settings (setting_key, setting_value, setting_type, description) values
  (''global_free_shipping_threshold'', ''500'', ''number'', ''Order subtotal above which shipping is free''),
  (''free_shipping_enabled'', ''true'', ''boolean'', ''Whether free shipping over the threshold applies''),
  (''default_shipping_cost'', ''7'', ''number'', ''Shipping cost when no country rate matches''),
  (''shipping_tax_rate'', ''0'', ''number'', ''Tax rate applied to shipping''),
  (''general_tax_rate'', ''0'', ''number'', ''Tax rate when no country rate matches'')","insert into public.country_tax_rates (country, country_code, tax_rate, tax_name, description) values
  (''Tunisia'', ''TN'', 0, ''TVA'', ''Tax-free / Exonéré de taxe'')"}', 'rebuild_storefront_schema');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260928141343', '{"-- Standard shipping for Tunisia, matching the defaults in site_settings
-- (8 TND, free above the global threshold). Without a row, calculateShipping
-- logs an error on every checkout before falling back to the same values.
insert into public.shipping_rates (country, country_code, shipping_method, base_rate, free_shipping_threshold)
values (''Tunisia'', ''TN'', ''standard'', 8, null)
on conflict (country_code, shipping_method) do nothing"}', 'seed_tunisia_shipping_rate');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260928164330', '{"-- Nested categories (e.g. Kachabia tunisienne > Kachabia longue > Kachabia laine).
-- A category page lists products from the category and all of its descendants.
alter table public.categories
  add column parent_id uuid references public.categories (id) on delete set null,
  add constraint categories_parent_not_self check (parent_id is null or parent_id <> id)","create index categories_parent_id_idx on public.categories (parent_id)"}', 'category_hierarchy');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260928183053', '{"-- Customer accounts: email/password sign-up on the storefront.
--
--   * Every auth user gets a public.users profile row (name + avatar only; the table
--     is publicly readable, so it never holds the email). The row is kept in sync
--     from the user''s metadata by a trigger, so the browser never writes it.
--   * Reviews now require a signed-in customer, posting as themselves.

-- ---------------------------------------------------------------------------
-- Profile sync
-- ---------------------------------------------------------------------------

create or replace function private.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  insert into public.users (id, name, avatar_url)
  values (
    new.id,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> ''full_name'', new.raw_user_meta_data ->> ''name'', '''')), 100), ''''),
    nullif(new.raw_user_meta_data ->> ''avatar_url'', '''')
  )
  on conflict (id) do update
    set name = excluded.name,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$","revoke all on function private.sync_user_profile() from public, anon, authenticated","create trigger sync_user_profile_on_insert
  after insert on auth.users
  for each row execute function private.sync_user_profile()","create trigger sync_user_profile_on_update
  after update of raw_user_meta_data on auth.users
  for each row
  when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
  execute function private.sync_user_profile()","-- Accounts created before this migration (the admins).
insert into public.users (id, name, avatar_url)
select
  u.id,
  nullif(left(trim(coalesce(u.raw_user_meta_data ->> ''full_name'', u.raw_user_meta_data ->> ''name'', '''')), 100), ''''),
  nullif(u.raw_user_meta_data ->> ''avatar_url'', '''')
from auth.users u
on conflict (id) do nothing","-- ---------------------------------------------------------------------------
-- Reviews: signed-in customers only
-- ---------------------------------------------------------------------------

drop policy \"Anyone can post a review as themselves\" on public.reviews","create policy \"Customers can post a review as themselves\" on public.reviews
  for insert to authenticated
  with check (user_id = (select auth.uid()))","revoke insert on public.reviews from anon"}', 'customer_accounts');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261001112501', '{"-- Stock management, merged from the separate kachabiti-stock-management app.
--
-- Model:
--   * Stock lives per variant × location in inventory_levels.
--   * Stock is never written directly: insert a stock_movements row and the
--     apply_stock_movement trigger updates inventory_levels (available can''t go below 0).
--   * The location with sells_online = true feeds product_variants.stock, which the
--     storefront reads. Products with stock_tracked = false stay orderable regardless
--     (stock not counted yet) and their confirmed orders don''t deduct stock.
--   * Online orders deduct stock when confirmed (public.apply_order_stock, called by
--     the admin orders API) and get it back when cancelled.
--   * All tables are service-role only (admin API); RLS is on with no policies.

-- ---------------------------------------------------------------------------
-- Setup tables
-- ---------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  sells_online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","-- At most one location feeds the online shop.
create unique index locations_single_online_idx on public.locations (sells_online) where sells_online","create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
)","-- ---------------------------------------------------------------------------
-- Product and variant fields
-- ---------------------------------------------------------------------------

create sequence public.product_code_seq","alter table public.products
  add column code text unique,
  add column supplier_id uuid references public.suppliers (id) on delete set null,
  add column collection_id uuid references public.collections (id) on delete set null,
  add column stock_tracked boolean not null default false","create index products_supplier_id_idx on public.products (supplier_id)","create index products_collection_id_idx on public.products (collection_id)","-- Purchase cost: admin only (served by the admin API, never exposed to the storefront).
create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost numeric(10, 2) not null check (cost >= 0),
  updated_at timestamptz not null default now()
)","alter table public.product_variants
  add column reorder_point integer not null default 5 check (reorder_point >= 0)","-- ---------------------------------------------------------------------------
-- Inventory and movements
-- ---------------------------------------------------------------------------

create table public.inventory_levels (
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  available integer not null default 0 check (available >= 0),
  updated_at timestamptz not null default now(),
  primary key (variant_id, location_id)
)","create index inventory_levels_location_id_idx on public.inventory_levels (location_id)","create type public.stock_movement_type as enum (''sale'', ''restock'', ''adjustment'', ''return'', ''transfer'')","alter table public.orders
  add column stock_deducted boolean not null default false","-- Size/color the customer picked (previously not recorded).
alter table public.order_items
  add column variant_id uuid references public.product_variants (id) on delete set null,
  add column variant_label text","create index order_items_variant_id_idx on public.order_items (variant_id)","-- Append-only log. sku/product_name are snapshots so history survives variant deletion.
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid references public.product_variants (id) on delete set null,
  sku text not null default '''',
  product_name text not null default '''',
  location_id uuid not null references public.locations (id),
  type public.stock_movement_type not null,
  quantity integer not null check (quantity <> 0),
  reference text not null default '''',
  note text not null default '''',
  order_id uuid references public.orders (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint stock_movements_direction check (
    (type in (''restock'', ''return'') and quantity > 0)
    or (type = ''sale'' and quantity < 0)
    or type in (''adjustment'', ''transfer'')
  )
)","create index stock_movements_created_at_idx on public.stock_movements (created_at desc)","create index stock_movements_variant_id_idx on public.stock_movements (variant_id)","create index stock_movements_location_id_idx on public.stock_movements (location_id)","create index stock_movements_order_id_idx on public.stock_movements (order_id)","-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  current_available integer;
  online boolean;
begin
  if new.variant_id is null then
    raise exception ''variant_id is required'';
  end if;

  select v.sku, p.name
    into new.sku, new.product_name
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = new.variant_id;

  insert into public.inventory_levels (variant_id, location_id)
  values (new.variant_id, new.location_id)
  on conflict (variant_id, location_id) do nothing;

  select available into current_available
    from public.inventory_levels
   where variant_id = new.variant_id and location_id = new.location_id
   for update;

  if current_available + new.quantity < 0 then
    -- Parsed by the admin API into a readable message.
    raise exception ''insufficient_stock:%:%'', coalesce(nullif(new.sku, ''''), new.variant_id::text), current_available
      using errcode = ''P0001'';
  end if;

  update public.inventory_levels
     set available = current_available + new.quantity,
         updated_at = now()
   where variant_id = new.variant_id and location_id = new.location_id;

  select sells_online into online from public.locations where id = new.location_id;
  if online then
    update public.product_variants
       set stock = current_available + new.quantity
     where id = new.variant_id;
  end if;

  return new;
end;
$$","create trigger stock_movements_apply
  before insert on public.stock_movements
  for each row execute function private.apply_stock_movement()","-- product_variants.stock mirrors the online location for tracked products.
-- Untracked products keep their old value (the storefront ignores it for them).
create or replace function private.sync_online_stock(product_ids uuid[] default null)
returns void
language sql
set search_path = ''''
as $$
  update public.product_variants v
     set stock = coalesce((
       select il.available
         from public.inventory_levels il
         join public.locations l on l.id = il.location_id and l.sells_online
        where il.variant_id = v.id
     ), 0)
    from public.products p
   where p.id = v.product_id
     and p.stock_tracked
     and (product_ids is null or v.product_id = any (product_ids));
$$","-- When a product starts being tracked, show its real online stock.
create or replace function private.on_product_tracking_change()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if new.stock_tracked and not old.stock_tracked then
    perform private.sync_online_stock(array[new.id]);
  end if;
  return new;
end;
$$","create trigger products_tracking_change
  after update of stock_tracked on public.products
  for each row execute function private.on_product_tracking_change()","-- Switching which location sells online re-syncs every variant.
create or replace function private.on_online_location_change()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  perform private.sync_online_stock(null);
  return null;
end;
$$","create trigger locations_online_change
  after insert or update of sells_online or delete on public.locations
  for each statement execute function private.on_online_location_change()","-- Product codes (e.g. KAC-012) when none is given; prefix from the category slug.
create or replace function private.set_product_code()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  prefix text;
begin
  if new.code is null or new.code = '''' then
    select upper(left(regexp_replace(coalesce(c.slug, ''''), ''[^a-zA-Z]'', '''', ''g''), 3))
      into prefix
      from public.categories c
     where c.id = new.category_id;
    new.code := coalesce(nullif(prefix, ''''), ''PRD'') || ''-'' || lpad(nextval(''public.product_code_seq'')::text, 3, ''0'');
  end if;
  return new;
end;
$$","create trigger products_set_code
  before insert on public.products
  for each row execute function private.set_product_code()","-- Variant SKUs (CODE-COLOR-SIZE) when none is given.
create or replace function private.variant_sku(p_variant public.product_variants)
returns text
language plpgsql
set search_path = ''''
as $$
declare
  base text;
  candidate text;
begin
  select concat_ws(''-'',
           p.code,
           nullif(upper(left(regexp_replace(coalesce(c.name, ''''), ''[^a-zA-Z0-9]'', '''', ''g''), 6)), ''''),
           nullif(upper(regexp_replace(coalesce(s.name, ''''), ''[^a-zA-Z0-9]'', '''', ''g'')), ''''))
    into base
    from public.products p
    left join public.colors c on c.id = p_variant.color_id
    left join public.sizes s on s.id = p_variant.size_id
   where p.id = p_variant.product_id;

  candidate := coalesce(nullif(base, ''''), ''SKU'');
  if exists (select 1 from public.product_variants where sku = candidate and id <> p_variant.id) then
    candidate := candidate || ''-'' || left(replace(p_variant.id::text, ''-'', ''''), 4);
  end if;
  return upper(candidate);
end;
$$","create or replace function private.set_variant_sku()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if new.sku is null or trim(new.sku) = '''' then
    new.sku := private.variant_sku(new);
  end if;
  return new;
end;
$$","create trigger product_variants_set_sku
  before insert on public.product_variants
  for each row execute function private.set_variant_sku()","do $$
declare
  t text;
begin
  foreach t in array array[''locations'', ''suppliers'', ''product_costs''] loop
    execute format(''create trigger set_updated_at before update on public.%I
                      for each row execute function private.set_updated_at()'', t);
  end loop;
end;
$$","-- ---------------------------------------------------------------------------
-- Orders ↔ stock
-- ---------------------------------------------------------------------------

-- p_direction ''deduct'': record a sale per tracked item from the online location.
-- p_direction ''restore'': return what this order deducted. Idempotent via orders.stock_deducted.
-- Runs as one transaction, so a shortage on any line rolls the whole thing back.
create or replace function public.apply_order_stock(p_order_id uuid, p_direction text, p_actor uuid default null, p_actor_email text default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  ord public.orders;
  online_location uuid;
  lines integer := 0;
  item record;
begin
  select * into ord from public.orders where id = p_order_id for update;
  if not found then
    raise exception ''order_not_found'';
  end if;

  if p_direction = ''deduct'' then
    if ord.stock_deducted then return 0; end if;
    select id into online_location from public.locations where sells_online;
    if online_location is null then
      raise exception ''no_online_location'';
    end if;
    for item in
      select oi.variant_id, oi.quantity
        from public.order_items oi
        join public.product_variants v on v.id = oi.variant_id
        join public.products p on p.id = v.product_id
       where oi.order_id = p_order_id and p.stock_tracked
    loop
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
      values (item.variant_id, online_location, ''sale'', -item.quantity, ord.order_number, p_order_id, p_actor, p_actor_email);
      lines := lines + 1;
    end loop;
    update public.orders set stock_deducted = true where id = p_order_id;
  elsif p_direction = ''restore'' then
    if not ord.stock_deducted then return 0; end if;
    for item in
      select variant_id, location_id, sum(-quantity)::integer as qty
        from public.stock_movements
       where order_id = p_order_id and variant_id is not null
       group by variant_id, location_id
      having sum(-quantity) > 0
    loop
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
      values (item.variant_id, item.location_id, ''return'', item.qty, ord.order_number, p_order_id, p_actor, p_actor_email);
      lines := lines + 1;
    end loop;
    update public.orders set stock_deducted = false where id = p_order_id;
  else
    raise exception ''invalid_direction'';
  end if;

  return lines;
end;
$$","revoke all on function public.apply_order_stock(uuid, text, uuid, text) from public, anon, authenticated","grant execute on function public.apply_order_stock(uuid, text, uuid, text) to service_role","-- Daily movement totals for the dashboard chart (last 30 days).
create view public.daily_movement_stats with (security_invoker = true) as
select
  d.day::date as day,
  coalesce(sum(-m.quantity) filter (where m.type = ''sale''), 0)::integer as sales,
  coalesce(sum(m.quantity) filter (where m.type = ''restock''), 0)::integer as restocks,
  coalesce(sum(m.quantity) filter (where m.type = ''return''), 0)::integer as returns,
  coalesce(sum(abs(m.quantity)) filter (where m.type in (''adjustment'', ''transfer'')), 0)::integer as adjustments
from generate_series(current_date - 29, current_date, interval ''1 day'') as d (day)
left join public.stock_movements m on m.created_at::date = d.day::date
group by d.day
order by d.day","-- ---------------------------------------------------------------------------
-- Security: service role only
-- ---------------------------------------------------------------------------

alter table public.locations enable row level security","alter table public.suppliers enable row level security","alter table public.collections enable row level security","alter table public.product_costs enable row level security","alter table public.inventory_levels enable row level security","alter table public.stock_movements enable row level security","revoke all on public.locations, public.suppliers, public.collections, public.product_costs,
  public.inventory_levels, public.stock_movements, public.daily_movement_stats from anon, authenticated","grant all on public.locations, public.suppliers, public.collections, public.product_costs,
  public.inventory_levels, public.stock_movements, public.daily_movement_stats to service_role","grant usage, select on sequence public.product_code_seq to service_role","revoke all on function private.apply_stock_movement() from public, anon, authenticated","revoke all on function private.sync_online_stock(uuid[]) from public, anon, authenticated","revoke all on function private.variant_sku(public.product_variants) from public, anon, authenticated","-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

insert into public.locations (name, sells_online) values
  (''Main warehouse'', true),
  (''Kachabiti monastir'', false)","-- Product codes for existing products, oldest first.
update public.products p
   set code = sub.code
  from (
    select p2.id,
           coalesce(nullif(upper(left(regexp_replace(coalesce(c.slug, ''''), ''[^a-zA-Z]'', '''', ''g''), 3)), ''''), ''PRD'')
             || ''-'' || lpad(nextval(''public.product_code_seq'')::text, 3, ''0'') as code
      from public.products p2
      left join public.categories c on c.id = p2.category_id
     where p2.code is null
     order by p2.created_at
  ) sub
 where p.id = sub.id","-- SKUs for existing variants (one at a time so collision checks see earlier ones).
do $$
declare
  v public.product_variants;
begin
  for v in select * from public.product_variants where sku is null or trim(sku) = '''' order by created_at loop
    update public.product_variants set sku = private.variant_sku(v) where id = v.id;
  end loop;
end;
$$"}', 'stock_management');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261001130516', '{"-- The stock triggers call other objects in the private schema (sync_online_stock, variant_sku,
-- product_code_seq). Callers (service_role) have no usage on that schema, so these functions run
-- as their owner. All of them already pin search_path = ''''.
alter function private.apply_stock_movement() security definer","alter function private.sync_online_stock(uuid[]) security definer","alter function private.on_product_tracking_change() security definer","alter function private.on_online_location_change() security definer","alter function private.set_product_code() security definer","alter function private.variant_sku(public.product_variants) security definer","alter function private.set_variant_sku() security definer","revoke all on function private.apply_stock_movement(), private.sync_online_stock(uuid[]),
  private.on_product_tracking_change(), private.on_online_location_change(), private.set_product_code(),
  private.variant_sku(public.product_variants), private.set_variant_sku() from public, anon, authenticated"}', 'stock_trigger_privileges');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261001170000', '{"-- Multi-step writes as single database functions, so each runs in one transaction:
-- if any step fails (stock shortage, duplicate SKU, constraint, lost connection), nothing
-- is written. The API routes call these through supabase.rpc() with the service role.

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- Checkout: the order and its lines together. Amounts are computed (and checked) by the API.
create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  ord public.orders;
begin
  insert into public.orders (
    order_number, user_id, customer_email, customer_first_name, customer_last_name, customer_phone,
    shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country,
    subtotal, shipping_cost, total, order_notes, status, payment_status
  ) values (
    p_order->>''order_number'', nullif(p_order->>''user_id'', '''')::uuid, nullif(p_order->>''customer_email'', ''''),
    p_order->>''customer_first_name'', p_order->>''customer_last_name'', p_order->>''customer_phone'',
    nullif(p_order->>''shipping_address'', ''''), nullif(p_order->>''shipping_city'', ''''), nullif(p_order->>''shipping_state'', ''''),
    nullif(p_order->>''shipping_zip'', ''''), nullif(p_order->>''shipping_country'', ''''),
    (p_order->>''subtotal'')::numeric, (p_order->>''shipping_cost'')::numeric, (p_order->>''total'')::numeric,
    nullif(p_order->>''order_notes'', ''''), ''pending'', ''pending''
  )
  returning * into ord;

  insert into public.order_items (
    order_id, product_id, variant_id, variant_label, product_name, product_name_ar, product_name_fr,
    product_image, quantity, price, subtotal
  )
  select ord.id, i.product_id, i.variant_id, i.variant_label, i.product_name, i.product_name_ar, i.product_name_fr,
         i.product_image, i.quantity, i.price, i.subtotal
    from jsonb_to_recordset(p_items) as i (
      product_id uuid, variant_id uuid, variant_label text, product_name text, product_name_ar text,
      product_name_fr text, product_image text, quantity integer, price numeric, subtotal numeric
    );

  return jsonb_build_object(
    ''order'', to_jsonb(ord),
    ''items'', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = ord.id), ''[]''::jsonb)
  );
end;
$$","-- Status/payment/notes change plus the matching stock movement, together.
-- processing/shipped/delivered deduct the order''s tracked items; pending/cancelled return them.
create or replace function public.set_order_status(p_order_id uuid, p_changes jsonb, p_actor uuid default null, p_actor_email text default null)
returns public.orders
language plpgsql
set search_path = ''''
as $$
declare
  new_status text := nullif(p_changes->>''status'', '''');
  ord public.orders;
begin
  if new_status in (''processing'', ''shipped'', ''delivered'') then
    perform public.apply_order_stock(p_order_id, ''deduct'', p_actor, p_actor_email);
  elsif new_status in (''pending'', ''cancelled'') then
    perform public.apply_order_stock(p_order_id, ''restore'', p_actor, p_actor_email);
  end if;

  update public.orders
     set status = coalesce(new_status, status),
         payment_status = case when p_changes ? ''payment_status'' then p_changes->>''payment_status'' else payment_status end,
         order_notes = case when p_changes ? ''order_notes'' then nullif(p_changes->>''order_notes'', '''') else order_notes end,
         updated_at = now()
   where id = p_order_id
  returning * into ord;

  if not found then
    raise exception ''order_not_found'';
  end if;
  return ord;
end;
$$","-- Deletes orders (one or many) after returning any stock they took. All or nothing.
create or replace function public.delete_orders(p_order_ids uuid[], p_actor uuid default null, p_actor_email text default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  v_order_id uuid;
  deleted integer := 0;
begin
  foreach v_order_id in array p_order_ids loop
    if exists (select 1 from public.orders where id = v_order_id) then
      perform public.apply_order_stock(v_order_id, ''restore'', p_actor, p_actor_email);
      delete from public.order_items where order_items.order_id = v_order_id;
      delete from public.orders where id = v_order_id;
      deleted := deleted + 1;
    end if;
  end loop;
  return deleted;
end;
$$","-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

-- Creates (p_product_id null) or updates a product with its variants and images in one go.
--   p_product: product columns to set; only keys present are changed on update.
--   p_variants: null leaves variants alone. Otherwise the full list: each is matched to an
--     existing variant by id, then by color + size, and updated in place (ids carry stock);
--     unmatched ones are inserted, and existing variants not in the list are deleted, which
--     is refused while they hold stock (unless p_keep_stocked_variants). A variant''s `images`
--     replace its photos. On create, a variant''s `stock` is recorded as opening stock at the
--     online location and the product starts tracked.
--   p_images: null leaves product photos alone; otherwise replaces them (first is main).
--   p_replace_discount / p_discount: replace the product''s discounts (used by the importer).
create or replace function public.save_product(
  p_product_id uuid,
  p_product jsonb,
  p_variants jsonb default null,
  p_images jsonb default null,
  p_replace_discount boolean default false,
  p_discount numeric default null,
  p_keep_stocked_variants boolean default false,
  p_actor uuid default null,
  p_actor_email text default null
)
returns uuid
language plpgsql
set search_path = ''''
as $$
declare
  v_product_id uuid := p_product_id;
  creating boolean := p_product_id is null;
  v jsonb;
  v_variant_id uuid;
  claimed uuid[] := ''{}'';
  opening jsonb := ''[]''::jsonb;
  stocked integer;
  online_location uuid;
begin
  if creating then
    insert into public.products (
      name, slug, description, name_ar, name_fr, description_ar, description_fr, category_id,
      base_price, status, code, supplier_id, collection_id, stock_tracked
    ) values (
      p_product->>''name'', p_product->>''slug'', nullif(p_product->>''description'', ''''),
      nullif(p_product->>''name_ar'', ''''), nullif(p_product->>''name_fr'', ''''),
      nullif(p_product->>''description_ar'', ''''), nullif(p_product->>''description_fr'', ''''),
      nullif(p_product->>''category_id'', '''')::uuid, coalesce(nullif(p_product->>''base_price'', '''')::numeric, 0),
      coalesce(nullif(p_product->>''status'', ''''), ''active''), nullif(trim(p_product->>''code''), ''''),
      nullif(p_product->>''supplier_id'', '''')::uuid, nullif(p_product->>''collection_id'', '''')::uuid,
      coalesce((p_product->>''stock_tracked'')::boolean, false)
    )
    returning id into v_product_id;
  else
    update public.products p
       set name = case when p_product ? ''name'' then p_product->>''name'' else p.name end,
           slug = case when p_product ? ''slug'' then p_product->>''slug'' else p.slug end,
           description = case when p_product ? ''description'' then nullif(p_product->>''description'', '''') else p.description end,
           name_ar = case when p_product ? ''name_ar'' then nullif(p_product->>''name_ar'', '''') else p.name_ar end,
           name_fr = case when p_product ? ''name_fr'' then nullif(p_product->>''name_fr'', '''') else p.name_fr end,
           description_ar = case when p_product ? ''description_ar'' then nullif(p_product->>''description_ar'', '''') else p.description_ar end,
           description_fr = case when p_product ? ''description_fr'' then nullif(p_product->>''description_fr'', '''') else p.description_fr end,
           category_id = case when p_product ? ''category_id'' then nullif(p_product->>''category_id'', '''')::uuid else p.category_id end,
           base_price = case when p_product ? ''base_price'' then (p_product->>''base_price'')::numeric else p.base_price end,
           status = case when p_product ? ''status'' then p_product->>''status'' else p.status end,
           code = case when p_product ? ''code'' then nullif(trim(p_product->>''code''), '''') else p.code end,
           supplier_id = case when p_product ? ''supplier_id'' then nullif(p_product->>''supplier_id'', '''')::uuid else p.supplier_id end,
           collection_id = case when p_product ? ''collection_id'' then nullif(p_product->>''collection_id'', '''')::uuid else p.collection_id end,
           stock_tracked = case when p_product ? ''stock_tracked'' then (p_product->>''stock_tracked'')::boolean else p.stock_tracked end,
           deleted_at = case when p_product ? ''restore'' and (p_product->>''restore'')::boolean then null else p.deleted_at end,
           updated_at = now()
     where p.id = v_product_id;
    if not found then
      raise exception ''product_not_found'';
    end if;
  end if;

  if p_variants is not null then
    -- Variant photos are rewritten from the payload below.
    delete from public.product_images pi where pi.product_id = v_product_id and pi.variant_id is not null;

    for v in select * from jsonb_array_elements(p_variants) loop
      v_variant_id := null;
      if nullif(v->>''id'', '''') is not null then
        select pv.id into v_variant_id
          from public.product_variants pv
         where pv.id = (v->>''id'')::uuid and pv.product_id = v_product_id and not (pv.id = any (claimed));
      end if;
      if v_variant_id is null then
        select pv.id into v_variant_id
          from public.product_variants pv
         where pv.product_id = v_product_id
           and pv.color_id is not distinct from nullif(v->>''color_id'', '''')::uuid
           and pv.size_id is not distinct from nullif(v->>''size_id'', '''')::uuid
           and not (pv.id = any (claimed))
         order by pv.deleted_at nulls first
         limit 1;
      end if;

      if v_variant_id is null then
        insert into public.product_variants (product_id, color_id, size_id, sku, price, is_available, reorder_point)
        values (
          v_product_id, nullif(v->>''color_id'', '''')::uuid, nullif(v->>''size_id'', '''')::uuid,
          nullif(trim(v->>''sku''), ''''), nullif(v->>''price'', '''')::numeric,
          coalesce((v->>''is_available'')::boolean, true), coalesce(nullif(v->>''reorder_point'', '''')::integer, 5)
        )
        returning id into v_variant_id;
        if creating and coalesce(nullif(v->>''stock'', '''')::integer, 0) > 0 then
          opening := opening || jsonb_build_object(''variant_id'', v_variant_id, ''quantity'', (v->>''stock'')::integer);
        end if;
      else
        update public.product_variants pv
           set color_id = nullif(v->>''color_id'', '''')::uuid,
               size_id = nullif(v->>''size_id'', '''')::uuid,
               sku = coalesce(nullif(trim(v->>''sku''), ''''), pv.sku),
               price = nullif(v->>''price'', '''')::numeric,
               is_available = coalesce((v->>''is_available'')::boolean, true),
               reorder_point = coalesce(nullif(v->>''reorder_point'', '''')::integer, pv.reorder_point),
               deleted_at = null,
               updated_at = now()
         where pv.id = v_variant_id;
      end if;
      claimed := claimed || v_variant_id;

      if jsonb_typeof(v->''images'') = ''array'' then
        insert into public.product_images (product_id, variant_id, image_url, alt_text, is_main, position)
        select v_product_id, v_variant_id,
               coalesce(img->>''url'', img #>> ''{}''), img->>''alt'',
               ord = 1 or coalesce((img->>''is_main'')::boolean, false),
               coalesce(nullif(img->>''position'', '''')::integer, (ord - 1)::integer)
          from jsonb_array_elements(v->''images'') with ordinality as t (img, ord)
         where coalesce(img->>''url'', img #>> ''{}'') is not null;
      end if;
    end loop;

    -- Variants left out of the list are removed, but never while they hold stock.
    select count(*) into stocked
      from public.product_variants pv
     where pv.product_id = v_product_id and not (pv.id = any (claimed))
       and exists (select 1 from public.inventory_levels l where l.variant_id = pv.id and l.available > 0);
    if stocked > 0 and not p_keep_stocked_variants then
      raise exception ''variants_with_stock:%'', stocked using errcode = ''P0001'';
    end if;
    delete from public.product_variants pv
     where pv.product_id = v_product_id and not (pv.id = any (claimed))
       and not exists (select 1 from public.inventory_levels l where l.variant_id = pv.id and l.available > 0);
  end if;

  if p_images is not null then
    delete from public.product_images pi where pi.product_id = v_product_id and pi.variant_id is null;
    insert into public.product_images (product_id, variant_id, image_url, alt_text, is_main, position)
    select v_product_id, null,
           coalesce(img->>''url'', img #>> ''{}''), img->>''alt'',
           ord = 1 or coalesce((img->>''is_main'')::boolean, false),
           coalesce(nullif(img->>''position'', '''')::integer, (ord - 1)::integer)
      from jsonb_array_elements(p_images) with ordinality as t (img, ord)
     where coalesce(img->>''url'', img #>> ''{}'') is not null;
  end if;

  if jsonb_array_length(opening) > 0 then
    select id into online_location from public.locations where sells_online;
    if online_location is not null then
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, created_by, created_by_email)
      select (o->>''variant_id'')::uuid, online_location, ''restock'', (o->>''quantity'')::integer, ''Opening stock'', p_actor, p_actor_email
        from jsonb_array_elements(opening) as o;
      update public.products p set stock_tracked = true where p.id = v_product_id;
    end if;
  end if;

  if p_replace_discount then
    delete from public.product_discounts d where d.product_id = v_product_id;
    if p_discount is not null and p_discount > 0 then
      insert into public.product_discounts (product_id, discount_percent, active) values (v_product_id, p_discount, true);
    end if;
  end if;

  return v_product_id;
end;
$$","-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------

-- Records stock movements in one transaction.
--   p_type: restock | return (add), sale (remove), adjustment (signed), transfer (from
--     p_location_id to p_to_location_id), or count (set the counted quantity; the difference
--     is recorded as an adjustment). Items may carry their own location_id (count across
--     several locations at once).
--   p_track: also switch on website tracking for the items'' products.
create or replace function public.record_stock_movements(
  p_type text,
  p_location_id uuid,
  p_items jsonb,
  p_to_location_id uuid default null,
  p_reference text default '''',
  p_note text default '''',
  p_track boolean default false,
  p_actor uuid default null,
  p_actor_email text default null
)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  item jsonb;
  item_location uuid;
  qty integer;
  current_qty integer;
  delta integer;
  recorded integer := 0;
  v_ref text := coalesce(p_reference, '''');
  v_note text := coalesce(p_note, '''');
begin
  if p_type not in (''restock'', ''return'', ''sale'', ''adjustment'', ''transfer'', ''count'') then
    raise exception ''invalid_movement_type'';
  end if;
  if p_type = ''transfer'' and (p_to_location_id is null or p_to_location_id = p_location_id) then
    raise exception ''invalid_transfer'';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    qty := (item->>''quantity'')::integer;
    item_location := coalesce(nullif(item->>''location_id'', '''')::uuid, p_location_id);

    if p_type = ''count'' then
      if qty < 0 then
        raise exception ''negative_count'';
      end if;
      -- Lock the level while counting so a concurrent sale can''t slip in between.
      select l.available into current_qty
        from public.inventory_levels l
       where l.variant_id = (item->>''variant_id'')::uuid and l.location_id = item_location
       for update;
      delta := qty - coalesce(current_qty, 0);
      if delta <> 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>''variant_id'')::uuid, item_location, ''adjustment'', delta, coalesce(nullif(v_ref, ''''), ''Stock count''), v_note, p_actor, p_actor_email);
        recorded := recorded + 1;
      end if;
    elsif p_type = ''transfer'' then
      qty := abs(qty);
      if qty > 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>''variant_id'')::uuid, item_location, ''transfer'', -qty, v_ref, v_note, p_actor, p_actor_email),
               ((item->>''variant_id'')::uuid, p_to_location_id, ''transfer'', qty, v_ref, v_note, p_actor, p_actor_email);
        recorded := recorded + 2;
      end if;
    else
      qty := case p_type when ''sale'' then -abs(qty) when ''adjustment'' then qty else abs(qty) end;
      if qty <> 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>''variant_id'')::uuid, item_location, p_type::public.stock_movement_type, qty, v_ref, v_note, p_actor, p_actor_email);
        recorded := recorded + 1;
      end if;
    end if;
  end loop;

  if p_track then
    update public.products p
       set stock_tracked = true
     where not p.stock_tracked
       and p.id in (select pv.product_id from public.product_variants pv
                     where pv.id in (select (i->>''variant_id'')::uuid from jsonb_array_elements(p_items) as i));
  end if;

  return recorded;
end;
$$","revoke all on function public.create_order(jsonb, jsonb),
  public.set_order_status(uuid, jsonb, uuid, text),
  public.delete_orders(uuid[], uuid, text),
  public.save_product(uuid, jsonb, jsonb, jsonb, boolean, numeric, boolean, uuid, text),
  public.record_stock_movements(text, uuid, jsonb, uuid, text, text, boolean, uuid, text)
  from public, anon, authenticated","grant execute on function public.create_order(jsonb, jsonb),
  public.set_order_status(uuid, jsonb, uuid, text),
  public.delete_orders(uuid[], uuid, text),
  public.save_product(uuid, jsonb, jsonb, jsonb, boolean, numeric, boolean, uuid, text),
  public.record_stock_movements(text, uuid, jsonb, uuid, text, text, boolean, uuid, text)
  to service_role"}', 'transactional_writes');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261002082656', '{"-- 1. No hard deletes: rows are marked with deleted_at (plus status/active where the table
--    has one) instead of being removed. A trigger refuses DELETE on business tables, so a
--    stray .delete() or a dashboard click fails loudly instead of losing data.
-- 2. landing_products: the products the admin picks (and orders) for the home page.

-- ---------------------------------------------------------------------------
-- Soft-delete columns
-- ---------------------------------------------------------------------------

alter table public.product_images add column deleted_at timestamptz","alter table public.product_discounts add column deleted_at timestamptz","alter table public.promotions add column deleted_at timestamptz","alter table public.reels add column deleted_at timestamptz","alter table public.hero_sections add column deleted_at timestamptz","alter table public.small_cards add column deleted_at timestamptz","alter table public.orders add column deleted_at timestamptz","alter table public.user_favorites add column deleted_at timestamptz","alter table public.locations add column deleted_at timestamptz","alter table public.suppliers add column deleted_at timestamptz","alter table public.collections add column deleted_at timestamptz","alter table public.product_costs add column deleted_at timestamptz","-- A deleted supplier/collection/location must not block re-creating one with the same name.
alter table public.locations drop constraint locations_name_key","alter table public.suppliers drop constraint suppliers_name_key","alter table public.collections drop constraint collections_name_key","create unique index locations_name_live_idx on public.locations (name) where deleted_at is null","create unique index suppliers_name_live_idx on public.suppliers (name) where deleted_at is null","create unique index collections_name_live_idx on public.collections (name) where deleted_at is null","-- ---------------------------------------------------------------------------
-- Public reads hide deleted rows
-- ---------------------------------------------------------------------------

drop policy \"Public can read product images\" on public.product_images","create policy \"Public can read live product images\" on public.product_images
  for select to anon, authenticated using (deleted_at is null)","drop policy \"Public can read active discounts\" on public.product_discounts","create policy \"Public can read active discounts\" on public.product_discounts
  for select to anon, authenticated using (active and deleted_at is null)","drop policy \"Public can read active sale banners\" on public.promotions","create policy \"Public can read active sale banners\" on public.promotions
  for select to anon, authenticated using (active and deleted_at is null)","drop policy \"Public can read active reels\" on public.reels","create policy \"Public can read active reels\" on public.reels
  for select to anon, authenticated using (active and deleted_at is null)","drop policy \"Public can read active hero sections\" on public.hero_sections","create policy \"Public can read active hero sections\" on public.hero_sections
  for select to anon, authenticated using (is_active and deleted_at is null)","drop policy \"Public can read active small cards\" on public.small_cards","create policy \"Public can read active small cards\" on public.small_cards
  for select to anon, authenticated using (is_active and deleted_at is null)","drop policy \"Users can read their orders\" on public.orders","create policy \"Users can read their orders\" on public.orders
  for select to authenticated using (user_id = (select auth.uid()) and deleted_at is null)","drop policy \"Users can read their order items\" on public.order_items","create policy \"Users can read their order items\" on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = (select auth.uid()) and o.deleted_at is null
    )
  )","-- Favorites: removing one sets deleted_at; adding it again upserts deleted_at back to null.
-- The select policy keeps the owner''s deleted rows visible so that upsert can find them;
-- lib/favorites.ts filters them out.
drop policy \"Users can remove their favorites\" on public.user_favorites","create policy \"Users can update their favorites\" on public.user_favorites
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()))","revoke delete on public.user_favorites from authenticated","grant update (user_id, product_id, deleted_at) on public.user_favorites to authenticated","-- ---------------------------------------------------------------------------
-- Functions: soft deletes instead of DELETE
-- ---------------------------------------------------------------------------

-- \"Deletes\" orders (one or many): returns any stock they took, then marks them cancelled
-- and deleted. Order lines stay attached. All or nothing.
create or replace function public.delete_orders(p_order_ids uuid[], p_actor uuid default null, p_actor_email text default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  v_order_id uuid;
  deleted integer := 0;
begin
  foreach v_order_id in array p_order_ids loop
    if exists (select 1 from public.orders where id = v_order_id and deleted_at is null) then
      perform public.apply_order_stock(v_order_id, ''restore'', p_actor, p_actor_email);
      update public.orders
         set status = ''cancelled'', deleted_at = now(), updated_at = now()
       where id = v_order_id;
      deleted := deleted + 1;
    end if;
  end loop;
  return deleted;
end;
$$","-- Same as before, except replaced photos, removed variants and replaced discounts are
-- marked deleted instead of being removed.
create or replace function public.save_product(
  p_product_id uuid,
  p_product jsonb,
  p_variants jsonb default null,
  p_images jsonb default null,
  p_replace_discount boolean default false,
  p_discount numeric default null,
  p_keep_stocked_variants boolean default false,
  p_actor uuid default null,
  p_actor_email text default null
)
returns uuid
language plpgsql
set search_path = ''''
as $$
declare
  v_product_id uuid := p_product_id;
  creating boolean := p_product_id is null;
  v jsonb;
  v_variant_id uuid;
  claimed uuid[] := ''{}'';
  opening jsonb := ''[]''::jsonb;
  stocked integer;
  online_location uuid;
begin
  if creating then
    insert into public.products (
      name, slug, description, name_ar, name_fr, description_ar, description_fr, category_id,
      base_price, status, code, supplier_id, collection_id, stock_tracked
    ) values (
      p_product->>''name'', p_product->>''slug'', nullif(p_product->>''description'', ''''),
      nullif(p_product->>''name_ar'', ''''), nullif(p_product->>''name_fr'', ''''),
      nullif(p_product->>''description_ar'', ''''), nullif(p_product->>''description_fr'', ''''),
      nullif(p_product->>''category_id'', '''')::uuid, coalesce(nullif(p_product->>''base_price'', '''')::numeric, 0),
      coalesce(nullif(p_product->>''status'', ''''), ''active''), nullif(trim(p_product->>''code''), ''''),
      nullif(p_product->>''supplier_id'', '''')::uuid, nullif(p_product->>''collection_id'', '''')::uuid,
      coalesce((p_product->>''stock_tracked'')::boolean, false)
    )
    returning id into v_product_id;
  else
    update public.products p
       set name = case when p_product ? ''name'' then p_product->>''name'' else p.name end,
           slug = case when p_product ? ''slug'' then p_product->>''slug'' else p.slug end,
           description = case when p_product ? ''description'' then nullif(p_product->>''description'', '''') else p.description end,
           name_ar = case when p_product ? ''name_ar'' then nullif(p_product->>''name_ar'', '''') else p.name_ar end,
           name_fr = case when p_product ? ''name_fr'' then nullif(p_product->>''name_fr'', '''') else p.name_fr end,
           description_ar = case when p_product ? ''description_ar'' then nullif(p_product->>''description_ar'', '''') else p.description_ar end,
           description_fr = case when p_product ? ''description_fr'' then nullif(p_product->>''description_fr'', '''') else p.description_fr end,
           category_id = case when p_product ? ''category_id'' then nullif(p_product->>''category_id'', '''')::uuid else p.category_id end,
           base_price = case when p_product ? ''base_price'' then (p_product->>''base_price'')::numeric else p.base_price end,
           status = case when p_product ? ''status'' then p_product->>''status'' else p.status end,
           code = case when p_product ? ''code'' then nullif(trim(p_product->>''code''), '''') else p.code end,
           supplier_id = case when p_product ? ''supplier_id'' then nullif(p_product->>''supplier_id'', '''')::uuid else p.supplier_id end,
           collection_id = case when p_product ? ''collection_id'' then nullif(p_product->>''collection_id'', '''')::uuid else p.collection_id end,
           stock_tracked = case when p_product ? ''stock_tracked'' then (p_product->>''stock_tracked'')::boolean else p.stock_tracked end,
           deleted_at = case when p_product ? ''restore'' and (p_product->>''restore'')::boolean then null else p.deleted_at end,
           updated_at = now()
     where p.id = v_product_id;
    if not found then
      raise exception ''product_not_found'';
    end if;
  end if;

  if p_variants is not null then
    -- Variant photos are rewritten from the payload below (the old rows are kept, marked deleted).
    update public.product_images pi set deleted_at = now()
     where pi.product_id = v_product_id and pi.variant_id is not null and pi.deleted_at is null;

    for v in select * from jsonb_array_elements(p_variants) loop
      v_variant_id := null;
      if nullif(v->>''id'', '''') is not null then
        select pv.id into v_variant_id
          from public.product_variants pv
         where pv.id = (v->>''id'')::uuid and pv.product_id = v_product_id and not (pv.id = any (claimed));
      end if;
      if v_variant_id is null then
        select pv.id into v_variant_id
          from public.product_variants pv
         where pv.product_id = v_product_id
           and pv.color_id is not distinct from nullif(v->>''color_id'', '''')::uuid
           and pv.size_id is not distinct from nullif(v->>''size_id'', '''')::uuid
           and not (pv.id = any (claimed))
         order by pv.deleted_at nulls first
         limit 1;
      end if;

      if v_variant_id is null then
        insert into public.product_variants (product_id, color_id, size_id, sku, price, is_available, reorder_point)
        values (
          v_product_id, nullif(v->>''color_id'', '''')::uuid, nullif(v->>''size_id'', '''')::uuid,
          nullif(trim(v->>''sku''), ''''), nullif(v->>''price'', '''')::numeric,
          coalesce((v->>''is_available'')::boolean, true), coalesce(nullif(v->>''reorder_point'', '''')::integer, 5)
        )
        returning id into v_variant_id;
        if creating and coalesce(nullif(v->>''stock'', '''')::integer, 0) > 0 then
          opening := opening || jsonb_build_object(''variant_id'', v_variant_id, ''quantity'', (v->>''stock'')::integer);
        end if;
      else
        update public.product_variants pv
           set color_id = nullif(v->>''color_id'', '''')::uuid,
               size_id = nullif(v->>''size_id'', '''')::uuid,
               sku = coalesce(nullif(trim(v->>''sku''), ''''), pv.sku),
               price = nullif(v->>''price'', '''')::numeric,
               is_available = coalesce((v->>''is_available'')::boolean, true),
               reorder_point = coalesce(nullif(v->>''reorder_point'', '''')::integer, pv.reorder_point),
               deleted_at = null,
               updated_at = now()
         where pv.id = v_variant_id;
      end if;
      claimed := claimed || v_variant_id;

      if jsonb_typeof(v->''images'') = ''array'' then
        insert into public.product_images (product_id, variant_id, image_url, alt_text, is_main, position)
        select v_product_id, v_variant_id,
               coalesce(img->>''url'', img #>> ''{}''), img->>''alt'',
               ord = 1 or coalesce((img->>''is_main'')::boolean, false),
               coalesce(nullif(img->>''position'', '''')::integer, (ord - 1)::integer)
          from jsonb_array_elements(v->''images'') with ordinality as t (img, ord)
         where coalesce(img->>''url'', img #>> ''{}'') is not null;
      end if;
    end loop;

    -- Variants left out of the list are removed, but never while they hold stock.
    select count(*) into stocked
      from public.product_variants pv
     where pv.product_id = v_product_id and not (pv.id = any (claimed)) and pv.deleted_at is null
       and exists (select 1 from public.inventory_levels l where l.variant_id = pv.id and l.available > 0);
    if stocked > 0 and not p_keep_stocked_variants then
      raise exception ''variants_with_stock:%'', stocked using errcode = ''P0001'';
    end if;
    update public.product_variants pv
       set deleted_at = now(), is_available = false
     where pv.product_id = v_product_id and not (pv.id = any (claimed)) and pv.deleted_at is null
       and not exists (select 1 from public.inventory_levels l where l.variant_id = pv.id and l.available > 0);
  end if;

  if p_images is not null then
    update public.product_images pi set deleted_at = now()
     where pi.product_id = v_product_id and pi.variant_id is null and pi.deleted_at is null;
    insert into public.product_images (product_id, variant_id, image_url, alt_text, is_main, position)
    select v_product_id, null,
           coalesce(img->>''url'', img #>> ''{}''), img->>''alt'',
           ord = 1 or coalesce((img->>''is_main'')::boolean, false),
           coalesce(nullif(img->>''position'', '''')::integer, (ord - 1)::integer)
      from jsonb_array_elements(p_images) with ordinality as t (img, ord)
     where coalesce(img->>''url'', img #>> ''{}'') is not null;
  end if;

  if jsonb_array_length(opening) > 0 then
    select id into online_location from public.locations where sells_online;
    if online_location is not null then
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, created_by, created_by_email)
      select (o->>''variant_id'')::uuid, online_location, ''restock'', (o->>''quantity'')::integer, ''Opening stock'', p_actor, p_actor_email
        from jsonb_array_elements(opening) as o;
      update public.products p set stock_tracked = true where p.id = v_product_id;
    end if;
  end if;

  if p_replace_discount then
    update public.product_discounts d set deleted_at = now(), active = false
     where d.product_id = v_product_id and d.deleted_at is null;
    if p_discount is not null and p_discount > 0 then
      insert into public.product_discounts (product_id, discount_percent, active) values (v_product_id, p_discount, true);
    end if;
  end if;

  return v_product_id;
end;
$$","-- ---------------------------------------------------------------------------
-- Landing page picks
-- ---------------------------------------------------------------------------

-- section: new_arrivals (pinned first, newest products fill the rest), showcase (the
-- header pieces), ring (extra pieces of the 3D ring, after the showcase ones).
create table public.landing_products (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in (''new_arrivals'', ''showcase'', ''ring'')),
  product_id uuid not null references public.products (id),
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index landing_products_section_product_live_idx
  on public.landing_products (section, product_id) where deleted_at is null","create index landing_products_section_position_idx
  on public.landing_products (section, position) where deleted_at is null","create index landing_products_product_id_idx on public.landing_products (product_id)","create index landing_products_created_by_idx on public.landing_products (created_by)","create trigger set_updated_at before update on public.landing_products
  for each row execute function private.set_updated_at()","alter table public.landing_products enable row level security","create policy \"Public can read live landing picks\" on public.landing_products
  for select to anon, authenticated using (deleted_at is null)","grant select on public.landing_products to anon, authenticated","grant all on public.landing_products to service_role","-- Replaces a section''s picks with p_product_ids, in that order. Picks left out are marked deleted.
create or replace function public.set_landing_products(p_section text, p_product_ids uuid[], p_actor uuid default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  ids uuid[] := coalesce(p_product_ids, ''{}'');
  i integer;
begin
  if p_section not in (''new_arrivals'', ''showcase'', ''ring'') then
    raise exception ''invalid_section'';
  end if;

  update public.landing_products lp
     set deleted_at = now()
   where lp.section = p_section and lp.deleted_at is null and not (lp.product_id = any (ids));

  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    update public.landing_products lp
       set position = i - 1
     where lp.section = p_section and lp.product_id = ids[i] and lp.deleted_at is null;
    if not found then
      insert into public.landing_products (section, product_id, position, created_by)
      values (p_section, ids[i], i - 1, p_actor);
    end if;
  end loop;

  return coalesce(array_length(ids, 1), 0);
end;
$$","revoke all on function public.set_landing_products(text, uuid[], uuid) from public, anon, authenticated","grant execute on function public.set_landing_products(text, uuid[], uuid) to service_role","-- Start from what the home page showed until now (the hard-coded slugs).
insert into public.landing_products (section, product_id, position)
select ''showcase'', p.id, s.ord - 1
  from unnest(array[
    ''kachabia-laine-zemnia-homme-224'', ''dengri-tunisien-homme-240'', ''blouza-djerbienne-homme-690''
  ]) with ordinality as s (slug, ord)
  join public.products p on p.slug = s.slug and p.deleted_at is null","insert into public.landing_products (section, product_id, position)
select ''ring'', p.id, s.ord - 1
  from unnest(array[
    ''kachabia-wazra-tibar-7018'', ''kachabia-ennour-3742'', ''dengri-du-marie-5849'',
    ''kachabia-poil-de-chameau-1853'', ''burnous-tunisien-laine-232'', ''kachabia-cachemire-3226'',
    ''kachabia-zemnia-rayee-4952'', ''kachabia-mlef-bouc-2638'', ''dengri-tunisien-simple-6583'',
    ''kachabia-chakhma-pro-max-2-7066'', ''kachabia-zemnia-demi-homme-241''
  ]) with ordinality as s (slug, ord)
  join public.products p on p.slug = s.slug and p.deleted_at is null","insert into public.site_settings (setting_key, setting_value, setting_type, description) values
  (''landing_new_arrivals_count'', ''10'', ''number'', ''How many products the home page New arrivals section shows''),
  (''landing_new_arrivals_autofill'', ''true'', ''boolean'', ''Fill New arrivals with the newest products after the pinned ones'')
on conflict (setting_key) do nothing","-- ---------------------------------------------------------------------------
-- Guard: no hard deletes
-- ---------------------------------------------------------------------------

create or replace function private.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  raise exception ''hard_delete_not_allowed: set deleted_at on %.% instead'', tg_table_schema, tg_table_name
    using errcode = ''P0001'';
end;
$$","-- Not guarded: users, user_favorites, carts and cart_items, which are removed by cascade
-- when Supabase Auth deletes an account; and inventory_levels, maintained by the stock trigger.
do $$
declare
  t text;
begin
  foreach t in array array[
    ''categories'', ''products'', ''colors'', ''sizes'', ''product_variants'', ''product_images'',
    ''product_discounts'', ''promotions'', ''reels'', ''hero_sections'', ''small_cards'', ''reviews'',
    ''orders'', ''order_items'', ''newsletter_subscribers'', ''site_settings'', ''shipping_rates'',
    ''country_tax_rates'', ''locations'', ''suppliers'', ''collections'', ''product_costs'',
    ''stock_movements'', ''landing_products''
  ]
  loop
    execute format(
      ''create trigger prevent_hard_delete before delete on public.%I
         for each row execute function private.prevent_hard_delete()'', t);
  end loop;
end;
$$"}', 'soft_deletes_and_landing_products');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261002084321', '{"-- 1. Every home page section is editable: product picks for top products, promotions and
--    the collection spotlight; featured categories in their own order; section order,
--    visibility and list sizes in the site_settings row `landing_config` (JSON).
-- 2. activity_log: who changed what in the back office. Triggers record every insert and
--    update on business tables; the actor comes from the x-actor-* headers that
--    lib/supabase-admin.ts adds to service-role requests made for a signed-in staff member.
-- 3. Customer accounts, favorites and carts join the no-hard-delete guard.

-- ---------------------------------------------------------------------------
-- Landing page
-- ---------------------------------------------------------------------------

alter table public.landing_products drop constraint landing_products_section_check","alter table public.landing_products add constraint landing_products_section_check
  check (section in (''new_arrivals'', ''showcase'', ''ring'', ''top_products'', ''promo_products'', ''spotlight''))","create or replace function public.set_landing_products(p_section text, p_product_ids uuid[], p_actor uuid default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  ids uuid[] := coalesce(p_product_ids, ''{}'');
  i integer;
begin
  if p_section not in (''new_arrivals'', ''showcase'', ''ring'', ''top_products'', ''promo_products'', ''spotlight'') then
    raise exception ''invalid_section'';
  end if;

  update public.landing_products lp
     set deleted_at = now()
   where lp.section = p_section and lp.deleted_at is null and not (lp.product_id = any (ids));

  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    update public.landing_products lp
       set position = i - 1
     where lp.section = p_section and lp.product_id = ids[i] and lp.deleted_at is null;
    if not found then
      insert into public.landing_products (section, product_id, position, created_by)
      values (p_section, ids[i], i - 1, p_actor);
    end if;
  end loop;

  return coalesce(array_length(ids, 1), 0);
end;
$$","-- Featured categories on the home page, in their own order (independent of sort_order,
-- which orders the menus).
alter table public.categories add column featured_position integer","update public.categories c
   set featured_position = r.pos
  from (select id, row_number() over (order by sort_order, name) - 1 as pos
          from public.categories where is_featured and deleted_at is null) r
 where c.id = r.id","-- Makes exactly p_category_ids featured, in that order.
create or replace function public.set_featured_categories(p_category_ids uuid[])
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  ids uuid[] := coalesce(p_category_ids, ''{}'');
begin
  update public.categories c
     set is_featured = false, featured_position = null
   where c.is_featured and not (c.id = any (ids));

  update public.categories c
     set is_featured = true, featured_position = array_position(ids, c.id) - 1
   where c.id = any (ids)
     and (not c.is_featured or c.featured_position is distinct from array_position(ids, c.id) - 1);

  return coalesce(array_length(ids, 1), 0);
end;
$$","revoke all on function public.set_featured_categories(uuid[]) from public, anon, authenticated","grant execute on function public.set_featured_categories(uuid[]) to service_role","-- One JSON setting replaces the two keys added earlier today (their values carry over).
insert into public.site_settings (setting_key, setting_value, setting_type, description)
select ''landing_config'',
       jsonb_build_object(
         ''lists'', jsonb_build_object(
           ''new_arrivals'', jsonb_build_object(
             ''count'', coalesce((select setting_value::integer from public.site_settings where setting_key = ''landing_new_arrivals_count''), 10),
             ''autofill'', coalesce((select setting_value::boolean from public.site_settings where setting_key = ''landing_new_arrivals_autofill''), true)
           )
         )
       )::text,
       ''json'',
       ''Home page layout and product lists (Admin → Landing page)''
on conflict (setting_key) do nothing","alter table public.site_settings disable trigger prevent_hard_delete","delete from public.site_settings where setting_key in (''landing_new_arrivals_count'', ''landing_new_arrivals_autofill'')","alter table public.site_settings enable trigger prevent_hard_delete","-- ---------------------------------------------------------------------------
-- Customer accounts: soft delete only
-- ---------------------------------------------------------------------------

alter table public.users add column deleted_at timestamptz","do $$
declare
  t text;
begin
  foreach t in array array[''users'', ''user_favorites'', ''carts'', ''cart_items''] loop
    execute format(
      ''create trigger prevent_hard_delete before delete on public.%I
         for each row execute function private.prevent_hard_delete()'', t);
  end loop;
end;
$$","-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  source text not null default ''admin'' check (source in (''admin'', ''database'')),
  action text not null,
  entity text not null,
  entity_id text,
  label text,
  changes jsonb
)","create index activity_log_created_at_idx on public.activity_log (created_at desc)","create index activity_log_actor_created_at_idx on public.activity_log (actor_id, created_at desc)","create index activity_log_entity_idx on public.activity_log (entity, entity_id)","-- Service role only (read by the admin Activity page).
alter table public.activity_log enable row level security","revoke all on public.activity_log from anon, authenticated","grant select, insert on public.activity_log to service_role","-- History can''t be rewritten.
create or replace function private.prevent_activity_log_change()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  raise exception ''activity_log_is_append_only'' using errcode = ''P0001'';
end;
$$","create trigger activity_log_append_only before update or delete on public.activity_log
  for each row execute function private.prevent_activity_log_change()","-- Records an insert or update. Requests through the API without a staff member (checkout,
-- shoppers'' favorites, scripts) are skipped; changes made directly in the database
-- (SQL editor, migrations) are recorded with source ''database''.
create or replace function private.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  headers jsonb;
  v_actor uuid;
  v_source text := ''admin'';
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_changes jsonb;
  v_action text;
begin
  begin
    headers := nullif(current_setting(''request.headers'', true), '''')::jsonb;
  exception when others then
    headers := null;
  end;

  if headers is null then
    v_source := ''database'';
  else
    begin
      v_actor := nullif(headers->>''x-actor-id'', '''')::uuid;
    exception when others then
      v_actor := null;
    end;
    if v_actor is null then
      return null;
    end if;
  end if;

  if tg_op = ''INSERT'' then
    v_action := ''create'';
    v_changes := v_new;
  else
    v_old := to_jsonb(old);
    select jsonb_object_agg(n.key, jsonb_build_object(''from'', o.value, ''to'', n.value))
      into v_changes
      from jsonb_each(v_new) n
      join jsonb_each(v_old) o using (key)
     where n.value is distinct from o.value
       and n.key not in (''updated_at'');
    if v_changes is null then
      return null;
    end if;
    v_action := case
      when v_old->>''deleted_at'' is null and v_new->>''deleted_at'' is not null then ''delete''
      when v_old->>''deleted_at'' is not null and v_new->>''deleted_at'' is null then ''restore''
      else ''update''
    end;
  end if;

  insert into public.activity_log (actor_id, actor_email, actor_role, source, action, entity, entity_id, label, changes)
  values (
    v_actor,
    nullif(headers->>''x-actor-email'', ''''),
    nullif(headers->>''x-actor-role'', ''''),
    v_source,
    v_action,
    tg_table_name,
    coalesce(v_new->>''id'', v_new->>''product_id'', v_new->>''setting_key''),
    coalesce(v_new->>''order_number'', v_new->>''name'', v_new->>''title'', v_new->>''sku'', v_new->>''setting_key'',
             v_new->>''product_name'', v_new->>''section''),
    v_changes
  );
  return null;
end;
$$","revoke all on function private.log_activity() from public, anon, authenticated","do $$
declare
  t text;
begin
  foreach t in array array[
    ''categories'', ''products'', ''colors'', ''sizes'', ''product_variants'', ''product_discounts'',
    ''promotions'', ''reels'', ''hero_sections'', ''small_cards'', ''orders'', ''site_settings'',
    ''shipping_rates'', ''country_tax_rates'', ''locations'', ''suppliers'', ''collections'',
    ''product_costs'', ''stock_movements'', ''landing_products'', ''reviews'', ''newsletter_subscribers''
  ]
  loop
    execute format(
      ''create trigger log_activity after insert or update on public.%I
         for each row execute function private.log_activity()'', t);
  end loop;
end;
$$","-- Everyone who appears in the log (for the Activity page''s user filter), including
-- accounts deleted since.
create or replace function public.activity_actors()
returns table (actor_id uuid, actor_email text, last_at timestamptz, entries bigint)
language sql
stable
set search_path = ''''
as $$
  select a.actor_id, max(a.actor_email), max(a.created_at), count(*)
    from public.activity_log a
   where a.actor_id is not null
   group by a.actor_id
   order by max(a.created_at) desc;
$$","revoke all on function public.activity_actors() from public, anon, authenticated","grant execute on function public.activity_actors() to service_role"}', 'landing_config_and_activity_log');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261002090113', '{"-- Permanent deletes, for admins and for staff given the `hard_delete` permission.
--
-- Deleting stays a soft delete everywhere. Rows that are already soft-deleted can then be
-- erased for good through public.purge_deleted() (Admin → Deleted items). It is the only way
-- past private.prevent_hard_delete, and only the service role can call it; the API checks
-- the permission (middleware.ts). Each erased row is recorded in the activity log.
--
-- Also: the activity log now trusts the x-actor-* headers only on service-role requests.
-- Before, a shopper''s own write (a review, a favorite) could carry made-up headers and be
-- logged under a staff member''s name.
--
-- And two writes that were several requests become one transaction each:
-- save_landing_page (Admin → Landing page) and delete_variant (variant + its photos).

-- ---------------------------------------------------------------------------
-- Identity of the staff member behind a request
-- ---------------------------------------------------------------------------

-- The request headers of a service-role API request (lib/supabase-admin.ts sets x-actor-*
-- from the identity middleware verified); ''{}'' for any other API request; null outside the
-- API (SQL editor, migrations, the importer''s direct connection).
create or replace function private.trusted_request_headers()
returns jsonb
language plpgsql
stable
set search_path = ''''
as $$
declare
  headers jsonb;
  claims jsonb;
begin
  begin
    headers := nullif(current_setting(''request.headers'', true), '''')::jsonb;
    claims := nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb;
  exception when others then
    return ''{}''::jsonb;
  end;
  if headers is null then
    return null;
  end if;
  if coalesce(claims->>''role'', '''') <> ''service_role'' then
    return ''{}''::jsonb;
  end if;
  return headers;
end;
$$","revoke all on function private.trusted_request_headers() from public, anon, authenticated","create or replace function private.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  headers jsonb := private.trusted_request_headers();
  v_actor uuid;
  v_source text := ''admin'';
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_changes jsonb;
  v_action text;
begin
  if headers is null then
    v_source := ''database'';
  else
    begin
      v_actor := nullif(headers->>''x-actor-id'', '''')::uuid;
    exception when others then
      v_actor := null;
    end;
    if v_actor is null then
      return null;
    end if;
  end if;

  if tg_op = ''INSERT'' then
    v_action := ''create'';
    v_changes := v_new;
  else
    v_old := to_jsonb(old);
    select jsonb_object_agg(n.key, jsonb_build_object(''from'', o.value, ''to'', n.value))
      into v_changes
      from jsonb_each(v_new) n
      join jsonb_each(v_old) o using (key)
     where n.value is distinct from o.value
       and n.key not in (''updated_at'');
    if v_changes is null then
      return null;
    end if;
    v_action := case
      when v_old->>''deleted_at'' is null and v_new->>''deleted_at'' is not null then ''delete''
      when v_old->>''deleted_at'' is not null and v_new->>''deleted_at'' is null then ''restore''
      else ''update''
    end;
  end if;

  insert into public.activity_log (actor_id, actor_email, actor_role, source, action, entity, entity_id, label, changes)
  values (
    v_actor,
    nullif(headers->>''x-actor-email'', ''''),
    nullif(headers->>''x-actor-role'', ''''),
    v_source,
    v_action,
    tg_table_name,
    coalesce(v_new->>''id'', v_new->>''product_id'', v_new->>''setting_key''),
    coalesce(v_new->>''order_number'', v_new->>''name'', v_new->>''title'', v_new->>''sku'', v_new->>''setting_key'',
             v_new->>''product_name'', v_new->>''section''),
    v_changes
  );
  return null;
end;
$$","revoke all on function private.log_activity() from public, anon, authenticated","-- ---------------------------------------------------------------------------
-- Guard: hard deletes only through purge_deleted()
-- ---------------------------------------------------------------------------

create or replace function private.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  -- Set (transaction-local) by public.purge_deleted() only. Also lets the rows its delete
  -- cascades to (variants, photos, order lines…) go.
  if current_setting(''app.purge'', true) = ''on'' then
    return old;
  end if;
  raise exception ''hard_delete_not_allowed: set deleted_at on %.% instead'', tg_table_schema, tg_table_name
    using errcode = ''P0001'';
end;
$$","-- ---------------------------------------------------------------------------
-- Erase soft-deleted rows
-- ---------------------------------------------------------------------------

-- Erases the given rows of p_table that are already soft-deleted (others are ignored) and
-- returns how many went. Nothing is erased (all or nothing) when one of them:
-- * is still used by live data, including references the database would quietly set to null
--   (a color on live variants, a category with live products or subcategories, a location
--   with stock movements): foreign_key_violation (23503);
-- * still holds stock (a product''s or variant''s inventory levels would vanish without a
--   stock movement): has_stock.
create or replace function public.purge_deleted(p_table text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  headers jsonb := private.trusted_request_headers();
  v_actor uuid;
  v_count integer;
begin
  if p_table not in (
    ''products'', ''product_variants'', ''categories'', ''colors'', ''sizes'', ''product_discounts'',
    ''promotions'', ''reels'', ''hero_sections'', ''small_cards'', ''orders'', ''locations'',
    ''suppliers'', ''collections''
  ) then
    raise exception ''purge_not_allowed: %'', p_table using errcode = ''P0001'';
  end if;

  begin
    v_actor := nullif(headers->>''x-actor-id'', '''')::uuid;
  exception when others then
    v_actor := null;
  end;

  -- Still used by live rows.
  if (p_table = ''colors'' and exists (
        select 1 from public.product_variants v where v.color_id = any (p_ids) and v.deleted_at is null))
     or (p_table = ''sizes'' and exists (
        select 1 from public.product_variants v where v.size_id = any (p_ids) and v.deleted_at is null))
     or (p_table = ''categories'' and (
        exists (select 1 from public.products p where p.category_id = any (p_ids) and p.deleted_at is null)
        or exists (select 1 from public.categories c where c.parent_id = any (p_ids) and c.deleted_at is null)))
     or (p_table = ''suppliers'' and exists (
        select 1 from public.products p where p.supplier_id = any (p_ids) and p.deleted_at is null))
     or (p_table = ''collections'' and exists (
        select 1 from public.products p where p.collection_id = any (p_ids) and p.deleted_at is null))
  then
    raise exception ''in_use: % still used by live records'', p_table using errcode = ''23503'';
  end if;

  -- Stock only changes through stock_movements; erasing a variant would drop its levels.
  if p_table in (''products'', ''product_variants'') and exists (
    select 1
      from public.inventory_levels il
      join public.product_variants v on v.id = il.variant_id
     where il.available <> 0
       and (case when p_table = ''products'' then v.product_id else v.id end) = any (p_ids)
  ) then
    raise exception ''has_stock: record a movement to bring the stock to 0 first'' using errcode = ''P0001'';
  end if;

  perform set_config(''app.purge'', ''on'', true);

  -- Home page picks point at products without a cascade; they go with the product.
  if p_table = ''products'' then
    delete from public.landing_products l
     using public.products p
     where l.product_id = p.id and p.id = any (p_ids) and p.deleted_at is not null;
  end if;

  execute format(
    ''with erased as (
       delete from public.%1$I t where t.id = any ($1) and t.deleted_at is not null returning t.*
     ), logged as (
       insert into public.activity_log (actor_id, actor_email, actor_role, source, action, entity, entity_id, label, changes)
       select $2, nullif($3->>''''x-actor-email'''', ''''''''), nullif($3->>''''x-actor-role'''', ''''''''),
              case when $3 is null then ''''database'''' else ''''admin'''' end,
              ''''purge'''', %1$L, e.id::text,
              coalesce(to_jsonb(e)->>''''order_number'''', to_jsonb(e)->>''''name'''', to_jsonb(e)->>''''title'''', to_jsonb(e)->>''''sku''''),
              to_jsonb(e)
         from erased e
       returning 1
     )
     select count(*) from logged'', p_table)
    using p_ids, v_actor, headers
    into v_count;

  perform set_config(''app.purge'', '''', true);
  return v_count;
end;
$$","revoke all on function public.purge_deleted(text, uuid[]) from public, anon, authenticated","grant execute on function public.purge_deleted(text, uuid[]) to service_role","-- ---------------------------------------------------------------------------
-- One-transaction writes used by the admin API
-- ---------------------------------------------------------------------------

-- Admin → Landing page save: a section''s picks, the layout/list settings and the featured
-- categories, each optional (null = leave as is), all or nothing.
create or replace function public.save_landing_page(
  p_section text default null,
  p_product_ids uuid[] default null,
  p_config jsonb default null,
  p_featured_category_ids uuid[] default null,
  p_actor uuid default null
)
returns void
language plpgsql
set search_path = ''''
as $$
begin
  if p_section is not null then
    perform public.set_landing_products(p_section, p_product_ids, p_actor);
  end if;
  if p_config is not null then
    insert into public.site_settings (setting_key, setting_value, setting_type)
    values (''landing_config'', p_config::text, ''json'')
    on conflict (setting_key) do update set setting_value = excluded.setting_value, setting_type = excluded.setting_type;
  end if;
  if p_featured_category_ids is not null then
    perform public.set_featured_categories(p_featured_category_ids);
  end if;
end;
$$","revoke all on function public.save_landing_page(text, uuid[], jsonb, uuid[], uuid) from public, anon, authenticated","grant execute on function public.save_landing_page(text, uuid[], jsonb, uuid[], uuid) to service_role","-- Variant delete (DELETE /api/variants): the variant and its photos together.
create or replace function public.delete_variant(p_variant_id uuid)
returns void
language plpgsql
set search_path = ''''
as $$
begin
  update public.product_variants
     set deleted_at = now(), is_available = false
   where id = p_variant_id and deleted_at is null;
  update public.product_images
     set deleted_at = now()
   where variant_id = p_variant_id and deleted_at is null;
end;
$$","revoke all on function public.delete_variant(uuid) from public, anon, authenticated","grant execute on function public.delete_variant(uuid) to service_role"}', 'permanent_deletes');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261004085227', '{"-- Product search (header suggestions and the products page).
--
-- Each product keeps two normalized texts, maintained by a trigger: search_name (its names
-- in en/fr/ar) and search_text (names, descriptions, code, and its category and parent
-- category names in all languages). Normalized means lower case, accents removed (é = e),
-- Arabic diacritics and tatweel removed, and Arabic letter variants unified (أ إ آ ٱ → ا,
-- ة → ه, ى → ي, ؤ → و, ئ → ي), so a search matches however the word was typed.
--
-- public.search_products(query) returns live products ranked by relevance: every word must
-- appear (in any order, anywhere in the text); a match in the name ranks above one in the
-- description. If no product contains all the words, it falls back to similar spellings
-- (pg_trgm word similarity), so small typos still find something.

create extension if not exists pg_trgm with schema extensions","create extension if not exists unaccent with schema extensions","create or replace function public.normalize_search_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''''
as $$
  select trim(regexp_replace(
    translate(
      regexp_replace(
        lower(extensions.unaccent(''extensions.unaccent''::regdictionary, coalesce(p_text, ''''))),
        ''[ً-ٰٟـ]'', '''', ''g''
      ),
      ''أإآٱةىؤئ'', ''ااااهيوي''
    ),
    ''[[:space:][:punct:]«»،؛؟“”‘’…–—]+'', '' '', ''g''
  ));
$$","grant execute on function public.normalize_search_text(text) to anon, authenticated, service_role","alter table public.products
  add column search_name text not null default '''',
  add column search_text text not null default ''''","create or replace function private.set_product_search()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  category_words text := '''';
begin
  select concat_ws('' '', c.name, c.name_ar, c.name_fr, parent.name, parent.name_ar, parent.name_fr)
    into category_words
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
   where c.id = new.category_id;

  new.search_name := public.normalize_search_text(concat_ws('' '', new.name, new.name_ar, new.name_fr));
  new.search_text := public.normalize_search_text(concat_ws('' '',
    new.name, new.name_ar, new.name_fr, new.code,
    new.description, new.description_ar, new.description_fr,
    category_words
  ));
  return new;
end;
$$","create trigger set_product_search
  before insert or update of name, name_ar, name_fr, code, description, description_ar, description_fr, category_id
  on public.products
  for each row execute function private.set_product_search()","-- A renamed or moved category refreshes the search text of its products (and of its
-- subcategories'' products, which carry the parent''s name too).
create or replace function private.refresh_category_search()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  update public.products p
     set category_id = p.category_id
   where p.category_id = new.id
      or p.category_id in (select c.id from public.categories c where c.parent_id = new.id);
  return null;
end;
$$","create trigger refresh_category_search
  after update of name, name_ar, name_fr, parent_id on public.categories
  for each row execute function private.refresh_category_search()","-- Fill the new columns for existing products (the trigger fires on the category_id update).
-- (Without touching updated_at or writing 59 history lines.)
alter table public.products disable trigger log_activity","alter table public.products disable trigger set_updated_at","update public.products set category_id = category_id","alter table public.products enable trigger set_updated_at","alter table public.products enable trigger log_activity","create index products_search_text_trgm_idx on public.products
  using gin (search_text extensions.gin_trgm_ops)
  where deleted_at is null","-- Ranked ids of the live products matching p_query (most relevant first).
create or replace function public.search_products(p_query text, p_limit integer default 200)
returns table (product_id uuid, rank real)
language sql
stable
set search_path = ''''
as $$
  with q as (
    select public.normalize_search_text(p_query) as phrase
  ),
  words as (
    select distinct w
      from q, regexp_split_to_table(q.phrase, '' '') as w
     where length(w) >= 2 or (length(w) = 1 and w ~ ''[0-9]'')
  ),
  word_count as (
    select count(*) as n from words
  ),
  live as (
    select p.id, p.search_name, p.search_text, p.sold_count
      from public.products p
     where p.deleted_at is null and p.status = ''active''
  ),
  scored as (
    select l.id,
           count(*) filter (where position(w in l.search_text) > 0) as exact_hits,
           count(*) filter (where position(w in l.search_text) > 0
                               or extensions.word_similarity(w, l.search_text) >= 0.5) as fuzzy_hits,
           sum(case
                 when position(w in l.search_name) > 0 then 3
                 when position(w in l.search_text) > 0 then 1
                 else extensions.word_similarity(w, l.search_text)
               end) as score,
           max(l.sold_count) as sold_count,
           bool_or(position(q.phrase in l.search_name) > 0) as phrase_in_name
      from live l
      cross join words
      cross join q
     group by l.id
  ),
  exact as (
    select s.* from scored s, word_count wc where s.exact_hits = wc.n
  ),
  matched as (
    select * from exact
    union all
    select s.* from scored s, word_count wc
     where s.fuzzy_hits = wc.n and not exists (select 1 from exact)
  )
  select m.id,
         (m.score + case when m.phrase_in_name then 5 else 0 end + least(m.sold_count, 100) / 1000.0)::real
    from matched m
   order by 2 desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$","grant execute on function public.search_products(text, integer) to anon, authenticated, service_role","-- The activity log ignores the derived search columns (same function as before otherwise).
create or replace function private.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  headers jsonb := private.trusted_request_headers();
  v_actor uuid;
  v_source text := ''admin'';
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_changes jsonb;
  v_action text;
begin
  if headers is null then
    v_source := ''database'';
  else
    begin
      v_actor := nullif(headers->>''x-actor-id'', '''')::uuid;
    exception when others then
      v_actor := null;
    end;
    if v_actor is null then
      return null;
    end if;
  end if;

  if tg_op = ''INSERT'' then
    v_action := ''create'';
    v_changes := v_new;
  else
    v_old := to_jsonb(old);
    select jsonb_object_agg(n.key, jsonb_build_object(''from'', o.value, ''to'', n.value))
      into v_changes
      from jsonb_each(v_new) n
      join jsonb_each(v_old) o using (key)
     where n.value is distinct from o.value
       and n.key not in (''updated_at'', ''search_text'', ''search_name'');
    if v_changes is null then
      return null;
    end if;
    v_action := case
      when v_old->>''deleted_at'' is null and v_new->>''deleted_at'' is not null then ''delete''
      when v_old->>''deleted_at'' is not null and v_new->>''deleted_at'' is null then ''restore''
      else ''update''
    end;
  end if;

  insert into public.activity_log (actor_id, actor_email, actor_role, source, action, entity, entity_id, label, changes)
  values (
    v_actor,
    nullif(headers->>''x-actor-email'', ''''),
    nullif(headers->>''x-actor-role'', ''''),
    v_source,
    v_action,
    tg_table_name,
    coalesce(v_new->>''id'', v_new->>''product_id'', v_new->>''setting_key''),
    coalesce(v_new->>''order_number'', v_new->>''name'', v_new->>''title'', v_new->>''sku'', v_new->>''setting_key'',
             v_new->>''product_name'', v_new->>''section''),
    v_changes
  );
  return null;
end;
$$","revoke all on function private.log_activity() from public, anon, authenticated"}', 'product_search');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261004092308', '{"-- Back-office notifications.
--
-- * New orders notify everyone who handles orders (owner, admins, staff with `orders`).
-- * Owner alerts: what admins and staff do that the owner should know about (deletes,
--   permanent erases, blocked attempts, team changes, big price cuts or discounts, large
--   stock adjustments, settings changes, cancelled or refunded orders). They are derived
--   from activity_log, so they cover every route and every way of changing data.
-- * Each notification is a row per recipient. The admin UI shows them live (Realtime) and
--   a trigger hands each new row to the `send-push` Edge Function, which delivers it as a
--   desktop notification to every browser the recipient enabled (Web Push).
--
-- Titles and bodies are stored in en/fr/ar so the admin UI and the push message use the
-- recipient''s language.

create extension if not exists pg_net with schema extensions","-- ---------------------------------------------------------------------------
-- Back-office users (who gets what)
-- ---------------------------------------------------------------------------

-- Mirror of each back-office user''s role, refreshed by GET /api/admin/me on every admin
-- visit and by the Team API. Needed because roles also come from the ADMIN_EMAILS and
-- OWNER_EMAILS settings, which the database can''t see.
create table public.back_office_users (
  user_id uuid primary key,
  email text,
  role text not null check (role in (''owner'', ''admin'', ''staff'')),
  permissions text[] not null default ''{}'',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create trigger set_updated_at before update on public.back_office_users
  for each row execute function private.set_updated_at()","alter table public.back_office_users enable row level security","revoke all on public.back_office_users from anon, authenticated","grant all on public.back_office_users to service_role","-- Live back-office users for an audience: ''orders'' or ''owner'' (owners; admins when the
-- business has no owner yet, so alerts are never lost).
create or replace function private.notification_recipients(p_audience text)
returns uuid[]
language sql
stable
security definer
set search_path = ''''
as $$
  with live as (
    select b.*
      from public.back_office_users b
      join auth.users u on u.id = b.user_id
     where b.deleted_at is null and u.deleted_at is null
  )
  select coalesce(array_agg(user_id), ''{}'')
    from live
   where case p_audience
           when ''orders'' then role in (''owner'', ''admin'') or ''orders'' = any (permissions)
           when ''owner'' then role = ''owner''
                          or (role = ''admin'' and not exists (select 1 from live where role = ''owner''))
           else false
         end;
$$","-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  recipient_id uuid not null,
  kind text not null check (kind in (''order'', ''security'', ''system'')),
  type text not null,
  severity text not null default ''info'' check (severity in (''info'', ''warning'', ''critical'')),
  title jsonb not null,
  body jsonb,
  url text,
  data jsonb not null default ''{}''::jsonb,
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc)
  where deleted_at is null","create index notifications_recipient_unread_idx on public.notifications (recipient_id)
  where read_at is null and deleted_at is null","create trigger set_updated_at before update on public.notifications
  for each row execute function private.set_updated_at()","create trigger prevent_hard_delete before delete on public.notifications
  for each row execute function private.prevent_hard_delete()","-- Each user reads their own (the admin bell subscribes through Realtime); writes go through the API.
alter table public.notifications enable row level security","create policy \"Users read their own notifications\" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()) and deleted_at is null)","revoke all on public.notifications from anon, authenticated","grant select on public.notifications to authenticated","grant all on public.notifications to service_role","alter publication supabase_realtime add table public.notifications","-- Browsers that receive desktop notifications.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  locale text not null default ''en'' check (locale in (''en'', ''fr'', ''ar'')),
  user_agent text,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where deleted_at is null","create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function private.set_updated_at()","create trigger prevent_hard_delete before delete on public.push_subscriptions
  for each row execute function private.prevent_hard_delete()","alter table public.push_subscriptions enable row level security","revoke all on public.push_subscriptions from anon, authenticated","grant all on public.push_subscriptions to service_role","-- One row per recipient.
create or replace function private.notify(
  p_recipients uuid[],
  p_kind text,
  p_type text,
  p_severity text,
  p_title jsonb,
  p_body jsonb,
  p_url text,
  p_data jsonb default ''{}''::jsonb
)
returns integer
language sql
security definer
set search_path = ''''
as $$
  with inserted as (
    insert into public.notifications (recipient_id, kind, type, severity, title, body, url, data)
    select distinct r, p_kind, p_type, p_severity, p_title, p_body, p_url, coalesce(p_data, ''{}''::jsonb)
      from unnest(p_recipients) as r
     where r is not null
    returning 1
  )
  select count(*)::integer from inserted;
$$","revoke all on function private.notify(uuid[], text, text, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated","-- {en, fr, ar} text, with {placeholders} filled from p_values (applied to every language).
create or replace function private.i18n(p_en text, p_fr text, p_ar text, p_values jsonb default ''{}''::jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''''
as $$
declare
  k text;
  v text;
  en text := p_en;
  fr text := p_fr;
  ar text := p_ar;
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_values, ''{}''::jsonb)) loop
    en := replace(en, ''{'' || k || ''}'', coalesce(v, ''''));
    fr := replace(fr, ''{'' || k || ''}'', coalesce(v, ''''));
    ar := replace(ar, ''{'' || k || ''}'', coalesce(v, ''''));
  end loop;
  return jsonb_build_object(''en'', en, ''fr'', fr, ''ar'', ar);
end;
$$","-- What a table''s rows are called, per language.
create or replace function private.entity_names(p_entity text)
returns jsonb
language sql
immutable
set search_path = ''''
as $$
  select case p_entity
    when ''products'' then ''{\"en\":\"product\",\"fr\":\"produit\",\"ar\":\"منتج\"}''
    when ''product_variants'' then ''{\"en\":\"variant\",\"fr\":\"variante\",\"ar\":\"متغير\"}''
    when ''product_images'' then ''{\"en\":\"product photo\",\"fr\":\"photo produit\",\"ar\":\"صورة منتج\"}''
    when ''categories'' then ''{\"en\":\"category\",\"fr\":\"catégorie\",\"ar\":\"فئة\"}''
    when ''colors'' then ''{\"en\":\"color\",\"fr\":\"couleur\",\"ar\":\"لون\"}''
    when ''sizes'' then ''{\"en\":\"size\",\"fr\":\"taille\",\"ar\":\"مقاس\"}''
    when ''product_discounts'' then ''{\"en\":\"product discount\",\"fr\":\"remise produit\",\"ar\":\"تخفيض منتج\"}''
    when ''promotions'' then ''{\"en\":\"sale banner\",\"fr\":\"bannière promo\",\"ar\":\"لافتة تخفيض\"}''
    when ''reels'' then ''{\"en\":\"video reel\",\"fr\":\"vidéo\",\"ar\":\"فيديو\"}''
    when ''orders'' then ''{\"en\":\"order\",\"fr\":\"commande\",\"ar\":\"طلب\"}''
    when ''locations'' then ''{\"en\":\"stock location\",\"fr\":\"emplacement\",\"ar\":\"موقع مخزون\"}''
    when ''suppliers'' then ''{\"en\":\"supplier\",\"fr\":\"fournisseur\",\"ar\":\"مورّد\"}''
    when ''collections'' then ''{\"en\":\"collection\",\"fr\":\"collection\",\"ar\":\"مجموعة\"}''
    when ''product_costs'' then ''{\"en\":\"purchase cost\",\"fr\":\"coût d''''achat\",\"ar\":\"تكلفة شراء\"}''
    when ''landing_products'' then ''{\"en\":\"home page pick\",\"fr\":\"choix page d''''accueil\",\"ar\":\"اختيار الصفحة الرئيسية\"}''
    when ''site_settings'' then ''{\"en\":\"setting\",\"fr\":\"réglage\",\"ar\":\"إعداد\"}''
    when ''shipping_rates'' then ''{\"en\":\"shipping rate\",\"fr\":\"tarif de livraison\",\"ar\":\"سعر شحن\"}''
    when ''country_tax_rates'' then ''{\"en\":\"tax rate\",\"fr\":\"taux de taxe\",\"ar\":\"نسبة ضريبة\"}''
    when ''reviews'' then ''{\"en\":\"review\",\"fr\":\"avis\",\"ar\":\"تقييم\"}''
    when ''team_member'' then ''{\"en\":\"team account\",\"fr\":\"compte d''''équipe\",\"ar\":\"حساب فريق\"}''
    else jsonb_build_object(''en'', p_entity, ''fr'', p_entity, ''ar'', p_entity)::text
  end::jsonb;
$$","-- ---------------------------------------------------------------------------
-- New orders
-- ---------------------------------------------------------------------------

-- Deferred to the end of the transaction, so create_order has inserted the lines too.
create or replace function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  items integer;
  vals jsonb;
begin
  select coalesce(sum(quantity), 0) into items from public.order_items where order_id = new.id;
  vals := jsonb_build_object(
    ''number'', new.order_number,
    ''name'', trim(concat_ws('' '', new.customer_first_name, new.customer_last_name)),
    ''city'', coalesce(nullif(new.shipping_city, ''''), nullif(new.shipping_state, ''''), ''—''),
    ''total'', trim(to_char(new.total, ''FM999999990.##'')),
    ''items'', items
  );
  perform private.notify(
    private.notification_recipients(''orders''),
    ''order'', ''new_order'', ''info'',
    private.i18n(''New order {number}'', ''Nouvelle commande {number}'', ''طلب جديد {number}'', vals),
    private.i18n(''{name} · {city} · {items} item(s) · {total} TND'',
                 ''{name} · {city} · {items} article(s) · {total} TND'',
                 ''{name} · {city} · {items} قطعة · {total} د.ت'', vals),
    ''/admin/orders/'' || new.id,
    jsonb_build_object(''order_id'', new.id, ''order_number'', new.order_number, ''total'', new.total)
  );
  return null;
end;
$$","create constraint trigger notify_new_order
  after insert on public.orders
  deferrable initially deferred
  for each row execute function private.notify_new_order()","-- ---------------------------------------------------------------------------
-- Owner alerts
-- ---------------------------------------------------------------------------

create or replace function private.owner_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  owners uuid[];
  who text := coalesce(nullif(new.actor_email, ''''), ''Someone'');
  what jsonb := private.entity_names(new.entity);
  item text := coalesce(nullif(new.label, ''''), new.entity_id, '''');
  url text := ''/admin/activity?actor='' || coalesce(new.actor_id::text, '''');
  vals jsonb;
  ch jsonb := coalesce(new.changes, ''{}''::jsonb);
  old_price numeric;
  new_price numeric;
  pct numeric;
  qty integer;
  recent integer;
  existing bigint;
begin
  -- The owner''s own actions, and direct database edits (migrations, SQL editor), don''t alert.
  if new.source <> ''admin'' or new.actor_role = ''owner'' or new.actor_id is null then
    return null;
  end if;

  owners := private.notification_recipients(''owner'');
  if cardinality(owners) = 0 then
    return null;
  end if;

  vals := jsonb_build_object(''who'', who, ''item'', item,
    ''what_en'', what->>''en'', ''what_fr'', what->>''fr'', ''what_ar'', what->>''ar'');

  -- Deletes (soft): one alert per person every 10 minutes, counting further deletes into it.
  if new.action = ''delete'' then
    select n.id into existing
      from public.notifications n
     where n.kind = ''security'' and n.type = ''delete'' and n.recipient_id = owners[1]
       and n.data->>''actor_id'' = new.actor_id::text
       and n.created_at > now() - interval ''10 minutes'' and n.deleted_at is null
     order by n.created_at desc
     limit 1;

    if existing is not null then
      select count(*) into recent
        from public.activity_log a
       where a.actor_id = new.actor_id and a.action = ''delete'' and a.created_at > now() - interval ''10 minutes'';
      update public.notifications n
         set title = private.i18n(''{who} deleted {count} items'', ''{who} a supprimé {count} éléments'', ''{who} حذف {count} عناصر'',
                                  vals || jsonb_build_object(''count'', recent)),
             body = private.i18n(''Latest: {what_en} “{item}”'', ''Dernier : {what_fr} « {item} »'', ''آخرها: {what_ar} «{item}»'', vals),
             data = n.data || jsonb_build_object(''count'', recent),
             read_at = null
       where n.kind = ''security'' and n.type = ''delete'' and n.recipient_id = any (owners)
         and n.data->>''actor_id'' = new.actor_id::text
         and n.created_at > now() - interval ''10 minutes'' and n.deleted_at is null;

      -- Many deletes in a short time: a separate, critical alert (sent once per threshold).
      if recent in (10, 25, 50, 100, 250) then
        perform private.notify(owners, ''security'', ''bulk_delete'', ''critical'',
          private.i18n(''{who} deleted {count} items in 10 minutes'', ''{who} a supprimé {count} éléments en 10 minutes'',
                       ''{who} حذف {count} عنصراً خلال 10 دقائق'', vals || jsonb_build_object(''count'', recent)),
          private.i18n(''Check the activity history. Deleted items can be restored from Deleted items.'',
                       ''Vérifiez l''''historique. Les éléments supprimés peuvent être restaurés depuis Éléments supprimés.'',
                       ''راجع سجل النشاط. يمكن استعادة العناصر المحذوفة من صفحة العناصر المحذوفة.'', vals),
          url, jsonb_build_object(''actor_id'', new.actor_id, ''count'', recent));
      end if;
      return null;
    end if;

    perform private.notify(owners, ''security'', ''delete'', ''warning'',
      private.i18n(''{who} deleted a {what_en}'', ''{who} a supprimé : {what_fr}'', ''{who} حذف {what_ar}'', vals),
      private.i18n(''“{item}”'', ''« {item} »'', ''«{item}»'', vals),
      url, jsonb_build_object(''actor_id'', new.actor_id, ''entity'', new.entity, ''entity_id'', new.entity_id, ''count'', 1));
    return null;
  end if;

  -- Permanent erase.
  if new.action = ''purge'' then
    perform private.notify(owners, ''security'', ''purge'', ''critical'',
      private.i18n(''{who} permanently erased a {what_en}'', ''{who} a effacé définitivement : {what_fr}'', ''{who} حذف نهائياً {what_ar}'', vals),
      private.i18n(''“{item}” can no longer be restored.'', ''« {item} » ne peut plus être restauré.'', ''لم يعد بالإمكان استعادة «{item}».'', vals),
      url, jsonb_build_object(''actor_id'', new.actor_id, ''entity'', new.entity, ''entity_id'', new.entity_id));
    return null;
  end if;

  -- Blocked attempt (logged by middleware): once per person and target per hour.
  if new.action = ''access_denied'' then
    if exists (
      select 1 from public.notifications n
       where n.kind = ''security'' and n.type = ''access_denied'' and n.recipient_id = owners[1]
         and n.data->>''actor_id'' = new.actor_id::text and n.data->>''target'' = item
         and n.created_at > now() - interval ''1 hour''
    ) then
      return null;
    end if;
    perform private.notify(owners, ''security'', ''access_denied'', ''warning'',
      private.i18n(''{who} tried something they are not allowed to do'', ''{who} a tenté une action non autorisée'', ''{who} حاول القيام بعملية غير مسموح بها'', vals),
      private.i18n(''Blocked: {item}'', ''Bloqué : {item}'', ''تم الحظر: {item}'', vals),
      url, jsonb_build_object(''actor_id'', new.actor_id, ''target'', item));
    return null;
  end if;

  -- Team and access changes.
  if new.entity = ''team_member'' then
    perform private.notify(owners, ''security'', ''team_'' || new.action,
      case when new.action in (''delete'', ''remove_access'') then ''warning'' else ''info'' end,
      case new.action
        when ''create'' then private.i18n(''{who} added {item} to the team'', ''{who} a ajouté {item} à l''''équipe'', ''{who} أضاف {item} إلى الفريق'', vals)
        when ''delete'' then private.i18n(''{who} deleted the account of {item}'', ''{who} a supprimé le compte de {item}'', ''{who} حذف حساب {item}'', vals)
        when ''remove_access'' then private.i18n(''{who} removed the access of {item}'', ''{who} a retiré l''''accès de {item}'', ''{who} أزال صلاحيات {item}'', vals)
        else private.i18n(''{who} changed the role or permissions of {item}'', ''{who} a modifié le rôle ou les permissions de {item}'', ''{who} غيّر دور أو صلاحيات {item}'', vals)
      end,
      private.i18n(''Role: {role}'', ''Rôle : {role}'', ''الدور: {role}'',
        jsonb_build_object(''role'', coalesce(ch #>> ''{role,to}'', ch->>''role'', ''—''))),
      url, jsonb_build_object(''actor_id'', new.actor_id, ''member'', new.entity_id));
    return null;
  end if;

  -- Price cut by half or more (product base price or a variant''s own price).
  if new.action = ''update'' and new.entity in (''products'', ''product_variants'') then
    begin
      old_price := coalesce(ch #>> ''{base_price,from}'', ch #>> ''{price,from}'')::numeric;
      new_price := coalesce(ch #>> ''{base_price,to}'', ch #>> ''{price,to}'')::numeric;
    exception when others then
      old_price := null;
    end;
    if old_price is not null and old_price > 0 and new_price is not null and new_price <= old_price * 0.5 then
      pct := round((1 - new_price / old_price) * 100);
      perform private.notify(owners, ''security'', ''price_cut'', ''warning'',
        private.i18n(''{who} cut a price by {pct}%'', ''{who} a baissé un prix de {pct} %'', ''{who} خفّض سعراً بنسبة {pct}%'', vals || jsonb_build_object(''pct'', pct)),
        private.i18n(''{item}: {from} → {to} TND'', ''{item} : {from} → {to} TND'', ''{item}: {from} ← {to} د.ت'',
          vals || jsonb_build_object(''from'', old_price, ''to'', new_price)),
        url, jsonb_build_object(''actor_id'', new.actor_id, ''entity'', new.entity, ''entity_id'', new.entity_id));
    end if;
    return null;
  end if;

  -- Discount of 50% or more.
  if new.entity = ''product_discounts'' and new.action in (''create'', ''update'') then
    begin
      pct := coalesce(ch #>> ''{discount_percent,to}'', ch->>''discount_percent'')::numeric;
    exception when others then
      pct := null;
    end;
    if pct is not null and pct >= 50 then
      select p.name into item
        from public.products p
       where p.id = coalesce(ch #>> ''{product_id,to}'', ch->>''product_id'',
                             (select d.product_id::text from public.product_discounts d where d.id::text = new.entity_id))::uuid;
      perform private.notify(owners, ''security'', ''big_discount'', ''warning'',
        private.i18n(''{who} set a {pct}% discount'', ''{who} a mis une remise de {pct} %'', ''{who} وضع تخفيضاً بنسبة {pct}%'', vals || jsonb_build_object(''pct'', pct)),
        private.i18n(''{item}'', ''{item}'', ''{item}'', jsonb_build_object(''item'', coalesce(item, ''—''))),
        url, jsonb_build_object(''actor_id'', new.actor_id, ''entity_id'', new.entity_id));
    end if;
    return null;
  end if;

  -- Large manual stock adjustment (20 units or more at once).
  if new.entity = ''stock_movements'' and new.action = ''create'' and ch->>''type'' = ''adjustment'' then
    begin
      qty := (ch->>''quantity'')::integer;
    exception when others then
      qty := null;
    end;
    if qty is not null and abs(qty) >= 20 then
      perform private.notify(owners, ''security'', ''stock_adjustment'', ''warning'',
        private.i18n(''{who} adjusted stock by {qty}'', ''{who} a ajusté le stock de {qty}'', ''{who} عدّل المخزون بمقدار {qty}'', vals || jsonb_build_object(''qty'', qty)),
        private.i18n(''{item}'', ''{item}'', ''{item}'', jsonb_build_object(''item'', coalesce(ch->>''product_name'', ch->>''sku'', item))),
        url, jsonb_build_object(''actor_id'', new.actor_id, ''entity_id'', new.entity_id));
    end if;
    return null;
  end if;

  -- Cancelled or refunded orders.
  if new.entity = ''orders'' and new.action = ''update'' then
    if ch #>> ''{payment_status,to}'' = ''refunded'' or ch #>> ''{status,to}'' = ''cancelled'' then
      perform private.notify(owners, ''security'',
        case when ch #>> ''{payment_status,to}'' = ''refunded'' then ''order_refunded'' else ''order_cancelled'' end, ''info'',
        case when ch #>> ''{payment_status,to}'' = ''refunded''
          then private.i18n(''{who} marked order {item} refunded'', ''{who} a marqué la commande {item} remboursée'', ''{who} سجّل الطلب {item} كمسترد'', vals)
          else private.i18n(''{who} cancelled order {item}'', ''{who} a annulé la commande {item}'', ''{who} ألغى الطلب {item}'', vals)
        end,
        null, ''/admin/orders/'' || new.entity_id, jsonb_build_object(''actor_id'', new.actor_id, ''order_id'', new.entity_id));
    end if;
    return null;
  end if;

  -- Shop settings (prices, shipping, taxes, home page config).
  if new.entity in (''site_settings'', ''shipping_rates'', ''country_tax_rates'') and new.action in (''create'', ''update'') then
    perform private.notify(owners, ''security'', ''settings_change'', ''info'',
      private.i18n(''{who} changed a {what_en}'', ''{who} a modifié : {what_fr}'', ''{who} غيّر {what_ar}'', vals),
      private.i18n(''“{item}”'', ''« {item} »'', ''«{item}»'', vals),
      url, jsonb_build_object(''actor_id'', new.actor_id, ''entity'', new.entity, ''entity_id'', new.entity_id));
    return null;
  end if;

  -- Restores are worth knowing about too.
  if new.action = ''restore'' then
    perform private.notify(owners, ''security'', ''restore'', ''info'',
      private.i18n(''{who} restored a {what_en}'', ''{who} a restauré : {what_fr}'', ''{who} استعاد {what_ar}'', vals),
      private.i18n(''“{item}”'', ''« {item} »'', ''«{item}»'', vals),
      url, jsonb_build_object(''actor_id'', new.actor_id, ''entity'', new.entity, ''entity_id'', new.entity_id));
  end if;

  return null;
end;
$$","revoke all on function private.owner_alerts() from public, anon, authenticated","create trigger owner_alerts after insert on public.activity_log
  for each row execute function private.owner_alerts()","-- ---------------------------------------------------------------------------
-- Desktop delivery
-- ---------------------------------------------------------------------------

-- Hands each new notification to the send-push Edge Function. Its URL and shared secret
-- are Vault secrets (push_function_url, push_webhook_secret); without them nothing is sent
-- and the notification still shows in the admin.
create or replace function private.dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  fn_url text;
  secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = ''push_function_url'';
  select decrypted_secret into secret from vault.decrypted_secrets where name = ''push_webhook_secret'';
  if fn_url is null or secret is null then
    return null;
  end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.recipient_id and s.deleted_at is null) then
    return null;
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object(''notification_id'', new.id),
    headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-push-secret'', secret),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- Never let delivery problems block the change that caused the notification.
  raise warning ''dispatch_push failed: %'', sqlerrm;
  return null;
end;
$$","revoke all on function private.dispatch_push() from public, anon, authenticated","create trigger dispatch_push after insert on public.notifications
  for each row execute function private.dispatch_push()"}', 'notifications_and_owner_alerts');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261004120000', '{"-- Update the live Tunisia delivery fee for existing installations.
update public.site_settings
set setting_value = ''8'', updated_at = now()
where setting_key = ''default_shipping_cost''","update public.shipping_rates
set base_rate = 8
where country_code = ''TN''
  and shipping_method = ''standard''"}', 'update_delivery_fee_to_8');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261005145858', '{"-- Out-of-stock items can be ordered (\"sur commande\"): validating an order deducts only the units
-- the online location actually holds, instead of failing on the shortage. The rest is made to order.
-- Restoring is unchanged: it returns exactly what was deducted (summed from the order''s movements).

create or replace function public.apply_order_stock(p_order_id uuid, p_direction text, p_actor uuid default null, p_actor_email text default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  ord public.orders;
  online_location uuid;
  lines integer := 0;
  item record;
  on_hand integer;
  take integer;
begin
  select * into ord from public.orders where id = p_order_id for update;
  if not found then
    raise exception ''order_not_found'';
  end if;

  if p_direction = ''deduct'' then
    if ord.stock_deducted then return 0; end if;
    select id into online_location from public.locations where sells_online;
    if online_location is null then
      raise exception ''no_online_location'';
    end if;
    for item in
      select oi.variant_id, sum(oi.quantity)::integer as quantity
        from public.order_items oi
        join public.product_variants v on v.id = oi.variant_id
        join public.products p on p.id = v.product_id
       where oi.order_id = p_order_id and p.stock_tracked
       group by oi.variant_id
    loop
      select available into on_hand
        from public.inventory_levels
       where variant_id = item.variant_id and location_id = online_location
         for update;
      take := least(item.quantity, greatest(coalesce(on_hand, 0), 0));
      if take > 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
        values (item.variant_id, online_location, ''sale'', -take, ord.order_number, p_order_id, p_actor, p_actor_email);
        lines := lines + 1;
      end if;
    end loop;
    update public.orders set stock_deducted = true where id = p_order_id;
  elsif p_direction = ''restore'' then
    if not ord.stock_deducted then return 0; end if;
    for item in
      select variant_id, location_id, sum(-quantity)::integer as qty
        from public.stock_movements
       where order_id = p_order_id and variant_id is not null
       group by variant_id, location_id
      having sum(-quantity) > 0
    loop
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
      values (item.variant_id, item.location_id, ''return'', item.qty, ord.order_number, p_order_id, p_actor, p_actor_email);
      lines := lines + 1;
    end loop;
    update public.orders set stock_deducted = false where id = p_order_id;
  else
    raise exception ''invalid_direction'';
  end if;

  return lines;
end;
$$","revoke all on function public.apply_order_stock(uuid, text, uuid, text) from public, anon, authenticated","grant execute on function public.apply_order_stock(uuid, text, uuid, text) to service_role"}', 'made_to_order_stock');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261006142809', '{"-- Parcels sent to the delivery company (Colissimo), one live parcel per order.
-- Colissimo''s API can create a parcel and report one parcel''s status by barcode, but can''t
-- list an account''s parcels, so this table is the list the admin sees. Parcels created on
-- Colissimo''s website can be added by barcode (order_id null until linked).

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete set null,
  provider text not null default ''colissimo'',
  barcode text,
  label_url text,
  label_zebra_url text,
  -- Colissimo''s état (\"En attente\", \"Livre\", ...), or ''sending'' while the request is out.
  status text not null default ''sending'',
  status_reason text,
  status_changed_at timestamptz,
  recipient_name text,
  phone text,
  governorate text,
  city text,
  address text,
  cod_amount numeric(10, 3),
  items_count integer,
  designation text,
  -- The fields sent to Colissimo (never the token).
  request jsonb,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index deliveries_order_live_idx on public.deliveries (order_id)
  where deleted_at is null and order_id is not null","create unique index deliveries_barcode_live_idx on public.deliveries (provider, barcode)
  where deleted_at is null and barcode is not null","create index deliveries_created_at_idx on public.deliveries (created_at desc)","alter table public.deliveries enable row level security","revoke all on public.deliveries from anon, authenticated","grant all on public.deliveries to service_role","create trigger prevent_hard_delete before delete on public.deliveries
  for each row execute function private.prevent_hard_delete()","create trigger log_activity after insert or update on public.deliveries
  for each row execute function private.log_activity()","-- Step 1 of sending an order: reserve its parcel row before calling Colissimo, so two clicks
-- (or two admins) can''t create two parcels for one order.
create or replace function public.begin_delivery(p_order_id uuid, p_request jsonb, p_actor uuid default null, p_actor_email text default null)
returns public.deliveries
language plpgsql
set search_path = ''''
as $$
declare
  ord public.orders;
  row public.deliveries;
begin
  select * into ord from public.orders where id = p_order_id and deleted_at is null for update;
  if not found then
    raise exception ''order_not_found'';
  end if;
  if ord.status = ''cancelled'' then
    raise exception ''order_cancelled'';
  end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id and deleted_at is null) then
    raise exception ''delivery_exists'';
  end if;

  insert into public.deliveries (order_id, status, recipient_name, phone, governorate, city, address,
                                 cod_amount, items_count, designation, request, created_by, created_by_email)
  values (p_order_id, ''sending'', p_request->>''nom'', p_request->>''tel'', p_request->>''gouvernerat'', p_request->>''ville'',
          p_request->>''adresse'', nullif(p_request->>''prix'', '''')::numeric, nullif(p_request->>''nb_article'', '''')::integer,
          p_request->>''designation'', p_request, p_actor, p_actor_email)
  returning * into row;
  return row;
end;
$$","-- Step 2: Colissimo accepted the parcel. Records its barcode and slip, and marks the order
-- shipped (which takes its items out of stock) in the same transaction. If the order can''t
-- change status, the parcel is still recorded and the reason comes back as `warning`.
create or replace function public.complete_delivery(p_id uuid, p_barcode text, p_label_url text, p_label_zebra_url text,
                                                    p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  row public.deliveries;
  ord_status text;
  warning text;
begin
  update public.deliveries
     set barcode = p_barcode, label_url = p_label_url, label_zebra_url = p_label_zebra_url,
         status = ''En attente'', status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
  returning * into row;
  if not found then
    raise exception ''delivery_not_found'';
  end if;

  if row.order_id is not null then
    select status into ord_status from public.orders where id = row.order_id;
    if ord_status in (''pending'', ''processing'') then
      begin
        perform public.set_order_status(row.order_id, ''{\"status\": \"shipped\"}''::jsonb, p_actor, p_actor_email);
      exception when others then
        warning := sqlerrm;
      end;
    end if;
  end if;

  return jsonb_build_object(''delivery'', to_jsonb(row), ''warning'', warning);
end;
$$","-- Colissimo refused the parcel or couldn''t be reached: release the reservation.
create or replace function public.fail_delivery(p_id uuid, p_error text)
returns void
language sql
set search_path = ''''
as $$
  update public.deliveries
     set status = ''failed'', status_reason = left(p_error, 500), deleted_at = now(), updated_at = now()
   where id = p_id and status = ''sending'' and deleted_at is null;
$$","-- A tracking result. Only a change of status is written (so refreshing doesn''t flood the
-- activity log). A delivered parcel marks its shipped order delivered, and \"Livre paye\"
-- (Colissimo has paid out the cash) also marks it paid.
create or replace function public.record_delivery_status(p_id uuid, p_status text, p_reason text,
                                                         p_actor uuid default null, p_actor_email text default null)
returns boolean
language plpgsql
set search_path = ''''
as $$
declare
  row public.deliveries;
  ord public.orders;
  changes jsonb := ''{}''::jsonb;
begin
  update public.deliveries
     set status = p_status, status_reason = nullif(p_reason, ''''), status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
     and (status is distinct from p_status or status_reason is distinct from nullif(p_reason, ''''))
  returning * into row;
  if not found then
    return false;
  end if;

  if row.order_id is not null and p_status in (''Livre'', ''Livre paye'') then
    select * into ord from public.orders where id = row.order_id and deleted_at is null;
    if found then
      if ord.status in (''processing'', ''shipped'') then
        changes := changes || ''{\"status\": \"delivered\"}''::jsonb;
      end if;
      if p_status = ''Livre paye'' and ord.payment_status = ''pending'' then
        changes := changes || ''{\"payment_status\": \"paid\"}''::jsonb;
      end if;
      if changes <> ''{}''::jsonb then
        perform public.set_order_status(row.order_id, changes, p_actor, p_actor_email);
      end if;
    end if;
  end if;
  return true;
end;
$$","revoke all on function public.begin_delivery(uuid, jsonb, uuid, text) from public, anon, authenticated","revoke all on function public.complete_delivery(uuid, text, text, text, uuid, text) from public, anon, authenticated","revoke all on function public.fail_delivery(uuid, text) from public, anon, authenticated","revoke all on function public.record_delivery_status(uuid, text, text, uuid, text) from public, anon, authenticated","grant execute on function public.begin_delivery(uuid, jsonb, uuid, text) to service_role","grant execute on function public.complete_delivery(uuid, text, text, text, uuid, text) to service_role","grant execute on function public.fail_delivery(uuid, text) to service_role","grant execute on function public.record_delivery_status(uuid, text, text, uuid, text) to service_role"}', 'colissimo_deliveries');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261007104019', '{"-- Validating an order now creates its Colissimo parcel. Creating the parcel therefore validates
-- the order (pending → processing, which takes its items out of stock) instead of marking it
-- shipped; it becomes shipped when Colissimo reports the parcel picked up or on its way.

create or replace function public.complete_delivery(p_id uuid, p_barcode text, p_label_url text, p_label_zebra_url text,
                                                    p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  row public.deliveries;
  ord public.orders;
  warning text;
begin
  update public.deliveries
     set barcode = p_barcode, label_url = p_label_url, label_zebra_url = p_label_zebra_url,
         status = ''En attente'', status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
  returning * into row;
  if not found then
    raise exception ''delivery_not_found'';
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id;
    if ord.status = ''pending'' then
      begin
        select * into ord from public.set_order_status(row.order_id, ''{\"status\": \"processing\"}''::jsonb, p_actor, p_actor_email);
      exception when others then
        warning := sqlerrm;
      end;
    end if;
  end if;

  return jsonb_build_object(
    ''delivery'', to_jsonb(row),
    ''order'', case when ord.id is null then null else jsonb_build_object(''status'', ord.status, ''stock_deducted'', ord.stock_deducted) end,
    ''warning'', warning
  );
end;
$$","-- As before, plus: once Colissimo has the parcel (picked up, at the depot, out for delivery),
-- a validated order becomes shipped.
create or replace function public.record_delivery_status(p_id uuid, p_status text, p_reason text,
                                                         p_actor uuid default null, p_actor_email text default null)
returns boolean
language plpgsql
set search_path = ''''
as $$
declare
  row public.deliveries;
  ord public.orders;
  changes jsonb := ''{}''::jsonb;
begin
  update public.deliveries
     set status = p_status, status_reason = nullif(p_reason, ''''), status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
     and (status is distinct from p_status or status_reason is distinct from nullif(p_reason, ''''))
  returning * into row;
  if not found then
    return false;
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id and deleted_at is null;
    if found then
      if p_status in (''Enleve'', ''Au depot'', ''En cours'', ''Retour Inter Agence'') and ord.status = ''processing'' then
        changes := changes || ''{\"status\": \"shipped\"}''::jsonb;
      elsif p_status in (''Livre'', ''Livre paye'') and ord.status in (''processing'', ''shipped'') then
        changes := changes || ''{\"status\": \"delivered\"}''::jsonb;
      end if;
      if p_status = ''Livre paye'' and ord.payment_status = ''pending'' then
        changes := changes || ''{\"payment_status\": \"paid\"}''::jsonb;
      end if;
      if changes <> ''{}''::jsonb then
        perform public.set_order_status(row.order_id, changes, p_actor, p_actor_email);
      end if;
    end if;
  end if;
  return true;
end;
$$"}', 'delivery_on_validation');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261014081317', '{"-- \"New parcel\" with products (Admin → Delivery): once Colissimo has created the parcel, the order,
-- its lines and the parcel are saved and the order is validated (its tracked items leave the online
-- location''s stock) in one transaction. If any step fails, nothing is written.

create or replace function public.create_order_with_delivery(p_order jsonb, p_items jsonb, p_delivery jsonb,
                                                             p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  created jsonb;
  order_id uuid;
  row public.deliveries;
  ord public.orders;
begin
  if jsonb_typeof(p_items) is distinct from ''array'' or jsonb_array_length(p_items) = 0 then
    raise exception ''order_items_required'';
  end if;

  created := public.create_order(p_order, p_items);
  order_id := (created->''order''->>''id'')::uuid;

  insert into public.deliveries (order_id, barcode, label_url, label_zebra_url, status, status_changed_at,
                                 recipient_name, phone, governorate, city, address, cod_amount, items_count,
                                 designation, request, created_by, created_by_email)
  values (order_id, p_delivery->>''barcode'', p_delivery->>''label_url'', p_delivery->>''label_zebra_url'', ''En attente'', now(),
          p_delivery->''request''->>''nom'', p_delivery->''request''->>''tel'', p_delivery->''request''->>''gouvernerat'',
          p_delivery->''request''->>''ville'', p_delivery->''request''->>''adresse'',
          nullif(p_delivery->''request''->>''prix'', '''')::numeric, nullif(p_delivery->''request''->>''nb_article'', '''')::integer,
          p_delivery->''request''->>''designation'', p_delivery->''request'', p_actor, p_actor_email)
  returning * into row;

  select * into ord from public.set_order_status(order_id, ''{\"status\": \"processing\"}''::jsonb, p_actor, p_actor_email);

  return jsonb_build_object(
    ''delivery'', to_jsonb(row),
    ''order'', jsonb_build_object(''id'', ord.id, ''order_number'', ord.order_number, ''status'', ord.status, ''stock_deducted'', ord.stock_deducted)
  );
end;
$$","revoke all on function public.create_order_with_delivery(jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated","grant execute on function public.create_order_with_delivery(jsonb, jsonb, jsonb, uuid, text) to service_role"}', 'manual_order_parcel');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261014090736', '{"-- Who added each order: the team member (agent) for orders entered in the admin, null for orders
-- placed on the website. Admin → Agent performance compares agents with agent_performance().

alter table public.orders add column created_by uuid, add column created_by_email text","create index orders_created_by_created_at_idx on public.orders (created_by, created_at desc) where created_by is not null","-- Orders entered so far with \"New parcel\" were saved in the same transaction as their parcel, so
-- they share its creation time and its author.
update public.orders o
   set created_by = d.created_by, created_by_email = d.created_by_email
  from public.deliveries d
 where d.order_id = o.id and d.created_at = o.created_at and d.created_by is not null and o.created_by is null","-- Same as before, and the order records the agent who added it.
create or replace function public.create_order_with_delivery(p_order jsonb, p_items jsonb, p_delivery jsonb,
                                                             p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  created jsonb;
  order_id uuid;
  row public.deliveries;
  ord public.orders;
begin
  if jsonb_typeof(p_items) is distinct from ''array'' or jsonb_array_length(p_items) = 0 then
    raise exception ''order_items_required'';
  end if;

  created := public.create_order(p_order, p_items);
  order_id := (created->''order''->>''id'')::uuid;
  update public.orders set created_by = p_actor, created_by_email = p_actor_email where id = order_id;

  insert into public.deliveries (order_id, barcode, label_url, label_zebra_url, status, status_changed_at,
                                 recipient_name, phone, governorate, city, address, cod_amount, items_count,
                                 designation, request, created_by, created_by_email)
  values (order_id, p_delivery->>''barcode'', p_delivery->>''label_url'', p_delivery->>''label_zebra_url'', ''En attente'', now(),
          p_delivery->''request''->>''nom'', p_delivery->''request''->>''tel'', p_delivery->''request''->>''gouvernerat'',
          p_delivery->''request''->>''ville'', p_delivery->''request''->>''adresse'',
          nullif(p_delivery->''request''->>''prix'', '''')::numeric, nullif(p_delivery->''request''->>''nb_article'', '''')::integer,
          p_delivery->''request''->>''designation'', p_delivery->''request'', p_actor, p_actor_email)
  returning * into row;

  select * into ord from public.set_order_status(order_id, ''{\"status\": \"processing\"}''::jsonb, p_actor, p_actor_email);

  return jsonb_build_object(
    ''delivery'', to_jsonb(row),
    ''order'', jsonb_build_object(''id'', ord.id, ''order_number'', ord.order_number, ''status'', ord.status, ''stock_deducted'', ord.stock_deducted)
  );
end;
$$","-- One row per agent (and one for website orders, agent_id null) over orders created in
-- [p_from, p_to): how many, their value, and how they ended. \"Returned\" means the parcel came back
-- (Colissimo return statuses). Deleted orders are left out.
create or replace function public.agent_performance(p_from timestamptz, p_to timestamptz)
returns table (
  agent_id uuid,
  agent_email text,
  agent_role text,
  orders integer,
  revenue numeric,
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
set search_path = ''''
as $$
  with scoped as (
    select o.*,
           exists (
             select 1 from public.deliveries d
              where d.order_id = o.id and d.deleted_at is null
                and d.status in (''Retour Expediteur'', ''Retour depot'', ''Retour definitif'', ''Retour paye'', ''Retour recu paye'')
           ) as was_returned,
           (select coalesce(sum(oi.quantity), 0) from public.order_items oi where oi.order_id = o.id) as item_count
      from public.orders o
     where o.deleted_at is null and o.created_at >= p_from and o.created_at < p_to
  )
  select s.created_by,
         coalesce(max(s.created_by_email), max(b.email)),
         max(b.role),
         count(*)::integer,
         coalesce(sum(s.total) filter (where s.status <> ''cancelled''), 0),
         (count(*) filter (where s.status = ''delivered''))::integer,
         coalesce(sum(s.total) filter (where s.status = ''delivered''), 0),
         (count(*) filter (where s.payment_status = ''paid''))::integer,
         (count(*) filter (where s.status in (''pending'', ''processing'', ''shipped'') and not s.was_returned))::integer,
         (count(*) filter (where s.status = ''cancelled''))::integer,
         (count(*) filter (where s.was_returned))::integer,
         coalesce(sum(s.item_count), 0)::integer,
         max(s.created_at)
    from scoped s
    left join public.back_office_users b on b.user_id = s.created_by
   group by s.created_by
   order by s.created_by is null, count(*) desc;
$$","revoke all on function public.agent_performance(timestamptz, timestamptz) from public, anon, authenticated","grant execute on function public.agent_performance(timestamptz, timestamptz) to service_role"}', 'agent_orders_performance');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261016120000', '{"-- ERP, part 1: sales pipeline, customers (CRM), payments, campaigns, goals and stock costs.
--
-- * Orders now record where they came from (channel, campaign), who handles them (assigned_to),
--   and each step on its own: confirmed (customer called back), validated (parcel created),
--   shipped, delivered, returned, cancelled. Being delivered is not being paid: money received is
--   one row per payment in order_payments, and orders.paid_amount / payment_status follow them.
-- * customers: one row per phone number, created from orders automatically; conversations
--   (customer_interactions) and reminders (crm_tasks) hang off it.
-- * Stock is valued at weighted average cost (CMUP): restocks carry a unit cost that updates
--   product_variants.avg_cost; every other movement and every order line records the cost in force.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Tunisian numbers keep their 8 digits (+216 / 00216 dropped); anything else keeps its digits.
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''''
as $$
  select nullif(case
    when d ~ ''^00216\\d{8}$'' then substr(d, 6)
    when d ~ ''^216\\d{8}$'' then substr(d, 4)
    else d
  end, '''')
  from (select regexp_replace(coalesce(p_phone, ''''), ''\\D'', '''', ''g'') as d) s;
$$","grant execute on function public.normalize_phone(text) to anon, authenticated, service_role","-- Settings of the back office that the storefront must not read (accounting, POS rules...).
create table public.erp_settings (
  key text primary key,
  value jsonb not null default ''{}''::jsonb,
  updated_at timestamptz not null default now()
)","alter table public.erp_settings enable row level security","revoke all on public.erp_settings from anon, authenticated","grant all on public.erp_settings to service_role","create trigger set_updated_at before update on public.erp_settings
  for each row execute function private.set_updated_at()","create trigger log_activity after insert or update on public.erp_settings
  for each row execute function private.log_activity()","insert into public.erp_settings (key, value) values
  (''sales'', jsonb_build_object(
     ''pending_alert_hours'', 24,       -- an order still unconfirmed after this long raises an alert
     ''late_delivery_days'', 6,         -- a parcel still moving after this long raises an alert
     ''duplicate_window_days'', 30      -- open orders from the same phone in this window are flagged
  )),
  (''pos'', jsonb_build_object(
     ''max_discount_percent'', 10       -- staff can''t give more than this at the till (owners/admins can)
  ))","-- ---------------------------------------------------------------------------
-- Campaigns and ad spend (Marketing)
-- ---------------------------------------------------------------------------

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  platform text not null default ''facebook''
    check (platform in (''facebook'', ''instagram'', ''tiktok'', ''google'', ''whatsapp'', ''influencer'', ''other'')),
  starts_on date,
  ends_on date,
  budget numeric(12, 3) check (budget >= 0),
  notes text,
  active boolean not null default true,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","-- What was spent, per day or per invoice. `account` is how it was paid: card/bank, cash, or still
-- owed (payable). It posts to the advertising account.
create table public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.ad_campaigns (id) on delete set null,
  spend_date date not null default current_date,
  amount numeric(12, 3) not null check (amount > 0),
  account text not null default ''bank'' check (account in (''bank'', ''cash'', ''payable'')),
  note text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index ad_spend_date_idx on public.ad_spend (spend_date) where deleted_at is null","create index ad_spend_campaign_idx on public.ad_spend (campaign_id) where deleted_at is null","-- ---------------------------------------------------------------------------
-- Customers (CRM)
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  -- Normalized (normalize_phone). Null only for contacts that wrote in on Messenger/Instagram
  -- without leaving a number yet.
  phone text,
  phone_alt text,
  full_name text not null default '''',
  email text,
  governorate text,
  city text,
  address text,
  -- First channel the customer reached us through.
  channel text not null default ''website''
    check (channel in (''website'', ''facebook'', ''instagram'', ''tiktok'', ''whatsapp'', ''phone'', ''store'', ''other'')),
  -- Sales pipeline. new/interested are set by hand; later stages follow the customer''s latest order.
  stage text not null default ''new''
    check (stage in (''new'', ''interested'', ''to_confirm'', ''confirmed'', ''shipped'', ''delivered'', ''cancelled'')),
  assigned_to uuid,
  assigned_to_email text,
  tags text[] not null default ''{}'',
  notes text,
  user_id uuid references auth.users (id) on delete set null,
  -- Ids on messaging platforms: {\"messenger\": \"<psid>\", \"instagram\": \"<igsid>\", \"whatsapp\": \"<wa_id>\"}.
  external_ids jsonb not null default ''{}''::jsonb,
  anonymized_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index customers_phone_live_idx on public.customers (phone) where deleted_at is null and phone is not null","create index customers_assigned_idx on public.customers (assigned_to) where deleted_at is null","create index customers_stage_idx on public.customers (stage) where deleted_at is null","create index customers_created_at_idx on public.customers (created_at desc)","create index customers_external_ids_idx on public.customers using gin (external_ids)","-- Conversations: messages received/sent on a channel, calls and notes typed by agents.
create table public.customer_interactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel text not null default ''phone''
    check (channel in (''website'', ''facebook'', ''instagram'', ''tiktok'', ''whatsapp'', ''phone'', ''store'', ''email'', ''other'')),
  direction text not null default ''note'' check (direction in (''in'', ''out'', ''note'')),
  body text not null check (length(body) > 0),
  order_id uuid references public.orders (id) on delete set null,
  -- Messages synced from Meta''s APIs (Messenger, Instagram Direct, WhatsApp Cloud).
  external_id text,
  sender_name text,
  read_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index customer_interactions_customer_idx on public.customer_interactions (customer_id, created_at desc)","-- Plain (not partial) so webhook upserts can target it; rows without an external id never clash.
create unique index customer_interactions_external_idx on public.customer_interactions (channel, external_id)","create index customer_interactions_unread_idx on public.customer_interactions (created_at desc)
  where direction = ''in'' and read_at is null and deleted_at is null","-- Follow-ups and reminders for agents.
create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  notes text,
  due_at timestamptz not null,
  assigned_to uuid,
  assigned_to_email text,
  done_at timestamptz,
  done_by uuid,
  reminded_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index crm_tasks_open_idx on public.crm_tasks (assigned_to, due_at) where done_at is null and deleted_at is null","create index crm_tasks_customer_idx on public.crm_tasks (customer_id)","-- ---------------------------------------------------------------------------
-- Orders: channel, campaign, customer, assignment, stages, location
-- ---------------------------------------------------------------------------

alter table public.orders
  add column channel text not null default ''website''
    check (channel in (''website'', ''facebook'', ''instagram'', ''tiktok'', ''whatsapp'', ''phone'', ''store'', ''other'')),
  add column campaign_id uuid references public.ad_campaigns (id) on delete set null,
  add column customer_id uuid references public.customers (id) on delete set null,
  add column assigned_to uuid,
  add column assigned_to_email text,
  add column assigned_at timestamptz,
  add column confirmed_at timestamptz,
  add column confirmed_by uuid,
  add column confirmed_by_email text,
  add column delivered_at timestamptz,
  add column returned_at timestamptz,
  add column cancelled_at timestamptz,
  -- Discount given on the whole order (till, phone orders). Line prices are already discounted
  -- product prices; subtotal is the lines, total = subtotal - discount_amount + shipping_cost.
  add column discount_amount numeric(12, 3) not null default 0 check (discount_amount >= 0),
  -- Where the stock comes from: the online location when null (website and phone orders),
  -- the shop for till sales.
  add column location_id uuid references public.locations (id) on delete set null,
  add column pos_session_id uuid,
  add column paid_amount numeric(12, 3) not null default 0","alter table public.orders drop constraint orders_status_check","alter table public.orders add constraint orders_status_check
  check (status in (''pending'', ''confirmed'', ''processing'', ''shipped'', ''delivered'', ''returned'', ''cancelled''))","alter table public.orders drop constraint orders_payment_status_check","alter table public.orders add constraint orders_payment_status_check
  check (payment_status in (''pending'', ''partial'', ''paid'', ''failed'', ''refunded''))","create index orders_channel_created_idx on public.orders (channel, created_at desc)","create index orders_customer_idx on public.orders (customer_id)","create index orders_assigned_idx on public.orders (assigned_to, created_at desc) where assigned_to is not null","create index orders_campaign_idx on public.orders (campaign_id) where campaign_id is not null","create index orders_delivered_at_idx on public.orders (delivered_at) where delivered_at is not null","create index orders_phone_idx on public.orders (public.normalize_phone(customer_phone))","-- Orders so far: website ones have no author; the others were typed in by an agent (phone/social).
update public.orders set channel = ''other'' where created_by is not null","update public.orders set assigned_to = created_by, assigned_to_email = created_by_email, assigned_at = created_at
 where created_by is not null","update public.orders set confirmed_at = coalesce(confirmed_at, updated_at)
 where status in (''processing'', ''shipped'', ''delivered'')","update public.orders set delivered_at = updated_at where status = ''delivered''","update public.orders set cancelled_at = updated_at where status = ''cancelled''","update public.orders o set returned_at = d.status_changed_at, status = ''returned''
  from public.deliveries d
 where d.order_id = o.id and d.deleted_at is null and o.deleted_at is null
   and d.status in (''Retour definitif'', ''Retour paye'', ''Retour recu paye'')
   and o.status not in (''delivered'', ''cancelled'', ''returned'')","-- ---------------------------------------------------------------------------
-- Stock cost (weighted average, CMUP)
-- ---------------------------------------------------------------------------

alter table public.product_variants add column avg_cost numeric(12, 3) check (avg_cost >= 0)","alter table public.stock_movements add column unit_cost numeric(12, 3) check (unit_cost >= 0)","alter table public.order_items add column unit_cost numeric(12, 3) check (unit_cost >= 0)","-- Start from the purchase cost entered per product.
update public.product_variants v set avg_cost = pc.cost
  from public.product_costs pc
 where pc.product_id = v.product_id and pc.deleted_at is null and v.avg_cost is null","-- Cost in force for a variant: the purchase cost entered on its product (the reference for
-- margins and statistics), else the running average of its restocks.
create or replace function public.variant_unit_cost(p_variant_id uuid)
returns numeric
language sql
stable
set search_path = ''''
as $$
  select coalesce(pc.cost, v.avg_cost)
    from public.product_variants v
    left join public.product_costs pc on pc.product_id = v.product_id and pc.deleted_at is null
   where v.id = p_variant_id;
$$","-- Runs after stock_movements_apply (triggers fire in name order), so inventory_levels already
-- include this movement. A restock with a unit cost moves the variant''s running average
-- (the fallback cost for products without a purchase cost):
--   new avg = (units before × avg + units in × cost) / (units before + units in)
-- Other movements record the cost in force (the cost of what left or came back).
create or replace function private.stock_movement_cost()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  units_after integer;
  units_before integer;
  avg_now numeric;
begin
  if new.type = ''restock'' and new.unit_cost is not null then
    select avg_cost into avg_now from public.product_variants where id = new.variant_id;
    select coalesce(sum(available), 0) into units_after from public.inventory_levels where variant_id = new.variant_id;
    units_before := units_after - new.quantity;
    update public.product_variants
       set avg_cost = case
             when avg_now is null or units_before <= 0 then new.unit_cost
             else round((units_before * avg_now + new.quantity * new.unit_cost) / (units_before + new.quantity), 3)
           end
     where id = new.variant_id;
  else
    new.unit_cost := coalesce(new.unit_cost, public.variant_unit_cost(new.variant_id));
  end if;
  return new;
end;
$$","create trigger stock_movements_cost
  before insert on public.stock_movements
  for each row execute function private.stock_movement_cost()","-- Order lines keep the product''s cost when the order was taken (gross margin).
create or replace function private.set_order_item_cost()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if new.unit_cost is null then
    if new.variant_id is not null then
      new.unit_cost := public.variant_unit_cost(new.variant_id);
    elsif new.product_id is not null then
      select coalesce(
               (select pc.cost from public.product_costs pc where pc.product_id = new.product_id and pc.deleted_at is null),
               (select avg(v.avg_cost) from public.product_variants v where v.product_id = new.product_id and v.avg_cost is not null))
        into new.unit_cost;
    end if;
  end if;
  return new;
end;
$$","-- When a product gets its purchase cost, its order lines that had none take it, so margins
-- and statistics cover past orders too. A changed cost doesn''t rewrite lines that had one.
create or replace function private.fill_order_item_costs()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if new.deleted_at is null and new.cost is not null then
    update public.order_items set unit_cost = new.cost
     where product_id = new.product_id and unit_cost is null;
  end if;
  return null;
end;
$$","revoke all on function private.fill_order_item_costs() from public, anon, authenticated","create trigger product_costs_fill_order_items
  after insert or update of cost, deleted_at on public.product_costs
  for each row execute function private.fill_order_item_costs()","create trigger order_items_cost
  before insert on public.order_items
  for each row execute function private.set_order_item_cost()","update public.order_items oi
   set unit_cost = coalesce((select pc.cost from public.product_costs pc where pc.product_id = oi.product_id and pc.deleted_at is null),
                            public.variant_unit_cost(oi.variant_id))
 where oi.unit_cost is null","-- Stock value per variant and location at the cost in force.
create or replace function public.stock_valuation()
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  sku text,
  location_id uuid,
  units integer,
  unit_cost numeric,
  value numeric
)
language sql
stable
set search_path = ''''
as $$
  select v.id, p.id, p.name, v.sku, il.location_id, il.available,
         public.variant_unit_cost(v.id),
         round(il.available * coalesce(public.variant_unit_cost(v.id), 0), 3)
    from public.inventory_levels il
    join public.product_variants v on v.id = il.variant_id and v.deleted_at is null
    join public.products p on p.id = v.product_id and p.deleted_at is null
    join public.locations l on l.id = il.location_id and l.deleted_at is null
   where il.available > 0;
$$","-- ---------------------------------------------------------------------------
-- Payments received and carrier payouts
-- ---------------------------------------------------------------------------

-- A payout from the delivery company: the cash it collected for a batch of parcels, less its fees,
-- arriving in the bank (or cash).
create table public.cod_remittances (
  id uuid primary key default gen_random_uuid(),
  provider text not null default ''colissimo'',
  reference text,
  received_on date not null default current_date,
  gross_amount numeric(12, 3) not null check (gross_amount >= 0),
  fees numeric(12, 3) not null default 0 check (fees >= 0),
  net_amount numeric(12, 3) generated always as (gross_amount - fees) stored,
  account text not null default ''bank'' check (account in (''bank'', ''cash'')),
  note text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","-- Money received for an order (negative amount: a refund). `account` is where the money is now:
-- the till (cash), the bank, or still held by the delivery company (carrier) until it pays out.
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric(12, 3) not null check (amount <> 0),
  method text not null default ''cash''
    check (method in (''cash'', ''card'', ''bank_transfer'', ''check'', ''cod'', ''mobile'', ''other'')),
  account text not null default ''cash'' check (account in (''cash'', ''bank'', ''carrier'')),
  received_at timestamptz not null default now(),
  reference text,
  note text,
  remittance_id uuid references public.cod_remittances (id) on delete set null,
  pos_session_id uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index order_payments_order_idx on public.order_payments (order_id)","create index order_payments_received_idx on public.order_payments (received_at) where deleted_at is null","create index order_payments_carrier_open_idx on public.order_payments (order_id)
  where account = ''carrier'' and remittance_id is null and deleted_at is null","-- orders.paid_amount and payment_status follow the live payments.
create or replace function private.refresh_order_paid(p_order_id uuid)
returns void
language plpgsql
set search_path = ''''
as $$
declare
  paid numeric;
  any_refund boolean;
begin
  select coalesce(sum(amount), 0), bool_or(amount < 0) into paid, any_refund
    from public.order_payments where order_id = p_order_id and deleted_at is null;
  update public.orders o
     set paid_amount = paid,
         payment_status = case
           when paid >= o.total - 0.0005 and o.total > 0 then ''paid''
           when paid > 0 then ''partial''
           when any_refund then ''refunded''
           when o.payment_status in (''paid'', ''partial'') then ''pending''
           else o.payment_status
         end,
         updated_at = now()
   where o.id = p_order_id
     and (o.paid_amount is distinct from paid or o.payment_status is distinct from case
           when paid >= o.total - 0.0005 and o.total > 0 then ''paid''
           when paid > 0 then ''partial''
           when any_refund then ''refunded''
           when o.payment_status in (''paid'', ''partial'') then ''pending''
           else o.payment_status
         end);
end;
$$","create or replace function private.on_order_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  perform private.refresh_order_paid(new.order_id);
  if tg_op = ''UPDATE'' and old.order_id <> new.order_id then
    perform private.refresh_order_paid(old.order_id);
  end if;
  return null;
end;
$$","create trigger order_payments_refresh
  after insert or update on public.order_payments
  for each row execute function private.on_order_payment_change()","-- Orders already marked paid (Colissimo \"Livre paye\") get the matching payment, held as paid out.
insert into public.order_payments (order_id, amount, method, account, received_at, note)
select o.id, o.total, ''cod'', ''bank'', o.updated_at, ''Recorded before payments were tracked''
  from public.orders o
 where o.payment_status = ''paid'' and o.total > 0 and o.deleted_at is null","-- Records a carrier payout and marks the given carrier payments as paid out, together.
create or replace function public.record_remittance(p_remittance jsonb, p_payment_ids uuid[],
                                                    p_actor uuid default null, p_actor_email text default null)
returns public.cod_remittances
language plpgsql
set search_path = ''''
as $$
declare
  row public.cod_remittances;
  linked integer;
begin
  insert into public.cod_remittances (provider, reference, received_on, gross_amount, fees, account, note, created_by, created_by_email)
  values (coalesce(nullif(p_remittance->>''provider'', ''''), ''colissimo''), nullif(p_remittance->>''reference'', ''''),
          coalesce(nullif(p_remittance->>''received_on'', '''')::date, current_date),
          (p_remittance->>''gross_amount'')::numeric, coalesce(nullif(p_remittance->>''fees'', '''')::numeric, 0),
          coalesce(nullif(p_remittance->>''account'', ''''), ''bank''), nullif(p_remittance->>''note'', ''''), p_actor, p_actor_email)
  returning * into row;

  update public.order_payments
     set remittance_id = row.id, updated_at = now()
   where id = any (coalesce(p_payment_ids, ''{}'')) and account = ''carrier'' and remittance_id is null and deleted_at is null;
  get diagnostics linked = row_count;
  if linked <> coalesce(cardinality(p_payment_ids), 0) then
    raise exception ''payments_not_open'';
  end if;
  return row;
end;
$$","-- ---------------------------------------------------------------------------
-- Treasury movements (cash and bank in/out that aren''t order payments or bills)
-- ---------------------------------------------------------------------------

create table public.treasury_movements (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in (''cash'', ''bank'')),
  direction text not null check (direction in (''in'', ''out'')),
  amount numeric(12, 3) not null check (amount > 0),
  category text not null default ''other''
    check (category in (''opening_balance'', ''owner_contribution'', ''owner_withdrawal'', ''transfer'', ''loan'',
                        ''loan_repayment'', ''other_income'', ''other_expense'', ''pos_difference'', ''other'')),
  occurred_on date not null default current_date,
  label text not null default '''',
  reference text,
  pos_session_id uuid,
  -- The other side of a transfer between cash and bank.
  transfer_id uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index treasury_movements_date_idx on public.treasury_movements (occurred_on) where deleted_at is null","-- ---------------------------------------------------------------------------
-- Objectives and commissions
-- ---------------------------------------------------------------------------

create table public.agent_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_email text,
  month date not null check (extract(day from month) = 1),
  target_orders integer check (target_orders >= 0),
  target_confirmed integer check (target_confirmed >= 0),
  target_delivered integer check (target_delivered >= 0),
  target_revenue numeric(12, 3) check (target_revenue >= 0),
  -- percent: % of delivered revenue; per_order: amount per delivered order.
  commission_type text not null default ''none'' check (commission_type in (''none'', ''percent'', ''per_order'')),
  commission_value numeric(12, 3) not null default 0 check (commission_value >= 0),
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index agent_goals_user_month_idx on public.agent_goals (user_id, month) where deleted_at is null","-- ---------------------------------------------------------------------------
-- Common triggers, RLS (service role only), audit
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[''ad_campaigns'', ''ad_spend'', ''customers'', ''customer_interactions'', ''crm_tasks'',
                           ''cod_remittances'', ''order_payments'', ''treasury_movements'', ''agent_goals''] loop
    execute format(''alter table public.%I enable row level security'', t);
    execute format(''revoke all on public.%I from anon, authenticated'', t);
    execute format(''grant all on public.%I to service_role'', t);
    execute format(''create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()'', t);
    execute format(''create trigger prevent_hard_delete before delete on public.%I for each row execute function private.prevent_hard_delete()'', t);
    execute format(''create trigger log_activity after insert or update on public.%I for each row execute function private.log_activity()'', t);
  end loop;
end;
$$","-- ---------------------------------------------------------------------------
-- Customers from orders
-- ---------------------------------------------------------------------------

-- Each order is linked to the customer with the same phone, who is created when new.
create or replace function private.link_order_customer()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_phone text := public.normalize_phone(new.customer_phone);
  v_id uuid;
begin
  if new.customer_id is not null or v_phone is null then
    return new;
  end if;
  select id into v_id from public.customers where phone = v_phone and deleted_at is null;
  if v_id is null then
    insert into public.customers (phone, full_name, email, governorate, city, address, channel, stage,
                                  assigned_to, assigned_to_email, user_id, created_by, created_by_email)
    values (v_phone, trim(concat_ws('' '', new.customer_first_name, new.customer_last_name)), new.customer_email,
            new.shipping_state, new.shipping_city, new.shipping_address, new.channel, ''to_confirm'',
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
           full_name = case when c.full_name = '''' then trim(concat_ws('' '', new.customer_first_name, new.customer_last_name)) else c.full_name end
     where c.id = v_id;
  end if;
  new.customer_id := v_id;
  return new;
end;
$$","create trigger orders_link_customer
  before insert on public.orders
  for each row execute function private.link_order_customer()","-- Existing orders: one customer per phone, named after their latest order.
insert into public.customers (phone, full_name, email, governorate, city, address, channel, stage, user_id, created_at)
select distinct on (public.normalize_phone(o.customer_phone))
       public.normalize_phone(o.customer_phone),
       trim(concat_ws('' '', o.customer_first_name, o.customer_last_name)), o.customer_email,
       o.shipping_state, o.shipping_city, o.shipping_address, o.channel,
       case o.status
         when ''pending'' then ''to_confirm'' when ''confirmed'' then ''confirmed'' when ''processing'' then ''confirmed''
         when ''shipped'' then ''shipped'' when ''delivered'' then ''delivered'' else ''cancelled'' end,
       o.user_id,
       (select min(o2.created_at) from public.orders o2 where public.normalize_phone(o2.customer_phone) = public.normalize_phone(o.customer_phone))
  from public.orders o
 where public.normalize_phone(o.customer_phone) is not null
 order by public.normalize_phone(o.customer_phone), o.created_at desc
on conflict do nothing","update public.orders o set customer_id = c.id
  from public.customers c
 where c.phone = public.normalize_phone(o.customer_phone) and c.deleted_at is null and o.customer_id is null","-- A customer''s stage follows their latest order (new/interested stay manual until they order).
create or replace function private.sync_customer_stage()
returns trigger
language plpgsql
security definer
set search_path = ''''
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
           when ''pending'' then ''to_confirm''
           when ''confirmed'' then ''confirmed''
           when ''processing'' then ''confirmed''
           when ''shipped'' then ''shipped''
           when ''delivered'' then ''delivered''
           else ''cancelled''
         end
   where c.id = new.customer_id and c.deleted_at is null;
  return null;
end;
$$","create trigger orders_sync_customer_stage
  after insert or update of status on public.orders
  for each row execute function private.sync_customer_stage()","-- Open orders (not finished) from the same phone, newest first: possible duplicates.
create or replace function public.find_order_duplicates(p_phone text, p_exclude uuid default null, p_days integer default 30)
returns table (id uuid, order_number text, status text, total numeric, created_at timestamptz, channel text,
               customer_first_name text, customer_last_name text)
language sql
stable
set search_path = ''''
as $$
  select o.id, o.order_number, o.status, o.total, o.created_at, o.channel, o.customer_first_name, o.customer_last_name
    from public.orders o
   where public.normalize_phone(o.customer_phone) = public.normalize_phone(p_phone)
     and o.deleted_at is null
     and o.id is distinct from p_exclude
     and o.status in (''pending'', ''confirmed'', ''processing'', ''shipped'')
     and o.created_at > now() - make_interval(days => greatest(p_days, 1))
   order by o.created_at desc;
$$","-- Customer records that look like the same person: same e-mail, same second phone, or same
-- name in the same city.
create or replace function public.find_customer_duplicates()
returns table (customer_id uuid, duplicate_id uuid, reason text)
language sql
stable
set search_path = ''''
as $$
  select a.id, b.id,
         case when lower(a.email) = lower(b.email) then ''email''
              when a.phone_alt is not null and (a.phone_alt = b.phone or a.phone_alt = b.phone_alt) then ''phone''
              else ''name'' end
    from public.customers a
    join public.customers b on b.id > a.id and b.deleted_at is null
   where a.deleted_at is null
     and (
       (a.email is not null and lower(a.email) = lower(b.email))
       or (a.phone_alt is not null and (a.phone_alt = b.phone or a.phone_alt = b.phone_alt))
       or (b.phone_alt is not null and b.phone_alt = a.phone)
       or (a.full_name <> '''' and lower(a.full_name) = lower(b.full_name) and lower(coalesce(a.city, '''')) = lower(coalesce(b.city, '''')))
     )
   limit 500;
$$","-- Keeps p_keep and moves p_remove''s orders, conversations and tasks onto it; p_remove is deleted.
create or replace function public.merge_customers(p_keep uuid, p_remove uuid)
returns public.customers
language plpgsql
set search_path = ''''
as $$
declare
  kept public.customers;
  gone public.customers;
begin
  if p_keep = p_remove then
    raise exception ''same_customer'';
  end if;
  select * into kept from public.customers where id = p_keep and deleted_at is null for update;
  select * into gone from public.customers where id = p_remove and deleted_at is null for update;
  if kept.id is null or gone.id is null then
    raise exception ''customer_not_found'';
  end if;
  update public.orders set customer_id = p_keep where customer_id = p_remove;
  update public.customer_interactions set customer_id = p_keep where customer_id = p_remove;
  update public.crm_tasks set customer_id = p_keep where customer_id = p_remove;
  update public.customers set deleted_at = now(), notes = concat_ws(E''\\n'', notes, ''Merged into '' || p_keep::text)
   where id = p_remove;
  update public.customers
     set phone_alt = coalesce(phone_alt, case when gone.phone is distinct from kept.phone then gone.phone end),
         email = coalesce(email, gone.email),
         governorate = coalesce(governorate, gone.governorate),
         city = coalesce(city, gone.city),
         address = coalesce(address, gone.address),
         tags = (select coalesce(array_agg(distinct t), ''{}'') from unnest(tags || gone.tags) t),
         external_ids = gone.external_ids || external_ids,
         notes = concat_ws(E''\\n'', notes, gone.notes)
   where id = p_keep
  returning * into kept;
  return kept;
end;
$$","-- Personal data erased on request (Tunisian law 2004-63). Orders keep their amounts and lines
-- for the accounts; their names, phone and address are blanked once they''re finished.
create or replace function public.anonymize_customer(p_id uuid)
returns void
language plpgsql
set search_path = ''''
as $$
begin
  if exists (select 1 from public.orders where customer_id = p_id and deleted_at is null
               and status in (''pending'', ''confirmed'', ''processing'', ''shipped'')) then
    raise exception ''customer_has_open_orders'';
  end if;
  update public.customers
     set phone = null, phone_alt = null, full_name = ''Anonymized'', email = null, address = null,
         notes = null, external_ids = ''{}''::jsonb, tags = ''{}'', anonymized_at = now()
   where id = p_id;
  update public.orders
     set customer_first_name = ''Anonymized'', customer_last_name = '''', customer_phone = ''00000000'',
         customer_email = null, shipping_address = null, order_notes = null
   where customer_id = p_id;
  update public.customer_interactions set body = ''—'', sender_name = null where customer_id = p_id;
end;
$$","-- ---------------------------------------------------------------------------
-- Orders: creation, statuses, stock location
-- ---------------------------------------------------------------------------

-- As before, plus the new order fields (channel, campaign, agent, till...). Everything the API
-- doesn''t send keeps its default.
create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  ord public.orders;
begin
  insert into public.orders (
    order_number, user_id, customer_email, customer_first_name, customer_last_name, customer_phone,
    shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country,
    subtotal, shipping_cost, total, order_notes, status, payment_status,
    channel, campaign_id, customer_id, assigned_to, assigned_to_email, assigned_at,
    created_by, created_by_email, discount_amount, location_id, pos_session_id
  ) values (
    p_order->>''order_number'', nullif(p_order->>''user_id'', '''')::uuid, nullif(p_order->>''customer_email'', ''''),
    p_order->>''customer_first_name'', p_order->>''customer_last_name'', p_order->>''customer_phone'',
    nullif(p_order->>''shipping_address'', ''''), nullif(p_order->>''shipping_city'', ''''), nullif(p_order->>''shipping_state'', ''''),
    nullif(p_order->>''shipping_zip'', ''''), nullif(p_order->>''shipping_country'', ''''),
    (p_order->>''subtotal'')::numeric, (p_order->>''shipping_cost'')::numeric, (p_order->>''total'')::numeric,
    nullif(p_order->>''order_notes'', ''''), ''pending'', ''pending'',
    coalesce(nullif(p_order->>''channel'', ''''), ''website''), nullif(p_order->>''campaign_id'', '''')::uuid,
    nullif(p_order->>''customer_id'', '''')::uuid,
    nullif(p_order->>''assigned_to'', '''')::uuid, nullif(p_order->>''assigned_to_email'', ''''),
    case when nullif(p_order->>''assigned_to'', '''') is not null then now() end,
    nullif(p_order->>''created_by'', '''')::uuid, nullif(p_order->>''created_by_email'', ''''),
    coalesce(nullif(p_order->>''discount_amount'', '''')::numeric, 0),
    nullif(p_order->>''location_id'', '''')::uuid, nullif(p_order->>''pos_session_id'', '''')::uuid
  )
  returning * into ord;

  insert into public.order_items (
    order_id, product_id, variant_id, variant_label, product_name, product_name_ar, product_name_fr,
    product_image, quantity, price, subtotal
  )
  select ord.id, i.product_id, i.variant_id, i.variant_label, i.product_name, i.product_name_ar, i.product_name_fr,
         i.product_image, i.quantity, i.price, i.subtotal
    from jsonb_to_recordset(p_items) as i (
      product_id uuid, variant_id uuid, variant_label text, product_name text, product_name_ar text,
      product_name_fr text, product_image text, quantity integer, price numeric, subtotal numeric
    );

  return jsonb_build_object(
    ''order'', to_jsonb(ord),
    ''items'', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = ord.id), ''[]''::jsonb)
  );
end;
$$","-- Stock leaves the order''s own location (the shop for till sales), else the online one.
create or replace function public.apply_order_stock(p_order_id uuid, p_direction text, p_actor uuid default null, p_actor_email text default null)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  ord public.orders;
  source_location uuid;
  lines integer := 0;
  item record;
  on_hand integer;
  take integer;
begin
  select * into ord from public.orders where id = p_order_id for update;
  if not found then
    raise exception ''order_not_found'';
  end if;

  if p_direction = ''deduct'' then
    if ord.stock_deducted then return 0; end if;
    source_location := ord.location_id;
    if source_location is null then
      select id into source_location from public.locations where sells_online;
    end if;
    if source_location is null then
      raise exception ''no_online_location'';
    end if;
    for item in
      select oi.variant_id, sum(oi.quantity)::integer as quantity
        from public.order_items oi
        join public.product_variants v on v.id = oi.variant_id
        join public.products p on p.id = v.product_id
       where oi.order_id = p_order_id and p.stock_tracked
       group by oi.variant_id
    loop
      select available into on_hand
        from public.inventory_levels
       where variant_id = item.variant_id and location_id = source_location
         for update;
      take := least(item.quantity, greatest(coalesce(on_hand, 0), 0));
      if take > 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
        values (item.variant_id, source_location, ''sale'', -take, ord.order_number, p_order_id, p_actor, p_actor_email);
        lines := lines + 1;
      end if;
    end loop;
    update public.orders set stock_deducted = true where id = p_order_id;
  elsif p_direction = ''restore'' then
    if not ord.stock_deducted then return 0; end if;
    for item in
      select variant_id, location_id, sum(-quantity)::integer as qty
        from public.stock_movements
       where order_id = p_order_id and variant_id is not null
       group by variant_id, location_id
      having sum(-quantity) > 0
    loop
      insert into public.stock_movements (variant_id, location_id, type, quantity, reference, order_id, created_by, created_by_email)
      values (item.variant_id, item.location_id, ''return'', item.qty, ord.order_number, p_order_id, p_actor, p_actor_email);
      lines := lines + 1;
    end loop;
    update public.orders set stock_deducted = false where id = p_order_id;
  else
    raise exception ''invalid_direction'';
  end if;
  return lines;
end;
$$","-- Status / payment status / notes, plus the stock movement and the date of each stage.
--   pending → confirmed (customer agreed) → processing (validated: parcel created, stock out)
--   → shipped → delivered; or returned (parcel came back: stock back) / cancelled.
create or replace function public.set_order_status(p_order_id uuid, p_changes jsonb, p_actor uuid default null, p_actor_email text default null)
returns public.orders
language plpgsql
set search_path = ''''
as $$
declare
  new_status text := nullif(p_changes->>''status'', '''');
  ord public.orders;
begin
  if new_status is not null and new_status not in (''pending'', ''confirmed'', ''processing'', ''shipped'', ''delivered'', ''returned'', ''cancelled'') then
    raise exception ''invalid_status'';
  end if;
  if new_status in (''processing'', ''shipped'', ''delivered'') then
    perform public.apply_order_stock(p_order_id, ''deduct'', p_actor, p_actor_email);
  elsif new_status in (''pending'', ''confirmed'', ''returned'', ''cancelled'') then
    perform public.apply_order_stock(p_order_id, ''restore'', p_actor, p_actor_email);
  end if;

  update public.orders
     set status = coalesce(new_status, status),
         payment_status = case when p_changes ? ''payment_status'' then p_changes->>''payment_status'' else payment_status end,
         order_notes = case when p_changes ? ''order_notes'' then nullif(p_changes->>''order_notes'', '''') else order_notes end,
         confirmed_at = case
           when new_status in (''confirmed'', ''processing'', ''shipped'', ''delivered'') then coalesce(confirmed_at, now())
           when new_status = ''pending'' then null
           else confirmed_at end,
         confirmed_by = case
           when new_status in (''confirmed'', ''processing'', ''shipped'', ''delivered'') and confirmed_at is null then p_actor
           when new_status = ''pending'' then null
           else confirmed_by end,
         confirmed_by_email = case
           when new_status in (''confirmed'', ''processing'', ''shipped'', ''delivered'') and confirmed_at is null then p_actor_email
           when new_status = ''pending'' then null
           else confirmed_by_email end,
         delivered_at = case
           when new_status = ''delivered'' then coalesce(delivered_at, now())
           when new_status is not null then null
           else delivered_at end,
         returned_at = case
           when new_status = ''returned'' then coalesce(returned_at, now())
           when new_status is not null then null
           else returned_at end,
         cancelled_at = case
           when new_status = ''cancelled'' then coalesce(cancelled_at, now())
           when new_status is not null then null
           else cancelled_at end,
         updated_at = now()
   where id = p_order_id
  returning * into ord;

  if not found then
    raise exception ''order_not_found'';
  end if;
  return ord;
end;
$$","-- Assigns orders to an agent (null: unassigns).
create or replace function public.assign_orders(p_order_ids uuid[], p_user uuid, p_user_email text)
returns integer
language sql
set search_path = ''''
as $$
  with changed as (
    update public.orders
       set assigned_to = p_user, assigned_to_email = case when p_user is null then null else p_user_email end,
           assigned_at = case when p_user is null then null else now() end, updated_at = now()
     where id = any (p_order_ids) and deleted_at is null and assigned_to is distinct from p_user
    returning 1
  )
  select count(*)::integer from changed;
$$","-- Parcels can be sent for pending and confirmed orders.
create or replace function public.complete_delivery(p_id uuid, p_barcode text, p_label_url text, p_label_zebra_url text,
                                                    p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  row public.deliveries;
  ord public.orders;
  warning text;
begin
  update public.deliveries
     set barcode = p_barcode, label_url = p_label_url, label_zebra_url = p_label_zebra_url,
         status = ''En attente'', status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
  returning * into row;
  if not found then
    raise exception ''delivery_not_found'';
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id;
    if ord.status in (''pending'', ''confirmed'') then
      begin
        select * into ord from public.set_order_status(row.order_id, ''{\"status\": \"processing\"}''::jsonb, p_actor, p_actor_email);
      exception when others then
        warning := sqlerrm;
      end;
    end if;
  end if;

  return jsonb_build_object(
    ''delivery'', to_jsonb(row),
    ''order'', case when ord.id is null then null else jsonb_build_object(''status'', ord.status, ''stock_deducted'', ord.stock_deducted) end,
    ''warning'', warning
  );
end;
$$","-- Tracking: picked up → shipped; delivered → delivered; \"Livre paye\" (Colissimo paid the cash
-- out) → the cash still owed is recorded as a payment held by the carrier until the payout is
-- entered; a parcel back with us → returned (its stock comes back).
create or replace function public.record_delivery_status(p_id uuid, p_status text, p_reason text,
                                                         p_actor uuid default null, p_actor_email text default null)
returns boolean
language plpgsql
set search_path = ''''
as $$
declare
  row public.deliveries;
  ord public.orders;
  changes jsonb := ''{}''::jsonb;
  owed numeric;
begin
  update public.deliveries
     set status = p_status, status_reason = nullif(p_reason, ''''), status_changed_at = now(), updated_at = now()
   where id = p_id and deleted_at is null
     and (status is distinct from p_status or status_reason is distinct from nullif(p_reason, ''''))
  returning * into row;
  if not found then
    return false;
  end if;

  if row.order_id is not null then
    select * into ord from public.orders where id = row.order_id and deleted_at is null;
    if found then
      if p_status in (''Enleve'', ''Au depot'', ''En cours'', ''Retour Inter Agence'') and ord.status = ''processing'' then
        changes := changes || ''{\"status\": \"shipped\"}''::jsonb;
      elsif p_status in (''Livre'', ''Livre paye'') and ord.status in (''confirmed'', ''processing'', ''shipped'') then
        changes := changes || ''{\"status\": \"delivered\"}''::jsonb;
      elsif p_status in (''Retour definitif'', ''Retour paye'', ''Retour recu paye'') and ord.status in (''processing'', ''shipped'', ''delivered'') then
        changes := changes || ''{\"status\": \"returned\"}''::jsonb;
      end if;
      if changes <> ''{}''::jsonb then
        perform public.set_order_status(row.order_id, changes, p_actor, p_actor_email);
      end if;
      if p_status = ''Livre paye'' then
        owed := ord.total - ord.paid_amount;
        if owed > 0 then
          insert into public.order_payments (order_id, amount, method, account, reference, note, created_by, created_by_email)
          values (row.order_id, owed, ''cod'', ''carrier'', row.barcode, ''Colissimo: delivered and paid'', p_actor, p_actor_email);
        end if;
      end if;
    end if;
  end if;
  return true;
end;
$$","-- Website and phone orders as before; till sales (channel store) don''t ring the order bell.
create or replace function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  items integer;
  vals jsonb;
  recipients uuid[];
begin
  if new.channel = ''store'' then
    return null;
  end if;
  select coalesce(sum(quantity), 0) into items from public.order_items where order_id = new.id;
  vals := jsonb_build_object(
    ''number'', new.order_number,
    ''name'', trim(concat_ws('' '', new.customer_first_name, new.customer_last_name)),
    ''city'', coalesce(nullif(new.shipping_city, ''''), nullif(new.shipping_state, ''''), ''—''),
    ''total'', trim(to_char(new.total, ''FM999999990.##'')),
    ''items'', items
  );
  recipients := private.notification_recipients(''orders'');
  if new.assigned_to is not null then
    recipients := array_append(recipients, new.assigned_to);
  end if;
  perform private.notify(
    recipients,
    ''order'', ''new_order'', ''info'',
    private.i18n(''New order {number}'', ''Nouvelle commande {number}'', ''طلب جديد {number}'', vals),
    private.i18n(''{name} · {city} · {items} item(s) · {total} TND'',
                 ''{name} · {city} · {items} article(s) · {total} TND'',
                 ''{name} · {city} · {items} قطعة · {total} د.ت'', vals),
    ''/admin/orders/'' || new.id,
    jsonb_build_object(''order_id'', new.id, ''order_number'', new.order_number, ''total'', new.total)
  );
  return null;
end;
$$","-- ---------------------------------------------------------------------------
-- Agent performance (by the agent handling the order)
-- ---------------------------------------------------------------------------

drop function if exists public.agent_performance(timestamptz, timestamptz)","-- One row per agent over orders created in [p_from, p_to). The agent is the one the order is
-- assigned to, else the one who entered it; website orders nobody handles come back as null.
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
set search_path = ''''
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
         coalesce(sum(s.total) filter (where s.status not in (''cancelled'', ''returned'')), 0),
         (count(*) filter (where s.confirmed_at is not null))::integer,
         (count(*) filter (where s.status = ''delivered''))::integer,
         coalesce(sum(s.total) filter (where s.status = ''delivered''), 0),
         (count(*) filter (where s.payment_status = ''paid''))::integer,
         (count(*) filter (where s.status in (''pending'', ''confirmed'', ''processing'', ''shipped'')))::integer,
         (count(*) filter (where s.status = ''cancelled''))::integer,
         (count(*) filter (where s.status = ''returned''))::integer,
         coalesce(sum(s.item_count), 0)::integer,
         max(s.created_at)
    from scoped s
    left join public.back_office_users b on b.user_id = s.agent
   group by s.agent
   order by s.agent is null, count(*) desc;
$$","-- ---------------------------------------------------------------------------
-- Notifications: more audiences, low stock, daily reminders
-- ---------------------------------------------------------------------------

create or replace function private.notification_recipients(p_audience text)
returns uuid[]
language sql
stable
security definer
set search_path = ''''
as $$
  with live as (
    select b.*
      from public.back_office_users b
      join auth.users u on u.id = b.user_id
     where b.deleted_at is null and u.deleted_at is null
  )
  select coalesce(array_agg(user_id), ''{}'')
    from live
   where case p_audience
           when ''owner'' then role = ''owner''
                          or (role = ''admin'' and not exists (select 1 from live where role = ''owner''))
           when ''orders'' then role in (''owner'', ''admin'') or ''orders'' = any (permissions)
           when ''stock'' then role in (''owner'', ''admin'') or ''stock'' = any (permissions) or ''purchasing'' = any (permissions)
           when ''finance'' then role in (''owner'', ''admin'') or ''finance'' = any (permissions)
           when ''customers'' then role in (''owner'', ''admin'') or ''customers'' = any (permissions)
           else false
         end;
$$","-- A variant at the online location (or the shop) falling to its reorder point.
create or replace function private.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v record;
  vals jsonb;
begin
  select pv.reorder_point, pv.sku, p.name, p.id as product_id, p.stock_tracked, l.name as location
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.locations l on l.id = new.location_id
   where pv.id = new.variant_id and pv.deleted_at is null and p.deleted_at is null;
  if not found or not v.stock_tracked then
    return null;
  end if;
  if new.available <= v.reorder_point and old.available > v.reorder_point then
    vals := jsonb_build_object(''name'', v.name, ''sku'', coalesce(v.sku, ''''), ''left'', new.available, ''location'', v.location);
    perform private.notify(
      private.notification_recipients(''stock''),
      ''system'', ''low_stock'', case when new.available = 0 then ''warning'' else ''info'' end,
      private.i18n(''Low stock: {name}'', ''Stock bas : {name}'', ''مخزون منخفض: {name}'', vals),
      private.i18n(''{sku} · {left} left at {location}'', ''{sku} · plus que {left} à {location}'', ''{sku} · بقي {left} في {location}'', vals),
      ''/admin/stock?search='' || coalesce(v.sku, ''''),
      jsonb_build_object(''variant_id'', new.variant_id, ''product_id'', v.product_id)
    );
  end if;
  return null;
end;
$$","create trigger inventory_levels_low_stock
  after update of available on public.inventory_levels
  for each row execute function private.notify_low_stock()","-- A message from a customer (Messenger, Instagram, WhatsApp): their agent, else the customers team.
create or replace function private.notify_customer_message()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  c public.customers;
  vals jsonb;
begin
  if new.direction <> ''in'' then
    return null;
  end if;
  select * into c from public.customers where id = new.customer_id;
  vals := jsonb_build_object(''name'', coalesce(nullif(c.full_name, ''''), new.sender_name, c.phone, ''?''), ''channel'', initcap(new.channel),
                             ''text'', left(new.body, 120));
  perform private.notify(
    case when c.assigned_to is not null then array[c.assigned_to] else private.notification_recipients(''customers'') end,
    ''order'', ''customer_message'', ''info'',
    private.i18n(''{channel} message from {name}'', ''Message {channel} de {name}'', ''رسالة {channel} من {name}'', vals),
    private.i18n(''{text}'', ''{text}'', ''{text}'', vals),
    ''/admin/customers/'' || new.customer_id,
    jsonb_build_object(''customer_id'', new.customer_id)
  );
  return null;
end;
$$","revoke all on function private.notify_customer_message() from public, anon, authenticated","create trigger customer_interactions_notify
  after insert on public.customer_interactions
  for each row execute function private.notify_customer_message()","-- Once a day: orders waiting for confirmation too long, parcels moving too long, tasks due today.
-- (Bills due soon are added by the accounting migration.)
create or replace function private.daily_alerts()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  cfg jsonb := coalesce((select value from public.erp_settings where key = ''sales''), ''{}''::jsonb);
  pending_hours integer := coalesce((cfg->>''pending_alert_hours'')::integer, 24);
  late_days integer := coalesce((cfg->>''late_delivery_days'')::integer, 6);
  n integer;
  sent integer := 0;
  t record;
begin
  select count(*) into n from public.orders
   where deleted_at is null and status in (''pending'', ''confirmed'') and created_at < now() - make_interval(hours => pending_hours);
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients(''orders''), ''order'', ''orders_waiting'', ''warning'',
      private.i18n(''{count} order(s) waiting for confirmation'', ''{count} commande(s) en attente de confirmation'', ''{count} طلب بانتظار التأكيد'', jsonb_build_object(''count'', n)),
      private.i18n(''Older than {hours} h'', ''Depuis plus de {hours} h'', ''منذ أكثر من {hours} ساعة'', jsonb_build_object(''hours'', pending_hours)),
      ''/admin/orders?status=pending'', ''{}''::jsonb);
  end if;

  select count(*) into n from public.orders o
   where o.deleted_at is null and o.status in (''processing'', ''shipped'')
     and coalesce(o.confirmed_at, o.created_at) < now() - make_interval(days => late_days);
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients(''orders''), ''order'', ''late_deliveries'', ''warning'',
      private.i18n(''{count} late delivery(ies)'', ''{count} livraison(s) en retard'', ''{count} توصيل متأخر'', jsonb_build_object(''count'', n)),
      private.i18n(''Sent more than {days} days ago and not delivered'', ''Envoyées il y a plus de {days} jours, non livrées'', ''أرسلت منذ أكثر من {days} أيام ولم تسلم'', jsonb_build_object(''days'', late_days)),
      ''/admin/delivery'', ''{}''::jsonb);
  end if;

  for t in
    select assigned_to, count(*) as due
      from public.crm_tasks
     where deleted_at is null and done_at is null and assigned_to is not null and due_at < now() + interval ''1 day''
     group by assigned_to
  loop
    sent := sent + private.notify(array[t.assigned_to], ''system'', ''tasks_due'', ''info'',
      private.i18n(''{count} follow-up(s) due today'', ''{count} relance(s) à faire aujourd''''hui'', ''{count} متابعة اليوم'', jsonb_build_object(''count'', t.due)),
      null, ''/admin/my-work'', ''{}''::jsonb);
  end loop;
  return sent;
end;
$$","revoke all on function private.daily_alerts() from public, anon, authenticated","-- ---------------------------------------------------------------------------
-- Names for the activity log and owner alerts
-- ---------------------------------------------------------------------------

create or replace function private.entity_names(p_entity text)
returns jsonb
language sql
immutable
set search_path = ''''
as $$
  select case p_entity
    when ''products'' then ''{\"en\":\"product\",\"fr\":\"produit\",\"ar\":\"منتج\"}''
    when ''product_variants'' then ''{\"en\":\"variant\",\"fr\":\"variante\",\"ar\":\"متغير\"}''
    when ''product_images'' then ''{\"en\":\"product photo\",\"fr\":\"photo produit\",\"ar\":\"صورة منتج\"}''
    when ''categories'' then ''{\"en\":\"category\",\"fr\":\"catégorie\",\"ar\":\"فئة\"}''
    when ''colors'' then ''{\"en\":\"color\",\"fr\":\"couleur\",\"ar\":\"لون\"}''
    when ''sizes'' then ''{\"en\":\"size\",\"fr\":\"taille\",\"ar\":\"مقاس\"}''
    when ''product_discounts'' then ''{\"en\":\"product discount\",\"fr\":\"remise produit\",\"ar\":\"تخفيض منتج\"}''
    when ''promotions'' then ''{\"en\":\"sale banner\",\"fr\":\"bannière promo\",\"ar\":\"لافتة تخفيض\"}''
    when ''reels'' then ''{\"en\":\"video reel\",\"fr\":\"vidéo\",\"ar\":\"فيديو\"}''
    when ''orders'' then ''{\"en\":\"order\",\"fr\":\"commande\",\"ar\":\"طلب\"}''
    when ''locations'' then ''{\"en\":\"stock location\",\"fr\":\"emplacement\",\"ar\":\"موقع مخزون\"}''
    when ''suppliers'' then ''{\"en\":\"supplier\",\"fr\":\"fournisseur\",\"ar\":\"مورّد\"}''
    when ''collections'' then ''{\"en\":\"collection\",\"fr\":\"collection\",\"ar\":\"مجموعة\"}''
    when ''product_costs'' then ''{\"en\":\"purchase cost\",\"fr\":\"coût d''''achat\",\"ar\":\"تكلفة شراء\"}''
    when ''landing_products'' then ''{\"en\":\"home page pick\",\"fr\":\"choix page d''''accueil\",\"ar\":\"اختيار الصفحة الرئيسية\"}''
    when ''site_settings'' then ''{\"en\":\"setting\",\"fr\":\"réglage\",\"ar\":\"إعداد\"}''
    when ''erp_settings'' then ''{\"en\":\"business setting\",\"fr\":\"réglage de gestion\",\"ar\":\"إعداد إداري\"}''
    when ''shipping_rates'' then ''{\"en\":\"shipping rate\",\"fr\":\"tarif de livraison\",\"ar\":\"سعر شحن\"}''
    when ''country_tax_rates'' then ''{\"en\":\"tax rate\",\"fr\":\"taux de taxe\",\"ar\":\"نسبة ضريبة\"}''
    when ''reviews'' then ''{\"en\":\"review\",\"fr\":\"avis\",\"ar\":\"تقييم\"}''
    when ''team_member'' then ''{\"en\":\"team account\",\"fr\":\"compte d''''équipe\",\"ar\":\"حساب فريق\"}''
    when ''customers'' then ''{\"en\":\"customer\",\"fr\":\"client\",\"ar\":\"عميل\"}''
    when ''customer_interactions'' then ''{\"en\":\"conversation note\",\"fr\":\"échange client\",\"ar\":\"محادثة\"}''
    when ''crm_tasks'' then ''{\"en\":\"follow-up\",\"fr\":\"relance\",\"ar\":\"متابعة\"}''
    when ''order_payments'' then ''{\"en\":\"payment\",\"fr\":\"encaissement\",\"ar\":\"دفعة\"}''
    when ''cod_remittances'' then ''{\"en\":\"carrier payout\",\"fr\":\"versement transporteur\",\"ar\":\"تحويل شركة التوصيل\"}''
    when ''treasury_movements'' then ''{\"en\":\"cash/bank movement\",\"fr\":\"mouvement de trésorerie\",\"ar\":\"حركة خزينة\"}''
    when ''ad_campaigns'' then ''{\"en\":\"campaign\",\"fr\":\"campagne\",\"ar\":\"حملة\"}''
    when ''ad_spend'' then ''{\"en\":\"ad spend\",\"fr\":\"dépense publicitaire\",\"ar\":\"مصروف إشهار\"}''
    when ''agent_goals'' then ''{\"en\":\"objective\",\"fr\":\"objectif\",\"ar\":\"هدف\"}''
    when ''business_goals'' then ''{\"en\":\"monthly goal\",\"fr\":\"objectif du mois\",\"ar\":\"هدف الشهر\"}''
    when ''raw_materials'' then ''{\"en\":\"raw material\",\"fr\":\"matière première\",\"ar\":\"مادة أولية\"}''
    when ''purchase_orders'' then ''{\"en\":\"purchase order\",\"fr\":\"commande d''''achat\",\"ar\":\"طلب شراء\"}''
    when ''purchase_receipts'' then ''{\"en\":\"goods receipt\",\"fr\":\"réception\",\"ar\":\"استلام\"}''
    when ''pos_sessions'' then ''{\"en\":\"till session\",\"fr\":\"session de caisse\",\"ar\":\"جلسة صندوق\"}''
    when ''bills'' then ''{\"en\":\"bill\",\"fr\":\"facture fournisseur\",\"ar\":\"فاتورة مورد\"}''
    when ''bill_payments'' then ''{\"en\":\"bill payment\",\"fr\":\"règlement fournisseur\",\"ar\":\"دفع فاتورة\"}''
    when ''sales_invoices'' then ''{\"en\":\"invoice\",\"fr\":\"facture\",\"ar\":\"فاتورة\"}''
    when ''journal_entries'' then ''{\"en\":\"journal entry\",\"fr\":\"écriture\",\"ar\":\"قيد محاسبي\"}''
    when ''accounts'' then ''{\"en\":\"account\",\"fr\":\"compte\",\"ar\":\"حساب\"}''
    when ''documents'' then ''{\"en\":\"document\",\"fr\":\"document\",\"ar\":\"وثيقة\"}''
    else jsonb_build_object(''en'', p_entity, ''fr'', p_entity, ''ar'', p_entity)::text
  end::jsonb;
$$","-- ---------------------------------------------------------------------------
-- Function grants (service role only)
-- ---------------------------------------------------------------------------

revoke all on function
  public.variant_unit_cost(uuid),
  public.stock_valuation(),
  public.record_remittance(jsonb, uuid[], uuid, text),
  public.find_order_duplicates(text, uuid, integer),
  public.find_customer_duplicates(),
  public.merge_customers(uuid, uuid),
  public.anonymize_customer(uuid),
  public.assign_orders(uuid[], uuid, text),
  public.agent_performance(timestamptz, timestamptz, text)
  from public, anon, authenticated","grant execute on function
  public.variant_unit_cost(uuid),
  public.stock_valuation(),
  public.record_remittance(jsonb, uuid[], uuid, text),
  public.find_order_duplicates(text, uuid, integer),
  public.find_customer_duplicates(),
  public.merge_customers(uuid, uuid),
  public.anonymize_customer(uuid),
  public.assign_orders(uuid[], uuid, text),
  public.agent_performance(timestamptz, timestamptz, text)
  to service_role","revoke all on function private.stock_movement_cost(), private.set_order_item_cost(), private.refresh_order_paid(uuid),
  private.on_order_payment_change(), private.link_order_customer(), private.sync_customer_stage(),
  private.notify_low_stock() from public, anon, authenticated","-- Sets an agent''s objective for one or more months, replacing the ones there were.
create or replace function public.set_agent_goal(p_user uuid, p_user_email text, p_months date[], p_goal jsonb,
                                                 p_actor uuid default null, p_actor_email text default null)
returns setof public.agent_goals
language plpgsql
set search_path = ''''
as $$
begin
  update public.agent_goals set deleted_at = now()
   where user_id = p_user and month = any (p_months) and deleted_at is null;
  return query
  insert into public.agent_goals (user_id, user_email, month, target_orders, target_confirmed, target_delivered, target_revenue,
                                  commission_type, commission_value, created_by, created_by_email)
  select p_user, p_user_email, m, nullif(p_goal->>''target_orders'', '''')::integer, nullif(p_goal->>''target_confirmed'', '''')::integer,
         nullif(p_goal->>''target_delivered'', '''')::integer, nullif(p_goal->>''target_revenue'', '''')::numeric,
         coalesce(nullif(p_goal->>''commission_type'', ''''), ''none''), coalesce(nullif(p_goal->>''commission_value'', '''')::numeric, 0),
         p_actor, p_actor_email
    from unnest(p_months) as m
  returning *;
end;
$$","revoke all on function public.set_agent_goal(uuid, text, date[], jsonb, uuid, text) from public, anon, authenticated","grant execute on function public.set_agent_goal(uuid, text, date[], jsonb, uuid, text) to service_role","-- ---------------------------------------------------------------------------
-- Monthly goals of the whole business (Admin → Objectives & commissions)
-- ---------------------------------------------------------------------------

-- One row per month; agents'' own objectives (agent_goals) break it down per person.
create table public.business_goals (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  target_revenue numeric(14, 3) check (target_revenue >= 0),        -- delivered sales, with VAT
  target_orders integer check (target_orders >= 0),                 -- orders taken
  target_confirmed integer check (target_confirmed >= 0),
  target_delivered integer check (target_delivered >= 0),
  target_gross_margin numeric(14, 3) check (target_gross_margin >= 0),
  max_return_rate numeric(5, 2) check (max_return_rate between 0 and 100),
  ad_budget numeric(14, 3) check (ad_budget >= 0),
  notes text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","alter table public.business_goals enable row level security","revoke all on public.business_goals from anon, authenticated","grant all on public.business_goals to service_role","create trigger set_updated_at before update on public.business_goals
  for each row execute function private.set_updated_at()","create trigger prevent_hard_delete before delete on public.business_goals
  for each row execute function private.prevent_hard_delete()","create trigger log_activity after insert or update on public.business_goals
  for each row execute function private.log_activity()"}', 'erp_sales_crm');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261016121000', '{"-- ERP, part 2: purchasing (suppliers, price requests, purchase orders, receipts with quality
-- check), raw materials and cost price per model (bill of materials, production), and the
-- point of sale (till sessions, sales, cash in/out, closing with variance).

-- ---------------------------------------------------------------------------
-- Suppliers: terms and details
-- ---------------------------------------------------------------------------

alter table public.suppliers
  add column contact_name text,
  add column address text,
  add column tax_id text,                       -- matricule fiscal
  add column bank_details text,                 -- RIB
  add column payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  add column kind text not null default ''goods'' check (kind in (''goods'', ''materials'', ''services'', ''other''))","-- ---------------------------------------------------------------------------
-- Raw materials
-- ---------------------------------------------------------------------------

create table public.raw_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  code text,
  unit text not null default ''unit'' check (unit in (''unit'', ''m'', ''cm'', ''kg'', ''g'', ''l'', ''ml'', ''roll'', ''pack'')),
  supplier_id uuid references public.suppliers (id) on delete set null,
  stock numeric(14, 3) not null default 0 check (stock >= 0),
  avg_cost numeric(14, 4) check (avg_cost >= 0),
  reorder_point numeric(14, 3) not null default 0 check (reorder_point >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index raw_materials_code_live_idx on public.raw_materials (code) where deleted_at is null and code is not null","-- Append-only, like stock_movements. The trigger keeps raw_materials.stock and avg_cost.
create table public.material_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.raw_materials (id),
  type text not null check (type in (''purchase'', ''consumption'', ''adjustment'', ''return'')),
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost numeric(14, 4) check (unit_cost >= 0),
  reference text not null default '''',
  note text not null default '''',
  purchase_receipt_id uuid,
  production_id uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint material_movements_direction check (
    (type = ''purchase'' and quantity > 0) or (type = ''consumption'' and quantity < 0) or type in (''adjustment'', ''return'')
  )
)","create index material_movements_material_idx on public.material_movements (material_id, created_at desc)","create or replace function private.apply_material_movement()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  m public.raw_materials;
begin
  select * into m from public.raw_materials where id = new.material_id for update;
  if not found then
    raise exception ''material_not_found'';
  end if;
  if m.stock + new.quantity < 0 then
    raise exception ''insufficient_material:%:%'', m.name, m.stock using errcode = ''P0001'';
  end if;
  if new.type = ''purchase'' and new.unit_cost is not null then
    update public.raw_materials
       set stock = m.stock + new.quantity,
           avg_cost = case when m.avg_cost is null or m.stock <= 0 then new.unit_cost
                           else round((m.stock * m.avg_cost + new.quantity * new.unit_cost) / (m.stock + new.quantity), 4) end
     where id = m.id;
  else
    new.unit_cost := coalesce(new.unit_cost, m.avg_cost);
    update public.raw_materials set stock = m.stock + new.quantity where id = m.id;
  end if;
  return new;
end;
$$","create trigger material_movements_apply
  before insert on public.material_movements
  for each row execute function private.apply_material_movement()","create or replace function private.prevent_movement_change()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  raise exception ''append_only: record a correcting movement instead'' using errcode = ''P0001'';
end;
$$","create trigger material_movements_append_only
  before update or delete on public.material_movements
  for each row execute function private.prevent_movement_change()","-- ---------------------------------------------------------------------------
-- Cost price per model
-- ---------------------------------------------------------------------------

-- Materials used to make one unit of a product.
create table public.product_bom (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  material_id uuid not null references public.raw_materials (id),
  quantity numeric(14, 4) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index product_bom_live_idx on public.product_bom (product_id, material_id) where deleted_at is null","-- Work and overhead per unit (admin only; products is publicly readable, so not there).
create table public.product_costing (
  product_id uuid primary key references public.products (id) on delete cascade,
  labor_cost numeric(12, 3) not null default 0 check (labor_cost >= 0),
  overhead_cost numeric(12, 3) not null default 0 check (overhead_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","-- Per product: what each unit costs. With a bill of materials: materials + labor + overhead.
-- Without one: the purchase cost entered on the product, else the stock''s average cost.
create or replace function public.product_cost_prices()
returns table (
  product_id uuid,
  product_name text,
  code text,
  base_price numeric,
  materials_cost numeric,
  labor_cost numeric,
  overhead_cost numeric,
  stock_avg_cost numeric,
  purchase_cost numeric,
  cost_price numeric,
  margin numeric,
  margin_percent numeric
)
language sql
stable
set search_path = ''''
as $$
  with bom as (
    select b.product_id, sum(b.quantity * coalesce(m.avg_cost, 0)) as materials
      from public.product_bom b
      join public.raw_materials m on m.id = b.material_id
     where b.deleted_at is null
     group by b.product_id
  ), avgc as (
    select v.product_id, avg(v.avg_cost) as avg_cost
      from public.product_variants v
     where v.deleted_at is null and v.avg_cost is not null
     group by v.product_id
  ), base as (
    select p.id, p.name, p.code, p.base_price,
           round(bom.materials, 3) as materials,
           coalesce(pc.labor_cost, 0) as labor, coalesce(pc.overhead_cost, 0) as overhead,
           round(avgc.avg_cost, 3) as avg_cost, cost.cost as purchase,
           case when bom.product_id is not null then round(bom.materials + coalesce(pc.labor_cost, 0) + coalesce(pc.overhead_cost, 0), 3)
                else coalesce(cost.cost, round(avgc.avg_cost, 3)) end as cost_price
      from public.products p
      left join bom on bom.product_id = p.id
      left join avgc on avgc.product_id = p.id
      left join public.product_costing pc on pc.product_id = p.id and pc.deleted_at is null
      left join public.product_costs cost on cost.product_id = p.id and cost.deleted_at is null
     where p.deleted_at is null
  )
  select id, name, code, base_price, materials, labor, overhead, avg_cost, purchase, cost_price,
         case when cost_price is null then null else base_price - cost_price end,
         case when cost_price is null or base_price = 0 then null else round((base_price - cost_price) / base_price * 100, 1) end
    from base
   order by name;
$$","-- Making p_quantity units of a variant in the workshop: its materials are consumed and the units
-- enter stock at their cost price (materials + labor + overhead).
create or replace function public.record_production(p_variant_id uuid, p_quantity integer, p_location_id uuid,
                                                    p_note text default '''', p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  v_product uuid;
  v_ref text := ''PROD-'' || to_char(now(), ''YYMMDDHH24MISS'');
  v_prod uuid := gen_random_uuid();
  materials numeric := 0;
  extra numeric := 0;
  line record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception ''invalid_quantity'';
  end if;
  select product_id into v_product from public.product_variants where id = p_variant_id and deleted_at is null;
  if v_product is null then
    raise exception ''variant_not_found'';
  end if;
  if not exists (select 1 from public.product_bom where product_id = v_product and deleted_at is null) then
    raise exception ''no_bill_of_materials'';
  end if;

  for line in
    select b.material_id, b.quantity, m.avg_cost
      from public.product_bom b join public.raw_materials m on m.id = b.material_id
     where b.product_id = v_product and b.deleted_at is null
  loop
    insert into public.material_movements (material_id, type, quantity, reference, note, production_id, created_by, created_by_email)
    values (line.material_id, ''consumption'', -(line.quantity * p_quantity), v_ref, coalesce(p_note, ''''), v_prod, p_actor, p_actor_email);
    materials := materials + line.quantity * coalesce(line.avg_cost, 0);
  end loop;
  select coalesce(labor_cost, 0) + coalesce(overhead_cost, 0) into extra
    from public.product_costing where product_id = v_product and deleted_at is null;

  insert into public.stock_movements (variant_id, location_id, type, quantity, unit_cost, reference, note, created_by, created_by_email)
  values (p_variant_id, p_location_id, ''restock'', p_quantity, round(materials + coalesce(extra, 0), 3), v_ref,
          coalesce(nullif(p_note, ''''), ''Production''), p_actor, p_actor_email);
  update public.products set stock_tracked = true where id = v_product and not stock_tracked;

  return jsonb_build_object(''reference'', v_ref, ''unit_cost'', round(materials + coalesce(extra, 0), 3));
end;
$$","-- Restocks recorded by hand can carry a unit cost (moves the average cost).
create or replace function public.record_stock_movements(
  p_type text,
  p_location_id uuid,
  p_items jsonb,
  p_to_location_id uuid default null,
  p_reference text default '''',
  p_note text default '''',
  p_track boolean default false,
  p_actor uuid default null,
  p_actor_email text default null
)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  item jsonb;
  item_location uuid;
  qty integer;
  current_qty integer;
  delta integer;
  recorded integer := 0;
  v_ref text := coalesce(p_reference, '''');
  v_note text := coalesce(p_note, '''');
  v_cost numeric;
begin
  if p_type not in (''restock'', ''return'', ''sale'', ''adjustment'', ''transfer'', ''count'') then
    raise exception ''invalid_movement_type'';
  end if;
  if p_type = ''transfer'' and (p_to_location_id is null or p_to_location_id = p_location_id) then
    raise exception ''invalid_transfer'';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    qty := (item->>''quantity'')::integer;
    item_location := coalesce(nullif(item->>''location_id'', '''')::uuid, p_location_id);
    v_cost := nullif(item->>''unit_cost'', '''')::numeric;

    if p_type = ''count'' then
      if qty < 0 then
        raise exception ''negative_count'';
      end if;
      select l.available into current_qty
        from public.inventory_levels l
       where l.variant_id = (item->>''variant_id'')::uuid and l.location_id = item_location
       for update;
      delta := qty - coalesce(current_qty, 0);
      if delta <> 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>''variant_id'')::uuid, item_location, ''adjustment'', delta, coalesce(nullif(v_ref, ''''), ''Stock count''), v_note, p_actor, p_actor_email);
        recorded := recorded + 1;
      end if;
    elsif p_type = ''transfer'' then
      qty := abs(qty);
      if qty > 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, reference, note, created_by, created_by_email)
        values ((item->>''variant_id'')::uuid, item_location, ''transfer'', -qty, v_ref, v_note, p_actor, p_actor_email),
               ((item->>''variant_id'')::uuid, p_to_location_id, ''transfer'', qty, v_ref, v_note, p_actor, p_actor_email);
        recorded := recorded + 2;
      end if;
    else
      qty := case p_type when ''sale'' then -abs(qty) when ''adjustment'' then qty else abs(qty) end;
      if qty <> 0 then
        insert into public.stock_movements (variant_id, location_id, type, quantity, unit_cost, reference, note, created_by, created_by_email)
        values ((item->>''variant_id'')::uuid, item_location, p_type::public.stock_movement_type, qty,
                case when p_type = ''restock'' then v_cost end, v_ref, v_note, p_actor, p_actor_email);
        recorded := recorded + 1;
      end if;
    end if;
  end loop;

  if p_track then
    update public.products p
       set stock_tracked = true
     where not p.stock_tracked
       and p.id in (select pv.product_id from public.product_variants pv
                     where pv.id in (select (i->>''variant_id'')::uuid from jsonb_array_elements(p_items) as i));
  end if;

  return recorded;
end;
$$","-- ---------------------------------------------------------------------------
-- Purchase orders and price requests
-- ---------------------------------------------------------------------------

create sequence public.purchase_order_seq","create sequence public.purchase_receipt_seq","create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default (''PO-'' || lpad(nextval(''public.purchase_order_seq'')::text, 5, ''0'')),
  supplier_id uuid not null references public.suppliers (id),
  -- rfq: price request sent, the prices are the supplier''s quote.
  status text not null default ''draft''
    check (status in (''draft'', ''rfq'', ''ordered'', ''partial'', ''received'', ''cancelled'')),
  order_date date not null default current_date,
  expected_date date,
  location_id uuid references public.locations (id) on delete set null,
  notes text,
  subtotal numeric(14, 3) not null default 0,
  vat_amount numeric(14, 3) not null default 0,
  total numeric(14, 3) not null default 0,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, order_date desc)","create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  material_id uuid references public.raw_materials (id) on delete set null,
  description text not null default '''',
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  vat_rate numeric(5, 2) not null default 19 check (vat_rate >= 0),
  received_quantity numeric(14, 3) not null default 0,
  rejected_quantity numeric(14, 3) not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (variant_id is not null or material_id is not null or length(description) > 0)
)","create index purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id)","create index purchase_order_lines_variant_idx on public.purchase_order_lines (variant_id) where variant_id is not null","create index purchase_order_lines_material_idx on public.purchase_order_lines (material_id) where material_id is not null","-- Goods arriving against a purchase order. Lines are checked (accepted / rejected) and the
-- accepted quantities only enter stock when the receipt is validated.
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default (''GR-'' || lpad(nextval(''public.purchase_receipt_seq'')::text, 5, ''0'')),
  purchase_order_id uuid not null references public.purchase_orders (id),
  received_on date not null default current_date,
  location_id uuid references public.locations (id),
  status text not null default ''pending'' check (status in (''pending'', ''validated'', ''cancelled'')),
  notes text,
  validated_at timestamptz,
  validated_by uuid,
  validated_by_email text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts (id) on delete cascade,
  po_line_id uuid not null references public.purchase_order_lines (id),
  quantity_accepted numeric(14, 3) not null default 0 check (quantity_accepted >= 0),
  quantity_rejected numeric(14, 3) not null default 0 check (quantity_rejected >= 0),
  reject_reason text,
  created_at timestamptz not null default now(),
  check (quantity_accepted + quantity_rejected > 0)
)","create index purchase_receipt_lines_receipt_idx on public.purchase_receipt_lines (receipt_id)","-- Creates (p_id null) or updates a purchase order and replaces its lines, with totals.
-- Lines already partly received can''t be removed.
create or replace function public.save_purchase_order(p_id uuid, p_po jsonb, p_lines jsonb,
                                                      p_actor uuid default null, p_actor_email text default null)
returns public.purchase_orders
language plpgsql
set search_path = ''''
as $$
declare
  po public.purchase_orders;
  line jsonb;
  pos integer := 0;
  keep uuid[] := ''{}'';
begin
  if p_id is null then
    insert into public.purchase_orders (supplier_id, status, order_date, expected_date, location_id, notes, created_by, created_by_email)
    values ((p_po->>''supplier_id'')::uuid, coalesce(nullif(p_po->>''status'', ''''), ''draft''),
            coalesce(nullif(p_po->>''order_date'', '''')::date, current_date), nullif(p_po->>''expected_date'', '''')::date,
            nullif(p_po->>''location_id'', '''')::uuid, nullif(p_po->>''notes'', ''''), p_actor, p_actor_email)
    returning * into po;
  else
    select * into po from public.purchase_orders where id = p_id and deleted_at is null for update;
    if not found then
      raise exception ''purchase_order_not_found'';
    end if;
    if po.status in (''received'', ''cancelled'') and p_lines is not null then
      raise exception ''purchase_order_closed'';
    end if;
    update public.purchase_orders
       set supplier_id = coalesce(nullif(p_po->>''supplier_id'', '''')::uuid, supplier_id),
           status = coalesce(nullif(p_po->>''status'', ''''), status),
           order_date = coalesce(nullif(p_po->>''order_date'', '''')::date, order_date),
           expected_date = case when p_po ? ''expected_date'' then nullif(p_po->>''expected_date'', '''')::date else expected_date end,
           location_id = case when p_po ? ''location_id'' then nullif(p_po->>''location_id'', '''')::uuid else location_id end,
           notes = case when p_po ? ''notes'' then nullif(p_po->>''notes'', '''') else notes end
     where id = p_id
    returning * into po;
  end if;

  if p_lines is not null then
    for line in select * from jsonb_array_elements(p_lines) loop
      pos := pos + 1;
      if nullif(line->>''id'', '''') is not null then
        update public.purchase_order_lines
           set variant_id = nullif(line->>''variant_id'', '''')::uuid, material_id = nullif(line->>''material_id'', '''')::uuid,
               description = coalesce(line->>''description'', ''''), quantity = (line->>''quantity'')::numeric,
               unit_cost = coalesce(nullif(line->>''unit_cost'', '''')::numeric, 0),
               vat_rate = coalesce(nullif(line->>''vat_rate'', '''')::numeric, 19), position = pos
         where id = (line->>''id'')::uuid and purchase_order_id = po.id;
        keep := keep || (line->>''id'')::uuid;
      else
        insert into public.purchase_order_lines (purchase_order_id, variant_id, material_id, description, quantity, unit_cost, vat_rate, position)
        values (po.id, nullif(line->>''variant_id'', '''')::uuid, nullif(line->>''material_id'', '''')::uuid, coalesce(line->>''description'', ''''),
                (line->>''quantity'')::numeric, coalesce(nullif(line->>''unit_cost'', '''')::numeric, 0),
                coalesce(nullif(line->>''vat_rate'', '''')::numeric, 19), pos)
        returning array_append(keep, id) into keep;
      end if;
    end loop;
    if exists (select 1 from public.purchase_order_lines
                where purchase_order_id = po.id and deleted_at is null and not (id = any (keep)) and received_quantity > 0) then
      raise exception ''line_already_received'';
    end if;
    update public.purchase_order_lines set deleted_at = now()
     where purchase_order_id = po.id and deleted_at is null and not (id = any (keep));
  end if;

  update public.purchase_orders p
     set subtotal = t.subtotal, vat_amount = t.vat, total = t.subtotal + t.vat
    from (
      select coalesce(round(sum(quantity * unit_cost), 3), 0) as subtotal,
             coalesce(round(sum(quantity * unit_cost * vat_rate / 100), 3), 0) as vat
        from public.purchase_order_lines where purchase_order_id = po.id and deleted_at is null
    ) t
   where p.id = po.id
  returning p.* into po;
  return po;
end;
$$","-- Records goods received (pending check), and validates them right away when p_validate.
create or replace function public.create_purchase_receipt(p_po_id uuid, p_receipt jsonb, p_lines jsonb, p_validate boolean,
                                                          p_actor uuid default null, p_actor_email text default null)
returns public.purchase_receipts
language plpgsql
set search_path = ''''
as $$
declare
  po public.purchase_orders;
  rec public.purchase_receipts;
  line jsonb;
begin
  select * into po from public.purchase_orders where id = p_po_id and deleted_at is null for update;
  if not found then
    raise exception ''purchase_order_not_found'';
  end if;
  if po.status in (''draft'', ''rfq'', ''cancelled'', ''received'') then
    raise exception ''purchase_order_not_open'';
  end if;

  insert into public.purchase_receipts (purchase_order_id, received_on, location_id, notes, created_by, created_by_email)
  values (po.id, coalesce(nullif(p_receipt->>''received_on'', '''')::date, current_date),
          coalesce(nullif(p_receipt->>''location_id'', '''')::uuid, po.location_id), nullif(p_receipt->>''notes'', ''''), p_actor, p_actor_email)
  returning * into rec;

  for line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((line->>''quantity_accepted'')::numeric, 0) + coalesce((line->>''quantity_rejected'')::numeric, 0) > 0 then
      if not exists (select 1 from public.purchase_order_lines
                      where id = (line->>''po_line_id'')::uuid and purchase_order_id = po.id and deleted_at is null) then
        raise exception ''line_not_on_order'';
      end if;
      insert into public.purchase_receipt_lines (receipt_id, po_line_id, quantity_accepted, quantity_rejected, reject_reason)
      values (rec.id, (line->>''po_line_id'')::uuid, coalesce((line->>''quantity_accepted'')::numeric, 0),
              coalesce((line->>''quantity_rejected'')::numeric, 0), nullif(line->>''reject_reason'', ''''));
    end if;
  end loop;
  if not exists (select 1 from public.purchase_receipt_lines where receipt_id = rec.id) then
    raise exception ''receipt_empty'';
  end if;

  if p_validate then
    rec := public.validate_purchase_receipt(rec.id, p_actor, p_actor_email);
  end if;
  return rec;
end;
$$","-- Accepted goods enter stock (products at the receipt''s location, materials in the workshop
-- store) at the order''s unit cost; the order''s received quantities and status follow.
create or replace function public.validate_purchase_receipt(p_receipt_id uuid, p_actor uuid default null, p_actor_email text default null)
returns public.purchase_receipts
language plpgsql
set search_path = ''''
as $$
declare
  rec public.purchase_receipts;
  po public.purchase_orders;
  line record;
  v_location uuid;
begin
  select * into rec from public.purchase_receipts where id = p_receipt_id and deleted_at is null for update;
  if not found then
    raise exception ''receipt_not_found'';
  end if;
  if rec.status <> ''pending'' then
    raise exception ''receipt_not_pending'';
  end if;
  select * into po from public.purchase_orders where id = rec.purchase_order_id for update;
  v_location := coalesce(rec.location_id, po.location_id);

  for line in
    select rl.*, pl.variant_id, pl.material_id, pl.unit_cost
      from public.purchase_receipt_lines rl
      join public.purchase_order_lines pl on pl.id = rl.po_line_id
     where rl.receipt_id = rec.id
  loop
    if line.quantity_accepted > 0 then
      if line.variant_id is not null then
        if v_location is null then
          raise exception ''receipt_location_required'';
        end if;
        if line.quantity_accepted <> trunc(line.quantity_accepted) then
          raise exception ''product_quantity_must_be_whole'';
        end if;
        insert into public.stock_movements (variant_id, location_id, type, quantity, unit_cost, reference, note, created_by, created_by_email)
        values (line.variant_id, v_location, ''restock'', line.quantity_accepted::integer, round(line.unit_cost, 3),
                po.number, ''Goods receipt '' || rec.number, p_actor, p_actor_email);
        update public.products set stock_tracked = true
         where id = (select product_id from public.product_variants where id = line.variant_id) and not stock_tracked;
      elsif line.material_id is not null then
        insert into public.material_movements (material_id, type, quantity, unit_cost, reference, note, purchase_receipt_id, created_by, created_by_email)
        values (line.material_id, ''purchase'', line.quantity_accepted, line.unit_cost, po.number, ''Goods receipt '' || rec.number, rec.id, p_actor, p_actor_email);
      end if;
    end if;
    update public.purchase_order_lines
       set received_quantity = received_quantity + line.quantity_accepted,
           rejected_quantity = rejected_quantity + line.quantity_rejected
     where id = line.po_line_id;
  end loop;

  update public.purchase_receipts
     set status = ''validated'', validated_at = now(), validated_by = p_actor, validated_by_email = p_actor_email
   where id = rec.id
  returning * into rec;

  update public.purchase_orders p
     set status = case when not exists (
                    select 1 from public.purchase_order_lines l
                     where l.purchase_order_id = p.id and l.deleted_at is null and l.received_quantity < l.quantity)
                  then ''received'' else ''partial'' end
   where p.id = po.id;
  return rec;
end;
$$","-- What each supplier asked for each item, most recent first: price requests and orders.
create or replace function public.purchase_price_comparison(p_variant_id uuid default null, p_material_id uuid default null)
returns table (
  item_key text,
  item_name text,
  supplier_id uuid,
  supplier_name text,
  last_unit_cost numeric,
  min_unit_cost numeric,
  avg_unit_cost numeric,
  times integer,
  total_quantity numeric,
  last_date date
)
language sql
stable
set search_path = ''''
as $$
  with lines as (
    select coalesce(''v:'' || l.variant_id, ''m:'' || l.material_id, ''d:'' || lower(l.description)) as item_key,
           coalesce(p.name || coalesce('' · '' || nullif(v.sku, ''''), ''''), m.name, l.description) as item_name,
           po.supplier_id, s.name as supplier_name, l.unit_cost, l.quantity, po.order_date, po.created_at
      from public.purchase_order_lines l
      join public.purchase_orders po on po.id = l.purchase_order_id and po.deleted_at is null and po.status <> ''cancelled''
      join public.suppliers s on s.id = po.supplier_id
      left join public.product_variants v on v.id = l.variant_id
      left join public.products p on p.id = v.product_id
      left join public.raw_materials m on m.id = l.material_id
     where l.deleted_at is null
       and (p_variant_id is null or l.variant_id = p_variant_id)
       and (p_material_id is null or l.material_id = p_material_id)
  )
  select item_key, max(item_name), supplier_id, max(supplier_name),
         (array_agg(unit_cost order by order_date desc, created_at desc))[1],
         min(unit_cost), round(avg(unit_cost), 4), count(*)::integer, sum(quantity), max(order_date)
    from lines
   group by item_key, supplier_id
   order by max(item_name), min(unit_cost);
$$","-- ---------------------------------------------------------------------------
-- Point of sale
-- ---------------------------------------------------------------------------

create sequence public.pos_session_seq","create table public.pos_sessions (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default (''CS-'' || lpad(nextval(''public.pos_session_seq'')::text, 5, ''0'')),
  location_id uuid not null references public.locations (id),
  status text not null default ''open'' check (status in (''open'', ''closed'')),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  opened_by_email text,
  opening_float numeric(12, 3) not null default 0 check (opening_float >= 0),
  closed_at timestamptz,
  closed_by uuid,
  closed_by_email text,
  expected_cash numeric(12, 3),
  counted_cash numeric(12, 3),
  difference numeric(12, 3),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index pos_sessions_one_open_idx on public.pos_sessions (location_id) where status = ''open'' and deleted_at is null","alter table public.orders add constraint orders_pos_session_fk foreign key (pos_session_id) references public.pos_sessions (id) on delete set null","alter table public.order_payments add constraint order_payments_pos_session_fk foreign key (pos_session_id) references public.pos_sessions (id) on delete set null","alter table public.treasury_movements add constraint treasury_movements_pos_session_fk foreign key (pos_session_id) references public.pos_sessions (id) on delete set null","create index orders_pos_session_idx on public.orders (pos_session_id) where pos_session_id is not null","create or replace function public.open_pos_session(p_location_id uuid, p_opening_float numeric,
                                                   p_actor uuid default null, p_actor_email text default null)
returns public.pos_sessions
language plpgsql
set search_path = ''''
as $$
declare
  s public.pos_sessions;
begin
  if exists (select 1 from public.pos_sessions where location_id = p_location_id and status = ''open'' and deleted_at is null) then
    raise exception ''session_already_open'';
  end if;
  insert into public.pos_sessions (location_id, opening_float, opened_by, opened_by_email)
  values (p_location_id, coalesce(p_opening_float, 0), p_actor, p_actor_email)
  returning * into s;
  return s;
end;
$$","-- Cash that should be in the drawer: float + cash takings + cash in − cash out.
create or replace function public.pos_expected_cash(p_session_id uuid)
returns numeric
language sql
stable
set search_path = ''''
as $$
  select s.opening_float
         + coalesce((select sum(p.amount) from public.order_payments p
                      where p.pos_session_id = s.id and p.account = ''cash'' and p.deleted_at is null), 0)
         + coalesce((select sum(case when m.direction = ''in'' then m.amount else -m.amount end) from public.treasury_movements m
                      where m.pos_session_id = s.id and m.account = ''cash'' and m.deleted_at is null and m.category <> ''pos_difference''), 0)
    from public.pos_sessions s
   where s.id = p_session_id;
$$","-- A till sale: the order (channel store, stock from the session''s shop, delivered on the spot)
-- and its payments, all together. The API prices the lines; payments must cover the total.
create or replace function public.create_pos_sale(p_session_id uuid, p_order jsonb, p_items jsonb, p_payments jsonb,
                                                  p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
set search_path = ''''
as $$
declare
  s public.pos_sessions;
  created jsonb;
  v_order_id uuid;
  ord public.orders;
  pay jsonb;
  paid numeric := 0;
begin
  select * into s from public.pos_sessions where id = p_session_id and deleted_at is null for update;
  if not found or s.status <> ''open'' then
    raise exception ''session_not_open'';
  end if;
  if jsonb_typeof(p_items) is distinct from ''array'' or jsonb_array_length(p_items) = 0 then
    raise exception ''order_items_required'';
  end if;
  select coalesce(sum((x->>''amount'')::numeric), 0) into paid from jsonb_array_elements(p_payments) x;
  if paid < (p_order->>''total'')::numeric - 0.0005 then
    raise exception ''payment_short'';
  end if;

  created := public.create_order(
    p_order || jsonb_build_object(''channel'', ''store'', ''location_id'', s.location_id, ''pos_session_id'', s.id,
                                  ''created_by'', p_actor, ''created_by_email'', p_actor_email,
                                  ''assigned_to'', p_actor, ''assigned_to_email'', p_actor_email),
    p_items);
  v_order_id := (created->''order''->>''id'')::uuid;
  perform public.set_order_status(v_order_id, ''{\"status\": \"delivered\"}''::jsonb, p_actor, p_actor_email);

  for pay in select * from jsonb_array_elements(p_payments) loop
    if (pay->>''amount'')::numeric <> 0 then
      insert into public.order_payments (order_id, amount, method, account, reference, pos_session_id, created_by, created_by_email)
      values (v_order_id, (pay->>''amount'')::numeric, coalesce(nullif(pay->>''method'', ''''), ''cash''),
              case when coalesce(nullif(pay->>''method'', ''''), ''cash'') = ''cash'' then ''cash'' else ''bank'' end,
              nullif(pay->>''reference'', ''''), s.id, p_actor, p_actor_email);
    end if;
  end loop;

  select * into ord from public.orders where id = v_order_id;
  return jsonb_build_object(''order'', to_jsonb(ord),
    ''items'', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = v_order_id), ''[]''::jsonb));
end;
$$","-- Closing: the counted cash is compared with what''s expected; a difference is booked as a
-- cash movement so the till balance matches what''s really there.
create or replace function public.close_pos_session(p_session_id uuid, p_counted numeric, p_notes text default null,
                                                    p_actor uuid default null, p_actor_email text default null)
returns public.pos_sessions
language plpgsql
set search_path = ''''
as $$
declare
  s public.pos_sessions;
  expected numeric;
  diff numeric;
begin
  select * into s from public.pos_sessions where id = p_session_id and deleted_at is null for update;
  if not found or s.status <> ''open'' then
    raise exception ''session_not_open'';
  end if;
  expected := public.pos_expected_cash(s.id);
  diff := round(coalesce(p_counted, 0) - expected, 3);
  if diff <> 0 then
    insert into public.treasury_movements (account, direction, amount, category, label, pos_session_id, created_by, created_by_email)
    values (''cash'', case when diff > 0 then ''in'' else ''out'' end, abs(diff), ''pos_difference'',
            ''Till difference '' || s.number, s.id, p_actor, p_actor_email);
  end if;
  update public.pos_sessions
     set status = ''closed'', closed_at = now(), closed_by = p_actor, closed_by_email = p_actor_email,
         expected_cash = expected, counted_cash = coalesce(p_counted, 0), difference = diff, notes = nullif(p_notes, '''')
   where id = s.id
  returning * into s;
  return s;
end;
$$","-- ---------------------------------------------------------------------------
-- RLS, audit, grants
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[''raw_materials'', ''product_bom'', ''product_costing'', ''purchase_orders'', ''purchase_order_lines'',
                           ''purchase_receipts'', ''pos_sessions''] loop
    execute format(''alter table public.%I enable row level security'', t);
    execute format(''revoke all on public.%I from anon, authenticated'', t);
    execute format(''grant all on public.%I to service_role'', t);
    execute format(''create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()'', t);
    execute format(''create trigger prevent_hard_delete before delete on public.%I for each row execute function private.prevent_hard_delete()'', t);
    execute format(''create trigger log_activity after insert or update on public.%I for each row execute function private.log_activity()'', t);
  end loop;
  foreach t in array array[''material_movements'', ''purchase_receipt_lines''] loop
    execute format(''alter table public.%I enable row level security'', t);
    execute format(''revoke all on public.%I from anon, authenticated'', t);
    execute format(''grant all on public.%I to service_role'', t);
  end loop;
end;
$$","grant usage on sequence public.purchase_order_seq, public.purchase_receipt_seq, public.pos_session_seq to service_role","revoke all on function
  public.product_cost_prices(),
  public.record_production(uuid, integer, uuid, text, uuid, text),
  public.save_purchase_order(uuid, jsonb, jsonb, uuid, text),
  public.create_purchase_receipt(uuid, jsonb, jsonb, boolean, uuid, text),
  public.validate_purchase_receipt(uuid, uuid, text),
  public.purchase_price_comparison(uuid, uuid),
  public.open_pos_session(uuid, numeric, uuid, text),
  public.pos_expected_cash(uuid),
  public.create_pos_sale(uuid, jsonb, jsonb, jsonb, uuid, text),
  public.close_pos_session(uuid, numeric, text, uuid, text),
  public.record_stock_movements(text, uuid, jsonb, uuid, text, text, boolean, uuid, text)
  from public, anon, authenticated","grant execute on function
  public.product_cost_prices(),
  public.record_production(uuid, integer, uuid, text, uuid, text),
  public.save_purchase_order(uuid, jsonb, jsonb, uuid, text),
  public.create_purchase_receipt(uuid, jsonb, jsonb, boolean, uuid, text),
  public.validate_purchase_receipt(uuid, uuid, text),
  public.purchase_price_comparison(uuid, uuid),
  public.open_pos_session(uuid, numeric, uuid, text),
  public.pos_expected_cash(uuid),
  public.create_pos_sale(uuid, jsonb, jsonb, jsonb, uuid, text),
  public.close_pos_session(uuid, numeric, text, uuid, text),
  public.record_stock_movements(text, uuid, jsonb, uuid, text, text, boolean, uuid, text)
  to service_role","revoke all on function private.apply_material_movement(), private.prevent_movement_change() from public, anon, authenticated","-- ---------------------------------------------------------------------------
-- Saving a product''s costing (bill of materials, labor, overhead) in one go
-- ---------------------------------------------------------------------------

-- p_bom: the full list [{material_id, quantity}]; materials no longer listed are removed.
create or replace function public.save_product_costing(p_product_id uuid, p_labor numeric, p_overhead numeric,
                                                       p_notes text, p_bom jsonb)
returns void
language plpgsql
set search_path = ''''
as $$
declare
  line jsonb;
  keep uuid[] := ''{}'';
begin
  if not exists (select 1 from public.products where id = p_product_id and deleted_at is null) then
    raise exception ''product_not_found'';
  end if;
  insert into public.product_costing (product_id, labor_cost, overhead_cost, notes)
  values (p_product_id, coalesce(p_labor, 0), coalesce(p_overhead, 0), nullif(p_notes, ''''))
  on conflict (product_id) do update
    set labor_cost = excluded.labor_cost, overhead_cost = excluded.overhead_cost, notes = excluded.notes, deleted_at = null;

  for line in select * from jsonb_array_elements(coalesce(p_bom, ''[]''::jsonb)) loop
    keep := keep || (line->>''material_id'')::uuid;
    update public.product_bom set quantity = (line->>''quantity'')::numeric
     where product_id = p_product_id and material_id = (line->>''material_id'')::uuid and deleted_at is null;
    if not found then
      insert into public.product_bom (product_id, material_id, quantity)
      values (p_product_id, (line->>''material_id'')::uuid, (line->>''quantity'')::numeric);
    end if;
  end loop;
  update public.product_bom set deleted_at = now()
   where product_id = p_product_id and deleted_at is null and not (material_id = any (keep));

  -- A product made in the workshop costs its materials + labor + overhead: that becomes its
  -- purchase cost, the one cost margins and statistics use.
  if exists (select 1 from public.product_bom where product_id = p_product_id and deleted_at is null) then
    insert into public.product_costs (product_id, cost)
    select p_product_id, round(coalesce(sum(b.quantity * coalesce(m.avg_cost, 0)), 0) + coalesce(p_labor, 0) + coalesce(p_overhead, 0), 3)
      from public.product_bom b join public.raw_materials m on m.id = b.material_id
     where b.product_id = p_product_id and b.deleted_at is null
    on conflict (product_id) do update set cost = excluded.cost, deleted_at = null, updated_at = now();
  end if;
end;
$$","revoke all on function public.save_product_costing(uuid, numeric, numeric, text, jsonb) from public, anon, authenticated","grant execute on function public.save_product_costing(uuid, numeric, numeric, text, jsonb) to service_role"}', 'erp_purchasing_pos');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261016122000', '{"-- ERP, part 3: accounting (Tunisian SCE structure), bills and expenses, sales invoices, bank
-- reconciliation, documents, and the owner''s overview.
--
-- Bookkeeping without double entry: deliveries, payments, carrier payouts, bills and their
-- payments, ad spend and cash/bank movements each create their journal entry through triggers.
-- Entries start as drafts; posting (validation) numbers them per journal and year and makes
-- them unchangeable. A correction is a reversing entry, never an edit. Stock uses intermittent
-- inventory: purchases are expensed on their bill, and the stock variation (valued at weighted
-- average cost) is booked when the accountant asks for it (period end).

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

insert into public.erp_settings (key, value) values (''accounting'', jsonb_build_object(
  ''enabled'', true,
  -- Events before this date create no entries (history stays out of the books).
  ''start_date'', to_char(current_date, ''YYYY-MM-DD''),
  ''auto_post'', false,
  ''vat_registered'', true,
  ''sales_vat_rate'', 19,            -- shop prices include VAT at this rate
  ''invoice_stamp'', 0,              -- timbre fiscal added to sales invoices (e.g. 1.000)
  ''valuation_method'', ''cmup'',      -- weighted average cost
  ''company'', jsonb_build_object(''name'', ''Kachabity'', ''tax_id'', '''', ''address'', '''', ''phone'', '''', ''email'', '''', ''rc'', ''''),
  ''accounts'', jsonb_build_object(
    ''customers'', ''411'', ''carrier'', ''4118'', ''suppliers'', ''401'',
    ''cash'', ''541'', ''bank'', ''532'', ''transfer'', ''581'',
    ''sales'', ''707'', ''shipping_income'', ''708'', ''vat_collected'', ''4366'', ''vat_deductible'', ''4367'', ''stamp'', ''4368'',
    ''delivery_fees'', ''6241'', ''advertising'', ''623'',
    ''stock'', ''37'', ''stock_variation'', ''6037'', ''materials'', ''31'', ''materials_variation'', ''6031'',
    ''owner'', ''108'', ''loan'', ''164'', ''other_income'', ''758'', ''other_expense'', ''658''
  )
))
on conflict (key) do nothing","create or replace function private.accounting_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''''
as $$
  select coalesce((select value from public.erp_settings where key = ''accounting''), ''{}''::jsonb);
$$","-- Account code for a role (''cash'', ''sales''...), from the settings.
create or replace function private.acct(p_key text)
returns text
language sql
stable
security definer
set search_path = ''''
as $$
  select coalesce(private.accounting_settings()->''accounts''->>p_key,
    case p_key
      when ''customers'' then ''411'' when ''carrier'' then ''4118'' when ''suppliers'' then ''401''
      when ''cash'' then ''541'' when ''bank'' then ''532'' when ''transfer'' then ''581''
      when ''sales'' then ''707'' when ''shipping_income'' then ''708'' when ''vat_collected'' then ''4366''
      when ''vat_deductible'' then ''4367'' when ''stamp'' then ''4368'' when ''delivery_fees'' then ''6241''
      when ''advertising'' then ''623'' when ''stock'' then ''37'' when ''stock_variation'' then ''6037''
      when ''materials'' then ''31'' when ''materials_variation'' then ''6031'' when ''owner'' then ''108''
      when ''loan'' then ''164'' when ''other_income'' then ''758'' when ''other_expense'' then ''658''
    end);
$$","-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------

create table public.accounts (
  code text primary key check (code ~ ''^[1-7][0-9A-Za-z]*$''),
  name text not null,            -- French (the accounts'' language)
  name_en text,
  name_ar text,
  class smallint generated always as (substr(code, 1, 1)::smallint) stored,
  type text not null check (type in (''asset'', ''liability'', ''equity'', ''income'', ''expense'')),
  is_active boolean not null default true,
  is_system boolean not null default false,   -- used by automatic entries: can''t be removed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","-- Structure of the Système Comptable des Entreprises; the accountant can add or rename accounts.
insert into public.accounts (code, name, name_en, name_ar, type, is_system) values
  (''101'', ''Capital social'', ''Share capital'', ''رأس المال'', ''equity'', false),
  (''108'', ''Compte de l''''exploitant'', ''Owner''''s account'', ''حساب المستغل'', ''equity'', true),
  (''110'', ''Résultats reportés'', ''Retained earnings'', ''نتائج مؤجلة'', ''equity'', false),
  (''120'', ''Résultat de l''''exercice'', ''Profit or loss for the year'', ''نتيجة السنة'', ''equity'', false),
  (''164'', ''Emprunts'', ''Loans'', ''قروض'', ''liability'', true),
  (''22'', ''Immobilisations corporelles'', ''Fixed assets'', ''أصول ثابتة'', ''asset'', false),
  (''31'', ''Matières premières'', ''Raw materials'', ''مواد أولية'', ''asset'', true),
  (''35'', ''Stocks de produits finis'', ''Finished goods'', ''منتجات تامة'', ''asset'', false),
  (''37'', ''Stocks de marchandises'', ''Goods for resale'', ''بضائع'', ''asset'', true),
  (''401'', ''Fournisseurs d''''exploitation'', ''Suppliers'', ''المزودون'', ''liability'', true),
  (''411'', ''Clients'', ''Customers'', ''الحرفاء'', ''asset'', true),
  (''4118'', ''Transporteur – encaissements à reverser'', ''Delivery company – cash to pay out'', ''شركة التوصيل – مبالغ للتحويل'', ''asset'', true),
  (''421'', ''Personnel – rémunérations dues'', ''Wages payable'', ''أجور مستحقة'', ''liability'', false),
  (''431'', ''CNSS'', ''Social security (CNSS)'', ''الضمان الاجتماعي'', ''liability'', false),
  (''4366'', ''TVA collectée'', ''VAT collected'', ''أداء على القيمة المضافة المحصل'', ''liability'', true),
  (''4367'', ''TVA déductible'', ''VAT deductible'', ''أداء على القيمة المضافة القابل للطرح'', ''asset'', true),
  (''4368'', ''Droit de timbre à payer'', ''Stamp duty payable'', ''معلوم الطابع'', ''liability'', true),
  (''4371'', ''Retenues à la source'', ''Withholding tax'', ''الخصم من المورد'', ''liability'', false),
  (''467'', ''Autres débiteurs et créditeurs'', ''Other receivables and payables'', ''مدينون ودائنون آخرون'', ''liability'', false),
  (''532'', ''Banques'', ''Bank'', ''البنك'', ''asset'', true),
  (''541'', ''Caisse'', ''Cash'', ''الصندوق'', ''asset'', true),
  (''581'', ''Virements internes'', ''Internal transfers'', ''تحويلات داخلية'', ''asset'', true),
  (''601'', ''Achats de matières premières'', ''Raw material purchases'', ''شراءات مواد أولية'', ''expense'', true),
  (''6031'', ''Variation des stocks de matières premières'', ''Change in raw material stock'', ''تغير مخزون المواد الأولية'', ''expense'', true),
  (''6037'', ''Variation des stocks de marchandises'', ''Change in stock of goods'', ''تغير مخزون البضائع'', ''expense'', true),
  (''6061'', ''Eau, électricité, carburant'', ''Utilities and fuel'', ''ماء وكهرباء ومحروقات'', ''expense'', true),
  (''6068'', ''Emballages et petites fournitures'', ''Packaging and supplies'', ''تغليف ولوازم'', ''expense'', true),
  (''607'', ''Achats de marchandises'', ''Purchases of goods'', ''شراءات بضائع'', ''expense'', true),
  (''613'', ''Locations'', ''Rent'', ''كراء'', ''expense'', true),
  (''615'', ''Entretien et réparations'', ''Maintenance and repairs'', ''صيانة وإصلاح'', ''expense'', true),
  (''616'', ''Assurances'', ''Insurance'', ''تأمين'', ''expense'', true),
  (''622'', ''Honoraires'', ''Professional fees'', ''أتعاب'', ''expense'', true),
  (''623'', ''Publicité'', ''Advertising'', ''إشهار'', ''expense'', true),
  (''624'', ''Transports'', ''Transport'', ''نقل'', ''expense'', true),
  (''6241'', ''Frais de livraison'', ''Delivery fees'', ''مصاريف التوصيل'', ''expense'', true),
  (''626'', ''Frais postaux et télécommunications'', ''Phone and internet'', ''هاتف وإنترنت'', ''expense'', true),
  (''627'', ''Services bancaires'', ''Bank charges'', ''خدمات بنكية'', ''expense'', true),
  (''628'', ''Autres services extérieurs'', ''Other external services'', ''خدمات خارجية أخرى'', ''expense'', true),
  (''640'', ''Salaires'', ''Salaries'', ''أجور'', ''expense'', true),
  (''647'', ''Charges sociales'', ''Social charges'', ''أعباء اجتماعية'', ''expense'', true),
  (''66'', ''Impôts et taxes'', ''Taxes and duties'', ''ضرائب ورسوم'', ''expense'', true),
  (''651'', ''Charges d''''intérêts'', ''Interest'', ''فوائد'', ''expense'', false),
  (''658'', ''Autres charges'', ''Other expenses'', ''أعباء أخرى'', ''expense'', true),
  (''701'', ''Ventes de produits finis'', ''Sales of finished goods'', ''مبيعات منتجات تامة'', ''income'', false),
  (''707'', ''Ventes de marchandises'', ''Sales of goods'', ''مبيعات بضائع'', ''income'', true),
  (''708'', ''Produits des activités annexes (port facturé)'', ''Shipping charged'', ''معاليم شحن مفوترة'', ''income'', true),
  (''758'', ''Autres produits'', ''Other income'', ''إيرادات أخرى'', ''income'', true)","-- ---------------------------------------------------------------------------
-- Gap-free numbering (invoices, posted entries)
-- ---------------------------------------------------------------------------

create table public.document_counters (
  key text primary key,
  value integer not null default 0
)","create or replace function private.next_number(p_key text)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  n integer;
begin
  insert into public.document_counters (key, value) values (p_key, 1)
  on conflict (key) do update set value = public.document_counters.value + 1
  returning value into n;
  return n;
end;
$$","-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  -- VT sales, AC purchases, CA cash, BQ bank, OD miscellaneous
  journal text not null check (journal in (''VT'', ''AC'', ''CA'', ''BQ'', ''OD'')),
  number text unique,               -- given when posted: VT-2026-00001
  entry_date date not null,
  label text not null default '''',
  source_type text not null default ''manual'',
  source_id uuid,
  source_event text not null default ''booked'',
  status text not null default ''draft'' check (status in (''draft'', ''posted'')),
  posted_at timestamptz,
  posted_by uuid,
  posted_by_email text,
  reversal_of uuid references public.journal_entries (id),
  reversed_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","-- One live automatic entry per event of a source document.
create unique index journal_entries_source_live_idx on public.journal_entries (source_type, source_id, source_event)
  where deleted_at is null and reversed_at is null and reversal_of is null and source_type <> ''manual''","create index journal_entries_date_idx on public.journal_entries (entry_date) where deleted_at is null","create index journal_entries_status_idx on public.journal_entries (status, entry_date) where deleted_at is null","create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  account_code text not null references public.accounts (code),
  label text not null default '''',
  debit numeric(14, 3) not null default 0 check (debit >= 0),
  credit numeric(14, 3) not null default 0 check (credit >= 0),
  partner_type text check (partner_type in (''customer'', ''supplier'', ''carrier'')),
  partner_id uuid,
  partner_name text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check ((debit = 0) <> (credit = 0))
)","create index journal_lines_entry_idx on public.journal_lines (entry_id)","create index journal_lines_account_idx on public.journal_lines (account_code)","create index journal_lines_partner_idx on public.journal_lines (partner_type, partner_id) where partner_id is not null","-- Posted entries can''t change, except being marked reversed; lines of posted entries are frozen.
create or replace function private.protect_posted_entry()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if old.status = ''posted'' then
    if (to_jsonb(new) - ''reversed_at'' - ''updated_at'') is distinct from (to_jsonb(old) - ''reversed_at'' - ''updated_at'') then
      raise exception ''entry_posted: posted entries can''''t be changed; reverse them instead'' using errcode = ''P0001'';
    end if;
  end if;
  return new;
end;
$$","create trigger journal_entries_protect before update on public.journal_entries
  for each row execute function private.protect_posted_entry()","create or replace function private.protect_posted_lines()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  if current_setting(''app.purge'', true) = ''on'' then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.journal_entries where id = v_entry and status = ''posted'') then
    raise exception ''entry_posted: posted entries can''''t be changed; reverse them instead'' using errcode = ''P0001'';
  end if;
  return coalesce(new, old);
end;
$$","create trigger journal_lines_protect before insert or update or delete on public.journal_lines
  for each row execute function private.protect_posted_lines()","-- Identity of the staff member behind the current request (see lib/supabase-admin.ts).
create or replace function private.request_actor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''''
as $$
declare
  h jsonb := private.trusted_request_headers();
begin
  if h is null then
    return ''{}''::jsonb;
  end if;
  return jsonb_build_object(''id'', nullif(h->>''x-actor-id'', ''''), ''email'', nullif(h->>''x-actor-email'', ''''));
end;
$$","-- Posts draft entries: each must balance and have lines; it gets its number and is frozen.
create or replace function public.post_journal_entries(p_ids uuid[], p_actor uuid default null, p_actor_email text default null)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  e public.journal_entries;
  d numeric;
  c numeric;
  posted integer := 0;
begin
  for e in select * from public.journal_entries where id = any (p_ids) and status = ''draft'' and deleted_at is null
            order by entry_date, created_at for update loop
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from public.journal_lines where entry_id = e.id;
    if d = 0 or d <> c then
      raise exception ''unbalanced_entry:%'', coalesce(e.label, e.id::text) using errcode = ''P0001'';
    end if;
    update public.journal_entries
       set status = ''posted'', posted_at = now(), posted_by = p_actor, posted_by_email = p_actor_email,
           number = e.journal || ''-'' || to_char(e.entry_date, ''YYYY'') || ''-''
                    || lpad(private.next_number(''journal:'' || e.journal || '':'' || to_char(e.entry_date, ''YYYY''))::text, 5, ''0'')
     where id = e.id;
    posted := posted + 1;
  end loop;
  return posted;
end;
$$","-- Writes an entry from lines [{account, debit, credit, label, partner_type, partner_id, partner_name}].
-- Amounts are rounded to the millime; a negative debit becomes a credit and the reverse.
-- Returns null (writes nothing) when accounting is off, the date is before the start date, the
-- lines are all zero, or the event already has its live entry.
create or replace function private.book(p_journal text, p_date date, p_label text, p_source_type text, p_source_id uuid,
                                        p_event text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  cfg jsonb := private.accounting_settings();
  actor jsonb := private.request_actor();
  e uuid;
  d numeric;
  c numeric;
  lines jsonb;
begin
  if not coalesce((cfg->>''enabled'')::boolean, true) then
    return null;
  end if;
  if p_date < coalesce(nullif(cfg->>''start_date'', '''')::date, ''1900-01-01''::date) then
    return null;
  end if;
  if exists (select 1 from public.journal_entries
              where source_type = p_source_type and source_id = p_source_id and source_event = p_event
                and deleted_at is null and reversed_at is null and reversal_of is null) then
    return null;
  end if;

  -- Normalized lines: one side each, rounded, zero lines dropped.
  select coalesce(jsonb_agg(n order by (n->>''pos'')::integer), ''[]''::jsonb) into lines
    from (
      select jsonb_build_object(
               ''account'', l->>''account'', ''label'', coalesce(nullif(l->>''label'', ''''), p_label),
               ''debit'', greatest(round(coalesce((l->>''debit'')::numeric, 0) - coalesce((l->>''credit'')::numeric, 0), 3), 0),
               ''credit'', greatest(round(coalesce((l->>''credit'')::numeric, 0) - coalesce((l->>''debit'')::numeric, 0), 3), 0),
               ''partner_type'', nullif(l->>''partner_type'', ''''), ''partner_id'', nullif(l->>''partner_id'', ''''),
               ''partner_name'', nullif(l->>''partner_name'', ''''), ''pos'', ord) as n
        from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
    ) s
   where (n->>''debit'')::numeric <> 0 or (n->>''credit'')::numeric <> 0;
  select coalesce(sum((l->>''debit'')::numeric), 0), coalesce(sum((l->>''credit'')::numeric), 0) into d, c
    from jsonb_array_elements(lines) l;
  if d = 0 then
    return null;
  end if;
  if d <> c then
    raise exception ''unbalanced_entry:% (% / %)'', p_label, d, c using errcode = ''P0001'';
  end if;

  insert into public.journal_entries (journal, entry_date, label, source_type, source_id, source_event, created_by, created_by_email)
  values (p_journal, p_date, left(p_label, 300), p_source_type, p_source_id, p_event,
          nullif(actor->>''id'', '''')::uuid, actor->>''email'')
  returning id into e;
  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select e, l.account, left(l.label, 300), l.debit, l.credit, l.partner_type, l.partner_id, l.partner_name, l.pos
    from jsonb_to_recordset(lines) as l (account text, label text, debit numeric, credit numeric, partner_type text,
                                         partner_id uuid, partner_name text, pos integer);

  if coalesce((cfg->>''auto_post'')::boolean, false) then
    perform public.post_journal_entries(array[e], nullif(actor->>''id'', '''')::uuid, actor->>''email'');
  end if;
  return e;
end;
$$","-- Undoes the live entry of an event: a draft simply goes; a posted one gets a reversing entry.
create or replace function private.unbook(p_source_type text, p_source_id uuid, p_event text, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  e public.journal_entries;
  actor jsonb := private.request_actor();
  r uuid;
begin
  select * into e from public.journal_entries
   where source_type = p_source_type and source_id = p_source_id and source_event = p_event
     and deleted_at is null and reversed_at is null and reversal_of is null;
  if not found then
    return null;
  end if;
  if e.status = ''draft'' then
    update public.journal_entries set deleted_at = now() where id = e.id;
    return null;
  end if;
  insert into public.journal_entries (journal, entry_date, label, source_type, source_id, source_event, reversal_of, created_by, created_by_email)
  values (e.journal, greatest(p_date, e.entry_date), left(''Reversal: '' || e.label, 300), e.source_type, e.source_id, e.source_event, e.id,
          nullif(actor->>''id'', '''')::uuid, actor->>''email'')
  returning id into r;
  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select r, account_code, label, credit, debit, partner_type, partner_id, partner_name, position
    from public.journal_lines where entry_id = e.id;
  update public.journal_entries set reversed_at = now() where id = e.id;
  if coalesce((private.accounting_settings()->>''auto_post'')::boolean, false) then
    perform public.post_journal_entries(array[r], nullif(actor->>''id'', '''')::uuid, actor->>''email'');
  end if;
  return r;
end;
$$","-- Saves a hand-written entry (draft): creates it (p_id null) or replaces a draft''s lines.
create or replace function public.save_manual_entry(p_id uuid, p_entry jsonb, p_lines jsonb,
                                                    p_actor uuid default null, p_actor_email text default null)
returns public.journal_entries
language plpgsql
set search_path = ''''
as $$
declare
  e public.journal_entries;
  d numeric;
  c numeric;
begin
  if p_id is null then
    insert into public.journal_entries (journal, entry_date, label, source_type, created_by, created_by_email)
    values (coalesce(nullif(p_entry->>''journal'', ''''), ''OD''), coalesce(nullif(p_entry->>''entry_date'', '''')::date, current_date),
            coalesce(p_entry->>''label'', ''''), ''manual'', p_actor, p_actor_email)
    returning * into e;
  else
    select * into e from public.journal_entries where id = p_id and deleted_at is null for update;
    if not found then
      raise exception ''entry_not_found'';
    end if;
    if e.status = ''posted'' then
      raise exception ''entry_posted: posted entries can''''t be changed; reverse them instead'' using errcode = ''P0001'';
    end if;
    update public.journal_entries
       set journal = coalesce(nullif(p_entry->>''journal'', ''''), journal),
           entry_date = coalesce(nullif(p_entry->>''entry_date'', '''')::date, entry_date),
           label = coalesce(p_entry->>''label'', label)
     where id = e.id
    returning * into e;
    delete from public.journal_lines where entry_id = e.id;
  end if;

  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select e.id, l->>''account'', coalesce(l->>''label'', ''''),
         round(coalesce((l->>''debit'')::numeric, 0), 3), round(coalesce((l->>''credit'')::numeric, 0), 3),
         nullif(l->>''partner_type'', ''''), nullif(l->>''partner_id'', '''')::uuid, nullif(l->>''partner_name'', ''''), ord::integer
    from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
   where round(coalesce((l->>''debit'')::numeric, 0), 3) <> 0 or round(coalesce((l->>''credit'')::numeric, 0), 3) <> 0;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from public.journal_lines where entry_id = e.id;
  if d = 0 or d <> c then
    raise exception ''unbalanced_entry:% (% / %)'', e.label, d, c using errcode = ''P0001'';
  end if;
  return e;
end;
$$","-- Reverses posted entries by hand (manual corrections).
create or replace function public.reverse_journal_entry(p_id uuid, p_date date default current_date,
                                                        p_actor uuid default null, p_actor_email text default null)
returns uuid
language plpgsql
set search_path = ''''
as $$
declare
  e public.journal_entries;
  r uuid;
begin
  select * into e from public.journal_entries where id = p_id and deleted_at is null for update;
  if not found then
    raise exception ''entry_not_found'';
  end if;
  if e.status <> ''posted'' or e.reversed_at is not null or e.reversal_of is not null then
    raise exception ''entry_not_reversible'';
  end if;
  insert into public.journal_entries (journal, entry_date, label, source_type, source_id, source_event, reversal_of, created_by, created_by_email)
  values (e.journal, greatest(coalesce(p_date, current_date), e.entry_date), left(''Reversal: '' || e.label, 300),
          e.source_type, e.source_id, e.source_event, e.id, p_actor, p_actor_email)
  returning id into r;
  insert into public.journal_lines (entry_id, account_code, label, debit, credit, partner_type, partner_id, partner_name, position)
  select r, account_code, label, credit, debit, partner_type, partner_id, partner_name, position
    from public.journal_lines where entry_id = e.id;
  update public.journal_entries set reversed_at = now() where id = e.id;
  return r;
end;
$$","-- ---------------------------------------------------------------------------
-- Bills (supplier invoices and expenses) and their payments
-- ---------------------------------------------------------------------------

create sequence public.bill_seq","create table public.bills (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default (''BILL-'' || lpad(nextval(''public.bill_seq'')::text, 5, ''0'')),
  supplier_id uuid references public.suppliers (id) on delete set null,
  payee text,                         -- who is paid when there''s no supplier record (landlord, staff...)
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  supplier_reference text,            -- the supplier''s invoice number
  category text not null default ''purchase_goods''
    check (category in (''purchase_goods'', ''purchase_materials'', ''rent'', ''salaries'', ''social_charges'', ''utilities'',
                        ''packaging'', ''delivery'', ''transport'', ''telecom'', ''bank_fees'', ''insurance'', ''maintenance'',
                        ''fees'', ''taxes'', ''other'')),
  cost_type text not null default ''variable'' check (cost_type in (''fixed'', ''variable'')),
  account_code text not null references public.accounts (code),
  bill_date date not null default current_date,
  due_date date,
  amount_ht numeric(14, 3) not null check (amount_ht >= 0),
  vat_amount numeric(14, 3) not null default 0 check (vat_amount >= 0),
  stamp numeric(14, 3) not null default 0 check (stamp >= 0),
  total numeric(14, 3) generated always as (amount_ht + vat_amount + stamp) stored,
  paid_amount numeric(14, 3) not null default 0,
  status text not null default ''unpaid'' check (status in (''unpaid'', ''partial'', ''paid'')),
  notes text,
  document_id uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index bills_due_idx on public.bills (due_date) where deleted_at is null and status <> ''paid''","create index bills_date_idx on public.bills (bill_date) where deleted_at is null","create index bills_supplier_idx on public.bills (supplier_id)","create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  amount numeric(14, 3) not null check (amount > 0),
  paid_on date not null default current_date,
  account text not null default ''bank'' check (account in (''cash'', ''bank'')),
  method text not null default ''bank_transfer'' check (method in (''cash'', ''bank_transfer'', ''check'', ''card'', ''other'')),
  reference text,
  note text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index bill_payments_bill_idx on public.bill_payments (bill_id)","-- Expense account for each bill category.
create or replace function private.bill_category_account(p_category text)
returns text
language sql
immutable
set search_path = ''''
as $$
  select case p_category
    when ''purchase_goods'' then ''607'' when ''purchase_materials'' then ''601'' when ''rent'' then ''613''
    when ''salaries'' then ''640'' when ''social_charges'' then ''647'' when ''utilities'' then ''6061''
    when ''packaging'' then ''6068'' when ''delivery'' then ''6241'' when ''transport'' then ''624''
    when ''telecom'' then ''626'' when ''bank_fees'' then ''627'' when ''insurance'' then ''616''
    when ''maintenance'' then ''615'' when ''fees'' then ''622'' when ''taxes'' then ''66'' else ''628''
  end;
$$","create or replace function private.refresh_bill_paid()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  paid numeric;
begin
  select coalesce(sum(amount), 0) into paid from public.bill_payments where bill_id = new.bill_id and deleted_at is null;
  update public.bills b
     set paid_amount = paid,
         status = case when paid >= b.total - 0.0005 and b.total > 0 then ''paid'' when paid > 0 then ''partial'' else ''unpaid'' end
   where b.id = new.bill_id
     and (b.paid_amount is distinct from paid);
  return null;
end;
$$","create trigger bill_payments_refresh after insert or update on public.bill_payments
  for each row execute function private.refresh_bill_paid()","-- A bill''s total can change after payments: keep its status right.
create or replace function private.bill_status()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  new.status := case when new.paid_amount >= (new.amount_ht + new.vat_amount + new.stamp) - 0.0005 and (new.amount_ht + new.vat_amount + new.stamp) > 0 then ''paid''
                     when new.paid_amount > 0 then ''partial'' else ''unpaid'' end;
  return new;
end;
$$","create trigger bills_status before insert or update on public.bills
  for each row execute function private.bill_status()","-- ---------------------------------------------------------------------------
-- Sales invoices and credit notes
-- ---------------------------------------------------------------------------

create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind text not null default ''invoice'' check (kind in (''invoice'', ''credit_note'')),
  order_id uuid references public.orders (id) on delete set null,
  credit_note_for uuid references public.sales_invoices (id),
  invoice_date date not null default current_date,
  customer_name text not null,
  customer_phone text,
  customer_address text,
  customer_tax_id text,
  lines jsonb not null default ''[]''::jsonb,
  amount_ht numeric(14, 3) not null,
  vat_rate numeric(5, 2) not null default 0,
  vat_amount numeric(14, 3) not null,
  stamp numeric(14, 3) not null default 0,
  total numeric(14, 3) not null,
  status text not null default ''issued'' check (status in (''issued'', ''cancelled'')),
  notes text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create unique index sales_invoices_order_live_idx on public.sales_invoices (order_id)
  where kind = ''invoice'' and status = ''issued'' and deleted_at is null","-- Issues the invoice of an order (numbered FA-2026-00001, no gaps). Prices include VAT; the
-- invoice shows them before VAT.
create or replace function public.issue_invoice(p_order_id uuid, p_customer_tax_id text default null, p_date date default null,
                                                p_actor uuid default null, p_actor_email text default null)
returns public.sales_invoices
language plpgsql
security definer
set search_path = ''''
as $$
declare
  cfg jsonb := private.accounting_settings();
  rate numeric := case when coalesce((cfg->>''vat_registered'')::boolean, true) then coalesce((cfg->>''sales_vat_rate'')::numeric, 19) else 0 end;
  stamp numeric := coalesce((cfg->>''invoice_stamp'')::numeric, 0);
  ord public.orders;
  inv public.sales_invoices;
  ht numeric;
  v_date date := coalesce(p_date, current_date);
begin
  select * into ord from public.orders where id = p_order_id and deleted_at is null;
  if not found then
    raise exception ''order_not_found'';
  end if;
  if ord.status in (''cancelled'', ''returned'') then
    raise exception ''order_not_invoiceable'';
  end if;
  if exists (select 1 from public.sales_invoices where order_id = ord.id and kind = ''invoice'' and status = ''issued'' and deleted_at is null) then
    raise exception ''invoice_exists'';
  end if;
  ht := round(ord.total / (1 + rate / 100), 3);

  insert into public.sales_invoices (number, kind, order_id, invoice_date, customer_name, customer_phone, customer_address,
                                     customer_tax_id, lines, amount_ht, vat_rate, vat_amount, stamp, total, created_by, created_by_email)
  values (
    ''FA-'' || to_char(v_date, ''YYYY'') || ''-'' || lpad(private.next_number(''invoice:'' || to_char(v_date, ''YYYY''))::text, 5, ''0''),
    ''invoice'', ord.id, v_date, trim(concat_ws('' '', ord.customer_first_name, ord.customer_last_name)), ord.customer_phone,
    concat_ws('', '', ord.shipping_address, ord.shipping_city, ord.shipping_state), nullif(p_customer_tax_id, ''''),
    coalesce((select jsonb_agg(jsonb_build_object(
                ''description'', oi.product_name || coalesce('' ('' || nullif(oi.variant_label, '''') || '')'', ''''),
                ''quantity'', oi.quantity,
                ''unit_price_ht'', round(oi.price / (1 + rate / 100), 3),
                ''total_ht'', round(oi.subtotal / (1 + rate / 100), 3)) order by oi.created_at)
              from public.order_items oi where oi.order_id = ord.id), ''[]''::jsonb)
      || case when ord.discount_amount > 0 then jsonb_build_array(jsonb_build_object(''description'', ''Remise'', ''quantity'', 1,
            ''unit_price_ht'', -round(ord.discount_amount / (1 + rate / 100), 3), ''total_ht'', -round(ord.discount_amount / (1 + rate / 100), 3))) else ''[]''::jsonb end
      || case when ord.shipping_cost > 0 then jsonb_build_array(jsonb_build_object(''description'', ''Livraison'', ''quantity'', 1,
            ''unit_price_ht'', round(ord.shipping_cost / (1 + rate / 100), 3), ''total_ht'', round(ord.shipping_cost / (1 + rate / 100), 3))) else ''[]''::jsonb end,
    ht, rate, ord.total - ht, stamp, ord.total + stamp, p_actor, p_actor_email
  )
  returning * into inv;
  return inv;
end;
$$","-- Cancels an invoice with a credit note for the same amounts.
create or replace function public.cancel_invoice(p_id uuid, p_reason text default null, p_actor uuid default null, p_actor_email text default null)
returns public.sales_invoices
language plpgsql
security definer
set search_path = ''''
as $$
declare
  inv public.sales_invoices;
  credit public.sales_invoices;
begin
  select * into inv from public.sales_invoices where id = p_id and kind = ''invoice'' and deleted_at is null for update;
  if not found then
    raise exception ''invoice_not_found'';
  end if;
  if inv.status = ''cancelled'' then
    raise exception ''invoice_already_cancelled'';
  end if;
  insert into public.sales_invoices (number, kind, order_id, credit_note_for, invoice_date, customer_name, customer_phone,
                                     customer_address, customer_tax_id, lines, amount_ht, vat_rate, vat_amount, stamp, total, notes,
                                     created_by, created_by_email)
  values (''AV-'' || to_char(current_date, ''YYYY'') || ''-'' || lpad(private.next_number(''credit_note:'' || to_char(current_date, ''YYYY''))::text, 5, ''0''),
          ''credit_note'', inv.order_id, inv.id, current_date, inv.customer_name, inv.customer_phone, inv.customer_address,
          inv.customer_tax_id, inv.lines, -inv.amount_ht, inv.vat_rate, -inv.vat_amount, -inv.stamp, -inv.total, nullif(p_reason, ''''),
          p_actor, p_actor_email)
  returning * into credit;
  update public.sales_invoices set status = ''cancelled'' where id = inv.id;
  return credit;
end;
$$","-- ---------------------------------------------------------------------------
-- Bank reconciliation
-- ---------------------------------------------------------------------------

-- Lines of the bank''s statement (imported from CSV or typed), matched one-to-one with bank
-- lines of the journal.
create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_date date not null,
  label text not null default '''',
  amount numeric(14, 3) not null check (amount <> 0),   -- + money in, − money out
  reference text,
  import_batch text,
  matched_line_id uuid unique references public.journal_lines (id) on delete set null,
  matched_at timestamptz,
  matched_by uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index bank_statement_lines_date_idx on public.bank_statement_lines (statement_date) where deleted_at is null","-- Matches unmatched statement lines with unmatched bank journal lines of the same amount
-- within p_days days (closest date first). Returns how many were matched.
create or replace function public.auto_match_bank(p_days integer default 5, p_actor uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  s record;
  l uuid;
  matched integer := 0;
  bank text := private.acct(''bank'');
begin
  for s in select * from public.bank_statement_lines where matched_line_id is null and deleted_at is null order by statement_date loop
    select jl.id into l
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id and je.deleted_at is null
     where jl.account_code = bank
       and (jl.debit - jl.credit) = s.amount
       and abs(je.entry_date - s.statement_date) <= p_days
       and not exists (select 1 from public.bank_statement_lines b where b.matched_line_id = jl.id and b.deleted_at is null)
     order by abs(je.entry_date - s.statement_date), je.entry_date
     limit 1;
    if l is not null then
      update public.bank_statement_lines set matched_line_id = l, matched_at = now(), matched_by = p_actor where id = s.id;
      matched := matched + 1;
    end if;
  end loop;
  return matched;
end;
$$","-- ---------------------------------------------------------------------------
-- Documents (contracts, invoices, delivery notes, certificates...)
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null default ''other''
    check (kind in (''contract'', ''supplier_invoice'', ''sales_invoice'', ''delivery_note'', ''certificate'', ''receipt'', ''tax'', ''payroll'', ''other'')),
  title text not null check (length(trim(title)) > 0),
  storage_path text,                  -- in the private `documents` bucket
  file_name text,
  mime_type text,
  size_bytes bigint,
  related_type text,                  -- ''order'', ''bill'', ''supplier'', ''customer'', ''purchase_order''...
  related_id uuid,
  partner_name text,
  document_date date,
  expires_on date,
  notes text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)","create index documents_related_idx on public.documents (related_type, related_id) where deleted_at is null","create index documents_expiry_idx on public.documents (expires_on) where deleted_at is null and expires_on is not null","alter table public.bills add constraint bills_document_fk foreign key (document_id) references public.documents (id) on delete set null","-- Private: files are only reached through short-lived signed links from the admin API.
insert into storage.buckets (id, name, public, file_size_limit)
values (''documents'', ''documents'', false, 20971520)
on conflict (id) do nothing","-- ---------------------------------------------------------------------------
-- RLS, audit
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[''accounts'', ''journal_entries'', ''bills'', ''bill_payments'', ''sales_invoices'',
                           ''bank_statement_lines'', ''documents''] loop
    execute format(''alter table public.%I enable row level security'', t);
    execute format(''revoke all on public.%I from anon, authenticated'', t);
    execute format(''grant all on public.%I to service_role'', t);
    execute format(''create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()'', t);
    execute format(''create trigger prevent_hard_delete before delete on public.%I for each row execute function private.prevent_hard_delete()'', t);
    execute format(''create trigger log_activity after insert or update on public.%I for each row execute function private.log_activity()'', t);
  end loop;
  foreach t in array array[''journal_lines'', ''document_counters''] loop
    execute format(''alter table public.%I enable row level security'', t);
    execute format(''revoke all on public.%I from anon, authenticated'', t);
    execute format(''grant all on public.%I to service_role'', t);
  end loop;
end;
$$","grant usage on sequence public.bill_seq to service_role","-- ---------------------------------------------------------------------------
-- Automatic entries
-- ---------------------------------------------------------------------------

-- Delivered order → sale (VT): customer debited with the total; sales, shipping charged and VAT
-- credited (shop prices include VAT). Leaving \"delivered\" (return, cancellation) undoes it.
create or replace function private.book_order()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  cfg jsonb := private.accounting_settings();
  rate numeric := case when coalesce((cfg->>''vat_registered'')::boolean, true) then coalesce((cfg->>''sales_vat_rate'')::numeric, 19) else 0 end;
  goods numeric;
  goods_ht numeric;
  ship_ht numeric;
  who text := trim(concat_ws('' '', new.customer_first_name, new.customer_last_name));
begin
  if new.status = ''delivered'' and (tg_op = ''INSERT'' or old.status is distinct from ''delivered'') and new.deleted_at is null then
    goods := new.total - new.shipping_cost;
    goods_ht := round(goods / (1 + rate / 100), 3);
    ship_ht := round(new.shipping_cost / (1 + rate / 100), 3);
    perform private.book(''VT'', coalesce(new.delivered_at, now())::date, ''Sale '' || new.order_number || '' – '' || who,
      ''order'', new.id, ''delivered'', jsonb_build_array(
        jsonb_build_object(''account'', private.acct(''customers''), ''debit'', new.total, ''partner_type'', ''customer'',
                           ''partner_id'', new.customer_id, ''partner_name'', who),
        jsonb_build_object(''account'', private.acct(''sales''), ''credit'', goods_ht),
        jsonb_build_object(''account'', private.acct(''shipping_income''), ''credit'', ship_ht),
        jsonb_build_object(''account'', private.acct(''vat_collected''), ''credit'', new.total - goods_ht - ship_ht)
      ));
  elsif tg_op = ''UPDATE'' and old.status = ''delivered'' and new.status is distinct from ''delivered'' then
    perform private.unbook(''order'', new.id, ''delivered'');
  end if;
  return null;
end;
$$","create trigger orders_book after insert or update of status on public.orders
  for each row execute function private.book_order()","-- Money received for an order: cash (CA), bank (BQ) or held by the carrier (OD) against the customer.
create or replace function private.book_order_payment()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  ord public.orders;
  who text;
  treasury text := private.acct(new.account);
begin
  if tg_op = ''UPDATE'' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook(''order_payment'', new.id, ''received'');
    return null;
  end if;
  if tg_op <> ''INSERT'' or new.deleted_at is not null then
    return null;
  end if;
  select * into ord from public.orders where id = new.order_id;
  who := trim(concat_ws('' '', ord.customer_first_name, ord.customer_last_name));
  perform private.book(case new.account when ''cash'' then ''CA'' when ''bank'' then ''BQ'' else ''OD'' end,
    new.received_at::date,
    case when new.amount < 0 then ''Refund '' else ''Payment '' end || ord.order_number || '' – '' || who,
    ''order_payment'', new.id, ''received'', jsonb_build_array(
      jsonb_build_object(''account'', treasury, ''debit'', new.amount,
                         ''partner_type'', case when new.account = ''carrier'' then ''carrier'' end,
                         ''partner_name'', case when new.account = ''carrier'' then ''Colissimo'' end),
      jsonb_build_object(''account'', private.acct(''customers''), ''credit'', new.amount, ''partner_type'', ''customer'',
                         ''partner_id'', ord.customer_id, ''partner_name'', who)
    ));
  return null;
end;
$$","create trigger order_payments_book after insert or update of deleted_at on public.order_payments
  for each row execute function private.book_order_payment()","-- Carrier payout: the bank (or cash) receives the net, the fees are an expense, the carrier''s
-- balance goes down by the gross.
create or replace function private.book_remittance()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if tg_op = ''UPDATE'' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook(''cod_remittance'', new.id, ''received'');
    return null;
  end if;
  if tg_op <> ''INSERT'' then
    return null;
  end if;
  perform private.book(case new.account when ''cash'' then ''CA'' else ''BQ'' end, new.received_on,
    ''Payout '' || new.provider || coalesce('' '' || new.reference, ''''), ''cod_remittance'', new.id, ''received'', jsonb_build_array(
      jsonb_build_object(''account'', private.acct(new.account), ''debit'', new.net_amount),
      jsonb_build_object(''account'', private.acct(''delivery_fees''), ''debit'', new.fees),
      jsonb_build_object(''account'', private.acct(''carrier''), ''credit'', new.gross_amount, ''partner_type'', ''carrier'', ''partner_name'', new.provider)
    ));
  return null;
end;
$$","create trigger cod_remittances_book after insert or update of deleted_at on public.cod_remittances
  for each row execute function private.book_remittance()","-- Bill → purchases journal (AC): expense (and stamp) + deductible VAT against the supplier.
-- Changing its amounts, account or date rebooks it (reversal + new entry once posted).
create or replace function private.book_bill()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  who text;
begin
  if tg_op = ''UPDATE'' then
    if old.deleted_at is null and new.deleted_at is not null then
      perform private.unbook(''bill'', new.id, ''booked'');
      return null;
    end if;
    if (old.amount_ht, old.vat_amount, old.stamp, old.account_code, old.bill_date, old.supplier_id)
       is not distinct from (new.amount_ht, new.vat_amount, new.stamp, new.account_code, new.bill_date, new.supplier_id) then
      return null;
    end if;
    perform private.unbook(''bill'', new.id, ''booked'', new.bill_date);
  end if;
  if new.deleted_at is not null then
    return null;
  end if;
  select coalesce((select name from public.suppliers where id = new.supplier_id), new.payee, '''') into who;
  perform private.book(''AC'', new.bill_date,
    ''Bill '' || coalesce(new.supplier_reference, new.number) || case when who <> '''' then '' – '' || who else '''' end,
    ''bill'', new.id, ''booked'', jsonb_build_array(
      jsonb_build_object(''account'', new.account_code, ''debit'', new.amount_ht + new.stamp),
      jsonb_build_object(''account'', private.acct(''vat_deductible''), ''debit'', new.vat_amount),
      jsonb_build_object(''account'', private.acct(''suppliers''), ''credit'', new.amount_ht + new.vat_amount + new.stamp,
                         ''partner_type'', ''supplier'', ''partner_id'', new.supplier_id, ''partner_name'', nullif(who, ''''))
    ));
  return null;
end;
$$","create trigger bills_book after insert or update on public.bills
  for each row execute function private.book_bill()","create or replace function private.book_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  b public.bills;
  who text;
begin
  if tg_op = ''UPDATE'' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook(''bill_payment'', new.id, ''paid'');
    return null;
  end if;
  if tg_op <> ''INSERT'' then
    return null;
  end if;
  select * into b from public.bills where id = new.bill_id;
  select coalesce((select name from public.suppliers where id = b.supplier_id), b.payee, '''') into who;
  perform private.book(case new.account when ''cash'' then ''CA'' else ''BQ'' end, new.paid_on,
    ''Paid '' || coalesce(b.supplier_reference, b.number) || case when who <> '''' then '' – '' || who else '''' end,
    ''bill_payment'', new.id, ''paid'', jsonb_build_array(
      jsonb_build_object(''account'', private.acct(''suppliers''), ''debit'', new.amount, ''partner_type'', ''supplier'',
                         ''partner_id'', b.supplier_id, ''partner_name'', nullif(who, '''')),
      jsonb_build_object(''account'', private.acct(new.account), ''credit'', new.amount)
    ));
  return null;
end;
$$","create trigger bill_payments_book after insert or update of deleted_at on public.bill_payments
  for each row execute function private.book_bill_payment()","-- Cash and bank movements against the account their category points to.
create or replace function private.book_treasury_movement()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  other text;
  signed numeric;
begin
  if tg_op = ''UPDATE'' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook(''treasury_movement'', new.id, ''booked'');
    return null;
  end if;
  if tg_op <> ''INSERT'' then
    return null;
  end if;
  other := case new.category
    when ''opening_balance'' then private.acct(''owner'')
    when ''owner_contribution'' then private.acct(''owner'')
    when ''owner_withdrawal'' then private.acct(''owner'')
    when ''transfer'' then private.acct(''transfer'')
    when ''loan'' then private.acct(''loan'')
    when ''loan_repayment'' then private.acct(''loan'')
    when ''other_income'' then private.acct(''other_income'')
    when ''other_expense'' then private.acct(''other_expense'')
    else case when new.direction = ''in'' then private.acct(''other_income'') else private.acct(''other_expense'') end
  end;
  signed := case when new.direction = ''in'' then new.amount else -new.amount end;
  perform private.book(case new.account when ''cash'' then ''CA'' else ''BQ'' end, new.occurred_on,
    coalesce(nullif(new.label, ''''), new.category), ''treasury_movement'', new.id, ''booked'', jsonb_build_array(
      jsonb_build_object(''account'', private.acct(new.account), ''debit'', signed),
      jsonb_build_object(''account'', other, ''credit'', signed)
    ));
  return null;
end;
$$","create trigger treasury_movements_book after insert or update of deleted_at on public.treasury_movements
  for each row execute function private.book_treasury_movement()","-- Ad spend → advertising, paid by bank/cash or owed (supplier).
create or replace function private.book_ad_spend()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  campaign text;
begin
  if tg_op = ''UPDATE'' and old.deleted_at is null and new.deleted_at is not null then
    perform private.unbook(''ad_spend'', new.id, ''booked'');
    return null;
  end if;
  if tg_op <> ''INSERT'' then
    return null;
  end if;
  select name into campaign from public.ad_campaigns where id = new.campaign_id;
  perform private.book(case new.account when ''cash'' then ''CA'' when ''bank'' then ''BQ'' else ''OD'' end, new.spend_date,
    ''Ads'' || coalesce('' – '' || campaign, ''''), ''ad_spend'', new.id, ''booked'', jsonb_build_array(
      jsonb_build_object(''account'', private.acct(''advertising''), ''debit'', new.amount),
      jsonb_build_object(''account'', case new.account when ''payable'' then private.acct(''suppliers'') else private.acct(new.account) end,
                         ''credit'', new.amount)
    ));
  return null;
end;
$$","create trigger ad_spend_book after insert or update of deleted_at on public.ad_spend
  for each row execute function private.book_ad_spend()","-- Invoice stamp duty (timbre fiscal), when the settings add one.
create or replace function private.book_invoice_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if new.stamp = 0 then
    return null;
  end if;
  perform private.book(''OD'', new.invoice_date, ''Stamp duty '' || new.number, ''sales_invoice'', new.id, ''stamp'', jsonb_build_array(
    jsonb_build_object(''account'', private.acct(''customers''), ''debit'', new.stamp, ''partner_type'', ''customer'', ''partner_name'', new.customer_name),
    jsonb_build_object(''account'', private.acct(''stamp''), ''credit'', new.stamp)
  ));
  return null;
end;
$$","create trigger sales_invoices_book after insert on public.sales_invoices
  for each row execute function private.book_invoice_stamp()","-- Period end: brings the stock accounts to the value of the stock (goods at weighted average
-- cost, raw materials at their average cost) through the stock variation accounts.
create or replace function public.book_stock_variation(p_date date default current_date, p_actor uuid default null, p_actor_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''''
as $$
declare
  goods_value numeric;
  materials_value numeric;
  goods_booked numeric;
  materials_booked numeric;
  ref uuid := gen_random_uuid();
  e1 uuid;
  e2 uuid;
begin
  select coalesce(sum(value), 0) into goods_value from public.stock_valuation();
  select coalesce(round(sum(stock * coalesce(avg_cost, 0)), 3), 0) into materials_value from public.raw_materials where deleted_at is null;
  select coalesce(sum(jl.debit - jl.credit), 0) into goods_booked
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id and je.deleted_at is null
   where jl.account_code = private.acct(''stock'') and je.entry_date <= p_date;
  select coalesce(sum(jl.debit - jl.credit), 0) into materials_booked
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id and je.deleted_at is null
   where jl.account_code = private.acct(''materials'') and je.entry_date <= p_date;

  e1 := private.book(''OD'', p_date, ''Stock variation (goods) at '' || to_char(p_date, ''YYYY-MM-DD''), ''stock_variation'', ref, ''goods'',
    jsonb_build_array(
      jsonb_build_object(''account'', private.acct(''stock''), ''debit'', goods_value - goods_booked),
      jsonb_build_object(''account'', private.acct(''stock_variation''), ''credit'', goods_value - goods_booked)));
  e2 := private.book(''OD'', p_date, ''Stock variation (raw materials) at '' || to_char(p_date, ''YYYY-MM-DD''), ''stock_variation'', ref, ''materials'',
    jsonb_build_array(
      jsonb_build_object(''account'', private.acct(''materials''), ''debit'', materials_value - materials_booked),
      jsonb_build_object(''account'', private.acct(''materials_variation''), ''credit'', materials_value - materials_booked)));
  return jsonb_build_object(''goods_value'', goods_value, ''goods_change'', goods_value - goods_booked, ''goods_entry'', e1,
                            ''materials_value'', materials_value, ''materials_change'', materials_value - materials_booked, ''materials_entry'', e2);
end;
$$","-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Per account: balance before the period, movements in it, balance at its end (debit − credit).
create or replace function public.trial_balance(p_from date, p_to date, p_include_drafts boolean default false)
returns table (
  account_code text,
  account_name text,
  account_class smallint,
  account_type text,
  opening numeric,
  debit numeric,
  credit numeric,
  closing numeric
)
language sql
stable
set search_path = ''''
as $$
  with lines as (
    select jl.account_code, je.entry_date, jl.debit, jl.credit
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id
     where je.deleted_at is null and je.entry_date <= p_to
       and (p_include_drafts or je.status = ''posted'')
  ), sums as (
    select account_code,
           coalesce(sum(debit - credit) filter (where entry_date < p_from), 0) as opening,
           coalesce(sum(debit) filter (where entry_date >= p_from), 0) as debit,
           coalesce(sum(credit) filter (where entry_date >= p_from), 0) as credit
      from lines group by account_code
  )
  select a.code, a.name, a.class, a.type, s.opening, s.debit, s.credit, s.opening + s.debit - s.credit
    from sums s join public.accounts a on a.code = s.account_code
   order by a.code;
$$","-- VAT per month: collected, deductible, due.
create or replace function public.vat_summary(p_from date, p_to date, p_include_drafts boolean default false)
returns table (month date, collected numeric, deductible numeric, due numeric)
language sql
security definer
stable
set search_path = ''''
as $$
  select date_trunc(''month'', je.entry_date)::date,
         coalesce(sum(jl.credit - jl.debit) filter (where jl.account_code = private.acct(''vat_collected'')), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code = private.acct(''vat_deductible'')), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where jl.account_code = private.acct(''vat_collected'')), 0)
           - coalesce(sum(jl.debit - jl.credit) filter (where jl.account_code = private.acct(''vat_deductible'')), 0)
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
   where je.deleted_at is null and je.entry_date between p_from and p_to
     and (p_include_drafts or je.status = ''posted'')
     and jl.account_code in (private.acct(''vat_collected''), private.acct(''vat_deductible''))
   group by 1
   order by 1;
$$","-- Money now: till, bank, and cash the delivery company holds for us.
create or replace function public.treasury_balances()
returns jsonb
language sql
stable
set search_path = ''''
as $$
  with flows as (
    select account, amount from public.order_payments where deleted_at is null and account in (''cash'', ''bank'')
    union all
    select account, net_amount from public.cod_remittances where deleted_at is null
    union all
    select account, case when direction = ''in'' then amount else -amount end from public.treasury_movements where deleted_at is null
    union all
    select account, -amount from public.bill_payments where deleted_at is null
    union all
    select account, -amount from public.ad_spend where deleted_at is null and account in (''cash'', ''bank'')
  )
  select jsonb_build_object(
    ''cash'', coalesce((select sum(amount) from flows where account = ''cash''), 0),
    ''bank'', coalesce((select sum(amount) from flows where account = ''bank''), 0),
    ''carrier'', coalesce((select sum(amount) from public.order_payments
                          where deleted_at is null and account = ''carrier'' and remittance_id is null), 0),
    ''open_tills'', coalesce((select sum(opening_float) from public.pos_sessions where status = ''open'' and deleted_at is null), 0)
  );
$$","-- The owner''s overview for a period, optionally narrowed to a channel, an agent, a product or a
-- campaign. Orders count in the period of the step they reached: created, confirmed, delivered,
-- returned. Amounts are in TND; revenue is shown with VAT and before VAT.
create or replace function public.owner_overview(p_from timestamptz, p_to timestamptz, p_channel text default null,
                                                 p_agent uuid default null, p_product uuid default null, p_campaign uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''''
as $$
declare
  cfg jsonb := private.accounting_settings();
  rate numeric := case when coalesce((cfg->>''vat_registered'')::boolean, true) then coalesce((cfg->>''sales_vat_rate'')::numeric, 19) else 0 end;
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
  ), lines as (
    -- Each line''s cost: the product''s cost when it was ordered, else its cost now.
    select oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.subtotal,
           coalesce(oi.unit_cost, pc.cost, public.variant_unit_cost(oi.variant_id)) as unit_cost
      from public.order_items oi join o on o.id = oi.order_id
      left join public.product_costs pc on pc.product_id = oi.product_id and pc.deleted_at is null
     where p_product is null or oi.product_id = p_product
  ), delivered as (
    select o.* from o where o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to
  ), delivered_lines as (
    select l.* from lines l join delivered d on d.id = l.order_id
  ), finished as (
    select o.* from o
     where (o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to)
        or (o.status = ''returned'' and o.returned_at >= p_from and o.returned_at < p_to)
  ), spend as (
    select coalesce(sum(s.amount), 0) as total from public.ad_spend s
     where s.deleted_at is null and s.spend_date >= p_from::date and s.spend_date < p_to::date + 1
       and (p_campaign is null or s.campaign_id = p_campaign)
  ), expenses as (
    select coalesce(sum(b.amount_ht + b.stamp) filter (where b.category not in (''purchase_goods'', ''purchase_materials'')), 0) as operating,
           coalesce(sum(b.amount_ht + b.stamp) filter (where b.category not in (''purchase_goods'', ''purchase_materials'') and b.cost_type = ''fixed''), 0) as fixed,
           coalesce(sum(b.amount_ht + b.stamp) filter (where b.category in (''purchase_goods'', ''purchase_materials'')), 0) as purchases
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
    select generate_series(date_trunc(''day'', p_from), date_trunc(''day'', p_to - interval ''1 second''), interval ''1 day'')::date as day
  )
  select jsonb_build_object(
    ''period'', jsonb_build_object(''from'', p_from, ''to'', p_to),
    ''orders'', jsonb_build_object(
      ''created'', (select count(*) from o where o.created_at >= p_from and o.created_at < p_to),
      ''created_value'', (select coalesce(sum(total), 0) from o where o.created_at >= p_from and o.created_at < p_to),
      ''confirmed'', (select count(*) from o where o.confirmed_at >= p_from and o.confirmed_at < p_to),
      ''delivered'', (select orders from revenue),
      ''returned'', (select count(*) from o where o.status = ''returned'' and o.returned_at >= p_from and o.returned_at < p_to),
      ''cancelled'', (select count(*) from o where o.status = ''cancelled'' and o.cancelled_at >= p_from and o.cancelled_at < p_to),
      ''pending_now'', (select count(*) from o where o.status in (''pending'', ''confirmed'')),
      ''in_delivery_now'', (select count(*) from o where o.status in (''processing'', ''shipped'')),
      ''finished'', (select count(*) from finished)
    ),
    ''money'', jsonb_build_object(
      ''delivered_revenue'', (select ttc from revenue),
      ''delivered_revenue_ht'', round((select goods from revenue) / (1 + rate / 100), 3),
      ''cogs'', (select total from cogs),
      ''missing_cost_lines'', (select missing from cogs),
      ''gross_margin'', round((select goods from revenue) / (1 + rate / 100), 3) - (select total from cogs),
      ''ad_spend'', (select total from spend),
      ''operating_expenses'', (select operating from expenses),
      ''fixed_expenses'', (select fixed from expenses),
      ''purchases'', (select purchases from expenses),
      ''delivery_fees'', (select total from fees),
      ''net_margin'', round((select goods from revenue) / (1 + rate / 100), 3) - (select total from cogs)
                    - (select total from spend) - (select operating from expenses) - (select total from fees),
      ''collected'', (select coalesce(sum(p.amount), 0) from public.order_payments p join o on o.id = p.order_id
                     where p.deleted_at is null and p.received_at >= p_from and p.received_at < p_to),
      ''receivable'', (select coalesce(sum(o.total - o.paid_amount), 0) from o where o.status = ''delivered'' and o.total > o.paid_amount),
      ''cost_per_delivered_sale'', case when (select orders from revenue) > 0 then round((select total from spend) / (select orders from revenue), 3) end,
      ''vat_rate'', rate
    ),
    ''treasury'', public.treasury_balances() || jsonb_build_object(
      ''supplier_debt'', (select coalesce(sum(total - paid_amount), 0) from public.bills where deleted_at is null and status <> ''paid''),
      ''due_7_days'', (select coalesce(sum(total - paid_amount), 0) from public.bills
                      where deleted_at is null and status <> ''paid'' and due_date <= current_date + 7),
      ''overdue'', (select coalesce(sum(total - paid_amount), 0) from public.bills
                   where deleted_at is null and status <> ''paid'' and due_date < current_date)
    ),
    ''stock'', jsonb_build_object(
      ''value'', (select coalesce(sum(value), 0) from public.stock_valuation()),
      ''units'', (select coalesce(sum(units), 0) from public.stock_valuation()),
      ''materials_value'', (select coalesce(round(sum(stock * coalesce(avg_cost, 0)), 3), 0) from public.raw_materials where deleted_at is null),
      ''low'', (select count(*) from public.product_variants v join public.products p on p.id = v.product_id
               where v.deleted_at is null and p.deleted_at is null and p.stock_tracked and v.stock <= v.reorder_point),
      ''out'', (select count(*) from public.product_variants v join public.products p on p.id = v.product_id
               where v.deleted_at is null and p.deleted_at is null and p.stock_tracked and v.stock <= 0),
      -- Live products without a purchase cost: their margin can''t be computed.
      ''products_without_cost'', (select count(*) from public.products p
               where p.deleted_at is null and p.status = ''active''
                 and not exists (select 1 from public.product_costs pc where pc.product_id = p.id and pc.deleted_at is null))
    ),
    ''daily'', (
      select coalesce(jsonb_agg(jsonb_build_object(
        ''day'', d.day,
        ''created'', (select count(*) from o where o.created_at::date = d.day),
        ''confirmed'', (select count(*) from o where o.confirmed_at::date = d.day),
        ''delivered'', (select count(*) from delivered x where x.delivered_at::date = d.day),
        ''revenue'', (select coalesce(sum(x.total), 0) from delivered x where x.delivered_at::date = d.day),
        ''returned'', (select count(*) from o where o.status = ''returned'' and o.returned_at::date = d.day),
        ''collected'', (select coalesce(sum(p.amount), 0) from public.order_payments p join o on o.id = p.order_id
                       where p.deleted_at is null and p.received_at::date = d.day),
        ''ad_spend'', (select coalesce(sum(s.amount), 0) from public.ad_spend s where s.deleted_at is null and s.spend_date = d.day
                      and (p_campaign is null or s.campaign_id = p_campaign))
      ) order by d.day), ''[]''::jsonb) from days d
    ),
    ''channels'', (
      select coalesce(jsonb_agg(c order by c->>''channel''), ''[]''::jsonb) from (
        select jsonb_build_object(''channel'', o.channel,
          ''created'', count(*) filter (where o.created_at >= p_from and o.created_at < p_to),
          ''confirmed'', count(*) filter (where o.confirmed_at >= p_from and o.confirmed_at < p_to),
          ''delivered'', count(*) filter (where o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to),
          ''returned'', count(*) filter (where o.status = ''returned'' and o.returned_at >= p_from and o.returned_at < p_to),
          ''revenue'', coalesce(sum(o.total) filter (where o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to), 0)
        ) as c
          from o group by o.channel
      ) x
    ),
    ''products'', (
      select coalesce(jsonb_agg(p order by (p->>''revenue'')::numeric desc), ''[]''::jsonb) from (
        select jsonb_build_object(''product_id'', l.product_id, ''name'', max(l.product_name),
          ''quantity'', sum(l.quantity), ''revenue'', sum(l.subtotal),
          ''cost'', sum(l.quantity * coalesce(l.unit_cost, 0)),
          ''margin'', round(sum(l.subtotal) / (1 + rate / 100), 3) - sum(l.quantity * coalesce(l.unit_cost, 0)),
          ''missing_cost'', bool_or(l.unit_cost is null)) as p
          from delivered_lines l group by l.product_id
         order by sum(l.subtotal) desc limit 15
      ) x
    ),
    ''agents'', (
      select coalesce(jsonb_agg(a order by (a->>''delivered_revenue'')::numeric desc), ''[]''::jsonb) from (
        select jsonb_build_object(''agent_id'', o.agent,
          ''email'', coalesce(max(o.assigned_to_email), max(o.created_by_email), max(b.email)),
          ''created'', count(*) filter (where o.created_at >= p_from and o.created_at < p_to),
          ''confirmed'', count(*) filter (where o.confirmed_at >= p_from and o.confirmed_at < p_to),
          ''delivered'', count(*) filter (where o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to),
          ''returned'', count(*) filter (where o.status = ''returned'' and o.returned_at >= p_from and o.returned_at < p_to),
          ''delivered_revenue'', coalesce(sum(o.total) filter (where o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to), 0)
        ) as a
          from o left join public.back_office_users b on b.user_id = o.agent
         where o.agent is not null
         group by o.agent
      ) x
    ),
    ''campaigns'', (
      select coalesce(jsonb_agg(c order by (c->>''spend'')::numeric desc), ''[]''::jsonb) from (
        select jsonb_build_object(''campaign_id'', c.id, ''name'', c.name, ''platform'', c.platform,
          ''spend'', coalesce((select sum(s.amount) from public.ad_spend s where s.campaign_id = c.id and s.deleted_at is null
                              and s.spend_date >= p_from::date and s.spend_date < p_to::date + 1), 0),
          ''orders'', (select count(*) from o where o.campaign_id = c.id and o.created_at >= p_from and o.created_at < p_to),
          ''delivered'', (select count(*) from o where o.campaign_id = c.id and o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to),
          ''revenue'', (select coalesce(sum(o.total), 0) from o where o.campaign_id = c.id and o.status = ''delivered'' and o.delivered_at >= p_from and o.delivered_at < p_to)
        ) as c
          from public.ad_campaigns c
         where c.deleted_at is null and (p_campaign is null or c.id = p_campaign)
      ) x
    )
  ) into result;
  return result;
end;
$$","-- ---------------------------------------------------------------------------
-- Daily alerts: bills due, expiring documents, plus part 1''s
-- ---------------------------------------------------------------------------

create or replace function private.daily_alerts()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  cfg jsonb := coalesce((select value from public.erp_settings where key = ''sales''), ''{}''::jsonb);
  pending_hours integer := coalesce((cfg->>''pending_alert_hours'')::integer, 24);
  late_days integer := coalesce((cfg->>''late_delivery_days'')::integer, 6);
  n integer;
  amount numeric;
  sent integer := 0;
  t record;
begin
  select count(*) into n from public.orders
   where deleted_at is null and status in (''pending'', ''confirmed'') and created_at < now() - make_interval(hours => pending_hours);
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients(''orders''), ''order'', ''orders_waiting'', ''warning'',
      private.i18n(''{count} order(s) waiting for confirmation'', ''{count} commande(s) en attente de confirmation'', ''{count} طلب بانتظار التأكيد'', jsonb_build_object(''count'', n)),
      private.i18n(''Older than {hours} h'', ''Depuis plus de {hours} h'', ''منذ أكثر من {hours} ساعة'', jsonb_build_object(''hours'', pending_hours)),
      ''/admin/orders?status=pending'', ''{}''::jsonb);
  end if;

  select count(*) into n from public.orders o
   where o.deleted_at is null and o.status in (''processing'', ''shipped'')
     and coalesce(o.confirmed_at, o.created_at) < now() - make_interval(days => late_days);
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients(''orders''), ''order'', ''late_deliveries'', ''warning'',
      private.i18n(''{count} late delivery(ies)'', ''{count} livraison(s) en retard'', ''{count} توصيل متأخر'', jsonb_build_object(''count'', n)),
      private.i18n(''Sent more than {days} days ago and not delivered'', ''Envoyées il y a plus de {days} jours, non livrées'', ''أرسلت منذ أكثر من {days} أيام ولم تسلم'', jsonb_build_object(''days'', late_days)),
      ''/admin/delivery'', ''{}''::jsonb);
  end if;

  for t in
    select assigned_to, count(*) as due
      from public.crm_tasks
     where deleted_at is null and done_at is null and assigned_to is not null and due_at < now() + interval ''1 day''
     group by assigned_to
  loop
    sent := sent + private.notify(array[t.assigned_to], ''system'', ''tasks_due'', ''info'',
      private.i18n(''{count} follow-up(s) due today'', ''{count} relance(s) à faire aujourd''''hui'', ''{count} متابعة اليوم'', jsonb_build_object(''count'', t.due)),
      null, ''/admin/my-work'', ''{}''::jsonb);
  end loop;

  select count(*), coalesce(sum(total - paid_amount), 0) into n, amount from public.bills
   where deleted_at is null and status <> ''paid'' and due_date <= current_date + 3;
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients(''finance''), ''system'', ''bills_due'', ''warning'',
      private.i18n(''{count} bill(s) due within 3 days'', ''{count} facture(s) à payer sous 3 jours'', ''{count} فاتورة مستحقة خلال 3 أيام'', jsonb_build_object(''count'', n)),
      private.i18n(''{amount} TND to pay (overdue included)'', ''{amount} TND à payer (retards compris)'', ''{amount} د.ت للدفع (مع المتأخرات)'', jsonb_build_object(''amount'', trim(to_char(amount, ''FM999999990.000'')))),
      ''/admin/finance/bills'', ''{}''::jsonb);
  end if;

  select count(*) into n from public.documents where deleted_at is null and expires_on between current_date and current_date + 15;
  if n > 0 then
    sent := sent + private.notify(private.notification_recipients(''finance''), ''system'', ''documents_expiring'', ''info'',
      private.i18n(''{count} document(s) expire within 15 days'', ''{count} document(s) expirent sous 15 jours'', ''{count} وثيقة تنتهي خلال 15 يوما'', jsonb_build_object(''count'', n)),
      null, ''/admin/finance/documents'', ''{}''::jsonb);
  end if;
  return sent;
end;
$$","revoke all on function private.daily_alerts() from public, anon, authenticated","-- Every morning at 08:00 Tunis (07:00 UTC), where pg_cron is available.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = ''pg_cron'') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = ''kachabity-daily-alerts'';
    perform cron.schedule(''kachabity-daily-alerts'', ''0 7 * * *'', ''select private.daily_alerts()'');
  end if;
exception when others then
  raise warning ''daily alerts not scheduled: %'', sqlerrm;
end;
$$","-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.post_journal_entries(uuid[], uuid, text),
  public.save_manual_entry(uuid, jsonb, jsonb, uuid, text),
  public.reverse_journal_entry(uuid, date, uuid, text),
  public.issue_invoice(uuid, text, date, uuid, text),
  public.cancel_invoice(uuid, text, uuid, text),
  public.auto_match_bank(integer, uuid),
  public.book_stock_variation(date, uuid, text),
  public.trial_balance(date, date, boolean),
  public.vat_summary(date, date, boolean),
  public.treasury_balances(),
  public.owner_overview(timestamptz, timestamptz, text, uuid, uuid, uuid)
  from public, anon, authenticated","grant execute on function
  public.post_journal_entries(uuid[], uuid, text),
  public.save_manual_entry(uuid, jsonb, jsonb, uuid, text),
  public.reverse_journal_entry(uuid, date, uuid, text),
  public.issue_invoice(uuid, text, date, uuid, text),
  public.cancel_invoice(uuid, text, uuid, text),
  public.auto_match_bank(integer, uuid),
  public.book_stock_variation(date, uuid, text),
  public.trial_balance(date, date, boolean),
  public.vat_summary(date, date, boolean),
  public.treasury_balances(),
  public.owner_overview(timestamptz, timestamptz, text, uuid, uuid, uuid)
  to service_role","revoke all on function private.accounting_settings(), private.acct(text), private.next_number(text), private.protect_posted_entry(),
  private.protect_posted_lines(), private.request_actor(), private.book(text, date, text, text, uuid, text, jsonb),
  private.unbook(text, uuid, text, date), private.bill_category_account(text), private.refresh_bill_paid(), private.bill_status(),
  private.book_order(), private.book_order_payment(), private.book_remittance(), private.book_bill(), private.book_bill_payment(),
  private.book_treasury_movement(), private.book_ad_spend(), private.book_invoice_stamp()
  from public, anon, authenticated","-- ---------------------------------------------------------------------------
-- Treasury helpers
-- ---------------------------------------------------------------------------

-- Moving money between the till and the bank: two movements through the internal transfer account.
create or replace function public.record_cash_transfer(p_from text, p_amount numeric, p_date date, p_label text,
                                                       p_actor uuid default null, p_actor_email text default null)
returns uuid
language plpgsql
set search_path = ''''
as $$
declare
  v_transfer uuid := gen_random_uuid();
  v_to text := case p_from when ''cash'' then ''bank'' when ''bank'' then ''cash'' end;
begin
  if v_to is null then
    raise exception ''invalid_account'';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception ''invalid_quantity'';
  end if;
  insert into public.treasury_movements (account, direction, amount, category, occurred_on, label, transfer_id, created_by, created_by_email)
  values (p_from, ''out'', p_amount, ''transfer'', coalesce(p_date, current_date), coalesce(nullif(p_label, ''''), ''Transfer to '' || v_to), v_transfer, p_actor, p_actor_email),
         (v_to, ''in'', p_amount, ''transfer'', coalesce(p_date, current_date), coalesce(nullif(p_label, ''''), ''Transfer from '' || p_from), v_transfer, p_actor, p_actor_email);
  return v_transfer;
end;
$$","-- Removes a carrier payout entered by mistake: its payments are owed by the carrier again.
create or replace function public.cancel_remittance(p_id uuid)
returns void
language plpgsql
set search_path = ''''
as $$
begin
  update public.order_payments set remittance_id = null, updated_at = now() where remittance_id = p_id;
  update public.cod_remittances set deleted_at = now() where id = p_id and deleted_at is null;
  if not found then
    raise exception ''remittance_not_found'';
  end if;
end;
$$","-- Removes one side of a transfer together with the other.
create or replace function public.delete_treasury_movement(p_id uuid)
returns integer
language plpgsql
set search_path = ''''
as $$
declare
  m public.treasury_movements;
  n integer;
begin
  select * into m from public.treasury_movements where id = p_id and deleted_at is null;
  if not found then
    raise exception ''movement_not_found'';
  end if;
  if m.category = ''pos_difference'' then
    raise exception ''pos_difference_locked'';
  end if;
  update public.treasury_movements set deleted_at = now()
   where deleted_at is null and (id = p_id or (m.transfer_id is not null and transfer_id = m.transfer_id));
  get diagnostics n = row_count;
  return n;
end;
$$","revoke all on function public.record_cash_transfer(text, numeric, date, text, uuid, text), public.cancel_remittance(uuid),
  public.delete_treasury_movement(uuid) from public, anon, authenticated","grant execute on function public.record_cash_transfer(text, numeric, date, text, uuid, text), public.cancel_remittance(uuid),
  public.delete_treasury_movement(uuid) to service_role","-- A bill paid on the spot (cash or bank): the bill and its payment together.
create or replace function public.create_paid_bill(p_bill jsonb, p_account text, p_method text,
                                                   p_actor uuid default null, p_actor_email text default null)
returns public.bills
language plpgsql
set search_path = ''''
as $$
declare
  b public.bills;
begin
  insert into public.bills (supplier_id, payee, purchase_order_id, supplier_reference, category, cost_type, account_code,
                            bill_date, due_date, amount_ht, vat_amount, stamp, notes, document_id, created_by, created_by_email)
  values (nullif(p_bill->>''supplier_id'', '''')::uuid, nullif(p_bill->>''payee'', ''''), nullif(p_bill->>''purchase_order_id'', '''')::uuid,
          nullif(p_bill->>''supplier_reference'', ''''), p_bill->>''category'', coalesce(nullif(p_bill->>''cost_type'', ''''), ''variable''),
          p_bill->>''account_code'', coalesce(nullif(p_bill->>''bill_date'', '''')::date, current_date), nullif(p_bill->>''due_date'', '''')::date,
          (p_bill->>''amount_ht'')::numeric, coalesce(nullif(p_bill->>''vat_amount'', '''')::numeric, 0), coalesce(nullif(p_bill->>''stamp'', '''')::numeric, 0),
          nullif(p_bill->>''notes'', ''''), nullif(p_bill->>''document_id'', '''')::uuid, p_actor, p_actor_email)
  returning * into b;
  if b.total > 0 then
    insert into public.bill_payments (bill_id, amount, paid_on, account, method, created_by, created_by_email)
    values (b.id, b.total, b.bill_date, p_account, p_method, p_actor, p_actor_email);
  end if;
  select * into b from public.bills where id = b.id;
  return b;
end;
$$","revoke all on function public.create_paid_bill(jsonb, text, text, uuid, text) from public, anon, authenticated","grant execute on function public.create_paid_bill(jsonb, text, text, uuid, text) to service_role"}', 'erp_accounting');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261023204053', '{"-- Phase 3 of the NestJS migration: accounts live in public.users, sessions and password resets
-- are NestJS''s own, and nothing points at auth.users any more (docs/MIGRATION-NESTJS.md).

-- 1. The profile table becomes the account table. app_metadata keeps Supabase''s shape
--    ({ role, permissions }) so lib/admin-auth.ts reads it unchanged.
alter table public.users
  add column if not exists email text,
  add column if not exists password_hash text,
  add column if not exists app_metadata jsonb not null default ''{}''::jsonb,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  -- What the customer typed about themselves (full_name, phone, address, city, country).
  add column if not exists user_metadata jsonb not null default ''{}''::jsonb,
  alter column id set default gen_random_uuid()","create unique index if not exists users_email_key on public.users (lower(email)) where deleted_at is null","-- The public may still read names and avatars (reviews); never e-mails, hashes or roles.
revoke select on public.users from anon, authenticated","grant select (id, name, avatar_url, created_at, updated_at) on public.users to anon, authenticated","-- 2. Copy the Supabase Auth accounts (bcrypt hashes as they are, so nobody has to reset their
--    password). Re-run at the switch-over for accounts created in the meantime.
create or replace function private.copy_auth_users()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  copied integer;
begin
  insert into public.users (id, name, avatar_url, created_at)
  select u.id,
         nullif(left(trim(coalesce(u.raw_user_meta_data ->> ''full_name'', u.raw_user_meta_data ->> ''name'', '''')), 100), ''''),
         nullif(u.raw_user_meta_data ->> ''avatar_url'', ''''),
         u.created_at
    from auth.users u
  on conflict (id) do nothing;

  update public.users p
     set email = lower(u.email),
         password_hash = u.encrypted_password,
         app_metadata = coalesce(u.raw_app_meta_data, ''{}''::jsonb) - ''provider'' - ''providers'',
         email_confirmed_at = u.email_confirmed_at,
         last_sign_in_at = u.last_sign_in_at,
         user_metadata = coalesce(u.raw_user_meta_data, ''{}''::jsonb)
                         - ''sub'' - ''email'' - ''email_verified'' - ''phone_verified'',
         deleted_at = coalesce(p.deleted_at, u.deleted_at)
    from auth.users u
   where u.id = p.id;
  get diagnostics copied = row_count;
  return copied;
end;
$$","revoke all on function private.copy_auth_users() from public, anon, authenticated","select private.copy_auth_users()","-- 3. Foreign keys point at public.users instead of auth.users (same ids, same on-delete rules).
alter table public.users drop constraint if exists users_id_fkey","alter table public.carts drop constraint if exists carts_user_id_fkey,
  add constraint carts_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade","alter table public.user_favorites drop constraint if exists user_favorites_user_id_fkey,
  add constraint user_favorites_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade","alter table public.stock_movements drop constraint if exists stock_movements_created_by_fkey,
  add constraint stock_movements_created_by_fkey foreign key (created_by) references public.users (id)","alter table public.orders drop constraint if exists orders_user_id_fkey,
  add constraint orders_user_id_fkey foreign key (user_id) references public.users (id)","alter table public.landing_products drop constraint if exists landing_products_created_by_fkey,
  add constraint landing_products_created_by_fkey foreign key (created_by) references public.users (id)","alter table public.customers drop constraint if exists customers_user_id_fkey,
  add constraint customers_user_id_fkey foreign key (user_id) references public.users (id)","-- 4. Sessions: one row per signed-in browser, holding the hash of its refresh token.
create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
)","create index user_sessions_user_idx on public.user_sessions (user_id) where revoked_at is null","-- 5. Single-use links sent by e-mail (confirm the address, reset the password), stored as hashes.
create table public.auth_tokens (
  token_hash text primary key,
  user_id uuid not null references public.users (id),
  purpose text not null check (purpose in (''confirm'', ''reset'')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
)","-- 6. Notification recipients: live accounts are public.users now.
create or replace function private.notification_recipients(p_audience text)
 returns uuid[]
 language sql
 stable security definer
 set search_path to ''''
as $function$
  with live as (
    select b.*
      from public.back_office_users b
      join public.users u on u.id = b.user_id
     where b.deleted_at is null and u.deleted_at is null
  )
  select coalesce(array_agg(user_id), ''{}'')
    from live
   where case p_audience
           when ''owner'' then role = ''owner''
                          or (role = ''admin'' and not exists (select 1 from live where role = ''owner''))
           when ''orders'' then role in (''owner'', ''admin'') or ''orders'' = any (permissions)
           when ''stock'' then role in (''owner'', ''admin'') or ''stock'' = any (permissions) or ''purchasing'' = any (permissions)
           when ''finance'' then role in (''owner'', ''admin'') or ''finance'' = any (permissions)
           when ''customers'' then role in (''owner'', ''admin'') or ''customers'' = any (permissions)
           else false
         end;
$function$","-- NestJS only (it connects directly); nothing for the public API.
alter table public.user_sessions enable row level security","alter table public.auth_tokens enable row level security","revoke all on public.user_sessions, public.auth_tokens from anon, authenticated"}', 'own_auth_accounts');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261023214627', '{"-- Phase 4 of the NestJS migration: NestJS delivers notifications and runs the daily alerts
-- (docs/MIGRATION-NESTJS.md), instead of pg_net → the send-push Edge Function and pg_cron.

-- Every new or changed notification is announced on the `notifications` channel. NestJS
-- listens: it streams the row to the recipient''s open admin tabs (SSE) and, for new rows,
-- sends Web Push. Delivered at commit, so rolled-back changes announce nothing.
create or replace function private.announce_notification()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  perform pg_notify(''notifications'', json_build_object(''id'', new.id, ''recipient_id'', new.recipient_id, ''op'', lower(tg_op))::text);
  return null;
end;
$$","revoke all on function private.announce_notification() from public, anon, authenticated","create trigger announce_notification after insert or update on public.notifications
  for each row execute function private.announce_notification()","drop trigger if exists dispatch_push on public.notifications","drop function if exists private.dispatch_push()","-- The daily alerts are scheduled by NestJS (07:00 UTC), so plain Postgres needs no pg_cron.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = ''cron'') then
    perform cron.unschedule(jobid) from cron.job where jobname = ''kachabity-daily-alerts'';
  end if;
end;
$$"}', 'notifications_from_nestjs');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261024134433', '{"-- Phase 5 of the NestJS migration: the schema no longer needs anything only Supabase has, so it
-- can be dumped and restored on plain Postgres (scripts/db/move-database.mjs). Applied at the
-- switch-over, after 20261023204053_own_auth_accounts has copied the accounts.

-- Browsers no longer reach the database (no PostgREST): NestJS connects as the tables'' owner,
-- which RLS doesn''t filter. The policies only granted the Supabase roles anon/authenticated, and
-- they would fail to restore where those roles don''t exist. RLS stays enabled, so any other role
-- sees nothing.
do $$
declare
  p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname in (''public'', ''private'') loop
    execute format(''drop policy %I on %I.%I'', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$","-- Supabase Auth leftovers: the profile sync on auth.users and the one-off account copy.
drop function if exists private.sync_user_profile() cascade","drop function if exists private.copy_auth_users()"}', 'plain_postgres_ready');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261024160000', '{"-- Objectives & commissions: prizes by number of delivered orders, and a start date for analytics.

-- 1. A new commission type, ''tiers'': prizes for reaching numbers of delivered orders in the month,
--    e.g. [{\"orders\": 50, \"prize\": 100}, {\"orders\": 80, \"prize\": 200}]. The agent earns the prize of
--    the highest tier reached (lib/erp/objectives.ts).
alter table public.agent_goals
  add column if not exists prize_tiers jsonb not null default ''[]''::jsonb
    check (jsonb_typeof(prize_tiers) = ''array'')","alter table public.agent_goals drop constraint if exists agent_goals_commission_type_check","alter table public.agent_goals add constraint agent_goals_commission_type_check
  check (commission_type in (''none'', ''percent'', ''per_order'', ''tiers''))","create or replace function public.set_agent_goal(p_user uuid, p_user_email text, p_months date[], p_goal jsonb,
                                                 p_actor uuid default null, p_actor_email text default null)
returns setof public.agent_goals
language plpgsql
set search_path = ''''
as $$
begin
  update public.agent_goals set deleted_at = now()
   where user_id = p_user and month = any (p_months) and deleted_at is null;
  return query
  insert into public.agent_goals (user_id, user_email, month, target_orders, target_confirmed, target_delivered, target_revenue,
                                  commission_type, commission_value, prize_tiers, created_by, created_by_email)
  select p_user, p_user_email, m, nullif(p_goal->>''target_orders'', '''')::integer, nullif(p_goal->>''target_confirmed'', '''')::integer,
         nullif(p_goal->>''target_delivered'', '''')::integer, nullif(p_goal->>''target_revenue'', '''')::numeric,
         coalesce(nullif(p_goal->>''commission_type'', ''''), ''none''), coalesce(nullif(p_goal->>''commission_value'', '''')::numeric, 0),
         case when jsonb_typeof(p_goal->''prize_tiers'') = ''array'' then p_goal->''prize_tiers'' else ''[]''::jsonb end,
         p_actor, p_actor_email
    from unnest(p_months) as m
  returning *;
end;
$$","-- 2. Analytics start date: the owner can \"reset\" the numbers (Business overview, Agent performance,
--    Objectives, My day) to count only from a date. Nothing is deleted; clearing it shows everything.
insert into public.erp_settings (key, value) values (''analytics'', ''{\"start_date\": null}''::jsonb)
on conflict (key) do nothing"}', 'objective_prize_tiers');


--
-- Name: activity_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activity_log_id_seq', 5, true);


--
-- Name: bill_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bill_seq', 1, false);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notifications_id_seq', 1, false);


--
-- Name: pos_session_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pos_session_seq', 1, false);


--
-- Name: product_code_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.product_code_seq', 1, false);


--
-- Name: purchase_order_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.purchase_order_seq', 1, false);


--
-- Name: purchase_receipt_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.purchase_receipt_seq', 1, false);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (code);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: ad_campaigns ad_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_pkey PRIMARY KEY (id);


--
-- Name: ad_spend ad_spend_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_spend
    ADD CONSTRAINT ad_spend_pkey PRIMARY KEY (id);


--
-- Name: agent_goals agent_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_goals
    ADD CONSTRAINT agent_goals_pkey PRIMARY KEY (id);


--
-- Name: auth_tokens auth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: back_office_users back_office_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.back_office_users
    ADD CONSTRAINT back_office_users_pkey PRIMARY KEY (user_id);


--
-- Name: bank_statement_lines bank_statement_lines_matched_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_matched_line_id_key UNIQUE (matched_line_id);


--
-- Name: bank_statement_lines bank_statement_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_pkey PRIMARY KEY (id);


--
-- Name: bill_payments bill_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_pkey PRIMARY KEY (id);


--
-- Name: bills bills_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_number_key UNIQUE (number);


--
-- Name: bills bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);


--
-- Name: business_goals business_goals_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_goals
    ADD CONSTRAINT business_goals_month_key UNIQUE (month);


--
-- Name: business_goals business_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_goals
    ADD CONSTRAINT business_goals_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_cart_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_product_id_key UNIQUE (cart_id, product_id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_pkey PRIMARY KEY (id);


--
-- Name: carts carts_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_session_id_key UNIQUE (session_id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: cod_remittances cod_remittances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cod_remittances
    ADD CONSTRAINT cod_remittances_pkey PRIMARY KEY (id);


--
-- Name: collections collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);


--
-- Name: colors colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colors
    ADD CONSTRAINT colors_pkey PRIMARY KEY (id);


--
-- Name: country_tax_rates country_tax_rates_country_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_tax_rates
    ADD CONSTRAINT country_tax_rates_country_code_key UNIQUE (country_code);


--
-- Name: country_tax_rates country_tax_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_tax_rates
    ADD CONSTRAINT country_tax_rates_pkey PRIMARY KEY (id);


--
-- Name: crm_tasks crm_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_pkey PRIMARY KEY (id);


--
-- Name: customer_interactions customer_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_interactions
    ADD CONSTRAINT customer_interactions_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);


--
-- Name: document_counters document_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_counters
    ADD CONSTRAINT document_counters_pkey PRIMARY KEY (key);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: erp_settings erp_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_settings
    ADD CONSTRAINT erp_settings_pkey PRIMARY KEY (key);


--
-- Name: hero_sections hero_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_sections
    ADD CONSTRAINT hero_sections_pkey PRIMARY KEY (id);


--
-- Name: inventory_levels inventory_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_levels
    ADD CONSTRAINT inventory_levels_pkey PRIMARY KEY (variant_id, location_id);


--
-- Name: journal_entries journal_entries_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_number_key UNIQUE (number);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);


--
-- Name: landing_products landing_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_products
    ADD CONSTRAINT landing_products_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: material_movements material_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_movements
    ADD CONSTRAINT material_movements_pkey PRIMARY KEY (id);


--
-- Name: newsletter_subscribers newsletter_subscribers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_email_key UNIQUE (email);


--
-- Name: newsletter_subscribers newsletter_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_payments order_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: pos_sessions pos_sessions_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_number_key UNIQUE (number);


--
-- Name: pos_sessions pos_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_pkey PRIMARY KEY (id);


--
-- Name: product_bom product_bom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bom
    ADD CONSTRAINT product_bom_pkey PRIMARY KEY (id);


--
-- Name: product_costing product_costing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costing
    ADD CONSTRAINT product_costing_pkey PRIMARY KEY (product_id);


--
-- Name: product_costs product_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_pkey PRIMARY KEY (product_id);


--
-- Name: product_discounts product_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_discounts
    ADD CONSTRAINT product_discounts_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);


--
-- Name: products products_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_code_key UNIQUE (code);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_lines purchase_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_number_key UNIQUE (number);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_receipt_lines purchase_receipt_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipt_lines
    ADD CONSTRAINT purchase_receipt_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_receipts purchase_receipts_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipts
    ADD CONSTRAINT purchase_receipts_number_key UNIQUE (number);


--
-- Name: purchase_receipts purchase_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipts
    ADD CONSTRAINT purchase_receipts_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: raw_materials raw_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_materials
    ADD CONSTRAINT raw_materials_pkey PRIMARY KEY (id);


--
-- Name: reels reels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reels
    ADD CONSTRAINT reels_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: sales_invoices sales_invoices_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_number_key UNIQUE (number);


--
-- Name: sales_invoices sales_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_pkey PRIMARY KEY (id);


--
-- Name: shipping_rates shipping_rates_country_code_shipping_method_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates
    ADD CONSTRAINT shipping_rates_country_code_shipping_method_key UNIQUE (country_code, shipping_method);


--
-- Name: shipping_rates shipping_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates
    ADD CONSTRAINT shipping_rates_pkey PRIMARY KEY (id);


--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);


--
-- Name: site_settings site_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: sizes sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sizes
    ADD CONSTRAINT sizes_pkey PRIMARY KEY (id);


--
-- Name: small_cards small_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.small_cards
    ADD CONSTRAINT small_cards_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: treasury_movements treasury_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_movements
    ADD CONSTRAINT treasury_movements_pkey PRIMARY KEY (id);


--
-- Name: user_favorites user_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_pkey PRIMARY KEY (id);


--
-- Name: user_favorites user_favorites_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: activity_log_actor_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_actor_created_at_idx ON public.activity_log USING btree (actor_id, created_at DESC);


--
-- Name: activity_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_created_at_idx ON public.activity_log USING btree (created_at DESC);


--
-- Name: activity_log_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_entity_idx ON public.activity_log USING btree (entity, entity_id);


--
-- Name: ad_spend_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_spend_campaign_idx ON public.ad_spend USING btree (campaign_id) WHERE (deleted_at IS NULL);


--
-- Name: ad_spend_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_spend_date_idx ON public.ad_spend USING btree (spend_date) WHERE (deleted_at IS NULL);


--
-- Name: agent_goals_user_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_goals_user_month_idx ON public.agent_goals USING btree (user_id, month) WHERE (deleted_at IS NULL);


--
-- Name: bank_statement_lines_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_statement_lines_date_idx ON public.bank_statement_lines USING btree (statement_date) WHERE (deleted_at IS NULL);


--
-- Name: bill_payments_bill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_payments_bill_idx ON public.bill_payments USING btree (bill_id);


--
-- Name: bills_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bills_date_idx ON public.bills USING btree (bill_date) WHERE (deleted_at IS NULL);


--
-- Name: bills_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bills_due_idx ON public.bills USING btree (due_date) WHERE ((deleted_at IS NULL) AND (status <> 'paid'::text));


--
-- Name: bills_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bills_supplier_idx ON public.bills USING btree (supplier_id);


--
-- Name: cart_items_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cart_items_product_id_idx ON public.cart_items USING btree (product_id);


--
-- Name: carts_active_last_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carts_active_last_activity_idx ON public.carts USING btree (last_activity_at) WHERE (status = 'active'::text);


--
-- Name: carts_converted_to_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carts_converted_to_order_id_idx ON public.carts USING btree (converted_to_order_id);


--
-- Name: carts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carts_user_id_idx ON public.carts USING btree (user_id);


--
-- Name: categories_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX categories_parent_id_idx ON public.categories USING btree (parent_id);


--
-- Name: collections_name_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX collections_name_live_idx ON public.collections USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: crm_tasks_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_customer_idx ON public.crm_tasks USING btree (customer_id);


--
-- Name: crm_tasks_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_open_idx ON public.crm_tasks USING btree (assigned_to, due_at) WHERE ((done_at IS NULL) AND (deleted_at IS NULL));


--
-- Name: customer_interactions_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_interactions_customer_idx ON public.customer_interactions USING btree (customer_id, created_at DESC);


--
-- Name: customer_interactions_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_interactions_external_idx ON public.customer_interactions USING btree (channel, external_id);


--
-- Name: customer_interactions_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_interactions_unread_idx ON public.customer_interactions USING btree (created_at DESC) WHERE ((direction = 'in'::text) AND (read_at IS NULL) AND (deleted_at IS NULL));


--
-- Name: customers_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_assigned_idx ON public.customers USING btree (assigned_to) WHERE (deleted_at IS NULL);


--
-- Name: customers_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_created_at_idx ON public.customers USING btree (created_at DESC);


--
-- Name: customers_external_ids_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_external_ids_idx ON public.customers USING gin (external_ids);


--
-- Name: customers_phone_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_phone_live_idx ON public.customers USING btree (phone) WHERE ((deleted_at IS NULL) AND (phone IS NOT NULL));


--
-- Name: customers_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_stage_idx ON public.customers USING btree (stage) WHERE (deleted_at IS NULL);


--
-- Name: deliveries_barcode_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deliveries_barcode_live_idx ON public.deliveries USING btree (provider, barcode) WHERE ((deleted_at IS NULL) AND (barcode IS NOT NULL));


--
-- Name: deliveries_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deliveries_created_at_idx ON public.deliveries USING btree (created_at DESC);


--
-- Name: deliveries_order_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deliveries_order_live_idx ON public.deliveries USING btree (order_id) WHERE ((deleted_at IS NULL) AND (order_id IS NOT NULL));


--
-- Name: documents_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_expiry_idx ON public.documents USING btree (expires_on) WHERE ((deleted_at IS NULL) AND (expires_on IS NOT NULL));


--
-- Name: documents_related_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_related_idx ON public.documents USING btree (related_type, related_id) WHERE (deleted_at IS NULL);


--
-- Name: inventory_levels_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_levels_location_id_idx ON public.inventory_levels USING btree (location_id);


--
-- Name: journal_entries_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_date_idx ON public.journal_entries USING btree (entry_date) WHERE (deleted_at IS NULL);


--
-- Name: journal_entries_source_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journal_entries_source_live_idx ON public.journal_entries USING btree (source_type, source_id, source_event) WHERE ((deleted_at IS NULL) AND (reversed_at IS NULL) AND (reversal_of IS NULL) AND (source_type <> 'manual'::text));


--
-- Name: journal_entries_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_status_idx ON public.journal_entries USING btree (status, entry_date) WHERE (deleted_at IS NULL);


--
-- Name: journal_lines_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_lines_account_idx ON public.journal_lines USING btree (account_code);


--
-- Name: journal_lines_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_lines_entry_idx ON public.journal_lines USING btree (entry_id);


--
-- Name: journal_lines_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_lines_partner_idx ON public.journal_lines USING btree (partner_type, partner_id) WHERE (partner_id IS NOT NULL);


--
-- Name: landing_products_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX landing_products_created_by_idx ON public.landing_products USING btree (created_by);


--
-- Name: landing_products_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX landing_products_product_id_idx ON public.landing_products USING btree (product_id);


--
-- Name: landing_products_section_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX landing_products_section_position_idx ON public.landing_products USING btree (section, "position") WHERE (deleted_at IS NULL);


--
-- Name: landing_products_section_product_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX landing_products_section_product_live_idx ON public.landing_products USING btree (section, product_id) WHERE (deleted_at IS NULL);


--
-- Name: locations_name_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX locations_name_live_idx ON public.locations USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: locations_single_online_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX locations_single_online_idx ON public.locations USING btree (sells_online) WHERE sells_online;


--
-- Name: material_movements_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_movements_material_idx ON public.material_movements USING btree (material_id, created_at DESC);


--
-- Name: notifications_recipient_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_recipient_created_idx ON public.notifications USING btree (recipient_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: notifications_recipient_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_recipient_unread_idx ON public.notifications USING btree (recipient_id) WHERE ((read_at IS NULL) AND (deleted_at IS NULL));


--
-- Name: order_items_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);


--
-- Name: order_items_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_product_id_idx ON public.order_items USING btree (product_id);


--
-- Name: order_items_variant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_variant_id_idx ON public.order_items USING btree (variant_id);


--
-- Name: order_payments_carrier_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_payments_carrier_open_idx ON public.order_payments USING btree (order_id) WHERE ((account = 'carrier'::text) AND (remittance_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: order_payments_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_payments_order_idx ON public.order_payments USING btree (order_id);


--
-- Name: order_payments_received_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_payments_received_idx ON public.order_payments USING btree (received_at) WHERE (deleted_at IS NULL);


--
-- Name: orders_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_assigned_idx ON public.orders USING btree (assigned_to, created_at DESC) WHERE (assigned_to IS NOT NULL);


--
-- Name: orders_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_campaign_idx ON public.orders USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);


--
-- Name: orders_channel_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_channel_created_idx ON public.orders USING btree (channel, created_at DESC);


--
-- Name: orders_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_created_at_idx ON public.orders USING btree (created_at DESC);


--
-- Name: orders_created_by_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_created_by_created_at_idx ON public.orders USING btree (created_by, created_at DESC) WHERE (created_by IS NOT NULL);


--
-- Name: orders_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id);


--
-- Name: orders_delivered_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_delivered_at_idx ON public.orders USING btree (delivered_at) WHERE (delivered_at IS NOT NULL);


--
-- Name: orders_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_phone_idx ON public.orders USING btree (public.normalize_phone(customer_phone));


--
-- Name: orders_pos_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_pos_session_idx ON public.orders USING btree (pos_session_id) WHERE (pos_session_id IS NOT NULL);


--
-- Name: orders_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_user_id_created_at_idx ON public.orders USING btree (user_id, created_at DESC);


--
-- Name: pos_sessions_one_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pos_sessions_one_open_idx ON public.pos_sessions USING btree (location_id) WHERE ((status = 'open'::text) AND (deleted_at IS NULL));


--
-- Name: product_bom_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_bom_live_idx ON public.product_bom USING btree (product_id, material_id) WHERE (deleted_at IS NULL);


--
-- Name: product_discounts_active_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_discounts_active_product_id_idx ON public.product_discounts USING btree (product_id) WHERE active;


--
-- Name: product_images_product_id_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_images_product_id_position_idx ON public.product_images USING btree (product_id, "position");


--
-- Name: product_images_variant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_images_variant_id_idx ON public.product_images USING btree (variant_id);


--
-- Name: product_variants_color_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_variants_color_id_idx ON public.product_variants USING btree (color_id);


--
-- Name: product_variants_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_variants_product_id_idx ON public.product_variants USING btree (product_id);


--
-- Name: product_variants_size_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_variants_size_id_idx ON public.product_variants USING btree (size_id);


--
-- Name: products_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_category_id_idx ON public.products USING btree (category_id);


--
-- Name: products_collection_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_collection_id_idx ON public.products USING btree (collection_id);


--
-- Name: products_live_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_live_created_at_idx ON public.products USING btree (created_at DESC) WHERE ((deleted_at IS NULL) AND (status = 'active'::text));


--
-- Name: products_live_sold_count_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_live_sold_count_idx ON public.products USING btree (sold_count DESC) WHERE ((deleted_at IS NULL) AND (status = 'active'::text));


--
-- Name: products_search_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_search_text_trgm_idx ON public.products USING gin (search_text extensions.gin_trgm_ops) WHERE (deleted_at IS NULL);


--
-- Name: products_supplier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_supplier_id_idx ON public.products USING btree (supplier_id);


--
-- Name: purchase_order_lines_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_order_lines_material_idx ON public.purchase_order_lines USING btree (material_id) WHERE (material_id IS NOT NULL);


--
-- Name: purchase_order_lines_po_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_order_lines_po_idx ON public.purchase_order_lines USING btree (purchase_order_id);


--
-- Name: purchase_order_lines_variant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_order_lines_variant_idx ON public.purchase_order_lines USING btree (variant_id) WHERE (variant_id IS NOT NULL);


--
-- Name: purchase_orders_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_orders_supplier_idx ON public.purchase_orders USING btree (supplier_id, order_date DESC);


--
-- Name: purchase_receipt_lines_receipt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_receipt_lines_receipt_idx ON public.purchase_receipt_lines USING btree (receipt_id);


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: raw_materials_code_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX raw_materials_code_live_idx ON public.raw_materials USING btree (code) WHERE ((deleted_at IS NULL) AND (code IS NOT NULL));


--
-- Name: reviews_product_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_product_id_created_at_idx ON public.reviews USING btree (product_id, created_at DESC);


--
-- Name: reviews_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_user_id_idx ON public.reviews USING btree (user_id);


--
-- Name: sales_invoices_order_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_invoices_order_live_idx ON public.sales_invoices USING btree (order_id) WHERE ((kind = 'invoice'::text) AND (status = 'issued'::text) AND (deleted_at IS NULL));


--
-- Name: stock_movements_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_created_at_idx ON public.stock_movements USING btree (created_at DESC);


--
-- Name: stock_movements_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_location_id_idx ON public.stock_movements USING btree (location_id);


--
-- Name: stock_movements_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_order_id_idx ON public.stock_movements USING btree (order_id);


--
-- Name: stock_movements_variant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_variant_id_idx ON public.stock_movements USING btree (variant_id);


--
-- Name: suppliers_name_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppliers_name_live_idx ON public.suppliers USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: treasury_movements_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treasury_movements_date_idx ON public.treasury_movements USING btree (occurred_on) WHERE (deleted_at IS NULL);


--
-- Name: user_favorites_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_favorites_product_id_idx ON public.user_favorites USING btree (product_id);


--
-- Name: user_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_user_idx ON public.user_sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (lower(email)) WHERE (deleted_at IS NULL);


--
-- Name: abandoned_carts _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.abandoned_carts WITH (security_invoker='true') AS
 SELECT c.id,
    c.user_id,
    c.session_id,
    c.last_activity_at,
    c.created_at,
    count(ci.id) AS item_count,
    sum(((ci.quantity)::numeric * ci.price_at_add)) AS estimated_value,
    COALESCE(jsonb_agg(jsonb_build_object('product_id', ci.product_id, 'quantity', ci.quantity, 'price', ci.price_at_add)) FILTER (WHERE (ci.id IS NOT NULL)), '[]'::jsonb) AS items
   FROM (public.carts c
     LEFT JOIN public.cart_items ci ON ((ci.cart_id = c.id)))
  WHERE ((c.status = 'active'::text) AND (c.last_activity_at < (now() - '01:00:00'::interval)) AND (c.last_activity_at > (now() - '30 days'::interval)) AND (c.user_id IS NOT NULL))
  GROUP BY c.id;


--
-- Name: activity_log activity_log_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER activity_log_append_only BEFORE DELETE OR UPDATE ON public.activity_log FOR EACH ROW EXECUTE FUNCTION private.prevent_activity_log_change();


--
-- Name: ad_spend ad_spend_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ad_spend_book AFTER INSERT OR UPDATE OF deleted_at ON public.ad_spend FOR EACH ROW EXECUTE FUNCTION private.book_ad_spend();


--
-- Name: notifications announce_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER announce_notification AFTER INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.announce_notification();


--
-- Name: bill_payments bill_payments_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bill_payments_book AFTER INSERT OR UPDATE OF deleted_at ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION private.book_bill_payment();


--
-- Name: bill_payments bill_payments_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bill_payments_refresh AFTER INSERT OR UPDATE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION private.refresh_bill_paid();


--
-- Name: bills bills_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bills_book AFTER INSERT OR UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION private.book_bill();


--
-- Name: bills bills_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bills_status BEFORE INSERT OR UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION private.bill_status();


--
-- Name: cod_remittances cod_remittances_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cod_remittances_book AFTER INSERT OR UPDATE OF deleted_at ON public.cod_remittances FOR EACH ROW EXECUTE FUNCTION private.book_remittance();


--
-- Name: customer_interactions customer_interactions_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_interactions_notify AFTER INSERT ON public.customer_interactions FOR EACH ROW EXECUTE FUNCTION private.notify_customer_message();


--
-- Name: inventory_levels inventory_levels_low_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_levels_low_stock AFTER UPDATE OF available ON public.inventory_levels FOR EACH ROW EXECUTE FUNCTION private.notify_low_stock();


--
-- Name: journal_entries journal_entries_protect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER journal_entries_protect BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION private.protect_posted_entry();


--
-- Name: journal_lines journal_lines_protect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER journal_lines_protect BEFORE INSERT OR DELETE OR UPDATE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION private.protect_posted_lines();


--
-- Name: locations locations_online_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER locations_online_change AFTER INSERT OR DELETE OR UPDATE OF sells_online ON public.locations FOR EACH STATEMENT EXECUTE FUNCTION private.on_online_location_change();


--
-- Name: accounts log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: ad_campaigns log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.ad_campaigns FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: ad_spend log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.ad_spend FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: agent_goals log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.agent_goals FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: bank_statement_lines log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: bill_payments log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: bills log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: business_goals log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.business_goals FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: categories log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: cod_remittances log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.cod_remittances FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: collections log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: colors log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.colors FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: country_tax_rates log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.country_tax_rates FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: crm_tasks log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: customer_interactions log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.customer_interactions FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: customers log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: deliveries log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: documents log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: erp_settings log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.erp_settings FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: hero_sections log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.hero_sections FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: journal_entries log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: landing_products log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.landing_products FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: locations log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: newsletter_subscribers log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: order_payments log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: orders log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: pos_sessions log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.pos_sessions FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: product_bom log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.product_bom FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: product_costing log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.product_costing FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: product_costs log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.product_costs FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: product_discounts log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.product_discounts FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: product_variants log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: products log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: promotions log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: purchase_order_lines log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: purchase_orders log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: purchase_receipts log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.purchase_receipts FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: raw_materials log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.raw_materials FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: reels log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.reels FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: reviews log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: sales_invoices log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: shipping_rates log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.shipping_rates FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: site_settings log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: sizes log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.sizes FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: small_cards log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.small_cards FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: stock_movements log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: suppliers log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: treasury_movements log_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE ON public.treasury_movements FOR EACH ROW EXECUTE FUNCTION private.log_activity();


--
-- Name: material_movements material_movements_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER material_movements_append_only BEFORE DELETE OR UPDATE ON public.material_movements FOR EACH ROW EXECUTE FUNCTION private.prevent_movement_change();


--
-- Name: material_movements material_movements_apply; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER material_movements_apply BEFORE INSERT ON public.material_movements FOR EACH ROW EXECUTE FUNCTION private.apply_material_movement();


--
-- Name: orders notify_new_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER notify_new_order AFTER INSERT ON public.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.notify_new_order();


--
-- Name: order_items order_items_cost; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_cost BEFORE INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.set_order_item_cost();


--
-- Name: order_payments order_payments_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_payments_book AFTER INSERT OR UPDATE OF deleted_at ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.book_order_payment();


--
-- Name: order_payments order_payments_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_payments_refresh AFTER INSERT OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.on_order_payment_change();


--
-- Name: orders orders_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_book AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION private.book_order();


--
-- Name: orders orders_link_customer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_link_customer BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION private.link_order_customer();


--
-- Name: orders orders_sync_customer_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_sync_customer_stage AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION private.sync_customer_stage();


--
-- Name: activity_log owner_alerts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER owner_alerts AFTER INSERT ON public.activity_log FOR EACH ROW EXECUTE FUNCTION private.owner_alerts();


--
-- Name: accounts prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: ad_campaigns prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.ad_campaigns FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: ad_spend prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.ad_spend FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: agent_goals prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.agent_goals FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: bank_statement_lines prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: bill_payments prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: bills prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.bills FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: business_goals prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.business_goals FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: cart_items prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: carts prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.carts FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: categories prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: cod_remittances prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.cod_remittances FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: collections prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.collections FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: colors prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.colors FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: country_tax_rates prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.country_tax_rates FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: crm_tasks prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: customer_interactions prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.customer_interactions FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: customers prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: deliveries prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: documents prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: hero_sections prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.hero_sections FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: journal_entries prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: landing_products prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.landing_products FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: locations prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.locations FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: newsletter_subscribers prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: notifications prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: order_items prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: order_payments prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: orders prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: pos_sessions prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.pos_sessions FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_bom prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.product_bom FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_costing prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.product_costing FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_costs prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.product_costs FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_discounts prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.product_discounts FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_images prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.product_images FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_variants prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: products prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: promotions prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.promotions FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: purchase_order_lines prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: purchase_orders prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: purchase_receipts prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.purchase_receipts FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: push_subscriptions prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: raw_materials prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.raw_materials FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: reels prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.reels FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: reviews prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: sales_invoices prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: shipping_rates prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.shipping_rates FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: site_settings prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: sizes prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.sizes FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: small_cards prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.small_cards FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: stock_movements prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: suppliers prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: treasury_movements prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.treasury_movements FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: user_favorites prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.user_favorites FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: users prevent_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION private.prevent_hard_delete();


--
-- Name: product_costs product_costs_fill_order_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_costs_fill_order_items AFTER INSERT OR UPDATE OF cost, deleted_at ON public.product_costs FOR EACH ROW EXECUTE FUNCTION private.fill_order_item_costs();


--
-- Name: product_variants product_variants_set_sku; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_variants_set_sku BEFORE INSERT ON public.product_variants FOR EACH ROW EXECUTE FUNCTION private.set_variant_sku();


--
-- Name: products products_set_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_set_code BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION private.set_product_code();


--
-- Name: products products_tracking_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_tracking_change AFTER UPDATE OF stock_tracked ON public.products FOR EACH ROW EXECUTE FUNCTION private.on_product_tracking_change();


--
-- Name: categories refresh_category_search; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER refresh_category_search AFTER UPDATE OF name, name_ar, name_fr, parent_id ON public.categories FOR EACH ROW EXECUTE FUNCTION private.refresh_category_search();


--
-- Name: sales_invoices sales_invoices_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_invoices_book AFTER INSERT ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.book_invoice_stamp();


--
-- Name: products set_product_search; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_product_search BEFORE INSERT OR UPDATE OF name, name_ar, name_fr, code, description, description_ar, description_fr, category_id ON public.products FOR EACH ROW EXECUTE FUNCTION private.set_product_search();


--
-- Name: accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: ad_campaigns set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ad_campaigns FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: ad_spend set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ad_spend FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: agent_goals set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.agent_goals FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: back_office_users set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.back_office_users FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: bank_statement_lines set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: bill_payments set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: bills set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: business_goals set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.business_goals FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: cart_items set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: carts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: categories set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: cod_remittances set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.cod_remittances FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: colors set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.colors FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: country_tax_rates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.country_tax_rates FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: crm_tasks set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: customer_interactions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customer_interactions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: customers set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: documents set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: erp_settings set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.erp_settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: hero_sections set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.hero_sections FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: journal_entries set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: landing_products set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.landing_products FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: locations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: notifications set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: order_payments set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: orders set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: pos_sessions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pos_sessions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: product_bom set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_bom FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: product_costing set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_costing FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: product_costs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_costs FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: product_discounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_discounts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: product_images set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: product_variants set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: products set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: promotions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: purchase_order_lines set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: purchase_orders set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: purchase_receipts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.purchase_receipts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: push_subscriptions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: raw_materials set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.raw_materials FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: reels set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.reels FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: reviews set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: sales_invoices set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: shipping_rates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.shipping_rates FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: site_settings set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: sizes set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sizes FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: small_cards set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.small_cards FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: suppliers set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: treasury_movements set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.treasury_movements FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: users set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: stock_movements stock_movements_apply; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stock_movements_apply BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION private.apply_stock_movement();


--
-- Name: stock_movements stock_movements_cost; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stock_movements_cost BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION private.stock_movement_cost();


--
-- Name: treasury_movements treasury_movements_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER treasury_movements_book AFTER INSERT OR UPDATE OF deleted_at ON public.treasury_movements FOR EACH ROW EXECUTE FUNCTION private.book_treasury_movement();


--
-- Name: ad_spend ad_spend_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_spend
    ADD CONSTRAINT ad_spend_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE SET NULL;


--
-- Name: auth_tokens auth_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bank_statement_lines bank_statement_lines_matched_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_matched_line_id_fkey FOREIGN KEY (matched_line_id) REFERENCES public.journal_lines(id) ON DELETE SET NULL;


--
-- Name: bill_payments bill_payments_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bills bills_account_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_account_code_fkey FOREIGN KEY (account_code) REFERENCES public.accounts(code);


--
-- Name: bills bills_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_document_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: bills bills_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: bills bills_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.carts(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: carts carts_converted_to_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_converted_to_order_id_fkey FOREIGN KEY (converted_to_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: carts carts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: customer_interactions customer_interactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_interactions
    ADD CONSTRAINT customer_interactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_interactions customer_interactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_interactions
    ADD CONSTRAINT customer_interactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: customers customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: deliveries deliveries_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: inventory_levels inventory_levels_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_levels
    ADD CONSTRAINT inventory_levels_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: inventory_levels inventory_levels_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_levels
    ADD CONSTRAINT inventory_levels_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: journal_entries journal_entries_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.journal_entries(id);


--
-- Name: journal_lines journal_lines_account_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_account_code_fkey FOREIGN KEY (account_code) REFERENCES public.accounts(code);


--
-- Name: journal_lines journal_lines_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: landing_products landing_products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_products
    ADD CONSTRAINT landing_products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: landing_products landing_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_products
    ADD CONSTRAINT landing_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: material_movements material_movements_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_movements
    ADD CONSTRAINT material_movements_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.raw_materials(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: order_payments order_payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_payments order_payments_pos_session_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_pos_session_fk FOREIGN KEY (pos_session_id) REFERENCES public.pos_sessions(id) ON DELETE SET NULL;


--
-- Name: order_payments order_payments_remittance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_remittance_id_fkey FOREIGN KEY (remittance_id) REFERENCES public.cod_remittances(id) ON DELETE SET NULL;


--
-- Name: orders orders_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE SET NULL;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: orders orders_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: orders orders_pos_session_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pos_session_fk FOREIGN KEY (pos_session_id) REFERENCES public.pos_sessions(id) ON DELETE SET NULL;


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: pos_sessions pos_sessions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: product_bom product_bom_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bom
    ADD CONSTRAINT product_bom_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.raw_materials(id);


--
-- Name: product_bom product_bom_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bom
    ADD CONSTRAINT product_bom_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_costing product_costing_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costing
    ADD CONSTRAINT product_costing_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_costs product_costs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_discounts product_discounts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_discounts
    ADD CONSTRAINT product_discounts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_images product_images_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_color_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_color_id_fkey FOREIGN KEY (color_id) REFERENCES public.colors(id) ON DELETE SET NULL;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_size_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_size_id_fkey FOREIGN KEY (size_id) REFERENCES public.sizes(id) ON DELETE SET NULL;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: products products_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE SET NULL;


--
-- Name: products products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: purchase_order_lines purchase_order_lines_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.raw_materials(id) ON DELETE SET NULL;


--
-- Name: purchase_order_lines purchase_order_lines_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: purchase_order_lines purchase_order_lines_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_receipt_lines purchase_receipt_lines_po_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipt_lines
    ADD CONSTRAINT purchase_receipt_lines_po_line_id_fkey FOREIGN KEY (po_line_id) REFERENCES public.purchase_order_lines(id);


--
-- Name: purchase_receipt_lines purchase_receipt_lines_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipt_lines
    ADD CONSTRAINT purchase_receipt_lines_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.purchase_receipts(id) ON DELETE CASCADE;


--
-- Name: purchase_receipts purchase_receipts_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipts
    ADD CONSTRAINT purchase_receipts_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: purchase_receipts purchase_receipts_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_receipts
    ADD CONSTRAINT purchase_receipts_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id);


--
-- Name: raw_materials raw_materials_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_materials
    ADD CONSTRAINT raw_materials_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: reviews reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sales_invoices sales_invoices_credit_note_for_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_credit_note_for_fkey FOREIGN KEY (credit_note_for) REFERENCES public.sales_invoices(id);


--
-- Name: sales_invoices sales_invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: stock_movements stock_movements_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: stock_movements stock_movements_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: treasury_movements treasury_movements_pos_session_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_movements
    ADD CONSTRAINT treasury_movements_pos_session_fk FOREIGN KEY (pos_session_id) REFERENCES public.pos_sessions(id) ON DELETE SET NULL;


--
-- Name: user_favorites user_favorites_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: user_favorites user_favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_spend; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: back_office_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.back_office_users ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_statement_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: bill_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: bills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

--
-- Name: business_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: cart_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

--
-- Name: carts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: cod_remittances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cod_remittances ENABLE ROW LEVEL SECURITY;

--
-- Name: collections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

--
-- Name: colors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;

--
-- Name: country_tax_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.country_tax_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: document_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: erp_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.erp_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: hero_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hero_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_levels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: landing_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.landing_products ENABLE ROW LEVEL SECURITY;

--
-- Name: locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

--
-- Name: material_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: product_bom; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_bom ENABLE ROW LEVEL SECURITY;

--
-- Name: product_costing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_costing ENABLE ROW LEVEL SECURITY;

--
-- Name: product_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: product_discounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_discounts ENABLE ROW LEVEL SECURITY;

--
-- Name: product_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_order_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_receipt_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_receipt_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_materials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;

--
-- Name: reels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: site_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: sizes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sizes ENABLE ROW LEVEL SECURITY;

--
-- Name: small_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.small_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: treasury_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: user_favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: user_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


