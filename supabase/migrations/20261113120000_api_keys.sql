-- API keys for outside systems (a developer, a customer-support agent): each acts as a staff member
-- with only the permissions chosen when it was made (lib/admin-auth.ts PERMISSIONS), through the
-- header x-api-key. Only the key's sha256 is kept: the key itself is shown once, at creation.
-- Made and revoked by admins in Admin → Team → API keys (/api/admin/team/api-keys).

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  prefix text not null,                 -- the key's first characters, to recognise it in the list
  key_hash text not null unique,        -- sha256 (hex) of the whole key
  permissions text[] not null default '{}',
  created_by uuid not null,             -- the admin who made it; its writes are recorded under them
  created_by_email text,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                -- revoked
);

alter table public.api_keys enable row level security;

create trigger prevent_hard_delete before delete on public.api_keys
  for each row execute function private.prevent_hard_delete();
create trigger set_updated_at before update on public.api_keys
  for each row execute function private.set_updated_at();
