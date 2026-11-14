-- The account sync saved status changes with the sync's own time, so parcels delivered weeks ago
-- (mostly the old tools' imports) counted as delivered on the day of the sync (12–13 Nov 2026).
-- Colissimo's account list gives each delivered parcel's real delivery date: this puts it back
-- everywhere that date was copied, and only where the day differs:
--   the parcel (status_changed_at), its delivered order (delivered_at), the carrier payment
--   recorded on delivery (received_at), and their draft journal entries. A draft that falls
--   before the accounting start date is removed, as it would never have been booked; posted
--   entries are left as they are.
-- The sync calls it on every run, so earlier runs are repaired by the next one.
create or replace function public.redate_deliveries(p_parcels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_date date := nullif(private.accounting_settings()->>'start_date', '')::date;
  n_parcels integer;
  n_orders integer;
  n_payments integer;
  n_entries integer;
  n_dropped integer;
begin
  -- p_parcels: [{ barcode, at }], at = Colissimo's delivery date, Tunis time ('YYYY-MM-DD[ HH:MM]').
  create temp table if not exists redate_parcels (delivery_id uuid, order_id uuid, barcode text, at timestamptz) on commit drop;
  truncate redate_parcels;
  insert into redate_parcels
  select d.id, d.order_id, d.barcode, (r.at::timestamp at time zone 'Africa/Tunis')
    from jsonb_to_recordset(p_parcels) as r (barcode text, at text)
    join public.deliveries d on d.barcode = r.barcode and d.deleted_at is null
   where r.at ~ '^\d{4}-\d{2}-\d{2}';

  update public.deliveries d
     set status_changed_at = x.at
    from redate_parcels x
   where d.id = x.delivery_id
     and (d.status_changed_at at time zone 'Africa/Tunis')::date is distinct from (x.at at time zone 'Africa/Tunis')::date;
  get diagnostics n_parcels = row_count;

  update public.orders o
     set delivered_at = x.at
    from redate_parcels x
   where o.id = x.order_id and o.status = 'delivered' and o.deleted_at is null
     and (o.delivered_at at time zone 'Africa/Tunis')::date is distinct from (x.at at time zone 'Africa/Tunis')::date;
  get diagnostics n_orders = row_count;

  update public.order_payments p
     set received_at = x.at
    from redate_parcels x
   where p.order_id = x.order_id and p.account = 'carrier' and p.reference = x.barcode and p.deleted_at is null
     and (p.received_at at time zone 'Africa/Tunis')::date is distinct from (x.at at time zone 'Africa/Tunis')::date;
  get diagnostics n_payments = row_count;

  -- Draft entries of those sales and carrier payments, at the corrected date.
  create temp table if not exists redate_entries (entry_id uuid, day date) on commit drop;
  truncate redate_entries;
  insert into redate_entries
  select e.id, (x.at at time zone 'Africa/Tunis')::date
    from redate_parcels x
    join public.journal_entries e on e.source_type = 'order' and e.source_id = x.order_id and e.source_event = 'delivered'
   where e.status = 'draft' and e.deleted_at is null
  union all
  select e.id, (x.at at time zone 'Africa/Tunis')::date
    from redate_parcels x
    join public.order_payments p on p.order_id = x.order_id and p.account = 'carrier' and p.reference = x.barcode and p.deleted_at is null
    join public.journal_entries e on e.source_type = 'order_payment' and e.source_id = p.id and e.source_event = 'received'
   where e.status = 'draft' and e.deleted_at is null;

  update public.journal_entries e
     set deleted_at = now(), updated_at = now()
    from redate_entries r
   where e.id = r.entry_id and start_date is not null and r.day < start_date;
  get diagnostics n_dropped = row_count;

  update public.journal_entries e
     set entry_date = r.day, updated_at = now()
    from redate_entries r
   where e.id = r.entry_id and e.deleted_at is null and e.entry_date <> r.day;
  get diagnostics n_entries = row_count;

  return jsonb_build_object('parcels', n_parcels, 'orders', n_orders, 'payments', n_payments,
                            'entries', n_entries, 'entries_removed', n_dropped);
end;
$$;

revoke all on function public.redate_deliveries(jsonb) from public;
