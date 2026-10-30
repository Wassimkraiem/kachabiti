import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { z } from 'zod';
import { COLISSIMO_GOVERNORATES } from '@shared/colissimo-data';
import {
  CHANNELS,
  MONEY_ACCOUNTS,
  PAYMENT_METHODS,
} from '@shared/erp/constants';
import { generateOrderNumber } from '@shared/order-number';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import {
  ApiError,
  idsFrom,
  isManager,
  params,
  Zod,
  zDate,
  zId,
  zMoney,
} from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { Database } from '../db/database';
import {
  buildManualOrderLines,
  calculateShipping,
  deliveryFee,
  ManualLineError,
  memberEmail,
} from './commerce';

// Ports of app/api/sales/orders, sales/payments and sales/remittances (rules in lib/api-access.ts).

// ── Orders typed in by agents, assignment, confirmation, duplicates ──

const itemSchema = z.object({
  product_id: zId,
  variant_id: zId.nullish(),
  quantity: z.number().int().min(1).max(999),
});
const createSchema = z.object({
  customer: z.object({
    phone: z
      .string()
      .trim()
      .regex(/^[24579]\d{7}$/, 'Invalid Tunisian phone number'),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().max(100).default(''),
    email: z.string().trim().email().optional().or(z.literal('')),
    governorate: z.enum(COLISSIMO_GOVERNORATES as [string, ...string[]]),
    city: z.string().trim().min(1).max(100),
    address: z.string().trim().min(1).max(250),
  }),
  items: z.array(itemSchema).min(1).max(50),
  channel: z
    .enum(CHANNELS)
    .refine(
      (c) => c !== 'store' && c !== 'website',
      'Choose where the order came from',
    ),
  campaign_id: zId.nullish(),
  // Delivery fee charged; omitted: the shop's usual fee (free above the threshold).
  shipping_cost: zMoney.optional(),
  discount_amount: zMoney.default(0),
  notes: z.string().trim().max(2000).optional(),
  assigned_to: zId.nullish(),
  // The customer already agreed (the agent confirmed while taking the order).
  confirmed: z.boolean().default(false),
});
const patchSchema = z.discriminatedUnion('action', [
  // Assign orders to an agent (null: unassign).
  z.object({
    action: z.literal('assign'),
    ids: z.array(zId).min(1).max(500),
    user_id: zId.nullable(),
  }),
  // The customer agreed: pending → confirmed.
  z.object({ action: z.literal('confirm'), ids: z.array(zId).min(1).max(500) }),
  // Where the order came from.
  z.object({
    action: z.literal('source'),
    id: zId,
    channel: z.enum(CHANNELS),
    campaign_id: zId.nullable(),
  }),
]);

async function erpSetting<T>(db: Database, key: string): Promise<T | null> {
  const row = await db
    .selectFrom('erp_settings')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();
  return (row?.value as T) ?? null;
}

@Controller('sales/orders')
@Public()
export class SalesOrdersController {
  constructor(private readonly db: Database) {}

  /** The usual delivery fee, filled in on New order and New parcel (agents can change it per order). */
  @Get('delivery-fee')
  async fee() {
    return { fee: await deliveryFee(this.db) };
  }

  /** ?phone=&exclude= — the customer with this phone and their orders still in progress. */
  @Get()
  async duplicates(@Query() query: Record<string, string>) {
    const q = params(query);
    const phone = q.get('phone');
    if (!phone) throw new ApiError('Phone is required');
    const days = Number(
      (await erpSetting<{ duplicate_window_days?: number }>(this.db, 'sales'))
        ?.duplicate_window_days ?? 30,
    );
    const [openOrders, normalized] = await Promise.all([
      this.db.callRows('find_order_duplicates', {
        p_phone: phone,
        p_exclude: q.get('exclude'),
        p_days: days,
      }),
      this.db.call<string | null>('normalize_phone', { p_phone: phone }),
    ]);
    const customer = normalized
      ? ((await this.db
          .selectFrom('customers')
          .select([
            'id',
            'full_name',
            'phone',
            'email',
            'governorate',
            'city',
            'address',
            'stage',
            'tags',
            'notes',
          ])
          .where('phone', '=', normalized)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()) ?? null)
      : null;
    return { customer, open_orders: openOrders };
  }

