-- Public comments on the shop's posts (Facebook Page, Instagram; TikTok once connected), received
-- by POST /api/webhooks/meta and listed in Admin → Customers → Comments. A comment that holds a
-- Tunisian phone number is a lead: its customer (by phone, created if new) gets a "call back" task
-- and the customers team is notified, in the same transaction as the comment.

create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok')),
  external_id text not null,
  post_id text,
  post_url text,
  author_id text,
  author_name text,
  body text not null default '',
  phone text,
  customer_id uuid references public.customers (id),
  task_id uuid references public.crm_tasks (id),
  commented_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid,
  handled_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (platform, external_id)
);

create index if not exists social_comments_list on public.social_comments (commented_at desc) where deleted_at is null;
alter table public.social_comments enable row level security;

create trigger prevent_hard_delete before delete on public.social_comments
  for each row execute function private.prevent_hard_delete();
create trigger set_updated_at before update on public.social_comments
  for each row execute function private.set_updated_at();

-- The first Tunisian number in a text (8 digits starting 2, 4, 5, 7 or 9; spaces, dots or dashes
-- between digits; +216 / 00216 / 216 in front; Arabic-Indic digits too), normalized, or null.
-- Digits glued to a longer number don't count (prices, order numbers).
create or replace function private.find_tunisian_phone(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.normalize_phone(m[1])
    from regexp_matches(
      translate(coalesce(p_text, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '(?<!\d)((?:(?:\+|00)?216[\s.-]*)?[24579](?:[\s.-]?\d){7})(?!\d)',
      'g'
    ) as m
   limit 1;
$$;

create or replace function private.social_comment_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_task uuid;
  vals jsonb;
begin
  new.phone := coalesce(public.normalize_phone(new.phone), private.find_tunisian_phone(new.body));
  if new.phone is null then
    return new;
  end if;

  select * into v_customer from public.customers where phone = new.phone and deleted_at is null;
  if not found then
    insert into public.customers (phone, full_name, channel, stage)
    values (new.phone, coalesce(new.author_name, ''), new.platform, 'interested')
    on conflict (phone) where deleted_at is null and phone is not null do nothing;
    select * into v_customer from public.customers where phone = new.phone and deleted_at is null;
  end if;
  new.customer_id := v_customer.id;

  -- One open call-back task per customer: a second comment with the same number doesn't add another.
  select id into v_task from public.crm_tasks
   where customer_id = v_customer.id and done_at is null and deleted_at is null
     and title like 'Call back:%'
   limit 1;
  if v_task is not null then
    new.task_id := v_task;
    return new;
  end if;

  insert into public.crm_tasks (customer_id, title, notes, due_at, assigned_to, assigned_to_email)
  values (v_customer.id,
          'Call back: phone number in a ' || initcap(new.platform) || ' comment',
          left(new.body, 1000), now(), v_customer.assigned_to, v_customer.assigned_to_email)
  returning id into new.task_id;

  vals := jsonb_build_object('name', coalesce(nullif(v_customer.full_name, ''), new.author_name, new.phone),
                             'channel', initcap(new.platform), 'phone', new.phone, 'text', left(new.body, 120));
  perform private.notify(
    case when v_customer.assigned_to is not null then array[v_customer.assigned_to] else private.notification_recipients('customers') end,
    'order', 'comment_phone', 'warning',
    private.i18n('Call {name}: phone number in a {channel} comment',
                 'Appeler {name} : numéro dans un commentaire {channel}',
                 'اتصل بـ {name}: رقم هاتف في تعليق {channel}', vals),
    private.i18n('{phone} · {text}', '{phone} · {text}', '{phone} · {text}', vals),
    '/admin/customers/comments',
    jsonb_build_object('customer_id', v_customer.id, 'task_id', new.task_id)
  );
  return new;
end;
$$;

revoke all on function private.social_comment_lead() from public;
revoke all on function private.find_tunisian_phone(text) from public;

create trigger social_comments_lead
  before insert on public.social_comments
  for each row execute function private.social_comment_lead();
