-- Team tasks: the back office's own board (Admin → Team tasks), for work between colleagues.
-- Customer follow-ups stay in crm_tasks, which only the customers team can open.

create table public.team_tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  assigned_to uuid,
  assigned_to_email text,
  done_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index team_tickets_open_idx on public.team_tickets (assigned_to, due_date)
  where status <> 'done' and deleted_at is null;

alter table public.team_tickets enable row level security;
create trigger set_updated_at before update on public.team_tickets
  for each row execute function private.set_updated_at();
create trigger prevent_hard_delete before delete on public.team_tickets
  for each row execute function private.prevent_hard_delete();
create trigger log_activity after insert or update on public.team_tickets
  for each row execute function private.log_activity();

-- Tells a person a ticket is now theirs, unless they took it themselves.
create or replace function private.notify_ticket_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor jsonb := private.request_actor();
begin
  if new.assigned_to is null or new.deleted_at is not null
     or (tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to)
     or new.assigned_to::text = actor->>'id' then
    return null;
  end if;
  perform private.notify(array[new.assigned_to], 'system', 'ticket_assigned',
    case when new.priority = 'high' then 'warning' else 'info' end,
    private.i18n('New task: {title}', 'Nouvelle tâche : {title}', 'مهمة جديدة: {title}', jsonb_build_object('title', new.title)),
    private.i18n('From {who}', 'De la part de {who}', 'من {who}', jsonb_build_object('who', coalesce(actor->>'email', new.created_by_email, ''))),
    '/admin/tickets?id=' || new.id, '{}'::jsonb);
  return null;
end;
$$;

revoke all on function private.notify_ticket_assignee() from public;

create trigger notify_ticket_assignee after insert or update of assigned_to on public.team_tickets
  for each row execute function private.notify_ticket_assignee();

-- Overdue tickets join the morning alerts.
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

-- The name of tickets in the activity log and owner alerts.
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
