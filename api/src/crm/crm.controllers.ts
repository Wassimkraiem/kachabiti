import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CHANNELS, CUSTOMER_STAGES } from '@shared/erp/constants';
import {
  metaConfigured,
  sendMetaText,
  type MetaChannel,
} from '@shared/erp/meta';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, isManager, params, Zod, zId } from '../common/api';
import { signedUrl } from '../common/storage';
import { Database } from '../db/database';
import { many, one } from '../db/embed';
import { memberEmail } from '../sales/commerce';

// Ports of app/api/customers, crm/interactions and crm/tasks (rules in lib/api-access.ts).

const LIST_COLUMNS = [
  'id',
  'phone',
  'phone_alt',
  'full_name',
  'email',
  'governorate',
  'city',
  'channel',
  'stage',
  'assigned_to',
  'assigned_to_email',
  'tags',
  'created_at',
  'updated_at',
  'anonymized_at',
  'bot_status',
  'lead_label',
] as const;

const fields = {
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s.-]{8,20}$/, 'Invalid phone number')
    .nullable(),
  phone_alt: z
    .string()
    .trim()
    .regex(/^\+?[\d\s.-]{8,20}$/, 'Invalid phone number')
    .nullable()
    .or(z.literal('')),
  full_name: z.string().trim().min(1).max(150),
  email: z.string().trim().email().nullable().or(z.literal('')),
  governorate: z.string().trim().max(60).nullable(),
  city: z.string().trim().max(100).nullable(),
  address: z.string().trim().max(250).nullable(),
  channel: z.enum(CHANNELS),
  stage: z.enum(CUSTOMER_STAGES),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  notes: z.string().trim().max(5000).nullable(),
  assigned_to: zId.nullable(),
};
const createSchema = z.object(fields).partial().required({ full_name: true });
const updateSchema = z
  .object({ id: zId, ...fields })
  .partial()
  .required({ id: true });
const actionSchema = z.discriminatedUnion('action', [
  // Same person twice: keep one record, move the other's orders and conversations onto it.
  z.object({ action: z.literal('merge'), keep_id: zId, remove_id: zId }),
  // Erase personal data on request (orders keep their amounts).
  z.object({ action: z.literal('anonymize'), id: zId }),
  z.object({
    action: z.literal('assign'),
    ids: z.array(zId).min(1).max(500),
    user_id: zId.nullable(),
  }),
  // Who answers this customer's messages: the support bot, an agent, or nobody automatic.
  z.object({
    action: z.literal('bot'),
    id: zId,
    status: z.enum(['bot', 'human', 'off']),
  }),
]);

@Controller('customers')
@Public()
export class CustomersController {
  constructor(private readonly db: Database) {}

