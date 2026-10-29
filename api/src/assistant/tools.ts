import type Anthropic from '@anthropic-ai/sdk';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { z } from 'zod';
import { matchGovernorate } from '@shared/colissimo-data';
import { generateOrderNumber } from '@shared/order-number';
import { config } from '../config';
import { Database } from '../db/database';
import {
  activeDiscounts,
  buildManualOrderLines,
  calculateShipping,
  ManualLineError,
} from '../sales/commerce';

// The bot's tools (docs/SUPPORT-BOT.md). Catalog reads and order creation run here; the three
// control tools (set_label, mark_unclear, handoff) are handled by AssistantService. Tool results
// are JSON strings; errors are returned as text so the model can correct itself.

export const HANDOFF_REASONS = [
  'unknown',
  'unclear',
  'complaint',
  'refund',
  'wholesale',
  'human_requested',
] as const;
export const LABELS = ['interested', 'not_interested', 'gibberish'] as const;

// Order matters for caching: the tool list is part of the cached prefix, so keep it fixed.
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the live catalog (names, descriptions, categories in Arabic, French and English; typos tolerated). Use simple keywords, e.g. "kachabia grise", "burnous", "dengri marié". Returns up to 8 products with price (discount included), link and whether any variant is in stock.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_product',
    description:
      'Full details of one product: description, every variant (color, size) with its id, price and availability. Call it before quoting sizes or taking an order.',
    input_schema: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'shipping_info',
    description:
      'Delivery fee for an order of this products total (TND), and the free-shipping threshold.',
    input_schema: {
      type: 'object',
      properties: { products_total: { type: 'number' } },
      required: ['products_total'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'create_order',
    description:
      'Creates the order (cash on delivery) once the customer said yes to the summary. The team then calls the customer to confirm. Fails with a message if something is missing or wrong; fix it with the customer and try again.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        phone: {
          type: 'string',
          description: '8 digits, e.g. 55123456',
        },
        governorate: {
          type: 'string',
          description: 'Tunisian governorate, e.g. Tunis, Sfax, Nabeul',
        },
        city: { type: 'string' },
        address: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string' },
              variant_id: {
                type: ['string', 'null'],
                description: 'Required when the product has several variants',
              },
              quantity: { type: 'integer' },
            },
            required: ['product_id', 'variant_id', 'quantity'],
            additionalProperties: false,
          },
        },
        notes: {
          type: 'string',
          description: 'Anything the team should know (or empty)',
        },
        new_order_despite_open_one: {
          type: 'boolean',
          description:
            'true only after the customer confirmed this is a new order although they already have one in progress',
        },
      },
      required: [
        'first_name',
        'last_name',
        'phone',
        'governorate',
        'city',
        'address',
        'items',
        'notes',
        'new_order_despite_open_one',
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'set_label',
    description:
      'Labels the customer: interested, not_interested or gibberish.',
    input_schema: {
      type: 'object',
      properties: { label: { type: 'string', enum: [...LABELS] } },
      required: ['label'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'mark_unclear',
    description:
      "Call when you don't understand the customer's message, then ask one short clarifying question.",
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'handoff',
    description:
      'Hands the conversation to a human agent and stops you answering this customer. The customer gets the standard message. Do not write a reply after calling it.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: [...HANDOFF_REASONS] },
        summary: {
          type: 'string',
          description:
            'One or two sentences for the agent: what the customer wants and what is missing.',
        },
      },
      required: ['reason', 'summary'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const productLink = (slug: string) =>
  `${config.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/fr/products/${slug}`;

const discounted = (base: number, percent: number) =>
  Math.round(percent > 0 && percent <= 100 ? base * (1 - percent / 100) : base);

const inStock = (tracked: boolean, stock: number) => !tracked || stock > 0;

async function searchProducts(db: Database, query: string) {
  const hits = await db.call<{ product_id: string; rank: number }[]>(
    'search_products',
    { p_query: query, p_limit: 8 },
  );
  if (!hits.length) return { products: [], note: 'No product matches.' };
  const ids = hits.map((h) => h.product_id);
  const [rows, variants, discounts] = await Promise.all([
    db
      .selectFrom('products as p')
      .select([
        'p.id',
        'p.name',
        'p.name_fr',
        'p.name_ar',
        'p.slug',
        'p.base_price',
        'p.stock_tracked',
      ])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('categories as c')
            .select(['c.name'])
            .whereRef('c.id', '=', 'p.category_id'),
        ).as('category'),
      )
      .where('p.id', 'in', ids)
      .where('p.status', '=', 'active')
      .where('p.deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('product_variants')
      .select(['product_id', 'stock'])
      .where('product_id', 'in', ids)
      .where('deleted_at', 'is', null)
      .where('is_available', 'is not', false)
      .execute(),
    activeDiscounts(db, ids),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  return {
    products: rows
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((p) => {
        const percent = Number(discounts.get(p.id)?.discount_percent ?? 0);
        const own = variants.filter((v) => v.product_id === p.id);
        return {
          product_id: p.id,
          name: p.name_fr || p.name,
          name_ar: p.name_ar,
          category: p.category?.name ?? null,
          price_tnd: discounted(Number(p.base_price), percent),
          ...(percent > 0
            ? {
                price_before_discount_tnd: Number(p.base_price),
                discount_percent: percent,
              }
            : {}),
          available_now:
            !own.length ||
            own.some((v) => inStock(p.stock_tracked, Number(v.stock))),
          link: productLink(p.slug),
        };
      }),
  };
}

async function getProduct(db: Database, productId: string) {
  if (!z.uuid().safeParse(productId).success)
    return { error: 'Unknown product id' };
  const product = await db
    .selectFrom('products')
    .select([
      'id',
      'name',
      'name_fr',
      'name_ar',
      'slug',
      'base_price',
      'stock_tracked',
      'description_fr',
      'description',
      'product_details',
    ])
    .where('id', '=', productId)
    .where('status', '=', 'active')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) return { error: 'This product is not for sale (anymore).' };
  const [variants, discounts] = await Promise.all([
    db
      .selectFrom('product_variants as v')
      .leftJoin('colors as c', 'c.id', 'v.color_id')
      .leftJoin('sizes as s', 's.id', 'v.size_id')
      .select([
        'v.id',
        'v.price',
        'v.stock',
        'c.name as color',
        'c.display_name as color_display',
        's.name as size',
      ])
      .where('v.product_id', '=', productId)
      .where('v.deleted_at', 'is', null)
      .where('v.is_available', 'is not', false)
      .orderBy('s.sort_order')
      .execute(),
    activeDiscounts(db, [productId]),
  ]);
  const percent = Number(discounts.get(productId)?.discount_percent ?? 0);
  return {
    product_id: product.id,
    name: product.name_fr || product.name,
    name_ar: product.name_ar,
    link: productLink(product.slug),
    description: (product.description_fr || product.description || '').slice(
      0,
      1500,
    ),
    details: product.product_details ?? [],
    discount_percent: percent || undefined,
    variants: variants.map((v) => ({
      variant_id: v.id,
      color: v.color_display || v.color,
      size: v.size,
      price_tnd: discounted(
        v.price != null ? Number(v.price) : Number(product.base_price),
        percent,
      ),
      availability: inStock(product.stock_tracked, Number(v.stock))
        ? 'in stock'
        : 'made to order (takes longer)',
    })),
  };
}

const orderSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100),
  phone: z.string(),
  governorate: z.string(),
  city: z.string().trim().min(1).max(100),
  address: z.string().trim().min(3).max(250),
  items: z
    .array(
      z.object({
        product_id: z.uuid(),
        variant_id: z.uuid().nullable(),
        quantity: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(10),
  notes: z.string().max(1000),
  new_order_despite_open_one: z.boolean(),
});

async function createOrder(
  db: Database,
  input: unknown,
  ctx: { channel: string; customerId: string },
) {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: `Invalid order: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    };
  const body = parsed.data;
  const phone = body.phone.replace(/\D/g, '').replace(/^(00)?216/, '');
  if (!/^[24579]\d{7}$/.test(phone))
    return { error: 'The phone must be a Tunisian number of 8 digits.' };
  const governorate = matchGovernorate(body.governorate, body.city);
  if (!governorate)
    return { error: `Unknown governorate "${body.governorate}". Ask again.` };

  if (!body.new_order_despite_open_one) {
    const open = await db.callRows<{ order_number: string; status: string }>(
      'find_order_duplicates',
      { p_phone: phone, p_exclude: null, p_days: 30 },
    );
    if (open.length)
      return {
        error: `This phone already has an order in progress (${open.map((o) => `${o.order_number}: ${o.status}`).join(', ')}). Ask the customer whether this is a new, separate order.`,
      };
  }

  // The order trigger links orders to the customer with this phone, so this chat's record takes
  // the phone first. shortcut: when another record already has it, the order goes there and the
  // two records stay separate until an agent merges them (Admin → Customers → duplicates).
  const owner = await db
    .selectFrom('customers')
    .select('id')
    .where('phone', '=', phone)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!owner || owner.id === ctx.customerId)
    await db
      .updateTable('customers')
      .set({
        phone,
        full_name: `${body.first_name} ${body.last_name}`.trim(),
        governorate,
        city: body.city,
        address: body.address,
      })
      .where('id', '=', ctx.customerId)
      .execute();

  let lines;
  try {
    lines = await buildManualOrderLines(db, body.items);
  } catch (error) {
    if (error instanceof ManualLineError) return { error: error.message };
    throw error;
  }
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const shipping = (await calculateShipping(db, 'TN', subtotal)).cost;
  const total = subtotal + shipping;
  const created = await db.withActor(null, (trx) =>
    db.call<{ order: { id: string; order_number: string } }>(
      'create_order',
      {
        p_order: {
          order_number: generateOrderNumber(),
          customer_email: null,
          customer_first_name: body.first_name,
          customer_last_name: body.last_name,
          customer_phone: phone,
          shipping_address: body.address,
          shipping_city: body.city,
          shipping_state: governorate,
          shipping_country: 'Tunisia',
          subtotal,
          shipping_cost: shipping,
          total,
          order_notes: ['Commande prise par le bot support.', body.notes]
            .filter(Boolean)
            .join(' '),
          channel: ctx.channel,
          campaign_id: null,
          assigned_to: null,
          assigned_to_email: null,
          created_by: null,
          created_by_email: null,
          discount_amount: 0,
        },
        p_items: lines,
      },
      trx,
    ),
  );
  return {
    order_number: created.order.order_number,
    products_total_tnd: subtotal,
    delivery_tnd: shipping,
    total_tnd: total,
    lines: lines.map((l) => ({
      name: l.product_name,
      variant: l.variant_label,
      quantity: l.quantity,
      price_tnd: l.price,
    })),
  };
}

/** Runs a catalog/order tool. Unknown names and failures come back as { error }. */
export async function runTool(
  db: Database,
  name: string,
  input: Record<string, unknown>,
  ctx: { channel: string; customerId: string },
): Promise<unknown> {
  switch (name) {
    case 'search_products':
      return searchProducts(
        db,
        typeof input.query === 'string' ? input.query : '',
      );
    case 'get_product':
      return getProduct(
        db,
        typeof input.product_id === 'string' ? input.product_id : '',
      );
    case 'shipping_info': {
      const total = Math.max(0, Number(input.products_total) || 0);
      const info = await calculateShipping(db, 'TN', total);
      return {
        delivery_fee_tnd: info.cost,
        free: info.isFree,
        free_shipping_above_tnd: info.threshold,
      };
    }
    case 'create_order':
      return createOrder(db, input, ctx);
    default:
      return { error: `Unknown tool ${name}` };
  }
}
