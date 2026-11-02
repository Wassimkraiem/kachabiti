-- Phase 3 of the NestJS migration: accounts live in public.users, sessions and password resets
-- are NestJS's own, and nothing points at auth.users any more (docs/MIGRATION-NESTJS.md).

-- 1. The profile table becomes the account table. app_metadata keeps Supabase's shape
--    ({ role, permissions }) so lib/admin-auth.ts reads it unchanged.
alter table public.users
  add column if not exists email text,
  add column if not exists password_hash text,
  add column if not exists app_metadata jsonb not null default '{}'::jsonb,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  -- What the customer typed about themselves (full_name, phone, address, city, country).
  add column if not exists user_metadata jsonb not null default '{}'::jsonb,
  alter column id set default gen_random_uuid();

create unique index if not exists users_email_key on public.users (lower(email)) where deleted_at is null;

-- The public may still read names and avatars (reviews); never e-mails, hashes or roles.
revoke select on public.users from anon, authenticated;
grant select (id, name, avatar_url, created_at, updated_at) on public.users to anon, authenticated;

-- 2. Copy the Supabase Auth accounts (bcrypt hashes as they are, so nobody has to reset their
--    password). Re-run at the switch-over for accounts created in the meantime.
create or replace function private.copy_auth_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  copied integer;
begin
  insert into public.users (id, name, avatar_url, created_at)
  select u.id,
         nullif(left(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), 100), ''),
         nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
         u.created_at
    from auth.users u
  on conflict (id) do nothing;

  update public.users p
     set email = lower(u.email),
         password_hash = u.encrypted_password,
         app_metadata = coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'provider' - 'providers',
         email_confirmed_at = u.email_confirmed_at,
         last_sign_in_at = u.last_sign_in_at,
         user_metadata = coalesce(u.raw_user_meta_data, '{}'::jsonb)
                         - 'sub' - 'email' - 'email_verified' - 'phone_verified',
         deleted_at = coalesce(p.deleted_at, u.deleted_at)
    from auth.users u
   where u.id = p.id;
  get diagnostics copied = row_count;
  return copied;
end;
$$;
revoke all on function private.copy_auth_users() from public, anon, authenticated;

select private.copy_auth_users();

-- 3. Foreign keys point at public.users instead of auth.users (same ids, same on-delete rules).
alter table public.users drop constraint if exists users_id_fkey;
alter table public.carts drop constraint if exists carts_user_id_fkey,
  add constraint carts_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
alter table public.user_favorites drop constraint if exists user_favorites_user_id_fkey,
  add constraint user_favorites_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
alter table public.stock_movements drop constraint if exists stock_movements_created_by_fkey,
  add constraint stock_movements_created_by_fkey foreign key (created_by) references public.users (id);
alter table public.orders drop constraint if exists orders_user_id_fkey,
  add constraint orders_user_id_fkey foreign key (user_id) references public.users (id);
alter table public.landing_products drop constraint if exists landing_products_created_by_fkey,
  add constraint landing_products_created_by_fkey foreign key (created_by) references public.users (id);
alter table public.customers drop constraint if exists customers_user_id_fkey,
  add constraint customers_user_id_fkey foreign key (user_id) references public.users (id);

-- 4. Sessions: one row per signed-in browser, holding the hash of its refresh token.
create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index user_sessions_user_idx on public.user_sessions (user_id) where revoked_at is null;

-- 5. Single-use links sent by e-mail (confirm the address, reset the password), stored as hashes.
create table public.auth_tokens (
  token_hash text primary key,
  user_id uuid not null references public.users (id),
  purpose text not null check (purpose in ('confirm', 'reset')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- 6. Notification recipients: live accounts are public.users now.
create or replace function private.notification_recipients(p_audience text)
 returns uuid[]
 language sql
 stable security definer
 set search_path to ''
as $function$
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
$function$;

-- NestJS only (it connects directly); nothing for the public API.
alter table public.user_sessions enable row level security;
alter table public.auth_tokens enable row level security;
revoke all on public.user_sessions, public.auth_tokens from anon, authenticated;
