-- Parcels from the tools used before this system (scripts/import/old-colissimo.mjs) that stopped
-- mid-way (to be picked up, at the depot, out for delivery) and that Colissimo's account no longer
-- lists: nobody can say what became of them, so they get a final status of their own,
-- OLD-ORDERS-UNKNOWN (lib/colissimo-data.ts), and tracking leaves them alone. Their orders are
-- left as they are. Runs after the account sync has set in_colissimo; before it (all true) it
-- changes nothing, and running it again later catches the rest.
update public.deliveries
   set status = 'OLD-ORDERS-UNKNOWN',
       status_changed_at = now(),
       updated_at = now()
 where deleted_at is null
   and not in_colissimo
   and label_url is null
   and status in ('A enlever', 'Au depot', 'En cours');
