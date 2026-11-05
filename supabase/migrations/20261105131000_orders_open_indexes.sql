-- The two scans of the whole orders table left on My day and Objectives.
-- Orders still to confirm: the unassigned count on My day and the morning alert. Few rows, so this
-- index stays tiny however many orders are finished.
create index orders_to_confirm_idx on public.orders (created_at)
  where deleted_at is null and status in ('pending', 'confirmed');

-- Agents' monthly results read orders created, confirmed or delivered in the month. The other two
-- dates are already indexed, and the three only combine if all of them are.
create index orders_confirmed_at_idx on public.orders (confirmed_at) where confirmed_at is not null;
