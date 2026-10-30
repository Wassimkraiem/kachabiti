import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
  Sse,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { hasFullAccess } from '@shared/admin-auth';
import { CHANNELS } from '@shared/erp/constants';
import {
  isTrashTable,
  TRASH_TABLES,
  type TrashTable,
} from '@shared/trash-tables';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, params, period, Zod, zId } from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { Database } from '../db/database';
import { one } from '../db/embed';
import { deliveryFee, setDeliveryFee } from '../sales/commerce';
import { NotificationEvents } from '../notifications/notification-events';
import { clampToStart } from '@shared/erp/objectives';
import {
  analyticsStart,
  deliveredByDay,
  listTeam,
  monthProgress,
  teamProgress,
} from './goals';

// Ports of app/api/owner/overview and app/api/admin/* except team (Supabase Auth accounts move
// with phase 3). Access comes from lib/api-access.ts: owner only, admins only, or any back-office user.

/** The owner's overview: sales delivered, margins, cash, debts, stock, rates, agents and the month's goal. */
@Controller('owner/overview')
@Public()
export class OwnerOverviewController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@Query() query: Record<string, string>) {
    const { from: asked, to } = period(query, 30);
    const start = await analyticsStart(this.db);
    // Figures count from the analytics start date (Business settings), even for a longer period.
    const from =
      clampToStart(asked, start) < to ? clampToStart(asked, start) : to;
    const q = params(query);
    const channel = q.get('channel');
    const month = new Date(to.getTime() - 1).toISOString().slice(0, 7);
    const [overview, goals, campaigns, costPrices, monthGoal] =
      await Promise.all([
        this.db.call<object>('owner_overview', {
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_channel:
            channel && (CHANNELS as readonly string[]).includes(channel)
              ? channel
              : null,
          p_agent: q.get('agent'),
          p_product: q.get('product'),
          p_campaign: q.get('campaign'),
        }),
        // Objectives of the month the period ends in.
        this.db
          .selectFrom('agent_goals')
          .selectAll()
          .where('deleted_at', 'is', null)
          .where('month', '=', `${to.toISOString().slice(0, 7)}-01`)
          .execute(),
        this.db
          .selectFrom('ad_campaigns')
          .select(['id', 'name', 'platform'])
          .where('deleted_at', 'is', null)
          .orderBy('created_at', 'desc')
          .execute(),
        this.db.call('product_cost_prices'),
        teamProgress(this.db, month),
      ]);
    return {
      ...overview,
      goals,
      campaign_options: campaigns,
      cost_prices: costPrices,
      month_goal: { month, ...monthGoal },
      analytics_start: start,
    };
  }
}

/** Back-office history (Admin → Activity): ?actor=&entity=&action=&entityId=&from=&to=&page=&pageSize= */
@Controller('admin/activity')
@Public()
export class ActivityController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    let filtered = this.db.selectFrom('activity_log');
    if (query.actor === 'database')
      filtered = filtered.where('source', '=', 'database');
    else if (query.actor)
      filtered = filtered.where('actor_id', '=', query.actor);
    if (query.entity) filtered = filtered.where('entity', '=', query.entity);
    if (query.action) filtered = filtered.where('action', '=', query.action);
    if (query.entityId)
      filtered = filtered.where('entity_id', '=', query.entityId);
    if (query.from) filtered = filtered.where('created_at', '>=', query.from);
    if (query.to) filtered = filtered.where('created_at', '<=', query.to);
    const [rows, count, actors] = await Promise.all([
      filtered
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
      this.db.call('activity_actors'),
    ]);
    return { rows, total: count.n, actors };
  }
}

const erpSettingsSchema = z.object({
  sales: z
    .object({
      pending_alert_hours: z.number().int().min(1).max(720),
      late_delivery_days: z.number().int().min(1).max(60),
      duplicate_window_days: z.number().int().min(1).max(365),
    })
    .partial()
    .optional(),
  pos: z
    .object({ max_discount_percent: z.number().min(0).max(100) })
    .partial()
    .optional(),
  analytics: z
    .object({
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    })
    .optional(),
  // Stored in shipping_rates (Tunisia), where the checkout reads it.
  delivery_fee: z.number().min(0).max(1000).optional(),
});

