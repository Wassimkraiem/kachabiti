-- A customer assigned to an agent wrote: their own notification (assigned_message: its own sound and
-- look in the messages icon). Others' customers as before (customer_message to the customers team).

create or replace function private.notify_customer_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  vals jsonb;
begin
  if new.direction <> 'in' or new.created_at < now() - interval '1 hour' then
    return null;
  end if;
  select * into c from public.customers where id = new.customer_id;
  vals := jsonb_build_object('name', coalesce(nullif(c.full_name, ''), new.sender_name, c.phone, '?'), 'channel', initcap(new.channel),
                             'text', left(new.body, 120));
  if c.assigned_to is not null then
    perform private.notify(
      array[c.assigned_to],
      'order', 'assigned_message', 'info',
      private.i18n('{name}, your customer, replied on {channel}', '{name}, votre client, a répondu sur {channel}', 'عميلك {name} ردّ على {channel}', vals),
      private.i18n('{text}', '{text}', '{text}', vals),
      '/admin/customers/inbox?tab=mine',
      jsonb_build_object('customer_id', new.customer_id)
    );
  else
    perform private.notify(
      private.notification_recipients('customers'),
      'order', 'customer_message', 'info',
      private.i18n('{channel} message from {name}', 'Message {channel} de {name}', 'رسالة {channel} من {name}', vals),
      private.i18n('{text}', '{text}', '{text}', vals),
      '/admin/customers/' || new.customer_id,
      jsonb_build_object('customer_id', new.customer_id)
    );
  end if;
  return null;
end;
$$;
