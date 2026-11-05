-- Team tasks: comments and images. A comment holds text, one image, or both; images live in the
-- private documents bucket, because team screenshots can show customers' details.
-- Deleted items: the owner can bring rows back with restore_deleted(), and team tasks are listed.

create table public.team_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.team_tickets (id) on delete cascade,
  body text not null default '',
  image_path text,
  author_id uuid,
  author_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (length(trim(body)) > 0 or image_path is not null)
);

create index team_ticket_comments_ticket_idx on public.team_ticket_comments (ticket_id, created_at)
  where deleted_at is null;

alter table public.team_ticket_comments enable row level security;
create trigger set_updated_at before update on public.team_ticket_comments
  for each row execute function private.set_updated_at();
create trigger prevent_hard_delete before delete on public.team_ticket_comments
  for each row execute function private.prevent_hard_delete();
create trigger log_activity after insert or update on public.team_ticket_comments
  for each row execute function private.log_activity();

-- Tells the ticket's assignee and author, except the one who wrote the comment.
create or replace function private.notify_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  select title, assigned_to, created_by into k
    from public.team_tickets where id = new.ticket_id and deleted_at is null;
  if not found then
    return null;
  end if;
  perform private.notify(
    array(select r from unnest(array[k.assigned_to, k.created_by]) as r where r is distinct from new.author_id),
    'system', 'ticket_comment', 'info',
    private.i18n('New comment on: {title}', 'Nouveau commentaire sur : {title}', 'تعليق جديد على: {title}', jsonb_build_object('title', k.title)),
    private.i18n('{who}: {text}', '{who} : {text}', '{who}: {text}', jsonb_build_object(
      'who', coalesce(new.author_email, ''),
      'text', coalesce(nullif(left(trim(new.body), 120), ''), '📷'))),
    '/admin/tickets?id=' || new.ticket_id, '{}'::jsonb);
  return null;
end;
$$;

revoke all on function private.notify_ticket_comment() from public;

create trigger notify_ticket_comment after insert on public.team_ticket_comments
  for each row execute function private.notify_ticket_comment();

-- Team tasks join the tables Deleted items can erase (lib/trash-tables.ts).
create or replace function public.purge_deleted(p_table text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := private.trusted_request_headers();
  v_actor uuid;
  v_count integer;
begin
  if p_table not in (
    'products', 'product_variants', 'categories', 'colors', 'sizes', 'product_discounts',
    'promotions', 'reels', 'hero_sections', 'small_cards', 'orders', 'locations',
    'suppliers', 'collections', 'team_tickets'
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
$$;

-- Brings soft-deleted rows back (owners only, Admin → Deleted items). What was switched off stays
-- off: products return inactive, banners, reels and discounts inactive, and orders stay cancelled
-- with their stock already put back, so nothing reappears in the shop or moves stock by itself.
create or replace function public.restore_deleted(p_table text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_table not in (
    'products', 'product_variants', 'categories', 'colors', 'sizes', 'product_discounts',
    'promotions', 'reels', 'hero_sections', 'small_cards', 'orders', 'locations',
    'suppliers', 'collections', 'team_tickets'
  ) then
    raise exception 'restore_not_allowed: %', p_table using errcode = 'P0001';
  end if;

  -- A variant's photos were deleted with it, in the same transaction, so at the same moment.
  if p_table = 'product_variants' then
    update public.product_images i
       set deleted_at = null
      from public.product_variants v
     where i.variant_id = v.id and i.deleted_at = v.deleted_at and v.id = any (p_ids);
  end if;

  execute format(
    'update public.%I set deleted_at = null%s where id = any ($1) and deleted_at is not null',
    p_table,
    case p_table
      when 'products' then ', status = ''inactive'''
      when 'product_variants' then ', is_available = true'
      else ''
    end)
    using p_ids;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.restore_deleted(text, uuid[]) from public;

-- The name of comments in the activity log and owner alerts.
create or replace function private.entity_names(p_entity text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
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
    when 'team_tickets' then '{"en":"team task","fr":"tâche d''équipe","ar":"مهمة فريق"}'
    when 'team_ticket_comments' then '{"en":"team task comment","fr":"commentaire de tâche","ar":"تعليق على مهمة"}'
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
