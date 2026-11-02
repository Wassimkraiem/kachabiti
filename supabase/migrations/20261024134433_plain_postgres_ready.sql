-- Phase 5 of the NestJS migration: the schema no longer needs anything only Supabase has, so it
-- can be dumped and restored on plain Postgres (scripts/db/move-database.mjs). Applied at the
-- switch-over, after 20261023204053_own_auth_accounts has copied the accounts.

-- Browsers no longer reach the database (no PostgREST): NestJS connects as the tables' owner,
-- which RLS doesn't filter. The policies only granted the Supabase roles anon/authenticated, and
-- they would fail to restore where those roles don't exist. RLS stays enabled, so any other role
-- sees nothing.
do $$
declare
  p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname in ('public', 'private') loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

-- Supabase Auth leftovers: the profile sync on auth.users and the one-off account copy.
drop function if exists private.sync_user_profile() cascade;
drop function if exists private.copy_auth_users();
