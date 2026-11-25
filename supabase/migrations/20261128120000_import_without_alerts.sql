-- Conversations imported from Meta (api/src/crm/meta-import.ts): only recent messages notify the team.

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
  perform private.notify(
    case when c.assigned_to is not null then array[c.assigned_to] else private.notification_recipients('customers') end,
    'order', 'customer_message', 'info',
    private.i18n('{channel} message from {name}', 'Message {channel} de {name}', 'رسالة {channel} من {name}', vals),
    private.i18n('{text}', '{text}', '{text}', vals),
    '/admin/customers/' || new.customer_id,
    jsonb_build_object('customer_id', new.customer_id)
  );
  return null;
end;
$$;
