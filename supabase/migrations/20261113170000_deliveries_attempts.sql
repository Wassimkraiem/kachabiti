-- Colissimo's delivery attempts per parcel ("Tentatives" on its dashboard pages), read by the
-- account sync every 5 minutes and shown in Admin → Delivery. Null until the sync has seen it.
alter table public.deliveries
  add column if not exists attempts integer;

-- The cards of Colissimo's dashboard that list the parcel (our status spellings, e.g.
-- {Livre paye,Echange}): its dashboard counts some parcels on two cards, so Admin → Delivery's
-- cards count this instead of the single status. Null or empty: the status alone.
alter table public.deliveries
  add column if not exists dashboard_cards text[];
