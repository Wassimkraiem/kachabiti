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
import { sql } from 'kysely';
import { z } from 'zod';
import { CHANNELS, CUSTOMER_STAGES } from '@shared/erp/constants';
import {
  metaConfigured,
  sendMetaText,
  type MetaChannel,
} from '@shared/erp/meta';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, isManager, params, Zod, zDate, zId } from '../common/api';
import { Database } from '../db/database';
import { many, one } from '../db/embed';
import { deleteObject } from '../common/storage';
import { metaPageToken } from './meta-connection';
import { MetaMedia, replyTarget, type Attachment } from './meta-media';
import { claimCustomer } from './meta-messages';
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
]);

@Controller('customers')
@Public()
export class CustomersController {
  constructor(
    private readonly db: Database,
    private readonly media: MetaMedia,
  ) {}

  /** ?id= (record with orders, conversations, follow-ups) | ?duplicates=1 | list: ?q=&stage=&channel=&assigned=me|none|<id>&page=&size= */
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
    const assigned = q.get('assigned');
    if (assigned === 'me')
      filtered = filtered.where('assigned_to', '=', actor.userId);
    else if (assigned === 'none')
      filtered = filtered.where('assigned_to', 'is', null);
    else if (assigned) filtered = filtered.where('assigned_to', '=', assigned);
    // Became a customer between these days (YYYY-MM-DD, Tunis time: UTC+1 all year), both included.
    const from = q.get('from');
    const to = q.get('to');
    if (from)
      filtered = filtered.where(
        'created_at',
        '>=',
        new Date(`${zDate.parse(from)}T00:00:00+01:00`).toISOString(),
      );
    if (to)
      filtered = filtered.where(
        'created_at',
        '<',
        new Date(
          new Date(`${zDate.parse(to)}T00:00:00+01:00`).getTime() + 86_400_000,
        ).toISOString(),
      );

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
      const files = await this.media.files(body.id);
      await this.db.withActor(actor, (trx) =>
        this.db.call('anonymize_customer', { p_id: body.id }, trx),
      );
      for (const path of files) await deleteObject('documents', path);
      return { id: body.id };
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
const claimSchema = z.object({
  customer_id: zId,
  // take: an owner or admin takes it from another agent; release: back to nobody.
  action: z.enum(['claim', 'take', 'release']).default('claim'),
});
const readSchema = z.object({
  customer_id: zId,
  channel: z.string().max(20).optional(),
});

/** Channels with conversations in the Messenger screen. */
const CHAT_CHANNELS = ['facebook', 'instagram', 'whatsapp', 'tiktok'];

const likeTerm = (term: string | null | undefined) =>
  term ? `%${term.replace(/[%_]/g, ' ')}%` : null;

@Controller('crm/interactions')
@Public()
export class InteractionsController {
  constructor(
    private readonly db: Database,
    private readonly media: MetaMedia,
  ) {}

