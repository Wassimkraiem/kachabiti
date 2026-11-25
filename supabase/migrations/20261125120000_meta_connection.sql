-- The Facebook Page (and its Instagram account) connected with "Connect with Facebook" in
-- Admin → Customers → Inbox (/api/admin/meta). One row: one Page at a time. The token is encrypted by
-- the API (api/src/crm/meta-connection.ts); no activity-log trigger here, or it would be copied there.

create table if not exists public.meta_connection (
  id boolean primary key default true check (id),
  page_id text not null,
  page_name text not null,
  instagram_id text,
  instagram_username text,
  token_encrypted text not null,
  data_access_expires_at timestamptz,   -- after this Meta wants the person to connect again
  connected_by uuid not null,
  connected_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                -- disconnected (the token is emptied)
);

alter table public.meta_connection enable row level security;

create trigger prevent_hard_delete before delete on public.meta_connection
  for each row execute function private.prevent_hard_delete();
create trigger set_updated_at before update on public.meta_connection
  for each row execute function private.set_updated_at();
