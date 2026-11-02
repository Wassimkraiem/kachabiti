import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { generateOrderNumber } from '@shared/order-number';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, isManager, params, Zod, zId, zMoney } from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { Database } from '../db/database';
import { many, one } from '../db/embed';
import {
  activeDiscounts,
  buildManualOrderLines,
  ManualLineError,
} from '../sales/commerce';

/**
 * Port of app/api/pos (Admin → Point of sale) and lib/erp/catalog.ts. A till session per shop
 * location with a float; sales are "store" orders delivered on the spot (stock leaves the shop's
 * location); closing compares the counted cash with what should be there.
 */

const saleSchema = z.object({
  action: z.literal('sale'),
  session_id: zId,
  items: z
    .array(
      z.object({
        product_id: zId,
        variant_id: zId.nullish(),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(100),
  discount_amount: zMoney.default(0),
  customer: z
    .object({
      name: z.string().trim().max(150).default(''),
      phone: z
        .string()
        .trim()
        .regex(/^([24579]\d{7})?$/, 'Invalid Tunisian phone number')
        .default(''),
    })
    .default({ name: '', phone: '' }),
  payments: z
    .array(
      z.object({
        method: z.enum([
          'cash',
          'card',
          'bank_transfer',
          'check',
          'mobile',
          'other',
        ]),
        amount: z.number().positive().max(1_000_000),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(5),
  note: z.string().trim().max(500).optional(),
});
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('open'),
    location_id: zId,
    opening_float: zMoney.default(0),
  }),
  saleSchema,
  z.object({
    action: z.literal('cash'),
    session_id: zId,
    direction: z.enum(['in', 'out']),
    amount: z.number().positive().max(1_000_000),
    label: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal('close'),
    session_id: zId,
    counted_cash: zMoney,
    notes: z.string().trim().max(1000).optional(),
  }),
]);

type Image = {
  image_url: string;
  is_main: boolean;
  position: number;
  variant_id: string | null;
};

@Controller('pos')
@Public()
export class PosController {
  constructor(private readonly db: Database) {}

  private sessions() {
    return this.db
      .selectFrom('pos_sessions as s')
      .selectAll('s')
      .select((eb) =>
        one(
          eb,
          'locations as l',
          ['l.id', 'l.name'],
          'l.id',
          's.location_id',
        ).as('location'),
      )
      .where('s.deleted_at', 'is', null);
  }

  /**
   * ?catalog=1&location_id= — products with prices and shop stock. ?receipt= — a sale's receipt.
   * ?session_id= — one session. ?sessions=1 — history. Otherwise: open sessions and shop locations.
   */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    if (q.bool('catalog')) return this.sellable(q.get('location_id'));
    const receipt = q.get('receipt');
    if (receipt) return this.receipt(receipt);
    const sessionId = q.get('session_id');
    if (sessionId) return this.summary(sessionId);
    if (q.bool('sessions'))
      return this.sessions()
        .orderBy('s.opened_at', 'desc')
        .limit(q.int('limit', 100, 500))
        .execute();
    const [open, locations, settings] = await Promise.all([
      this.sessions().where('s.status', '=', 'open').execute(),
      this.db
        .selectFrom('locations')
        .select(['id', 'name', 'sells_online'])
        .where('deleted_at', 'is', null)
        .orderBy('name')
        .execute(),
      this.db
        .selectFrom('erp_settings')
        .select('value')
        .where('key', '=', 'pos')
        .executeTakeFirst(),
    ]);
    return { open_sessions: open, locations, settings: settings?.value ?? {} };
  }

  @Post()
  async post(
    @Body(new Zod(bodySchema)) body: z.infer<typeof bodySchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.action === 'open') {
      return this.db.withActor(actor, (trx) =>
        this.db.call(
          'open_pos_session',
          {
            p_location_id: body.location_id,
            p_opening_float: body.opening_float,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
    }
    if (body.action === 'cash') {
      const session = await this.db
        .selectFrom('pos_sessions')
        .select('status')
        .where('id', '=', body.session_id)
        .executeTakeFirst();
      if (session?.status !== 'open')
        throw new ApiError('This till session is closed. Open a new one.', 409);
      return this.db.withActor(actor, (trx) =>
        trx
          .insertInto('treasury_movements')
          .values({
            account: 'cash',
            direction: body.direction,
            amount: body.amount,
            category:
              body.direction === 'in' ? 'other_income' : 'other_expense',
            label: body.label,
            pos_session_id: body.session_id,
            created_by: actor.userId,
            created_by_email: actor.email,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    }
    if (body.action === 'close') {
      return this.db.withActor(actor, (trx) =>
        this.db.call(
          'close_pos_session',
          {
            p_session_id: body.session_id,
            p_counted: body.counted_cash,
            p_notes: body.notes ?? '',
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
    }
    return this.sale(body, actor);
  }

  // A sale: lines priced from the catalog, discount within the allowed limit, payments covering the total.
  private async sale(body: z.infer<typeof saleSchema>, actor: RequestActor) {
    let lines;
    try {
      lines = await buildManualOrderLines(this.db, body.items);
    } catch (error) {
      if (error instanceof ManualLineError)
        throw new ApiError(error.message, 422, 'INVALID_ITEMS');
      throw error;
    }
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
    if (body.discount_amount > subtotal)
      throw new ApiError('The discount is larger than the sale.');
    if (body.discount_amount > 0 && !isManager(actor)) {
      const pos = await this.db
        .selectFrom('erp_settings')
        .select('value')
        .where('key', '=', 'pos')
        .executeTakeFirst();
      const maxPercent = Number(
        (pos?.value as { max_discount_percent?: number } | null)
          ?.max_discount_percent ?? 10,
      );
      if (body.discount_amount > (subtotal * maxPercent) / 100 + 0.0005) {
        throw new ApiError(
          `Discounts above ${maxPercent}% need an owner or admin.`,
          403,
          'DISCOUNT_LIMIT',
        );
      }
    }
    const total = Math.round((subtotal - body.discount_amount) * 1000) / 1000;
    // Cash given beyond the total is change handed back: only what the sale costs is recorded.
    let remaining = total;
    const payments = body.payments
      .map((p) => {
        const amount =
          p.method === 'cash'
            ? Math.min(p.amount, Math.max(remaining, 0))
            : p.amount;
        remaining -= amount;
        return { ...p, amount };
      })
      .filter((p) => p.amount > 0);
    if (remaining > 0.0005)
      throw new ApiError(
        'The payments do not cover the total.',
        409,
        'PAYMENT_SHORT',
      );
    if (remaining < -0.0005)
      throw new ApiError(
        'Card and transfer payments cannot be more than the total.',
        409,
      );

    const [firstName, ...rest] = (
      body.customer.name || 'Walk-in customer'
    ).split(/\s+/);
    const result = await this.db.withActor(actor, (trx) =>
      this.db.call<{
        order: { id: string; order_number: string; total: number };
      }>(
        'create_pos_sale',
        {
          p_session_id: body.session_id,
          p_order: {
            order_number: generateOrderNumber(),
            customer_first_name: firstName,
            customer_last_name: rest.join(' '),
            customer_phone: body.customer.phone,
            subtotal,
            shipping_cost: 0,
            total,
            discount_amount: body.discount_amount,
            order_notes: body.note ?? '',
          },
          p_items: lines,
          p_payments: payments,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
    await invalidateCatalog();
    const tendered = body.payments
      .filter((p) => p.method === 'cash')
      .reduce((s, p) => s + p.amount, 0);
    const cashKept = payments
      .filter((p) => p.method === 'cash')
      .reduce((s, p) => s + p.amount, 0);
    return {
      order: result.order,
      change: Math.max(0, Math.round((tendered - cashKept) * 1000) / 1000),
    };
  }

  private async summary(sessionId: string) {
    const [session, sales, payments, movements, expected] = await Promise.all([
      this.sessions().where('s.id', '=', sessionId).executeTakeFirst(),
      this.db
        .selectFrom('orders as o')
        .select([
          'o.id',
          'o.order_number',
          'o.total',
          'o.discount_amount',
          'o.created_at',
          'o.customer_first_name',
          'o.customer_last_name',
          'o.status',
        ])
        .select((eb) =>
          many(
            eb,
            'order_items as i',
            ['i.product_name', 'i.variant_label', 'i.quantity', 'i.price'],
            'i.order_id',
            'o.id',
          ).as('items'),
        )
        .where('o.pos_session_id', '=', sessionId)
        .where('o.deleted_at', 'is', null)
        .orderBy('o.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('order_payments')
        .select(['amount', 'method', 'account'])
        .where('pos_session_id', '=', sessionId)
        .where('deleted_at', 'is', null)
        .execute(),
      this.db
        .selectFrom('treasury_movements')
        .select([
          'id',
          'direction',
          'amount',
          'category',
          'label',
          'created_at',
          'created_by_email',
        ])
        .where('pos_session_id', '=', sessionId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at')
        .execute(),
      this.db.call<number>('pos_expected_cash', { p_session_id: sessionId }),
    ]);
    if (!session)
      throw new ApiError('This till session no longer exists.', 404);
    const byMethod: Record<string, number> = {};
    for (const p of payments)
      byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
    return {
      session,
      sales,
      movements,
      totals: {
        sales: sales
          .filter((o) => o.status === 'delivered')
          .reduce((s, o) => s + Number(o.total), 0),
        count: sales.length,
        discounts: sales.reduce((s, o) => s + Number(o.discount_amount), 0),
        by_method: byMethod,
        expected_cash: Number(expected ?? 0),
      },
    };
  }

  // A till sale's receipt (items, payments and the shop's details).
  private async receipt(orderId: string) {
    const [order, payments, settings] = await Promise.all([
      this.db
        .selectFrom('orders as o')
        .select([
          'o.id',
          'o.order_number',
          'o.created_at',
          'o.subtotal',
          'o.discount_amount',
          'o.total',
          'o.customer_first_name',
          'o.customer_last_name',
          'o.customer_phone',
          'o.created_by_email',
          'o.channel',
        ])
        .select((eb) => [
          one(
            eb,
            'pos_sessions as s',
            ['s.number'],
            's.id',
            'o.pos_session_id',
            (q) =>
              q.select((eb2: any) =>
                one(
                  eb2,
                  'locations as l',
                  ['l.name'],
                  'l.id',
                  's.location_id',
                ).as('location'),
              ),
          ).as('pos_session'),
          many(
            eb,
            'order_items as i',
            [
              'i.product_name',
              'i.variant_label',
              'i.quantity',
              'i.price',
              'i.subtotal',
            ],
            'i.order_id',
            'o.id',
          ).as('items'),
        ])
        .where('o.id', '=', orderId)
        .where('o.channel', '=', 'store')
        .where('o.deleted_at', 'is', null)
        .executeTakeFirst(),
      this.db
        .selectFrom('order_payments')
        .select(['amount', 'method'])
        .where('order_id', '=', orderId)
        .where('deleted_at', 'is', null)
        .execute(),
      this.db
        .selectFrom('erp_settings')
        .select('value')
        .where('key', '=', 'accounting')
        .executeTakeFirst(),
    ]);
    if (!order) throw new ApiError('This sale no longer exists.', 404);
    return {
      ...order,
      payments,
      company: (settings?.value as { company?: unknown } | null)?.company ?? {},
    };
  }

  /**
   * Every live product variant with its selling price (round(variant or base price × (1 −
   * discount%)), like the shop) and its stock at one location.
   */
  private async sellable(locationId: string | null) {
    const [products, variants, levels] = await Promise.all([
      this.db
        .selectFrom('products as p')
        .select(['p.id', 'p.name', 'p.code', 'p.base_price', 'p.stock_tracked'])
        .select((eb) =>
          many(
            eb,
            'product_images as i',
            ['i.image_url', 'i.is_main', 'i.position', 'i.variant_id'],
            'i.product_id',
            'p.id',
            (q) => q.where('i.deleted_at', 'is', null),
          ).as('product_images'),
        )
        .where('p.deleted_at', 'is', null)
        .where('p.status', '=', 'active')
        .execute(),
      this.db
        .selectFrom('product_variants as v')
        .select(['v.id', 'v.product_id', 'v.sku', 'v.price'])
        .select((eb) => [
          one(
            eb,
            'colors as c',
            ['c.name', 'c.display_name'],
            'c.id',
            'v.color_id',
          ).as('colors'),
          one(eb, 'sizes as z', ['z.name'], 'z.id', 'v.size_id').as('sizes'),
        ])
        .where('v.deleted_at', 'is', null)
        .where('v.is_available', 'is not', false)
        .execute(),
      locationId
        ? this.db
            .selectFrom('inventory_levels')
            .select(['variant_id', 'available'])
            .where('location_id', '=', locationId)
            .execute()
        : Promise.resolve([]),
    ]);
    const stock = new Map(levels.map((l) => [l.variant_id, l.available]));
    const discounts = await activeDiscounts(
      this.db,
      products.map((p) => p.id),
    );
    const byProduct = new Map<string, typeof variants>();
    for (const v of variants)
      byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);

    const out: Record<string, unknown>[] = [];
    for (const p of products) {
      const images = p.product_images as Image[];
      const firstOf = (list: Image[]) =>
        list.find((i) => i.is_main)?.image_url ||
        [...list].sort((a, b) => a.position - b.position)[0]?.image_url ||
        null;
      const discount = Number(discounts.get(p.id)?.discount_percent ?? 0);
      const priced = (base: number) =>
        Math.round(
          discount > 0 && discount <= 100 ? base * (1 - discount / 100) : base,
        );
      const list = byProduct.get(p.id) ?? [];
      if (!list.length) {
        out.push({
          product_id: p.id,
          variant_id: null,
          name: p.name,
          label: '',
          sku: null,
          code: p.code,
          price: priced(Number(p.base_price)),
          base_price: Number(p.base_price),
          discount_percent: discount,
          image: firstOf(images.filter((i) => !i.variant_id)),
          tracked: p.stock_tracked,
          stock: null,
        });
        continue;
      }
      for (const v of list) {
        const colors = v.colors as {
          name: string;
          display_name: string | null;
        } | null;
        const sizes = v.sizes as { name: string } | null;
        const base = v.price != null ? Number(v.price) : Number(p.base_price);
        out.push({
          product_id: p.id,
          variant_id: v.id,
          name: p.name,
          label: [colors?.display_name || colors?.name, sizes?.name]
            .filter(Boolean)
            .join(' / '),
          sku: v.sku,
          code: p.code,
          price: priced(base),
          base_price: base,
          discount_percent: discount,
          image:
            firstOf(images.filter((i) => i.variant_id === v.id)) ||
            firstOf(images.filter((i) => !i.variant_id)),
          tracked: p.stock_tracked,
          stock: p.stock_tracked ? (stock.get(v.id) ?? 0) : null,
        });
      }
    }
    return out.sort(
      (a, b) =>
        String(a.name).localeCompare(String(b.name)) ||
        String(a.label).localeCompare(String(b.label)),
    );
  }
}
