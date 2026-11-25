-- Posts scheduled on the connected Facebook Page and its Instagram account (Admin → Marketing → Post
-- calendar, /api/social/posts), published by api/src/social/post-publisher.ts.

create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,                -- the Page connected when it was scheduled: never posted to another
  caption text not null default '',
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  targets text[] not null check (cardinality(targets) > 0 and targets <@ array['facebook', 'instagram']),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'publishing', 'published', 'failed')),
  published jsonb not null default '{}', -- { facebook: id, instagram: id }: these are never sent again
  error text,
  claimed_at timestamptz,
  created_by uuid not null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((media_url is null) = (media_type is null))
);

create index if not exists scheduled_posts_calendar on public.scheduled_posts (scheduled_at) where deleted_at is null;
alter table public.scheduled_posts enable row level security;

create trigger prevent_hard_delete before delete on public.scheduled_posts
  for each row execute function private.prevent_hard_delete();
create trigger set_updated_at before update on public.scheduled_posts
  for each row execute function private.set_updated_at();
create trigger log_activity after insert or update on public.scheduled_posts
  for each row execute function private.log_activity();

-- Claims the posts that are due, and gives up on those interrupted half way: Meta may have received
-- them, so only a person sends them again.
create or replace function public.claim_due_posts()
returns setof public.scheduled_posts
language sql
security definer
set search_path = ''
as $$
  update public.scheduled_posts
     set status = 'failed', error = 'Interrupted while publishing. Check the Page before trying again.'
   where status = 'publishing' and claimed_at < now() - interval '20 minutes' and deleted_at is null;
  update public.scheduled_posts
     set status = 'publishing', claimed_at = now(), error = null
   where id in (select id from public.scheduled_posts
                 where status = 'scheduled' and scheduled_at <= now() and deleted_at is null
                 order by scheduled_at limit 1 for update skip locked)
  returning *;
$$;

-- Saves how it went, and tells the person who scheduled a post that failed.
create or replace function public.finish_post(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.scheduled_posts;
begin
  update public.scheduled_posts
     set status = case when p_error is null then 'published' else 'failed' end, error = p_error
   where id = p_id and status = 'publishing'
  returning * into p;
  if p.id is null or p_error is null then
    return;
  end if;
  perform private.notify(array[p.created_by], 'system', 'post_failed', 'warning',
    private.i18n('A scheduled post failed', 'Une publication programmée a échoué', 'فشل منشور مجدول', '{}'::jsonb),
    private.i18n('{text}', '{text}', '{text}', jsonb_build_object('text', left(p_error, 200))),
    '/admin/marketing/calendar', jsonb_build_object('post_id', p.id));
end;
$$;

revoke all on function public.claim_due_posts() from public;
revoke all on function public.finish_post(uuid, text) from public;
