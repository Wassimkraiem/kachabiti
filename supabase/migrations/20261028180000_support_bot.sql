-- Support bot (docs/SUPPORT-BOT.md): who is answering each customer, the lead label, media on
-- messages, one row per bot turn (tokens, cost, outcome), and the bot's settings.

alter table public.customers
  add column bot_status text not null default 'bot' check (bot_status in ('bot', 'human', 'off')),
  add column bot_handoff_reason text,
  add column bot_handoff_at timestamptz,
  add column bot_unclear_count integer not null default 0,
  add column lead_label text check (lead_label in ('interested', 'not_interested', 'gibberish'));

create index customers_waiting_agent_idx on public.customers (bot_handoff_at desc)
  where bot_status = 'human' and deleted_at is null;

alter table public.customer_interactions
  add column by_bot boolean not null default false,
  -- [{ type: image|audio|video|file, key: <documents bucket key>, mime, transcript? }]
  add column attachments jsonb not null default '[]'::jsonb;

create table public.assistant_runs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null,
  model text not null,
  prompt_version text not null,
  input_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  audio_seconds numeric(10, 1) not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer not null default 0,
  -- transcribed: a voice note turned into text (cost of the audio only, no reply).
  outcome text not null check (outcome in ('replied', 'handoff', 'error', 'transcribed')),
  handoff_reason text,
  reply text,
  tool_calls jsonb not null default '[]'::jsonb,
  error text,
  trace_id text,
  created_at timestamptz not null default now()
);

create index assistant_runs_created_idx on public.assistant_runs (created_at desc);
create index assistant_runs_customer_idx on public.assistant_runs (customer_id, created_at desc);

-- Only NestJS (the owner) reads it, like every table since the move off Supabase.
alter table public.assistant_runs enable row level security;

insert into public.erp_settings (key, value)
values ('assistant', jsonb_build_object(
  'enabled', false,
  'channels', jsonb_build_array('facebook'),
  'monthly_budget_usd', 20,
  'knowledge', '',
  'handoff_message', 'Merci 🙏 Nraj3oulek ba3d chwaya, wa7ed men l''équipe besh yjewbek.'
))
on conflict (key) do nothing;

-- Messages from customers notify agents only when no bot is answering them: the bot is off,
-- the channel isn't one it answers, or it handed the customer over (it notifies on hand-off).
create or replace function private.notify_customer_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  bot jsonb;
  vals jsonb;
begin
  if new.direction <> 'in' then
    return null;
  end if;
  select * into c from public.customers where id = new.customer_id;
  select value into bot from public.erp_settings where key = 'assistant';
  if c.bot_status = 'bot'
     and coalesce((bot ->> 'enabled')::boolean, false)
     and coalesce(bot -> 'channels', '[]'::jsonb) ? new.channel then
    return null;
  end if;
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

-- The bot handed a customer over: their agent, else the customers team (warning, so it stands out).
create or replace function public.notify_bot_handoff(p_customer_id uuid, p_reason text, p_summary text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  vals jsonb;
begin
  select * into c from public.customers where id = p_customer_id;
  if not found then
    return 0;
  end if;
  vals := jsonb_build_object('name', coalesce(nullif(c.full_name, ''), c.phone, '?'), 'reason', p_reason,
                             'text', left(coalesce(p_summary, ''), 160));
  return private.notify(
    case when c.assigned_to is not null then array[c.assigned_to] else private.notification_recipients('customers') end,
    'order', 'bot_handoff', 'warning',
    private.i18n('The bot needs an agent for {name} ({reason})', 'Le bot a besoin d''un agent pour {name} ({reason})',
                 'المساعد يحتاج موظفاً لـ {name} ({reason})', vals),
    private.i18n('{text}', '{text}', '{text}', vals),
    '/admin/customers/' || p_customer_id,
    jsonb_build_object('customer_id', p_customer_id, 'reason', p_reason)
  );
end;
$$;

-- Budget alerts for the owners at 80% / 100% of the month's budget (the caller sends each once a month).
create or replace function public.notify_bot_budget(p_spent numeric, p_budget numeric, p_percent integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.notify(
    private.notification_recipients('owner'),
    'system', 'bot_budget', case when p_percent >= 100 then 'critical' else 'warning' end,
    private.i18n('Support bot at {percent}% of its monthly budget', 'Bot support à {percent}% de son budget mensuel',
                 'المساعد بلغ {percent}% من ميزانيته الشهرية',
                 jsonb_build_object('percent', p_percent)),
    private.i18n('${spent} of ${budget} spent this month. The bot keeps answering.',
                 '${spent} sur ${budget} dépensés ce mois-ci. Le bot continue de répondre.',
                 'تم صرف ${spent} من ${budget} هذا الشهر. المساعد يواصل الرد.',
                 jsonb_build_object('spent', round(p_spent, 2), 'budget', p_budget)),
    '/admin/assistant',
    jsonb_build_object('percent', p_percent)
  );
$$;

revoke all on function public.notify_bot_handoff(uuid, text, text) from public;
revoke all on function public.notify_bot_budget(numeric, numeric, integer) from public;