  /** Creates an order by hand. Catalog prices; agents may discount up to the till's limit (managers: any). */
  @Post()
  async create(
    @Body(new Zod(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
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
      throw new ApiError('The discount is larger than the products total.');
    if (body.discount_amount > 0 && !isManager(actor)) {
      const maxPercent = Number(
        (await erpSetting<{ max_discount_percent?: number }>(this.db, 'pos'))
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
    const shipping =
      body.shipping_cost ??
      (await calculateShipping(this.db, 'TN', subtotal - body.discount_amount))
        .cost;
    const total = Math.max(0, subtotal - body.discount_amount) + shipping;

    const assignee =
      body.assigned_to === undefined ? actor.userId : body.assigned_to;
    const assigneeEmail = assignee
      ? assignee === actor.userId
        ? actor.email
        : await memberEmail(this.db, assignee)
      : null;
    if (assignee && !assigneeEmail)
      throw new ApiError('This agent is not on the team.');

    const created = await this.db.withActor(actor, async (trx) => {
      const result = await this.db.call<{
        order: { id: string; order_number: string };
      }>(
        'create_order',
        {
          p_order: {
            order_number: generateOrderNumber(),
            customer_email: body.customer.email || null,
            customer_first_name: body.customer.first_name,
            customer_last_name: body.customer.last_name,
            customer_phone: body.customer.phone,
            shipping_address: body.customer.address,
            shipping_city: body.customer.city,
            shipping_state: body.customer.governorate,
            shipping_country: 'Tunisia',
            subtotal,
            shipping_cost: shipping,
            total,
            order_notes: body.notes || null,
            channel: body.channel,
            campaign_id: body.campaign_id ?? null,
            assigned_to: assignee,
            assigned_to_email: assigneeEmail,
            created_by: actor.userId,
            created_by_email: actor.email,
            discount_amount: body.discount_amount,
          },
          p_items: lines,
        },
        trx,
      );
      if (body.confirmed) {
        await this.db.call(
          'set_order_status',
          {
            p_order_id: result.order.id,
            p_changes: { status: 'confirmed' },
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        );
      }
      return result;
    });
    return {
      id: created.order.id,
      order_number: created.order.order_number,
      total,
    };
  }

  @Patch()
  async patch(
    @Body(new Zod(patchSchema)) body: z.infer<typeof patchSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.action === 'assign') {
      // Staff can take unassigned orders for themselves; handing orders to others is for managers.
      if (!isManager(actor) && body.user_id !== actor.userId) {
        throw new ApiError(
          'Only owners and admins can assign orders to someone else.',
          403,
        );
      }
      const email = body.user_id
        ? await memberEmail(this.db, body.user_id)
        : null;
      if (body.user_id && !email)
        throw new ApiError('This agent is not on the team.');
      if (!isManager(actor)) {
        const taken = await this.db
          .selectFrom('orders')
          .select('id')
          .where('id', 'in', body.ids)
          .where('assigned_to', 'is not', null)
          .where('assigned_to', '<>', actor.userId)
          .execute();
        if (taken.length)
          throw new ApiError(
            'Some of these orders are already handled by someone else.',
            403,
          );
      }
      const changed = await this.db.withActor(actor, (trx) =>
        this.db.call(
          'assign_orders',
          { p_order_ids: body.ids, p_user: body.user_id, p_user_email: email },
          trx,
        ),
      );
      return { changed };
    }
    if (body.action === 'confirm') {
      const orders = await this.db
        .selectFrom('orders')
        .select(['id', 'status'])
        .where('id', 'in', body.ids)
        .where('deleted_at', 'is', null)
        .execute();
      let confirmed = 0;
      for (const order of orders.filter((o) => o.status === 'pending')) {
        await this.db.withActor(actor, (trx) =>
          this.db.call(
            'set_order_status',
            {
              p_order_id: order.id,
              p_changes: { status: 'confirmed' },
              p_actor: actor.userId,
              p_actor_email: actor.email,
            },
            trx,
          ),
        );
        confirmed += 1;
      }
      await invalidateCatalog();
      return { confirmed };
    }
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('orders')
        .set({ channel: body.channel, campaign_id: body.campaign_id })
        .where('id', '=', body.id)
        .where('deleted_at', 'is', null)
        .returning(['id', 'channel', 'campaign_id'])
        .executeTakeFirst(),
    );
    if (!row) throw new ApiError('Order not found', 404);
    return row;
  }
}

// ── Payments received for orders ──

const paymentSchema = z.object({
  order_id: zId,
  // Negative: a refund.
  amount: z
    .number()
    .finite()
    .refine((v) => v !== 0, 'Amount cannot be zero')
    .refine((v) => Math.abs(v) <= 1_000_000, 'Amount too large'),
  method: z.enum(PAYMENT_METHODS),
  account: z.enum(MONEY_ACCOUNTS).optional(),
  received_at: z.string().datetime({ offset: true }).optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

// The usual account for a method: cash in the till, cash on delivery with the carrier, the rest in the bank.
const defaultAccount = (method: string) =>
  method === 'cash' ? 'cash' : method === 'cod' ? 'carrier' : 'bank';

@Controller('sales/payments')
@Public()
export class PaymentsController {
  constructor(private readonly db: Database) {}

  private select() {
    return this.db
      .selectFrom('order_payments as p')
      .select([
        'p.id',
        'p.order_id',
        'p.amount',
        'p.method',
        'p.account',
        'p.received_at',
        'p.reference',
        'p.note',
        'p.remittance_id',
        'p.pos_session_id',
        'p.created_by_email',
        'p.created_at',
      ])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('orders as o')
            .select([
              'o.order_number',
              'o.customer_first_name',
              'o.customer_last_name',
              'o.total',
              'o.paid_amount',
              'o.status',
              'o.channel',
            ])
            .whereRef('o.id', '=', 'p.order_id'),
        ).as('order'),
      );
  }

  /** ?order_id= (one order's payments) or the list: ?account=&method=&from=&to=&open_carrier=1&limit= */
  @Get()
  list(@Query() query: Record<string, string>) {
    const q = params(query);
    let rows = this.select()
      .where('p.deleted_at', 'is', null)
      .orderBy('p.received_at', 'desc');
    const orderId = q.get('order_id');
    if (orderId) return rows.where('p.order_id', '=', orderId).execute();
    if (q.get('account'))
      rows = rows.where('p.account', '=', q.get('account')!);
    if (q.get('method')) rows = rows.where('p.method', '=', q.get('method')!);
    if (q.get('from')) rows = rows.where('p.received_at', '>=', q.get('from')!);
    if (q.get('to')) rows = rows.where('p.received_at', '<', q.get('to')!);
    if (q.bool('open_carrier'))
      rows = rows
        .where('p.account', '=', 'carrier')
        .where('p.remittance_id', 'is', null);
    return rows.limit(q.int('limit', 300, 2000)).execute();
  }

  @Post()
  async create(
    @Body(new Zod(paymentSchema)) body: z.infer<typeof paymentSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const order = await this.db
      .selectFrom('orders')
      .select(['id', 'total', 'paid_amount', 'status'])
      .where('id', '=', body.order_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!order) throw new ApiError('Order not found', 404);
    if (
      body.amount > 0 &&
      Number(order.paid_amount) + body.amount > Number(order.total) + 0.0005
    ) {
      throw new ApiError(
        'This payment is more than what the order still owes.',
        409,
        'OVERPAID',
      );
    }
    const { id } = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('order_payments')
        .values({
          order_id: body.order_id,
          amount: body.amount,
          method: body.method,
          account: body.account ?? defaultAccount(body.method),
          received_at: body.received_at ?? new Date().toISOString(),
          reference: body.reference || null,
          note: body.note || null,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return this.select().where('p.id', '=', id).executeTakeFirstOrThrow();
  }

  /** ?id= — a payment recorded by mistake (its accounting entry is reversed). */
  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    const payment = await this.db
      .selectFrom('order_payments')
      .select(['id', 'remittance_id', 'pos_session_id'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!payment) throw new ApiError('This payment no longer exists.', 404);
    if (payment.remittance_id)
      throw new ApiError(
        'This payment is part of a carrier payout. Cancel the payout first.',
        409,
      );
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('order_payments')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

// ── Carrier payouts ──

const remittanceSchema = z.object({
  payment_ids: z.array(zId).max(2000),
  // Cash the carrier collected for these parcels; defaults to the payments' total.
  gross_amount: zMoney.optional(),
  fees: zMoney.default(0),
  received_on: zDate.optional(),
  account: z.enum(['bank', 'cash']).default('bank'),
  provider: z.string().trim().max(50).default('colissimo'),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

@Controller('sales/remittances')
@Public()
export class RemittancesController {
  constructor(private readonly db: Database) {}

  /** Payouts (newest first) and the payments the carrier still holds. */
  @Get()
  async list(@Query() query: Record<string, string>) {
    const [remittances, open] = await Promise.all([
      this.db
        .selectFrom('cod_remittances as r')
        .selectAll('r')
        .select((eb) =>
          jsonArrayFrom(
            eb
              .selectFrom('order_payments as p')
              .select(['p.id', 'p.amount'])
              .select((eb2) =>
                jsonObjectFrom(
                  eb2
                    .selectFrom('orders as o')
                    .select('o.order_number')
                    .whereRef('o.id', '=', 'p.order_id'),
                ).as('order'),
              )
              .whereRef('p.remittance_id', '=', 'r.id'),
          ).as('payments'),
        )
        .where('r.deleted_at', 'is', null)
        .orderBy('r.received_on', 'desc')
        .limit(params(query).int('limit', 100, 500))
        .execute(),
      this.db
        .selectFrom('order_payments as p')
        .select([
          'p.id',
          'p.amount',
          'p.received_at',
          'p.reference',
          'p.order_id',
        ])
        .select((eb) =>
          jsonObjectFrom(
            eb
              .selectFrom('orders as o')
              .select([
                'o.order_number',
                'o.customer_first_name',
                'o.customer_last_name',
                'o.delivered_at',
              ])
              .whereRef('o.id', '=', 'p.order_id'),
          ).as('order'),
        )
        .where('p.account', '=', 'carrier')
        .where('p.remittance_id', 'is', null)
        .where('p.deleted_at', 'is', null)
        .orderBy('p.received_at')
        .execute(),
    ]);
    return { remittances, open_payments: open };
  }

  @Post()
  async create(
    @Body(new Zod(remittanceSchema)) body: z.infer<typeof remittanceSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    let gross = body.gross_amount;
    if (gross === undefined) {
      if (!body.payment_ids.length)
        throw new ApiError(
          'Choose the parcels this payout covers, or enter its amount.',
        );
      const payments = await this.db
        .selectFrom('order_payments')
        .select('amount')
        .where('id', 'in', body.payment_ids)
        .execute();
      gross = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    }
    if (body.fees > gross)
      throw new ApiError('Fees cannot be more than the payout.');
    return this.db.withActor(actor, (trx) =>
      this.db.call(
        'record_remittance',
        {
          p_remittance: {
            provider: body.provider,
            reference: body.reference ?? '',
            received_on: body.received_on ?? '',
            gross_amount: gross,
            fees: body.fees,
            account: body.account,
            note: body.note ?? '',
          },
          p_payment_ids: body.payment_ids,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
  }

  /** ?id= — a payout entered by mistake: its parcels are owed by the carrier again. */
  @Delete()
  async remove(
    @Query() query: { id?: string },
    @CurrentActor() actor: RequestActor,
  ) {
    const [id] = idsFrom(query);
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      this.db.call('cancel_remittance', { p_id: id }, trx),
    );
    return { id };
  }
}