const SETTING_KEYS = ['sales', 'pos', 'analytics'] as const;

/**
 * Business rules (owners and admins): sales alerts and duplicates, the till's discount limit, and the
 * analytics start date ("reset": figures count only from that day; nothing is deleted).
 */
@Controller('admin/erp-settings')
@Public()
export class ErpSettingsController {
  constructor(private readonly db: Database) {}

  private current() {
    return this.db
      .selectFrom('erp_settings')
      .select(['key', 'value'])
      .where('key', 'in', [...SETTING_KEYS])
      .execute();
  }

  @Get()
  async get() {
    return {
      ...Object.fromEntries(
        (await this.current()).map((r) => [r.key, r.value]),
      ),
      delivery_fee: await deliveryFee(this.db),
    };
  }

  @Put()
  async save(
    @Body(new Zod(erpSettingsSchema)) body: z.infer<typeof erpSettingsSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const byKey = Object.fromEntries(
      (await this.current()).map((r) => [
        r.key,
        r.value as Record<string, unknown>,
      ]),
    );
    const rows = SETTING_KEYS.filter((key) => body[key]).map((key) => ({
      key,
      value: { ...(byKey[key] ?? {}), ...body[key] },
    }));
    await this.db.withActor(actor, async (trx) => {
      if (rows.length)
        await trx
          .insertInto('erp_settings')
          .values(
            rows.map((r) => ({ key: r.key, value: JSON.stringify(r.value) })),
          )
          .onConflict((oc) =>
            oc
              .column('key')
              .doUpdateSet((eb) => ({ value: eb.ref('excluded.value') })),
          )
          .execute();
      if (body.delivery_fee !== undefined)
        await setDeliveryFee(trx, body.delivery_fee);
    });
    return {
      ...Object.fromEntries(rows.map((r) => [r.key, r.value])),
      ...(body.delivery_fee !== undefined
        ? { delivery_fee: body.delivery_fee }
        : {}),
    };
  }
}

const goalSchema = z
  .object({
    user_id: zId,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    target_orders: z.number().int().min(0).nullable().optional(),
    target_confirmed: z.number().int().min(0).nullable().optional(),
    target_delivered: z.number().int().min(0).nullable().optional(),
    target_revenue: z.number().min(0).nullable().optional(),
    commission_type: z
      .enum(['none', 'percent', 'per_order', 'tiers'])
      .default('none'),
    commission_value: z.number().min(0).max(1_000_000).default(0),
    // 'tiers': prize (TND) for reaching a number of delivered orders in the month.
    prize_tiers: z
      .array(
        z.object({
          orders: z.number().int().min(1).max(100_000),
          prize: z.number().min(0).max(1_000_000),
        }),
      )
      .max(10)
      .default([]),
    // Copy to the following months too (same objective for the quarter, for example).
    repeat_months: z.number().int().min(0).max(11).default(0),
  })
  .refine((g) => g.commission_type !== 'tiers' || g.prize_tiers.length > 0, {
    message: 'Add at least one prize tier',
    path: ['prize_tiers'],
  });
const businessGoalSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  target_revenue: z.number().min(0).nullable().optional(),
  target_orders: z.number().int().min(0).nullable().optional(),
  target_confirmed: z.number().int().min(0).nullable().optional(),
  target_delivered: z.number().int().min(0).nullable().optional(),
  target_gross_margin: z.number().min(0).nullable().optional(),
  max_return_rate: z.number().min(0).max(100).nullable().optional(),
  ad_budget: z.number().min(0).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** Monthly goals (owners and admins): the business's goal and each agent's objective and commission. */
@Controller('admin/goals')
@Public()
export class GoalsController {
  constructor(private readonly db: Database) {}

