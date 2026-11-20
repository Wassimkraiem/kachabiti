-- Only some products are made to order ("sur commande"): when a tracked product without this flag
-- runs out, the shop shows it out of stock and checkout refuses it.
alter table public.products add column if not exists made_to_order boolean not null default false;
comment on column public.products.made_to_order is 'Orderable without stock (made to order). Off: a tracked product at zero stock is out of stock.';

-- The kachabiya zemniya (260 TND), the demi zemniya (189 TND) and the burnous (380 TND).
-- shortcut: matched by slug and price; fix any miss with the product form's "Made to order" switch.
update public.products
   set made_to_order = true
 where deleted_at is null
   and ((slug ilike '%zemnia%' and base_price in (260, 189))
     or (slug ilike '%burnous%' and base_price = 380));
