-- An order can be an exchange: Colissimo delivers it and takes items back from the customer.
-- Set in Admin → New order, sent to Colissimo when the order is validated (parcelFromOrder()).
-- { "article": "what to take back", "count": how many }; null for an ordinary order.
alter table public.orders add column if not exists exchange jsonb;

comment on column public.orders.exchange is
  'Exchange to collect on delivery: { article, count }; null for an ordinary order.';