  /** ?month=YYYY-MM (default: this month) */
  @Get()
  async get(@Query('month') month = new Date().toISOString().slice(0, 7)) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError('Invalid month');
    const [rows, team, daily, start] = await Promise.all([
      monthProgress(this.db, month),
      teamProgress(this.db, month),
      deliveredByDay(this.db, month),
      analyticsStart(this.db),
    ]);
    return { month, rows, team, daily, analytics_start: start };
  }

  /** Sets an agent's objective for a month (replacing the previous one). */
  @Post()
  async setAgentGoal(
    @Body(new Zod(goalSchema)) body: z.infer<typeof goalSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const member = (await listTeam(this.db)).find(
      (m) => m.user_id === body.user_id,
    );
    if (!member) throw new ApiError('This person is not on the team.');
    const { repeat_months, month, user_id, ...goal } = body;
    const months = Array.from({ length: repeat_months + 1 }, (_, i) => {
      const d = new Date(`${month}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      return d.toISOString().slice(0, 10);
    });
    return this.db.withActor(actor, (trx) =>
      this.db.call(
        'set_agent_goal',
        {
          p_user: user_id,
          p_user_email: member.email,
          p_months: months,
          p_goal: goal,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
  }

  /** Sets the business's goal for a month (replaces it). */
  @Put()
  setBusinessGoal(
    @Body(new Zod(businessGoalSchema)) body: z.infer<typeof businessGoalSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { month, ...goal } = body;
    const row = {
      ...goal,
      month: `${month}-01`,
      deleted_at: null,
      created_by: actor.userId,
      created_by_email: actor.email,
    };
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('business_goals')
        .values(row)
        .onConflict((oc) => oc.column('month').doUpdateSet(row))
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Delete()
  async remove(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    const businessId = q.get('business_id');
    if (businessId) {
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('business_goals')
          .set({ deleted_at: new Date() })
          .where('id', '=', businessId)
          .execute(),
      );
      return { id: businessId };
    }
    const id = q.get('id');
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('agent_goals')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

/**
 * The signed-in back-office user (role and permissions, so the admin UI can hide controls). Also
 * refreshes their row in back_office_users (who receives which notifications); that never fails
 * the request.
 */
@Controller('admin/me')
@Public()
export class MeController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@CurrentActor() actor: RequestActor) {
    try {
      await this.db
        .insertInto('back_office_users')
        .values({
          user_id: actor.userId,
          email: actor.email,
          role: actor.role,
          permissions: actor.permissions,
          deleted_at: null,
        })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet({
            email: actor.email,
            role: actor.role,
            permissions: actor.permissions,
            deleted_at: null,
          }),
        )
        .execute();
    } catch {
      // Notifications only.
    }
    return {
      id: actor.userId,
      role: actor.role,
      email: actor.email,
      permissions: actor.permissions,
    };
  }
}

/** An admin page middleware.ts refused this user: recorded like the guard's refusals (owner alert). */
@Controller('admin/access-denied')
@Public()
export class AccessDeniedController {
  constructor(private readonly db: Database) {}

  @Post()
  @HttpCode(204)
  async record(
    @CurrentActor() actor: RequestActor,
    @Body() body: { path?: unknown; query?: unknown },
  ) {
    const path = typeof body?.path === 'string' ? body.path.slice(0, 300) : '';
    if (!path.startsWith('/admin')) throw new ApiError('path is required');
    await this.db
      .insertInto('activity_log')
      .values({
        actor_id: actor.userId,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'access_denied',
        entity: 'access',
        label: `GET ${path}`,
        changes: JSON.stringify({
          query:
            typeof body.query === 'string' ? body.query.slice(0, 300) : null,
        }),
      })
      .execute();
  }
}

/** An agent's day: their orders to confirm and in delivery, unassigned orders, follow-ups, unread messages, month results. */
@Controller('admin/my-work')
@Public()
export class MyWorkController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@CurrentActor() actor: RequestActor) {
    const me = actor.userId;
    const can = (p: string) =>
      hasFullAccess(actor.role) || (actor.permissions as string[]).includes(p);
    const month = new Date().toISOString().slice(0, 7);
    const orders = () =>
      this.db
        .selectFrom('orders')
        .select([
          'id',
          'order_number',
          'status',
          'total',
          'channel',
          'created_at',
          'customer_first_name',
          'customer_last_name',
          'customer_phone',
          'shipping_city',
          'customer_id',
        ])
        .where('deleted_at', 'is', null);

    const [toConfirm, inDelivery, unassigned, tasks, unread, progress, team] =
      await Promise.all([
        can('orders')
          ? orders()
              .where('status', 'in', ['pending', 'confirmed'])
              .where((eb) =>
                eb.or([
                  eb('assigned_to', '=', me),
                  eb.and([
                    eb('assigned_to', 'is', null),
                    eb('created_by', '=', me),
                  ]),
                ]),
              )
              .orderBy('created_at')
              .limit(100)
              .execute()
          : [],
        can('orders')
          ? orders()
              .where('status', 'in', ['processing', 'shipped'])
              .where('assigned_to', '=', me)
              .orderBy('created_at')
              .limit(100)
              .execute()
          : [],
        can('orders')
          ? this.db
              .selectFrom('orders')
              .select((eb) => eb.fn.countAll<number>().as('n'))
              .where('deleted_at', 'is', null)
              .where('status', 'in', ['pending', 'confirmed'])
              .where('assigned_to', 'is', null)
              .where('created_by', 'is', null)
              .executeTakeFirstOrThrow()
              .then((r) => r.n)
          : 0,
        can('customers')
          ? this.db
              .selectFrom('crm_tasks as t')
              .selectAll('t')
              .select((eb) => [
                one(
                  eb,
                  'customers as c',
                  ['c.id', 'c.full_name', 'c.phone'],
                  'c.id',
                  't.customer_id',
                ).as('customer'),
                one(
                  eb,
                  'orders as o',
                  ['o.id', 'o.order_number'],
                  'o.id',
                  't.order_id',
                ).as('order'),
              ])
              .where('t.assigned_to', '=', me)
              .where('t.done_at', 'is', null)
              .where('t.deleted_at', 'is', null)
              .orderBy('t.due_at')
              .limit(100)
              .execute()
          : [],
        can('customers')
          ? this.db
              .selectFrom('customer_interactions as x')
              .innerJoin('customers as c', 'c.id', 'x.customer_id')
              .select('x.customer_id')
              .where('x.direction', '=', 'in')
              .where('x.read_at', 'is', null)
              .where('x.deleted_at', 'is', null)
              .where('c.assigned_to', '=', me)
              .limit(500)
              .execute()
          : [],
        monthProgress(this.db, month, me),
        // The business's goal for the month, so agents see what the team is aiming for.
        teamProgress(this.db, month),
      ]);
    return {
      to_confirm: toConfirm,
      in_delivery: inDelivery,
      unassigned_count: unassigned,
      tasks,
      unread_customers: new Set(unread.map((r) => r.customer_id)).size,
      month: progress[0] ?? null,
      team: team.goal
        ? {
            goal: team.goal,
            delivered_revenue: team.delivered_revenue,
            delivered: team.delivered,
            created: team.created,
            confirmed: team.confirmed,
            days_elapsed: team.days_elapsed,
            days_in_month: team.days_in_month,
          }
        : null,
    };
  }
}

/** Orders added per agent and how they ended (owners and admins), ?from=&to= (default: last 30 days). */
@Controller('admin/performance')
@Public()
export class PerformanceController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@Query() query: Record<string, string>) {
    const { from: asked, to } = period(query, 30);
    // Counted from the analytics start date (Business settings).
    const start = clampToStart(asked, await analyticsStart(this.db));
    const from = start < to ? start : to;
    const rows = await this.db.call('agent_performance', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    return { from: from.toISOString(), to: to.toISOString(), rows: rows ?? [] };
  }
}

/** Team members for "assign to" pickers (any back-office user). */
@Controller('admin/staff')
@Public()
export class StaffController {
  constructor(private readonly db: Database) {}

  @Get()
  get() {
    return listTeam(this.db);
  }
}

// ── Notifications ──

@Controller('admin/notifications')
@Public()
export class NotificationsController {
  constructor(
    private readonly db: Database,
    private readonly events: NotificationEvents,
  ) {}

  /** Live: each new or changed notification of the user, as { op, row } (server-sent events). */
  @Sse('stream')
  stream(@CurrentActor() actor: RequestActor) {
    return this.events.stream(actor.userId);
  }

  /** The user's own notifications: ?limit=&before=<id>&kind=&unread=1 → { rows, unread, hasMore }. */
  @Get()
  async list(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    let rows = this.db
      .selectFrom('notifications')
      .select([
        'id',
        'created_at',
        'kind',
        'type',
        'severity',
        'title',
        'body',
        'url',
        'data',
        'read_at',
      ])
      .where('recipient_id', '=', actor.userId)
      .where('deleted_at', 'is', null)
      .orderBy('id', 'desc')
      .limit(limit + 1);
    const before = Number(query.before);
    if (before) rows = rows.where('id', '<', before);
    if (query.kind) rows = rows.where('kind', '=', query.kind);
    if (query.unread === '1') rows = rows.where('read_at', 'is', null);
    const [list, unread] = await Promise.all([
      rows.execute(),
      this.db
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('recipient_id', '=', actor.userId)
        .where('deleted_at', 'is', null)
        .where('read_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      rows: list.slice(0, limit),
      hasMore: list.length > limit,
      unread: unread.n,
    };
  }

  /** { ids: number[] } or { all: true } marks the user's notifications read. */
  @Put()
  async markRead(
    @Body() body: Record<string, any>,
    @CurrentActor() actor: RequestActor,
  ) {
    let update = this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('recipient_id', '=', actor.userId)
      .where('read_at', 'is', null);
    if (body?.all !== true) {
      const ids: number[] = Array.isArray(body?.ids)
        ? body.ids.map(Number).filter(Number.isInteger)
        : [];
      if (ids.length === 0) throw new ApiError('ids or all is required');
      update = update.where('id', 'in', ids);
    }
    await update.execute();
  }

  /** Sends the user a test notification (in the admin and on their computers). */
  @Post('test')
  async test(@CurrentActor() actor: RequestActor) {
    await this.db
      .insertInto('notifications')
      .values({
        recipient_id: actor.userId,
        kind: 'system',
        type: 'test',
        severity: 'info',
        title: JSON.stringify({
          en: 'Notifications are working',
          fr: 'Les notifications fonctionnent',
          ar: 'الإشعارات تعمل',
        }),
        body: JSON.stringify({
          en: 'You will be notified here and on this computer.',
          fr: 'Vous serez averti ici et sur cet ordinateur.',
          ar: 'ستصلك الإشعارات هنا وعلى هذا الحاسوب.',
        }),
        url: '/admin/notifications',
      })
      .execute();
  }

  /** The public key browsers subscribe to desktop notifications with. */
  @Get('push')
  async pushKey() {
    const row = await this.db
      .selectFrom('site_settings')
      .select('setting_value')
      .where('setting_key', '=', 'vapid_public_key')
      .executeTakeFirst();
    return { publicKey: row?.setting_value ?? null };
  }

  /** { subscription: { endpoint, keys: { p256dh, auth } }, locale } registers this browser. */
  @Post('push')
  async subscribe(
    @Body() body: Record<string, any>,
    @CurrentActor() actor: RequestActor,
    @Req() request: Request,
  ) {
    const { subscription, locale } = body ?? {};
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('https://') ||
      typeof p256dh !== 'string' ||
      typeof auth !== 'string'
    ) {
      throw new ApiError('Invalid push subscription');
    }
    const row = {
      user_id: actor.userId,
      endpoint,
      p256dh,
      auth,
      locale: ['en', 'fr', 'ar'].includes(locale) ? locale : 'en',
      user_agent: request.headers['user-agent']?.slice(0, 300) ?? null,
      last_error: null,
      deleted_at: null,
    };
    await this.db
      .insertInto('push_subscriptions')
      .values(row)
      .onConflict((oc) => oc.column('endpoint').doUpdateSet(row))
      .execute();
  }

  /** { endpoint } stops desktop notifications for this browser (soft delete). */
  @Delete('push')
  async unsubscribe(
    @Body() body: Record<string, any>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (typeof body?.endpoint !== 'string')
      throw new ApiError('endpoint is required');
    await this.db
      .updateTable('push_subscriptions')
      .set({ deleted_at: new Date() })
      .where('endpoint', '=', body.endpoint)
      .where('user_id', '=', actor.userId)
      .where('deleted_at', 'is', null)
      .execute();
  }
}

// ── Deleted items ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelOf(row: Record<string, any>): string {
  const text = (key: string) =>
    typeof row[key] === 'string' && row[key] ? row[key] : null;
  if (row.discount_percent != null) {
    const product = row.products?.name;
    return `${row.discount_percent}%${product ? ` · ${product}` : ''}`;
  }
  const main =
    text('order_number') ??
    text('display_name') ??
    text('name') ??
    text('title') ??
    text('sku') ??
    row.id;
  const extra = text('customer_email') ?? text('code');
  return extra ? `${main} · ${extra}` : main;
}

/**
 * Deleted items (Admin → Deleted items): counts per area the caller can edit, the rows of one
 * table (?table=), and erasing for good (DELETE ?table=&ids=). Needs `hard_delete` (+ the area).
 */
@Controller('admin/trash')
@Public()
export class TrashController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(
    @Query('table') table: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    const db = this.db as any;
    if (table === undefined) {
      const tables = (Object.keys(TRASH_TABLES) as TrashTable[]).filter(
        (t) =>
          hasFullAccess(actor.role) ||
          actor.permissions.includes(TRASH_TABLES[t].permission),
      );
      const counts = await Promise.all(
        tables.map((t) =>
          db
            .selectFrom(t)
            .select((eb: any) => eb.fn.countAll().as('n'))
            .where('deleted_at', 'is not', null)
            .executeTakeFirstOrThrow(),
        ),
      );
      return {
        counts: Object.fromEntries(tables.map((t, i) => [t, counts[i].n])),
      };
    }
    if (!isTrashTable(table)) throw new ApiError('Unknown table');
    const columns = TRASH_TABLES[table].columns
      .split(',')
      .filter((c) => !c.includes('('));
    let rows = db
      .selectFrom(`${table} as t`)
      .select(columns.map((c) => `t.${c}`))
      .where('t.deleted_at', 'is not', null);
    if (table === 'product_discounts')
      rows = rows.select((eb: any) =>
        one(eb, 'products as p', ['p.name'], 'p.id', 't.product_id').as(
          'products',
        ),
      );
    const list: Record<string, any>[] = await rows
      .orderBy('t.deleted_at', 'desc')
      .limit(1000)
      .execute();
    return {
      rows: list.map((row) => ({
        id: row.id,
        label: labelOf(row),
        deleted_at: row.deleted_at,
      })),
    };
  }

  @Delete()
  async purge(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const table = query.table ?? null;
    if (!isTrashTable(table)) throw new ApiError('Unknown table');
    const ids = (query.ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0 || !ids.every((id) => UUID.test(id)))
      throw new ApiError('ids must be a comma-separated list of ids');
    try {
      const erased = await this.db.withActor(actor, (trx) =>
        this.db.call('purge_deleted', { p_table: table, p_ids: ids }, trx),
      );
      await invalidateCatalog();
      return { erased: erased ?? 0 };
    } catch (error: any) {
      // A row the database still needs elsewhere (a location with stock movements).
      if (error?.code === '23503')
        throw new ApiError(
          'Some of these are still used by other records, so nothing was erased.',
          409,
          'IN_USE',
        );
      // Stock only changes through movements, so it has to be brought to 0 first.
      if (error?.message?.startsWith('has_stock')) {
        throw new ApiError(
          'Some of these still hold stock. Record a movement to bring it to 0 first.',
          409,
          'HAS_STOCK',
        );
      }
      throw error;
    }
  }
}
