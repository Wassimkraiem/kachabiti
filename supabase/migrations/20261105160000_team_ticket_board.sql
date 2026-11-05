-- The board: each task has a short number (T-12) and a place in its column. New tasks go last;
-- dragging a task sets a position between its new neighbours.

alter table public.team_tickets
  add column ticket_number integer generated always as identity,
  add column position double precision not null default extract(epoch from now());

update public.team_tickets set position = extract(epoch from created_at);