  /**
   * ?customer_id=&channel= — one conversation, oldest first (its latest 500 messages). Otherwise the
   * Messenger list: one thread per customer and channel, latest first (?channel=&unread=1&q=), with
   * the unread messages per channel.
   */
  @Get()
  async list(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    const customerId = q.get('customer_id');
    const channel = q.get('channel');
    if (customerId) {
      let rows = this.db
        .selectFrom('customer_interactions')
        .selectAll()
        .where('customer_id', '=', customerId)
        .where('deleted_at', 'is', null);
      if (channel) rows = rows.where('channel', '=', channel);
      const latest = await rows
        .orderBy('created_at', 'desc')
        .limit(500)
        .execute();
      this.media.background(this.media.recover(latest));
      return latest.reverse().map((row) => ({
        ...row,
        attachments: ((row.attachments ?? []) as unknown as Attachment[]).map(
          (a) => ({ type: a.type }),
        ),
      }));
    }
    const channels = channel ? [channel] : CHAT_CHANNELS;
    const like = likeTerm(q.get('q'));
    const [threads, counts] = await Promise.all([
      sql<Record<string, unknown>>`
        select l.*, coalesce(u.n, 0)::int as unread,
               json_build_object('full_name', c.full_name, 'phone', c.phone, 'stage', c.stage,
                                 'assigned_to', c.assigned_to,
                                 'assigned_to_email', c.assigned_to_email) as customer,
               c.external_ids ? ((case l.channel when 'facebook' then 'messenger' else l.channel end) || '_photo') as photo
        from (
          select distinct on (x.customer_id, x.channel)
                 x.customer_id, x.channel, x.direction, x.body, x.created_at, x.sender_name
          from customer_interactions x
          where x.deleted_at is null and x.channel = any(${channels}::text[])
          order by x.customer_id, x.channel, x.created_at desc
        ) l
        join customers c on c.id = l.customer_id and c.deleted_at is null
        left join (
          select customer_id, channel, count(*) as n from customer_interactions
          where direction = 'in' and read_at is null and deleted_at is null
          group by 1, 2
        ) u on u.customer_id = l.customer_id and u.channel = l.channel
        where (not ${q.bool('unread')}::boolean or u.n > 0)
          and (not ${q.get('assigned') === 'me'}::boolean or c.assigned_to = ${actor.userId}::uuid)
          and (${like}::text is null or c.full_name ilike ${like}
               or c.phone ilike ${like} or l.body ilike ${like})
        order by l.created_at desc
        limit 200`.execute(this.db),
      sql<{ channel: string; n: number }>`
        select x.channel, count(*)::int as n
        from customer_interactions x
        join customers c on c.id = x.customer_id and c.deleted_at is null
        where x.direction = 'in' and x.read_at is null and x.deleted_at is null
          and x.channel = any(${CHAT_CHANNELS}::text[])
        group by 1`.execute(this.db),
    ]);
    this.media.background(
      this.media.profiles(
        threads.rows as { customer_id: string; channel: string }[],
      ),
    );
    return {
      threads: threads.rows,
      unread: Object.fromEntries(counts.rows.map((r) => [r.channel, r.n])),
      connected: metaConfigured(await metaPageToken(this.db)),
    };
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
      await claimCustomer(this.db, actor, body.customer_id);
      const { recipient, pageToken } = await replyTarget(
        this.db,
        body.customer_id,
        channel,
      );
      try {
        externalId = await sendMetaText(
          channel,
          recipient,
          body.body,
          pageToken,
        );
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
        // Meta's echo of this reply may have been stored first: keep one, with its sender.
        .onConflict((oc) =>
          oc.columns(['channel', 'external_id']).doUpdateSet({
            created_by: actor.userId,
            created_by_email: actor.email,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('customers')
        .set({ updated_at: new Date() })
        .where('id', '=', body.customer_id)
        .execute();
      return row;
    });
  }

  /** { customer_id, action } — who answers this customer (opening an unassigned conversation claims it). */
  @Post('claim')
  async claim(
    @Body(new Zod(claimSchema)) body: z.infer<typeof claimSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.action === 'take' && !isManager(actor))
      throw new ApiError(
        'Only owners and admins can take a conversation over.',
        403,
      );
    if (body.action !== 'release')
      return claimCustomer(
        this.db,
        actor,
        body.customer_id,
        body.action === 'take',
      );
    const released = await this.db.withActor(actor, (trx) => {
      let query = trx
        .updateTable('customers')
        .set({ assigned_to: null, assigned_to_email: null })
        .where('id', '=', body.customer_id)
        .where('deleted_at', 'is', null);
      if (!isManager(actor))
        query = query.where('assigned_to', '=', actor.userId);
      return query.returning('id').executeTakeFirst();
    });
    if (!released)
      throw new ApiError(
        'This conversation is assigned to another agent.',
        409,
        'ASSIGNED',
      );
    return { assigned_to_email: null };
  }

  /** { customer_id, channel? } — marks a customer's messages read (on one channel, or all). */
  @Put()
  async markRead(
    @Body(new Zod(readSchema)) body: z.infer<typeof readSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    await this.db.withActor(actor, (trx) => {
      let rows = trx
        .updateTable('customer_interactions')
        .set({ read_at: new Date() })
        .where('customer_id', '=', body.customer_id)
        .where('direction', '=', 'in')
        .where('read_at', 'is', null);
      if (body.channel) rows = rows.where('channel', '=', body.channel);
      return rows.execute();
    });
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

// ── Public comments on the shop's posts ──

const commentsPatchSchema = z.object({
  ids: z.array(zId).min(1).max(500),
  handled: z.boolean(),
});

/** Whose comment it is: Meta's id when it sends one, else the name, else the comment alone. */
const AUTHOR_KEY = sql<string>`coalesce(sc.author_id, sc.author_name, sc.id::text)`;

@Controller('crm/comments')
@Public()
export class CommentsController {
  constructor(private readonly db: Database) {}

  /** One thread per person and platform, latest first, with the comments to handle per platform. */
  private async threads(q: ReturnType<typeof params>) {
    const platform = q.get('platform') || null;
    const show = q.get('show') || 'all';
    const like = likeTerm(q.get('q'));
    const [threads, counts] = await Promise.all([
      sql<Record<string, unknown>>`
        select t.* from (
          select sc.platform, ${AUTHOR_KEY} as author,
                 max(sc.author_name) as author_name,
                 (array_agg(sc.body order by sc.commented_at desc))[1] as body,
                 max(sc.commented_at) as commented_at,
                 max(sc.phone) as phone,
                 count(*) filter (where sc.handled_at is null)::int as open,
                 bool_or(${like}::text is null or sc.body ilike ${like}
                         or sc.author_name ilike ${like} or sc.phone ilike ${like}) as matches
          from social_comments sc
          where sc.deleted_at is null and (${platform}::text is null or sc.platform = ${platform})
          group by 1, 2
        ) t
        where t.matches
          and (${show}::text <> 'leads' or t.phone is not null)
          and (${show}::text <> 'open' or t.open > 0)
        order by t.commented_at desc
        limit 200`.execute(this.db),
      sql<{ platform: string; n: number }>`
        select platform, count(*)::int as n from social_comments
        where deleted_at is null and handled_at is null group by 1`.execute(
        this.db,
      ),
    ]);
    return {
      threads: threads.rows,
      open: Object.fromEntries(counts.rows.map((r) => [r.platform, r.n])),
      connected: metaConfigured(await metaPageToken(this.db)),
    };
  }

  /**
   * ?threads=1 — the Messenger list, one thread per person. Otherwise the comments, newest first:
   * ?show=all|leads (with a phone)|open (not handled) &platform=&author= (a thread's key) &q=&page=
   */
  @Get()
  async list(@Query() query: Record<string, string>) {
    const q = params(query);
    if (q.bool('threads')) return this.threads(q);
    const page = q.int('page', 1, 10_000);
    const size = q.int('size', 50, 200);
    let filtered = this.db
      .selectFrom('social_comments as sc')
      .where('sc.deleted_at', 'is', null);
    if (q.get('show') === 'leads')
      filtered = filtered.where('sc.phone', 'is not', null);
    if (q.get('show') === 'open')
      filtered = filtered.where('sc.handled_at', 'is', null);
    if (q.get('platform'))
      filtered = filtered.where('sc.platform', '=', q.get('platform')!);
    if (q.get('author'))
      filtered = filtered.where(
        sql<boolean>`${AUTHOR_KEY} = ${q.get('author')}`,
      );
    const term = q.get('q');
    if (term) {
      const like = `%${term.replace(/[%_]/g, ' ')}%`;
      filtered = filtered.where((eb) =>
        eb.or([
          eb('sc.body', 'ilike', like),
          eb('sc.author_name', 'ilike', like),
          eb('sc.phone', 'ilike', like),
        ]),
      );
    }
    const count = (show: 'leads' | 'open') =>
      this.db
        .selectFrom('social_comments')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('deleted_at', 'is', null)
        .where(
          show === 'leads' ? 'phone' : 'handled_at',
          show === 'leads' ? 'is not' : 'is',
          null,
        )
        .executeTakeFirstOrThrow();
    const [rows, total, leads, open] = await Promise.all([
      filtered
        .selectAll('sc')
        .select((eb) => [
          one(
            eb,
            'customers as c',
            ['c.id', 'c.full_name', 'c.stage', 'c.assigned_to_email'],
            'c.id',
            'sc.customer_id',
            (q) => q.where('c.deleted_at', 'is', null),
          ).as('customer'),
          one(
            eb,
            'crm_tasks as t',
            ['t.id', 't.done_at'],
            't.id',
            'sc.task_id',
            (q) => q.where('t.deleted_at', 'is', null),
          ).as('task'),
        ])
        .orderBy('sc.commented_at', 'desc')
        .limit(size)
        .offset((page - 1) * size)
        .execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
      count('leads'),
      count('open'),
    ]);
    return {
      rows,
      total: total.n,
      page,
      size,
      leads: leads.n,
      open: open.n,
      connected: metaConfigured(await metaPageToken(this.db)),
    };
  }

  /** { ids, handled } — marks comments handled (or not) by the signed-in agent. */
  @Patch()
  async patch(
    @Body(new Zod(commentsPatchSchema))
    body: z.infer<typeof commentsPatchSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const changed = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('social_comments')
        .set(
          body.handled
            ? {
                handled_at: new Date(),
                handled_by: actor.userId,
                handled_by_email: actor.email,
              }
            : { handled_at: null, handled_by: null, handled_by_email: null },
        )
        .where('id', 'in', body.ids)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
    );
    return { changed: Number(changed.numUpdatedRows) };
  }
}
