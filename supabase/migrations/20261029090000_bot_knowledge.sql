-- The support bot's knowledge base (docs/SUPPORT-BOT.md, api/src/assistant/knowledge.ts): Q&A and
-- documents the team writes in Admin → Support bot → Knowledge. Each is cut into chunks; for each
-- customer message the bot gets only the few chunks that match (by words here, by meaning with
-- the embeddings), instead of the whole knowledge in every prompt.

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'faq' check (kind in ('faq', 'doc')),
  -- The question (faq) or the document's title.
  title text not null check (length(trim(title)) > 0),
  -- Our answer (faq) or the document's text.
  content text not null check (length(trim(content)) > 0),
  language text check (language in ('darija', 'ar', 'fr', 'en')),
  active boolean not null default true,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index knowledge_entries_live_idx on public.knowledge_entries (updated_at desc) where deleted_at is null;

create trigger prevent_hard_delete before delete on public.knowledge_entries
  for each row execute function private.prevent_hard_delete();
create trigger log_activity after insert or update on public.knowledge_entries
  for each row execute function private.log_activity();
create trigger set_updated_at before update on public.knowledge_entries
  for each row execute function private.set_updated_at();

-- A search index derived from the entries, like inventory_levels from stock movements: only
-- save_knowledge_entry writes it, replacing an entry's chunks when the entry changes, so it has
-- no soft delete and no activity log of its own.
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  position integer not null,
  content text not null,
  -- normalize_search_text(title + content): the word search.
  search_text text not null,
  -- The meaning (Voyage AI); null when VOYAGE_API_KEY isn't set or the call failed.
  embedding real[],
  embedding_model text
);

create index knowledge_chunks_entry_idx on public.knowledge_chunks (entry_id, position);
create index knowledge_chunks_search_idx on public.knowledge_chunks using gin (search_text extensions.gin_trgm_ops);

alter table public.knowledge_entries enable row level security;
alter table public.knowledge_chunks enable row level security;

-- Saves an entry (new when p_id is null) and replaces its chunks, in one transaction.
-- p_entry: {kind, title, content, language, active}; p_chunks: [{content, embedding, model}].
create function public.save_knowledge_entry(
  p_id uuid, p_entry jsonb, p_chunks jsonb, p_actor uuid default null, p_actor_email text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_entry uuid;
  chunk jsonb;
  pos integer := 0;
begin
  if p_id is null then
    insert into public.knowledge_entries (kind, title, content, language, active, created_by, created_by_email)
    values (coalesce(p_entry->>'kind', 'faq'), p_entry->>'title', p_entry->>'content',
            nullif(p_entry->>'language', ''), coalesce((p_entry->>'active')::boolean, true), p_actor, p_actor_email)
    returning id into v_entry;
  else
    update public.knowledge_entries
       set kind = coalesce(p_entry->>'kind', kind),
           title = coalesce(p_entry->>'title', title),
           content = coalesce(p_entry->>'content', content),
           language = case when p_entry ? 'language' then nullif(p_entry->>'language', '') else language end,
           active = coalesce((p_entry->>'active')::boolean, active)
     where id = p_id and deleted_at is null
    returning id into v_entry;
    if v_entry is null then
      raise exception 'knowledge_entry_not_found';
    end if;
    delete from public.knowledge_chunks c where c.entry_id = v_entry;
  end if;

  for chunk in select * from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) loop
    insert into public.knowledge_chunks (entry_id, position, content, search_text, embedding, embedding_model)
    select v_entry, pos, chunk->>'content',
           public.normalize_search_text(concat_ws(' ', e.title, chunk->>'content')),
           case when jsonb_typeof(chunk->'embedding') = 'array'
                then array(select jsonb_array_elements_text(chunk->'embedding')::real) end,
           nullif(chunk->>'model', '')
      from public.knowledge_entries e where e.id = v_entry;
    pos := pos + 1;
  end loop;
  return v_entry;
end;
$$;

revoke all on function public.save_knowledge_entry(uuid, jsonb, jsonb, uuid, text) from public;
