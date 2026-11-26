-- Meta ads (Admin → Marketing → Meta ads, api/src/social/meta-ads.controller.ts): the ad account read
-- with the token of the person who connected (ads_read), and which ad each conversation came from.

alter table public.meta_connection
  add column if not exists user_token_encrypted text,   -- sealed by the API, like token_encrypted
  add column if not exists ad_account_id text,          -- act_…
  add column if not exists ad_account_name text,
  add column if not exists ad_currency text;

-- Meta's referral when someone writes after clicking an ad (Click to Messenger / Instagram Direct).
create table if not exists public.ad_referrals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel text not null check (channel in ('facebook', 'instagram')),
  ad_id text not null,
  source text,
  ref text,
  ad_title text,
  external_id text not null,          -- the message id, or sender:time for a referral without one
  referred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (channel, external_id)
);

create index if not exists ad_referrals_period on public.ad_referrals (referred_at) where deleted_at is null;
create index if not exists ad_referrals_customer on public.ad_referrals (customer_id);
alter table public.ad_referrals enable row level security;

create trigger prevent_hard_delete before delete on public.ad_referrals
  for each row execute function private.prevent_hard_delete();
create trigger set_updated_at before update on public.ad_referrals
  for each row execute function private.set_updated_at();

-- Merging two customers moves their ad referrals too.
create or replace function public.merge_customers(p_keep uuid, p_remove uuid)
returns public.customers
language plpgsql
set search_path = ''
as $$
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
  update public.ad_referrals set customer_id = p_keep where customer_id = p_remove;
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
