-- Phase 4 of the NestJS migration: NestJS delivers notifications and runs the daily alerts
-- (docs/MIGRATION-NESTJS.md), instead of pg_net → the send-push Edge Function and pg_cron.

-- Every new or changed notification is announced on the `notifications` channel. NestJS
-- listens: it streams the row to the recipient's open admin tabs (SSE) and, for new rows,
-- sends Web Push. Delivered at commit, so rolled-back changes announce nothing.
create or replace function private.announce_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_notify('notifications', json_build_object('id', new.id, 'recipient_id', new.recipient_id, 'op', lower(tg_op))::text);
  return null;
end;
$$;
revoke all on function private.announce_notification() from public, anon, authenticated;

create trigger announce_notification after insert or update on public.notifications
  for each row execute function private.announce_notification();

drop trigger if exists dispatch_push on public.notifications;
drop function if exists private.dispatch_push();

-- The daily alerts are scheduled by NestJS (07:00 UTC), so plain Postgres needs no pg_cron.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kachabity-daily-alerts';
  end if;
end;
$$;
