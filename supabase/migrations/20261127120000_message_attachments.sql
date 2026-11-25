-- Photos, audio and videos of Messenger and Instagram conversations (api/src/crm/meta-media.ts):
-- [{ type, path }] in the private `documents` bucket, or [{ type, url }] until copied from Meta.

alter table public.customer_interactions add column if not exists attachments jsonb;

-- As before, and the attachments too (the API deletes the files).
create or replace function public.anonymize_customer(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.orders where customer_id = p_id and deleted_at is null
               and status in ('pending', 'confirmed', 'processing', 'shipped')) then
    raise exception 'customer_has_open_orders';
  end if;
  update public.customers
     set phone = null, phone_alt = null, full_name = 'Anonymized', email = null, address = null,
         notes = null, external_ids = '{}'::jsonb, tags = '{}', anonymized_at = now()
   where id = p_id;
  update public.orders
     set customer_first_name = 'Anonymized', customer_last_name = '', customer_phone = '00000000',
         customer_email = null, shipping_address = null, order_notes = null
   where customer_id = p_id;
  update public.customer_interactions set body = '—', sender_name = null, attachments = null where customer_id = p_id;
end;
$$;
