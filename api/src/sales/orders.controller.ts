import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import * as Sentry from '@sentry/nestjs';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { z } from 'zod';
import { hasFullAccess } from '@shared/admin-auth';
import { COLISSIMO_GOVERNORATES } from '@shared/colissimo-data';
import { OPEN_ORDER_STATUSES } from '@shared/erp/constants';
import { sendOrderConfirmationEmail } from '@shared/order-confirmation-email';
import { generateOrderNumber } from '@shared/order-number';
import type { Order, OrderItem } from '@shared/order-types';
import { CurrentActor, CurrentUserId, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, Envelope, idsFrom, params, zDate, zId } from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { clientIp, rateLimit } from '../common/rate-limit';
import { Database } from '../db/database';
import { priceOrder } from './commerce';
import { ColissimoTracking } from './colissimo-tracking';

// Port of app/api/orders/route.ts: the public checkout (POST) and the admin order list, status
// changes and deletes (rules in lib/api-access.ts: `orders`).

const ORDER_SORTS = [
  'created_at',
  'order_number',
  'total',
  'status',
  'payment_status',
] as const;

const orderItemSchema = z.object({
  id: z.guid(),
  variantId: z.guid().optional().nullable(),
  name: z.string().optional(),
  name_ar: z.string().optional().nullable(),
  name_fr: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

const createOrderSchema = z.object({
  customerEmail: z.string().email().optional(),
  customerFirstName: z.string().trim().min(1),
  customerLastName: z.string().trim().min(1),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[24579]\d{7}$/, 'Invalid Tunisian phone number'),
  shippingAddress: z
    .string()
    .trim()
    .min(1, 'Shipping address is required')
    .max(200),
  shippingCity: z.string().trim().min(1, 'City is required').max(100),
  shippingState: z.enum(COLISSIMO_GOVERNORATES as [string, ...string[]], {
    message: 'Choose a governorate',
  }),
  shippingZip: z.string().optional(),
  shippingCountry: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  shippingCost: z.number().nonnegative(),
  total: z.number().nonnegative(),
  orderNotes: z.string().max(2000).optional(),
  // Where the shopper came from (lib/traffic-source.ts); anything else is dropped, not refused.
  trafficSource: z
    .string()
    .regex(/^[a-z0-9._-]{1,40}$/)
    .optional()
    .catch(undefined),
});

@Controller('orders')
@Public()
export class OrdersController {
  constructor(
    private readonly db: Database,
    private readonly tracking: ColissimoTracking,
  ) {}

  /**
   * A cancelled or deleted order's parcel is deleted at Colissimo first, while it's still waiting
   * for pickup. Colissimo's refusal (it already has the parcel) is reported and the order change goes
   * on; when Colissimo can't be reached the order change is refused, or the parcel would still leave.
   */
  private async cancelParcels(orderIds: string[], actor: RequestActor) {
    try {
      return await this.tracking.cancelForOrders(orderIds, actor);
    } catch (error) {
      Sentry.captureException(error, { tags: { area: 'colissimo-cancel' } });
      throw new ApiError(
        `The order's parcel couldn't be deleted at Colissimo, so nothing was changed: ${(error as Error).message}. Try again.`,
        502,
        'COLISSIMO_UNREACHABLE',
      );
    }
  }

  /** Public checkout. Amounts are re-priced on the server; the order is linked to a signed-in shopper. */
  @Post()
  async create(
    @Body() raw: unknown,
    @CurrentUserId() userId: string | null,
    @Req() request: Request,
  ) {
    // Each order notifies the team and opens a customer: cap floods from one address.
    rateLimit(`checkout-ip:${clientIp(request)}`, 20, 60 * 60_000);
    const parsed = createOrderSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError('Invalid order data');
    const data = parsed.data;

    const priced = await priceOrder(
      this.db,
      data.items,
      data.shippingCountry,
      data.total,
    );
    if (!priced.ok)
      throw new ApiError('Order prices are out of date', 409, priced.code);
    const { pricing } = priced;

    // The order and its lines in one transaction (create_order), with where the shopper came from.
    const created = await this.db.withActor(null, async (trx) => {
      const result = await this.db.call<{ order: Order; items: OrderItem[] }>(
        'create_order',
        {
          p_order: {
            order_number: generateOrderNumber(),
            user_id: userId,
            customer_email: data.customerEmail || null,
            customer_first_name: data.customerFirstName,
            customer_last_name: data.customerLastName,
            customer_phone: data.customerPhone,
            shipping_address: data.shippingAddress || null,
            shipping_city: data.shippingCity || null,
            shipping_state: data.shippingState || null,
            shipping_zip: data.shippingZip || null,
            shipping_country: data.shippingCountry || null,
            subtotal: pricing.subtotal,
            shipping_cost: pricing.shippingCost,
            total: pricing.total,
            order_notes: data.orderNotes || null,
          },
          p_items: data.items.map((item, index) => {
            const product = pricing.products.get(item.id)!;
            const variant = pricing.variants[index];
            return {
              product_id: item.id,
              variant_id: variant?.id ?? null,
              variant_label: variant?.label || null,
              product_name: product.name,
              product_name_ar: product.name_ar,
              product_name_fr: product.name_fr,
              product_image: product.image,
              quantity: item.quantity,
              price: item.price,
              subtotal: item.price * item.quantity,
            };
          }),
        },
        trx,
      );
      if (data.trafficSource) {
        await trx
          .updateTable('orders')
          .set({ traffic_source: data.trafficSource })
          .where('id', '=', result.order.id)
          .execute();
      }
      return result;
    });
    const { order, items } = created;

    // Sent from stored data only; a failed e-mail never fails the order.
    if (order.customer_email) {
      await sendOrderConfirmationEmail({
        order,
        orderItems: items ?? [],
        customerName: `${order.customer_first_name} ${order.customer_last_name}`,
        onError: (error) =>
          Sentry.captureException(error, { tags: { area: 'order-email' } }),
      });
    }
    return order;
  }

  /** One page of the list (with thumbnails and parcel), or one order with its lines (?id=). */
  @Get()
  async list(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    const id = q.get('id');
    let filtered = this.db
      .selectFrom('orders as o')
      .where('o.deleted_at', 'is', null);
    if (id) {
      const rows = await filtered
        .selectAll('o')
        .select((eb) =>
          jsonArrayFrom(
            eb
              .selectFrom('order_items as i')
              .selectAll('i')
              .whereRef('i.order_id', '=', 'o.id'),
          ).as('items'),
        )
        .where('o.id', '=', id)
        .execute();
      return rows[0] ?? [];
    }
    // shortcut: staff list, filter and search only the newest 1000 orders; raise or drop the cap if they need older ones.
    if (!hasFullAccess(actor.role))
      filtered = filtered.where(
        'o.id',
        'in',
        this.db
          .selectFrom('orders')
          .select('id')
          .where('deleted_at', 'is', null)
          .orderBy('created_at', 'desc')
          .limit(1000),
      );
    const status = q.get('status');
    if (status && status !== 'all')
      filtered = filtered.where('o.status', '=', status);
    const payment = q.get('payment_status');
    if (payment) filtered = filtered.where('o.payment_status', '=', payment);
    const channel = q.get('channel');
    if (channel) filtered = filtered.where('o.channel', '=', channel);
    const handler = q.get('handled_by');
    if (handler === 'website')
      filtered = filtered.where('o.created_by', 'is', null);
    else if (handler === 'none')
      filtered = filtered
        .where('o.assigned_to', 'is', null)
        .where('o.created_by', 'is', null);
    else if (handler)
      filtered = filtered.where(
        sql<string>`coalesce(o.assigned_to, o.created_by)`,
        '=',
        zId.parse(handler),
      );
    // Created between these days (YYYY-MM-DD, Tunis time: UTC+1 all year), both included.
    const from = q.get('from');
    const to = q.get('to');
    if (from)
      filtered = filtered.where(
        'o.created_at',
        '>=',
        new Date(`${zDate.parse(from)}T00:00:00+01:00`).toISOString(),
      );
    if (to)
      filtered = filtered.where(
        'o.created_at',
        '<',
        new Date(
          new Date(`${zDate.parse(to)}T00:00:00+01:00`).getTime() + 86_400_000,
        ).toISOString(),
      );
    const term = q.get('q');
    if (term) {
      const like = `%${term.replace(/[%,()]/g, ' ')}%`;
      filtered = filtered.where((eb) =>
        eb.or([
          eb('o.order_number', 'ilike', like),
          eb('o.customer_first_name', 'ilike', like),
          eb('o.customer_last_name', 'ilike', like),
          eb('o.customer_email', 'ilike', like),
          eb('o.customer_phone', 'ilike', like),
          eb('o.created_by_email', 'ilike', like),
          eb('o.traffic_source', 'ilike', like),
          eb.exists(
            eb
              .selectFrom('deliveries as d')
              .select('d.id')
              .whereRef('d.order_id', '=', 'o.id')
              .where('d.deleted_at', 'is', null)
              .where('d.barcode', 'ilike', like),
          ),
        ]),
      );
    }

    const page = q.int('page', 1, 10_000);
    const size = q.int('size', 10, 200);
    const sort =
      ORDER_SORTS.find((column) => column === q.get('sort')) ?? 'created_at';
    const open = [...OPEN_ORDER_STATUSES];
    const [rows, count] = await Promise.all([
      filtered
        .selectAll('o')
        .select((eb) => [
          jsonArrayFrom(
            eb
              .selectFrom('order_items as i')
              .select([
                'i.id',
                'i.product_name',
                'i.product_image',
                'i.quantity',
                'i.variant_label',
              ])
              .whereRef('i.order_id', '=', 'o.id'),
          ).as('items'),
          jsonArrayFrom(
            eb
              .selectFrom('deliveries as d')
              .select(['d.status', 'd.barcode'])
              .whereRef('d.order_id', '=', 'o.id')
              .where('d.deleted_at', 'is', null),
          ).as('deliveries'),
          // Orders in progress sharing this one's phone: possible duplicates.
          sql<string[]>`case when o.status = any(${open}) then array(
            select x.order_number from orders x
             where x.id <> o.id and x.deleted_at is null and x.status = any(${open})
               and public.normalize_phone(x.customer_phone) = public.normalize_phone(o.customer_phone)
          ) else '{}' end`.as('duplicates'),
        ])
        .orderBy(`o.${sort}`, q.get('dir') === 'asc' ? 'asc' : 'desc')
        .orderBy('o.id')
        .limit(size)
        .offset((page - 1) * size)
        .execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
    ]);
    return new Envelope(rows, { total: Number(count.n) });
  }

  /**
   * Status or notes. Validated, shipped and delivered orders take their tracked
   * items out of the online location; pending and cancelled ones give them back, in one
   * transaction with the status (set_order_status): a shortage changes nothing.
   */
  @Put()
  async update(
    @Body() body: Record<string, any>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!body?.id) throw new ApiError('Order ID is required');
    const changes: Record<string, unknown> = {};
    // payment_status follows the order's payments (private.refresh_order_paid): never set by hand.
    for (const field of ['status', 'order_notes']) {
      if (body[field] !== undefined) changes[field] = body[field];
    }
    const parcels =
      changes.status === 'cancelled'
        ? await this.cancelParcels([body.id], actor)
        : null;
    const order = await this.db.withActor(actor, (trx) =>
      this.db.call(
        'set_order_status',
        {
          p_order_id: body.id,
          p_changes: changes,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
    if (changes.status) await invalidateCatalog(); // shop availability may have changed
    return parcels ? { ...(order as object), parcels } : order;
  }

  /** ?id= or ?ids=a,b: returns the stock they took, then cancels and deletes them, all or none (delete_orders). */
  @Delete()
  async remove(
    @Query() query: { id?: string; ids?: string },
    @CurrentActor() actor: RequestActor,
  ) {
    const ids = idsFrom(query);
    if (ids.length === 0) throw new ApiError('Order ID is required');
    const parcels = await this.cancelParcels(ids, actor);
    const deleted = await this.db.withActor(actor, (trx) =>
      this.db.call(
        'delete_orders',
        { p_order_ids: ids, p_actor: actor.userId, p_actor_email: actor.email },
        trx,
      ),
    );
    await invalidateCatalog();
    return { deleted, parcels };
  }
}