  /** ?id= (record with orders, conversations, follow-ups) | ?duplicates=1 | list: ?q=&stage=&channel=&bot=&assigned=me|none|<id>&page=&size= */
  @Get()
  async get(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    const id = q.get('id');
    if (id) return this.record(id);

    if (q.bool('duplicates')) {
      const pairs = await this.db.callRows<{
        customer_id: string;
        duplicate_id: string;
        reason: string;
      }>('find_customer_duplicates');
      const ids = [
        ...new Set(pairs.flatMap((p) => [p.customer_id, p.duplicate_id])),
      ];
      const people = ids.length
        ? await this.db
            .selectFrom('customers')
            .select(LIST_COLUMNS)
            .where('id', 'in', ids)
            .execute()
        : [];
      const byId = new Map(people.map((p) => [p.id, p]));
      return pairs.map((p) => ({
        reason: p.reason,
        a: byId.get(p.customer_id),
        b: byId.get(p.duplicate_id),
      }));
    }

    const page = q.int('page', 1, 10_000);
    const size = q.int('size', 50, 200);
    let filtered = this.db
      .selectFrom('customers')
      .where('deleted_at', 'is', null);
    const term = q.get('q');
    if (term) {
      const digits = term.replace(/\D/g, '');
      const like = `%${term.replace(/[%,()]/g, ' ')}%`;
      filtered = filtered.where((eb) =>
        eb.or([
          eb('full_name', 'ilike', like),
          eb('email', 'ilike', like),
          eb('city', 'ilike', like),
          ...(digits.length >= 3
            ? [
                eb('phone', 'ilike', `%${digits}%`),
                eb('phone_alt', 'ilike', `%${digits}%`),
              ]
            : []),
        ]),
      );
    }
    if (q.get('stage'))
      filtered = filtered.where('stage', '=', q.get('stage')!);
    if (q.get('channel'))
      filtered = filtered.where('channel', '=', q.get('channel')!);
    // ?bot=human: the bot handed them over (or an agent took them) and nobody gave them back.
    if (q.get('bot'))
      filtered = filtered.where('bot_status', '=', q.get('bot')!);
    const assigned = q.get('assigned');
    if (assigned === 'me')
      filtered = filtered.where('assigned_to', '=', actor.userId);
    else if (assigned === 'none')
      filtered = filtered.where('assigned_to', 'is', null);
    else if (assigned) filtered = filtered.where('assigned_to', '=', assigned);

    const [rows, count, stageRows] = await Promise.all([
      filtered
        .select(LIST_COLUMNS)
        .orderBy('updated_at', 'desc')
        .limit(size)
        .offset((page - 1) * size)
        .execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
      // Pipeline counts for the stage tabs.
      this.db
        .selectFrom('customers')
        .select(['stage', (eb) => eb.fn.countAll<number>().as('n')])
        .where('deleted_at', 'is', null)
        .groupBy('stage')
        .execute(),
    ]);
    const stages = Object.fromEntries(
      CUSTOMER_STAGES.map((stage) => [
        stage,
        stageRows.find((r) => r.stage === stage)?.n ?? 0,
      ]),
    );
    return { rows, total: count.n, page, size, stages };
  }

  private async record(id: string) {
    const [customer, orders, interactions, tasks] = await Promise.all([
      this.db
        .selectFrom('customers')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
      this.db
        .selectFrom('orders as o')
        .select([
          'o.id',
          'o.order_number',
          'o.status',
          'o.payment_status',
          'o.total',
          'o.paid_amount',
          'o.channel',
          'o.created_at',
          'o.delivered_at',
          'o.assigned_to_email',
        ])
        .select((eb) =>
          many(
            eb,
            'order_items as i',
            ['i.product_name', 'i.variant_label', 'i.quantity'],
            'i.order_id',
            'o.id',
          ).as('items'),
        )
        .where('o.customer_id', '=', id)
        .where('o.deleted_at', 'is', null)
        .orderBy('o.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('customer_interactions')
        .selectAll()
        .where('customer_id', '=', id)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(300)
        .execute(),
      this.db
        .selectFrom('crm_tasks')
        .selectAll()
        .where('customer_id', '=', id)
        .where('deleted_at', 'is', null)
        .orderBy('due_at')
        .execute(),
    ]);
    if (!customer) throw new ApiError('This customer no longer exists.', 404);
    const delivered = orders.filter((o) => o.status === 'delivered');
    const finished = orders.filter((o) =>
      ['delivered', 'returned'].includes(o.status),
    );
    return {
      customer,
      orders,
      interactions,
      tasks,
      stats: {
        orders: orders.length,
        delivered: delivered.length,
        returned: orders.filter((o) => o.status === 'returned').length,
        spent: delivered.reduce((sum, o) => sum + Number(o.total), 0),
        delivery_rate: finished.length
          ? Math.round((delivered.length / finished.length) * 100)
          : null,
      },
    };
  }

  private async normalized(phone: string | null | undefined) {
    return phone
      ? this.db.call<string | null>('normalize_phone', { p_phone: phone })
      : null;
  }

  private async rowFrom(body: Partial<z.infer<typeof updateSchema>>) {
    const row: Record<string, unknown> = { ...body };
    delete row.id;
    if ('phone' in body) row.phone = await this.normalized(body.phone);
    if ('phone_alt' in body)
      row.phone_alt = await this.normalized(body.phone_alt || null);
    if ('email' in body) row.email = body.email || null;
    if ('assigned_to' in body)
      row.assigned_to_email = body.assigned_to
        ? await memberEmail(this.db, body.assigned_to)
        : null;
    return row;
  }

  private async refuseTakenPhone(phone: unknown, exceptId?: string) {
    if (!phone) return;
    let query = this.db
      .selectFrom('customers')
      .select(['id', 'full_name'])
      .where('phone', '=', phone as string)
      .where('deleted_at', 'is', null);
    if (exceptId) query = query.where('id', '<>', exceptId);
    const existing = await query.executeTakeFirst();
    if (existing)
      throw new ApiError(
        `This phone already belongs to ${existing.full_name || 'another customer'}.`,
        409,
        'DUPLICATE_PHONE',
      );
  }

  @Post()
  async create(
    @Body(new Zod(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const row = await this.rowFrom(body);
    await this.refuseTakenPhone(row.phone);
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('customers')
        .values({
          channel: 'phone',
          ...row,
          assigned_to:
            row.assigned_to === undefined ? actor.userId : row.assigned_to,
          assigned_to_email:
            row.assigned_to === undefined ? actor.email : row.assigned_to_email,
          created_by: actor.userId,
          created_by_email: actor.email,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Put()
  async update(
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const row = await this.rowFrom(body);
    await this.refuseTakenPhone(row.phone, body.id);
    const saved = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('customers')
        .set(row as any)
        .where('id', '=', body.id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!saved) throw new ApiError('This customer no longer exists.', 404);
    return saved;
  }

  @Patch()
  async action(
    @Body(new Zod(actionSchema)) body: z.infer<typeof actionSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.action === 'merge') {
      if (!isManager(actor) && !actor.permissions.includes('delete'))
        throw new ApiError('Merging needs the delete permission.', 403);
      return this.db.withActor(actor, (trx) =>
        this.db.call(
          'merge_customers',
          { p_keep: body.keep_id, p_remove: body.remove_id },
          trx,
        ),
      );
    }
    if (body.action === 'anonymize') {
      if (!isManager(actor))
        throw new ApiError(
          'Only owners and admins can erase personal data.',
          403,
        );
      await this.db.withActor(actor, (trx) =>
        this.db.call('anonymize_customer', { p_id: body.id }, trx),
      );
      return { id: body.id };
    }
    if (body.action === 'bot') {
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('customers')
          .set(
            body.status === 'human'
              ? {
                  bot_status: 'human',
                  bot_handoff_reason: 'agent_took_over',
                  bot_handoff_at: new Date(),
                }
              : {
                  bot_status: body.status,
                  bot_handoff_reason: null,
                  bot_handoff_at: null,
                  bot_unclear_count: 0,
                },
          )
          .where('id', '=', body.id)
          .execute(),
      );
      return { id: body.id, bot_status: body.status };
    }
    const email = body.user_id
      ? await memberEmail(this.db, body.user_id)
      : null;
    if (body.user_id && !email)
      throw new ApiError('This agent is not on the team.');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('customers')
        .set({ assigned_to: body.user_id, assigned_to_email: email })
        .where('id', 'in', body.ids)
        .execute(),
    );
    return { changed: body.ids.length };
  }

  /** ?id= — removes a customer record (their orders stay). */
  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('customers')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

// ── Conversations ──

const interactionSchema = z.object({
  customer_id: zId,
  channel: z.enum([
    'website',
    'facebook',
    'instagram',
    'tiktok',
    'whatsapp',
    'phone',
    'store',
    'email',
    'other',
  ]),
  // in: what the customer said; out: what we said; note: internal.
  direction: z.enum(['in', 'out', 'note']),
  body: z.string().trim().min(1).max(5000),
  order_id: zId.nullish(),
  // Actually send it on the channel (Messenger, Instagram, WhatsApp) instead of only logging it.
  send: z.boolean().default(false),
});
const readSchema = z.object({ customer_id: zId });

@Controller('crm/interactions')
@Public()
export class InteractionsController {
  constructor(private readonly db: Database) {}

  /** ?customer_id= — one conversation (oldest first). Otherwise the inbox: latest message per customer, unread first (?unread=1). */
  @Get()
  async list(@Query() query: Record<string, string>) {
    const q = params(query);
    const customerId = q.get('customer_id');
    if (customerId) {
      return this.db
        .selectFrom('customer_interactions')
        .selectAll()
        .where('customer_id', '=', customerId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at')
        .limit(500)
        .execute();
    }
    let rows = this.db
      .selectFrom('customer_interactions as x')
      .select([
        'x.id',
        'x.customer_id',
        'x.channel',
        'x.direction',
        'x.body',
        'x.created_at',
        'x.read_at',
        'x.sender_name',
      ])
      .select((eb) =>
        one(
          eb,
          'customers as c',
          ['c.full_name', 'c.phone', 'c.stage', 'c.assigned_to_email'],
          'c.id',
          'x.customer_id',
        ).as('customer'),
      )
      .where('x.deleted_at', 'is', null)
      .where('x.channel', 'in', ['facebook', 'instagram', 'whatsapp', 'tiktok'])
      .orderBy('x.created_at', 'desc')
      .limit(1000);
    if (q.bool('unread'))
      rows = rows
        .where('x.direction', '=', 'in')
        .where('x.read_at', 'is', null);
    const latest = new Map<string, any>();
    for (const row of await rows.execute()) {
      const unread = row.direction === 'in' && !row.read_at ? 1 : 0;
      const seen = latest.get(row.customer_id);
      if (seen) seen.unread += unread;
      else latest.set(row.customer_id, { ...row, unread });
    }
    const threads = [...latest.values()].sort(
      (a, b) => Number(b.unread > 0) - Number(a.unread > 0),
    );
    return { threads, connected: metaConfigured() };
  }

  @Post()
  async create(
    @Body(new Zod(interactionSchema)) body: z.infer<typeof interactionSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    let externalId: string | null = null;
    if (body.send) {
      if (
        body.direction !== 'out' ||
        !['facebook', 'instagram', 'whatsapp'].includes(body.channel)
      ) {
        throw new ApiError(
          'Only replies on Messenger, Instagram or WhatsApp can be sent.',
        );
      }
      const channel = body.channel as MetaChannel;
      if (!metaConfigured()[channel])
        throw new ApiError(
          `${channel} is not connected yet. Log the message instead.`,
          503,
          'NOT_CONFIGURED',
        );
      const customer = await this.db
        .selectFrom('customers')
        .select(['phone', 'external_ids'])
        .where('id', '=', body.customer_id)
        .executeTakeFirst();
      const ids = (customer?.external_ids ?? {}) as Record<string, string>;
      const recipient =
        channel === 'whatsapp'
          ? (ids.whatsapp ?? (customer?.phone ? `216${customer.phone}` : null))
          : ids[channel === 'facebook' ? 'messenger' : 'instagram'];
      if (!recipient)
        throw new ApiError(
          'This customer has never written to us on this channel.',
          409,
        );
      try {
        externalId = await sendMetaText(channel, recipient, body.body);
      } catch (error) {
        throw new ApiError(
          `Not sent: ${(error as Error).message}`,
          502,
          'META',
        );
      }
    }
    return this.db.withActor(actor, async (trx) => {
      const row = await trx
        .insertInto('customer_interactions')
        .values({
          customer_id: body.customer_id,
          channel: body.channel,
          direction: body.direction,
          body: body.body,
          order_id: body.order_id ?? null,
          external_id: externalId,
          read_at: new Date(),
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('customers')
        .set({ updated_at: new Date() })
        .where('id', '=', body.customer_id)
        .execute();
      // An agent replying on the channel takes the conversation from the bot until they hand it back.
      if (body.send)
        await trx
          .updateTable('customers')
          .set({
            bot_status: 'human',
            bot_handoff_reason: 'agent_replied',
            bot_handoff_at: new Date(),
          })
          .where('id', '=', body.customer_id)
          .where('bot_status', '=', 'bot')
          .execute();
      return row;
    });
  }

  /** ?key= — a 5-minute link to a photo or voice note a customer sent (stored by the support bot). */
  @Get('file')
  async file(@Query('key') key: string | undefined) {
    if (!key || !/^conversations\/[\w-]+\/[\w.-]+$/.test(key))
      throw new ApiError('Invalid file');
    return { url: await signedUrl('documents', key, 300) };
  }

  /** { customer_id } — marks a customer's messages read. */
  @Put()
  async markRead(
    @Body(new Zod(readSchema)) body: z.infer<typeof readSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('customer_interactions')
        .set({ read_at: new Date() })
        .where('customer_id', '=', body.customer_id)
        .where('direction', '=', 'in')
        .where('read_at', 'is', null)
        .execute(),
    );
    return { customer_id: body.customer_id };
  }

  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('customer_interactions')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .where('direction', '=', 'note')
        .execute(),
    );
    return { id };
  }
}

// ── Follow-ups ──

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  due_at: z.string().datetime({ offset: true }),
  customer_id: zId.nullish(),
  order_id: zId.nullish(),
  assigned_to: zId.nullish(),
});
const taskUpdateSchema = z.object({
  id: zId,
  done: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  assigned_to: zId.nullable().optional(),
});

@Controller('crm/tasks')
@Public()
export class TasksController {
  constructor(private readonly db: Database) {}

  private select() {
    return this.db
      .selectFrom('crm_tasks as t')
      .selectAll('t')
      .select((eb) => [
        one(
          eb,
          'customers as c',
          ['c.id', 'c.full_name', 'c.phone', 'c.stage'],
          'c.id',
          't.customer_id',
        ).as('customer'),
        one(
          eb,
          'orders as o',
          ['o.id', 'o.order_number', 'o.status'],
          'o.id',
          't.order_id',
        ).as('order'),
      ])
      .where('t.deleted_at', 'is', null);
  }

  /** ?customer_id= | ?mine=1 | ?status=open|done|overdue&assigned=<id> */
  @Get()
  list(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    let rows = this.select();
    if (q.get('customer_id'))
      rows = rows.where('t.customer_id', '=', q.get('customer_id')!);
    if (q.bool('mine')) rows = rows.where('t.assigned_to', '=', actor.userId);
    else if (q.get('assigned'))
      rows = rows.where('t.assigned_to', '=', q.get('assigned')!);
    const status = q.get('status');
    if (status === 'open') rows = rows.where('t.done_at', 'is', null);
    if (status === 'done') rows = rows.where('t.done_at', 'is not', null);
    if (status === 'overdue')
      rows = rows
        .where('t.done_at', 'is', null)
        .where('t.due_at', '<', new Date().toISOString());
    return rows
      .orderBy('t.due_at')
      .limit(q.int('limit', 300, 1000))
      .execute();
  }

  @Post()
  async create(
    @Body(new Zod(taskCreateSchema)) body: z.infer<typeof taskCreateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const assignee =
      body.assigned_to === undefined ? actor.userId : body.assigned_to;
    const email = assignee
      ? assignee === actor.userId
        ? actor.email
        : await memberEmail(this.db, assignee)
      : null;
    const { id } = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('crm_tasks')
        .values({
          title: body.title,
          notes: body.notes || null,
          due_at: body.due_at,
          customer_id: body.customer_id ?? null,
          order_id: body.order_id ?? null,
          assigned_to: assignee,
          assigned_to_email: email,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return this.select().where('t.id', '=', id).executeTakeFirstOrThrow();
  }

  @Put()
  async update(
    @Body(new Zod(taskUpdateSchema)) body: z.infer<typeof taskUpdateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const row: Record<string, unknown> = {};
    if (body.done !== undefined) {
      row.done_at = body.done ? new Date() : null;
      row.done_by = body.done ? actor.userId : null;
    }
    if (body.title !== undefined) row.title = body.title;
    if (body.notes !== undefined) row.notes = body.notes;
    if (body.due_at !== undefined) row.due_at = body.due_at;
    if (body.assigned_to !== undefined) {
      row.assigned_to = body.assigned_to;
      row.assigned_to_email = body.assigned_to
        ? await memberEmail(this.db, body.assigned_to)
        : null;
    }
    const saved = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('crm_tasks')
        .set(row)
        .where('id', '=', body.id)
        .where('deleted_at', 'is', null)
        .returning('id')
        .executeTakeFirst(),
    );
    if (!saved) throw new ApiError('This follow-up no longer exists.', 404);
    return this.select().where('t.id', '=', body.id).executeTakeFirstOrThrow();
  }

  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('crm_tasks')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}
