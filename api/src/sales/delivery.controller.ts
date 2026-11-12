import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { z } from 'zod';
import {
  ColissimoError,
  colissimoConfigured,
  createParcel,
  deleteParcels,
  editParcel,
  handOverParcels,
  requestPriceChange,
  trackParcel,
  type ParcelChanges,
  type ParcelRequest,
} from '@shared/colissimo';
import {
  COLISSIMO_GOVERNORATES,
  parcelFromOrder,
  statusInfo,
} from '@shared/colissimo-data';
import { MANUAL_CHANNELS, type Channel } from '@shared/erp/constants';
import { generateOrderNumber } from '@shared/order-number';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import {
  ApiError,
  idsFrom,
  isManager,
  params,
  Raw,
  zDate,
} from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { Database } from '../db/database';
import {
  buildManualOrderLines,
  ManualLineError,
  type ManualLineInput,
} from './commerce';
import { parcelDetail, parcelSlip, PortalError } from './colissimo-portal';
import { ColissimoTracking } from './colissimo-tracking';

// Parcels sent to Colissimo (Admin → Delivery, the order page). GET lists them; POST sends,
// validates, quotes, tracks, imports, refreshes, hands over for pickup, edits or asks a price
// change; DELETE deletes them at Colissimo (while it allows) and removes them from the list.

const parcelSchema = z.object({
  nom: z.string().trim().min(1).max(100),
  gouvernerat: z.enum(COLISSIMO_GOVERNORATES as [string, ...string[]]),
  ville: z.string().trim().min(1).max(100),
  adresse: z.string().trim().min(1).max(250),
  tel: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'Phone must be exactly 8 digits'),
  tel2: z
    .string()
    .trim()
    .regex(/^(\d{8})?$/, 'Second phone must be 8 digits')
    .optional(),
  designation: z.string().trim().min(1).max(250),
  nb_article: z.number().int().min(1).max(999),
  prix: z.number().min(0).max(100000),
  msg: z.string().trim().max(250).optional(),
  echange: z.enum(['oui', 'non']),
  article: z.string().trim().max(250).optional(),
  nb_echange: z.number().int().min(0).max(999).optional(),
  ouvrir: z.union([z.literal(0), z.literal(1)]),
  fragile: z.union([z.literal(0), z.literal(1)]),
  type_colis: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const itemsSchema = z.array(
  z.object({
    product_id: z.guid(),
    variant_id: z.guid().nullish(),
    quantity: z.number().int().min(1).max(999),
  }),
);
const barcode = z
  .string()
  .trim()
  .regex(/^\d{6,20}$/, 'Barcode must be digits');
const bodySchema = z.discriminatedUnion('action', [
  // A parcel for an order, or entered by hand; with `items` (no order_id) an order is created and validated.
  z.object({
    action: z.literal('create'),
    order_id: z.guid().optional(),
    parcel: parcelSchema,
    items: itemsSchema.max(50).optional(),
    channel: z.enum(MANUAL_CHANNELS as [Channel, ...Channel[]]).optional(),
    campaign_id: z.guid().nullish(),
  }),
  // Validating an order: its parcel is built from the order and sent, then the order is validated.
  z.object({ action: z.literal('validate'), order_id: z.guid() }),
  // Prices for products picked in "New parcel", without saving.
  z.object({ action: z.literal('quote'), items: itemsSchema.min(1).max(50) }),
  // One parcel's status at Colissimo, without saving.
  z.object({ action: z.literal('track'), barcode }),
  z.object({
    action: z.literal('import'),
    barcode,
    order_id: z.guid().optional(),
  }),
  z.object({
    action: z.literal('refresh'),
    ids: z.array(z.guid()).max(200).optional(),
  }),
  // Parcels waiting for pickup → Colissimo's manifest ("A enlever").
  z.object({
    action: z.literal('handover'),
    ids: z.array(z.guid()).min(1).max(200),
  }),
  // A parcel waiting for pickup: the fields to change, at Colissimo and on its order.
  z.object({
    action: z.literal('edit'),
    id: z.guid(),
    parcel: parcelSchema
      .pick({
        nom: true,
        gouvernerat: true,
        ville: true,
        adresse: true,
        tel: true,
        tel2: true,
        designation: true,
        nb_article: true,
        prix: true,
      })
      .partial(),
  }),
  // A printed or picked-up parcel's price: a request Colissimo answers later.
  z.object({
    action: z.literal('price_change'),
    id: z.guid(),
    price: z.number().min(0).max(99999.999),
    reason: z.string().trim().max(255).optional(),
  }),
]);

const notConfigured = (what: 'add' | 'tracking') =>
  new ApiError(
    what === 'add'
      ? 'Colissimo is not set up: add COLISSIMO_ADD_TOKEN to the server environment'
      : 'Colissimo tracking is not set up: add COLISSIMO_TRACKING_TOKEN to the server environment',
    503,
    'NOT_CONFIGURED',
  );

function dbError(error: any): never {
  const message: string = error?.message ?? '';
  if (message.includes('order_not_found'))
    throw new ApiError('Order not found', 404);
  if (message.includes('order_cancelled'))
    throw new ApiError('This order is cancelled', 409, 'ORDER_CANCELLED');
  if (message.includes('delivery_exists') || error?.code === '23505') {
    throw new ApiError(
      'This order or barcode already has a parcel',
      409,
      'DELIVERY_EXISTS',
    );
  }
  throw error;
}

const PAID = 'Livre paye';
const asSeen = (status: string) => (status === PAID ? 'Livre' : status);

/**
 * A parcel as staff see it: no cash to collect, price change, order total or Colissimo request
 * (it holds the price), and "delivered and paid" shown as delivered. Owners and admins see all.
 */
function withoutMoney<
  T extends { status: string; order: { total: unknown } | null },
>(row: T) {
  return {
    ...row,
    status: asSeen(row.status),
    paid: false,
    cod_amount: null,
    price_change: null,
    request: null,
    order: row.order ? { ...row.order, total: null } : null,
  };
}

@Controller('delivery')
@Public()
export class DeliveryController {
  constructor(
    private readonly db: Database,
    private readonly tracking: ColissimoTracking,
  ) {}

  private live() {
    return this.db
      .selectFrom('deliveries as d')
      .where('d.deleted_at', 'is', null);
  }

  private select(parcels = this.live()) {
    return parcels
      .selectAll('d')
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('orders as o')
            .select([
              'o.id',
              'o.order_number',
              'o.customer_first_name',
              'o.customer_last_name',
              'o.status',
              'o.total',
            ])
            .whereRef('o.id', '=', 'd.order_id'),
        ).as('order'),
      );
  }

  /**
   * One page of Admin → Delivery. Tabs count the parcels within the dates and source, whatever the
   * search; `waiting` is what "Validate for pickup" takes when nothing is ticked: every parcel
   * shown that Colissimo can still take, on any page.
   */
  /** `showMoney`: owners and admins see each status's cash to collect; staff only the counts. */
  /** `isOwner`: owners also see the old parcels whose fate is unknown (OLD-ORDERS-UNKNOWN). */
  private async page(
    q: ReturnType<typeof params>,
    showMoney: boolean,
    isOwner: boolean,
  ) {
    const page = q.int('page', 1, 10_000);
    const size = q.int('size', 25, 200);
    let sent = this.live();
    // What Colissimo's account lists, like its dashboard (deliveries.in_colissimo, kept by the
    // account sync). Owners and admins may ask for all their data (?scope=all, old tools included).
    if (!(showMoney && q.get('scope') === 'all'))
      sent = sent.where((eb) =>
        isOwner
          ? eb.or([
              eb('d.in_colissimo', '=', true),
              eb('d.status', '=', 'OLD-ORDERS-UNKNOWN'),
            ])
          : eb('d.in_colissimo', '=', true),
      );
    // Sent between these days (YYYY-MM-DD, Tunis time: UTC+1 all year), both included.
    const from = q.get('from');
    const to = q.get('to');
    if (from)
      sent = sent.where(
        'd.created_at',
        '>=',
        new Date(`${zDate.parse(from)}T00:00:00+01:00`).toISOString(),
      );
    if (to)
      sent = sent.where(
        'd.created_at',
        '<',
        new Date(
          new Date(`${zDate.parse(to)}T00:00:00+01:00`).getTime() + 86_400_000,
        ).toISOString(),
      );
    const source = q.get('source');
    const imported = sql<boolean>`exists (select 1 from orders o where o.id = d.order_id and o.order_number like 'COL-%')`;
    if (source === 'imported') sent = sent.where(imported);
    if (source === 'system') sent = sent.where(sql<boolean>`not ${imported}`);

    const hasBarcode = sql<boolean>`d.barcode is not null`;
    const groups = await sent
      .select([
        'd.status',
        hasBarcode.as('has_barcode'),
        (eb) => eb.fn.countAll<number>().as('n'),
        sql<number>`coalesce(sum(d.cod_amount), 0)`.as('amount'),
      ])
      .groupBy(['d.status', hasBarcode])
      .execute();
    // The same rule as canEditParcel() on the page; statusInfo() stays the one map of statuses.
    const tabOf = (g: { status: string; has_barcode: boolean }) =>
      g.has_barcode && g.status === 'En attente'
        ? 'validate'
        : statusInfo(g.status).group;
    const counts = {
      all: 0,
      validate: 0,
      pending: 0,
      moving: 0,
      delivered: 0,
      returned: 0,
      problem: 0,
    };
    for (const group of groups) {
      counts.all += Number(group.n);
      counts[tabOf(group)] += Number(group.n);
    }

    const canTake = sql<boolean>`d.status = 'En attente' and d.barcode is not null`;
    let shown = sent;
    const tab = q.get('tab');
    // ?statuses=a,b: Colissimo's own statuses (the page's status cards, like Colissimo's dashboard).
    // Staff don't see payments: for them "delivered and paid" is just delivered (asSeen).
    let statuses = q.get('statuses')?.split(',').filter(Boolean);
    if (statuses?.length && !showMoney)
      statuses = statuses.some((s) => s === 'Livre' || s === 'Livrer')
        ? [...statuses, PAID]
        : statuses.filter((s) => s !== PAID).concat('-'); // '-' matches nothing: never an empty list
    if (statuses?.length)
      shown = shown.where(sql<boolean>`d.status = any(${statuses})`);
    else if (tab === 'validate') shown = shown.where(canTake);
    else if (tab && tab !== 'all') {
      const statuses = groups
        .filter((g) => tabOf(g) === tab)
        .map((g) => g.status);
      shown = shown.where(
        sql<boolean>`d.status = any(${statuses}) and not (${canTake})`,
      );
    }
    const term = q.get('q');
    if (term) {
      const like = `%${term.replace(/[%,()]/g, ' ')}%`;
      shown = shown.where((eb) =>
        eb.or([
          eb('d.barcode', 'ilike', like),
          eb('d.recipient_name', 'ilike', like),
          eb('d.phone', 'ilike', like),
          eb('d.governorate', 'ilike', like),
          eb('d.city', 'ilike', like),
          sql<boolean>`exists (select 1 from orders o where o.id = d.order_id and (
            o.order_number ilike ${like} or o.customer_first_name || ' ' || o.customer_last_name ilike ${like}))`,
        ]),
      );
    }

    const [rows, count, waiting] = await Promise.all([
      this.select(shown)
        .orderBy(
          q.get('sort') === 'changed'
            ? sql`coalesce(d.status_changed_at, d.created_at)`
            : sql`d.created_at`,
          q.get('dir') === 'asc' ? 'asc' : 'desc',
        )
        .orderBy('d.id')
        .limit(size)
        .offset((page - 1) * size)
        .execute(),
      shown
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
      shown.where(canTake).select('d.id').execute(),
    ]);
    return {
      rows: showMoney ? rows : rows.map(withoutMoney),
      total: Number(count.n),
      counts,
      // Parcels per Colissimo status, and their cash to collect for owners and admins only.
      by_status: groups.map((g) => ({
        status: showMoney ? g.status : asSeen(g.status),
        n: Number(g.n),
        ...(showMoney ? { amount: Number(g.amount) } : {}),
      })),
      waiting: waiting.map((row) => row.id),
    };
  }

  @Get()
  async list(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    const orderId = q.get('order_id');
    const status = {
      configured: colissimoConfigured(),
      // The last automatic check (every 15 minutes), for "checked … ago".
      tracking: this.tracking.lastRun,
    };
    if (q.get('page'))
      return {
        ...(await this.page(q, isManager(actor), actor.role === 'owner')),
        ...status,
      };
    // shortcut: without ?page= the whole list is sent, for Admin → Colissimo account's totals
    // (about 12,000 parcels in Nov 2026); give it totals from the server as it nears this limit.
    // The whole list is for Admin → Colissimo account (owners); staff read pages or one order's parcels.
    if (!orderId && !isManager(actor))
      throw new ApiError('Add ?page= to list parcels', 400);
    let list = this.select().orderBy('d.created_at', 'desc').limit(30000);
    if (orderId) list = list.where('d.order_id', '=', orderId);
    const rows = await list.execute();
    return {
      rows: isManager(actor) ? rows : rows.map(withoutMoney),
      ...status,
    };
  }

  /**
   * The parcel's half-page delivery slip from Colissimo's website, for /admin/delivery/print.
   * It's their page and scripts served from our address, so it's sandboxed: the scripts (barcode,
   * QR code) run, but in an opaque origin that can't read our cookies or pages.
   */
  @Get('slip')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', 'sandbox allow-scripts allow-modals')
  @Header('Cache-Control', 'no-store')
  async slip(@Query('code') code = '') {
    if (!/^\d{6,20}$/.test(code)) throw new ApiError('Enter a valid barcode');
    try {
      const html = await parcelSlip(code);
      if (!html)
        throw new ApiError('Colissimo has no parcel with this barcode', 404);
      return new Raw(html);
    } catch (error) {
      if (error instanceof PortalError) throw new ApiError(error.message, 502);
      throw error;
    }
  }

  /** A parcel's details and full status history, read from Colissimo's website (any barcode). */
  @Get('history')
  async history(@Query('code') code = '', @CurrentActor() actor: RequestActor) {
    if (!/^\d{6,20}$/.test(code)) throw new ApiError('Enter a valid barcode');
    try {
      const detail = await parcelDetail(code);
      if (!detail)
        throw new ApiError('Colissimo has no parcel with this barcode', 404);
      if (isManager(actor)) return detail;
      // Staff don't see money: drop Colissimo's amount fields (Montant, Prix, frais…).
      return {
        ...detail,
        fields: detail.fields.filter(
          (f) => !/montant|prix|price|frais|cod|paye|payé/i.test(f.label),
        ),
      };
    } catch (error) {
      if (error instanceof PortalError) throw new ApiError(error.message, 502);
      throw error;
    }
  }

  @Post()
  @HttpCode(200)
  async post(@Body() raw: unknown, @CurrentActor() actor: RequestActor) {
    const parsed = bodySchema.safeParse(raw ?? null);
    if (!parsed.success)
      throw new ApiError(parsed.error.issues[0]?.message ?? 'Invalid request');
    const body = parsed.data;
    try {
      if (body.action === 'create') {
        if (!body.order_id && body.items?.length) {
          return await this.sendNewOrder(
            body.parcel,
            body.items,
            actor,
            body.channel ?? 'phone',
            body.campaign_id ?? null,
          );
        }
        return await this.sendParcel(body.order_id ?? null, body.parcel, actor);
      }
      if (body.action === 'validate')
        return await this.validateOrder(body.order_id, actor);
      if (body.action === 'quote')
        return { lines: await buildManualOrderLines(this.db, body.items) };
      if (body.action === 'track') return await this.lookUp(body.barcode);
      if (body.action === 'import')
        return await this.importParcel(
          body.barcode,
          body.order_id ?? null,
          actor,
        );
      if (body.action === 'handover')
        return await this.handOver(body.ids, actor);
      if (body.action === 'edit')
        return await this.edit(body.id, body.parcel, actor);
      if (body.action === 'price_change')
        return await this.priceChange(body.id, body.price, body.reason, actor);
      if (!colissimoConfigured().tracking) throw notConfigured('tracking');
      return await this.tracking.run(actor, body.ids);
    } catch (error) {
      if (error instanceof ManualLineError)
        throw new ApiError(error.message, 422, 'INVALID_ITEMS');
      if (error instanceof ColissimoError)
        throw new ApiError(error.message, 502, error.code ?? 'COLISSIMO');
      throw error;
    }
  }

  /**
   * ?ids=a,b — removes parcels from this list (soft delete), after deleting them at Colissimo when
   * they're still waiting for pickup. One Colissimo already has (picked up, on its way…) stays, with
   * the reason in `kept`: removing it here would let the order be sent twice.
   */
  @Delete()
  async remove(
    @Query() query: { ids?: string },
    @CurrentActor() actor: RequestActor,
  ) {
    const ids = idsFrom({ ids: query.ids });
    if (ids.length === 0) throw new ApiError('No parcel selected');
    const parcels = await this.db
      .selectFrom('deliveries')
      .select(['id', 'barcode', 'status'])
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .execute();
    // Only a parcel waiting for pickup is deleted (here and at Colissimo); ones that never reached
    // Colissimo or that it already deleted just go. Validated ones ("A enlever") and later stay.
    const live = parcels.filter((p) => p.barcode && p.status === 'En attente');
    const kept: { id: string; barcode: string; reason: string }[] = [];
    if (live.length) {
      if (!colissimoConfigured().add) throw notConfigured('add');
      const results = await deleteParcels(live.map((p) => p.barcode!));
      for (const parcel of live) {
        const result = results.get(parcel.barcode!);
        if (!result?.deleted && !result?.notFound)
          kept.push({
            id: parcel.id,
            barcode: parcel.barcode!,
            reason: result?.message ?? '',
          });
      }
    }
    const validated = parcels.filter(
      (p) => p.barcode && !live.includes(p) && p.status !== 'Supprime',
    );
    for (const parcel of validated)
      kept.push({
        id: parcel.id,
        barcode: parcel.barcode!,
        reason:
          'This parcel is already validated at Colissimo: only parcels waiting for pickup can be deleted',
      });
    const removable = parcels
      .filter((p) => !kept.some((k) => k.id === p.id))
      .map((p) => p.id);
    if (removable.length)
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('deliveries')
          .set({ deleted_at: new Date(), updated_at: new Date() })
          .where('id', 'in', removable)
          .where('deleted_at', 'is', null)
          .execute(),
      );
    return { deleted: removable.length, kept };
  }

  /** A parcel was created at Colissimo but saving it here failed: delete it there again (it's still
   * waiting for pickup), so nothing exists at Colissimo that this list doesn't know. */
  private async undoCreatedParcel(barcode: string) {
    try {
      const result = (await deleteParcels([barcode])).get(barcode);
      return !!(result?.deleted || result?.notFound);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: 'admin-delivery', action: 'undo-create' },
      });
      return false;
    }
  }

  private savedFailed(barcode: string, undone: boolean) {
    return undone
      ? new ApiError(
          'Saving the parcel failed, so it was cancelled at Colissimo too. Nothing was sent: try again.',
          500,
          'SAVE_FAILED',
        )
      : new ApiError(
          `Colissimo created parcel ${barcode}, but saving it failed. Add it with "Add by barcode".`,
          500,
          'SAVE_FAILED',
          { barcode },
        );
  }

  // Reserve the parcel row (for an order: its single live parcel), create the parcel at Colissimo,
  // then record its barcode and validate the order. If Colissimo refuses, the row is released; if
  // saving fails after Colissimo created it, the parcel is deleted there again.
  private async sendParcel(
    orderId: string | null,
    parcel: ParcelRequest,
    actor: RequestActor,
  ) {
    if (!colissimoConfigured().add) throw notConfigured('add');
    const reserved = await this.db
      .withActor(actor, (trx) =>
        orderId
          ? this.db.call<{ id: string }>(
              'begin_delivery',
              {
                p_order_id: orderId,
                p_request: parcel,
                p_actor: actor.userId,
                p_actor_email: actor.email,
              },
              trx,
            )
          : trx
              .insertInto('deliveries')
              .values({
                status: 'sending',
                recipient_name: parcel.nom,
                phone: parcel.tel,
                governorate: parcel.gouvernerat,
                city: parcel.ville,
                address: parcel.adresse,
                cod_amount: parcel.prix,
                items_count: parcel.nb_article,
                designation: parcel.designation,
                request: JSON.stringify(parcel),
                created_by: actor.userId,
                created_by_email: actor.email,
              })
              .returning('id')
              .executeTakeFirstOrThrow(),
      )
      .catch(dbError);

    let created: Awaited<ReturnType<typeof createParcel>>;
    try {
      created = await createParcel(parcel);
    } catch (error) {
      await this.db.withActor(actor, (trx) =>
        this.db.call(
          'fail_delivery',
          { p_id: reserved.id, p_error: (error as Error).message },
          trx,
        ),
      );
      throw error;
    }

    try {
      const result = await this.db.withActor(actor, (trx) =>
        this.db.call<{
          delivery: unknown;
          order: unknown;
          warning: string | null;
        }>(
          'complete_delivery',
          {
            p_id: reserved.id,
            p_barcode: created.barcode,
            p_label_url: created.labelUrl,
            p_label_zebra_url: created.labelZebraUrl,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
      await invalidateCatalog(); // validating the order took its items out of stock
      return {
        delivery: result.delivery,
        order: result.order,
        warning: result.warning,
      };
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: 'admin-delivery', action: 'complete' },
      });
      const undone = await this.undoCreatedParcel(created.barcode);
      await this.db
        .withActor(actor, (trx) =>
          this.db.call(
            'fail_delivery',
            {
              p_id: reserved.id,
              p_error: `${undone ? 'Created and deleted again' : 'Created'} as ${created.barcode}, not saved: ${(error as Error).message}`,
            },
            trx,
          ),
        )
        .catch((failError) => Sentry.captureException(failError));
      throw this.savedFailed(created.barcode, undone);
    }
  }

  // "New parcel" with products: price the lines, create the parcel at Colissimo, then save the
  // order, lines and parcel and validate the order in one transaction (create_order_with_delivery).
  private async sendNewOrder(
    parcel: ParcelRequest,
    items: ManualLineInput[],
    actor: RequestActor,
    channel: Channel,
    campaignId: string | null,
  ) {
    if (!colissimoConfigured().add) throw notConfigured('add');
    const lines = await buildManualOrderLines(this.db, items); // create_order ignores the extra `stock` field
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const [firstName, ...rest] = parcel.nom.trim().split(/\s+/);

    const created = await createParcel(parcel);
    try {
      const result = await this.db.withActor(actor, (trx) =>
        this.db.call<{ delivery: unknown; order: unknown }>(
          'create_order_with_delivery',
          {
            p_order: {
              order_number: generateOrderNumber(),
              customer_first_name: firstName,
              customer_last_name: rest.join(' '),
              customer_phone: parcel.tel,
              shipping_address: parcel.adresse,
              shipping_city: parcel.ville,
              shipping_state: parcel.gouvernerat,
              shipping_country: 'Tunisia',
              // The cash to collect is what the customer pays; above the products, it's the delivery fee.
              subtotal,
              shipping_cost: Math.max(0, parcel.prix - subtotal),
              total: parcel.prix,
              order_notes: parcel.msg || null,
              channel,
              campaign_id: campaignId,
              assigned_to: actor.userId,
              assigned_to_email: actor.email,
            },
            p_items: lines,
            p_delivery: {
              barcode: created.barcode,
              label_url: created.labelUrl,
              label_zebra_url: created.labelZebraUrl,
              request: parcel,
            },
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
      await invalidateCatalog(); // the products left the stock
      return { delivery: result.delivery, order: result.order, warning: null };
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: 'admin-delivery', action: 'create-order' },
      });
      throw this.savedFailed(
        created.barcode,
        await this.undoCreatedParcel(created.barcode),
      );
    }
  }

  // The Validate button: send the order's parcel from its details, then validate it. Missing
  // details → NEEDS_DETAILS (completed in the send form). Without Colissimo, validate without a parcel.
  private async validateOrder(orderId: string, actor: RequestActor) {
    const order = await this.db
      .selectFrom('orders as o')
      .select([
        'o.id',
        'o.status',
        'o.customer_first_name',
        'o.customer_last_name',
        'o.customer_phone',
        'o.shipping_address',
        'o.shipping_city',
        'o.shipping_state',
        'o.total',
        'o.payment_status',
        'o.order_notes',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('order_items as i')
            .select(['i.product_name', 'i.variant_label', 'i.quantity'])
            .whereRef('i.order_id', '=', 'o.id'),
        ).as('items'),
      )
      .where('o.id', '=', orderId)
      .where('o.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!order) throw new ApiError('Order not found', 404);
    if (order.status !== 'pending' && order.status !== 'confirmed') {
      throw new ApiError(
        'This order is already validated',
        409,
        'ALREADY_VALIDATED',
      );
    }

    if (!colissimoConfigured().add) {
      const updated = await this.db.withActor(actor, (trx) =>
        this.db.call<{ status: string; stock_deducted: boolean }>(
          'set_order_status',
          {
            p_order_id: orderId,
            p_changes: { status: 'processing' },
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
      await invalidateCatalog();
      return {
        delivery: null,
        order: {
          status: updated.status,
          stock_deducted: updated.stock_deducted,
        },
        warning:
          'Colissimo is not connected: the order was validated without a parcel.',
      };
    }

    const parcel = parcelSchema.safeParse(parcelFromOrder(order));
    if (!parcel.success) {
      const fields = [
        ...new Set(parcel.error.issues.map((issue) => String(issue.path[0]))),
      ];
      throw new ApiError(
        `Delivery details to complete before sending: ${fields.join(', ')}`,
        422,
        'NEEDS_DETAILS',
        { fields },
      );
    }
    return this.sendParcel(orderId, parcel.data, actor);
  }

  // "Check a parcel": Colissimo's status for any barcode (with the driver's live report), plus our
  // parcel if listed. Read-only.
  private async lookUp(code: string) {
    if (!colissimoConfigured().tracking) throw notConfigured('tracking');
    const [tracked, listed] = await Promise.all([
      trackParcel(code),
      this.select().where('d.barcode', '=', code).executeTakeFirst(),
    ]);
    return { barcode: code, ...tracked, delivery: listed ?? null };
  }

  // A parcel created on Colissimo's website: checked with the tracking API, then listed.
  private async importParcel(
    code: string,
    orderId: string | null,
    actor: RequestActor,
  ) {
    if (!colissimoConfigured().tracking) throw notConfigured('tracking');
    const tracked = await trackParcel(code);
    const { id } = await this.db
      .withActor(actor, (trx) =>
        trx
          .insertInto('deliveries')
          .values({
            barcode: code,
            order_id: orderId,
            status: tracked.status,
            status_reason: tracked.reason || null,
            status_changed_at: new Date(),
            paid: tracked.paid,
            driver_status: tracked.driverStatus || null,
            driver_reason: tracked.driverReason || null,
            created_by: actor.userId,
            created_by_email: actor.email,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
      .catch(dbError);
    return {
      delivery: await this.select().where('d.id', '=', id).executeTakeFirst(),
    };
  }

  /** One live parcel with its Colissimo barcode, or a clear refusal. */
  private async parcel(id: string) {
    const row = await this.db
      .selectFrom('deliveries')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new ApiError('Parcel not found', 404);
    if (!row.barcode)
      throw new ApiError(
        'This parcel has no Colissimo barcode yet',
        409,
        'NO_BARCODE',
      );
    return row;
  }

  // "Hand over for pickup": Colissimo makes a manifest of the parcels waiting for pickup, which
  // then become "A enlever". Each one it refuses comes back with its reason; the rest stand.
  private async handOver(ids: string[], actor: RequestActor) {
    if (!colissimoConfigured().add) throw notConfigured('add');
    const parcels = await this.db
      .selectFrom('deliveries')
      .select(['id', 'barcode', 'status'])
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .execute();
    const refused: { barcode: string; reason: string }[] = parcels
      .filter((p) => !p.barcode || p.status !== 'En attente')
      .map((p) => ({
        barcode: p.barcode ?? '',
        reason: p.barcode
          ? 'Not waiting for pickup'
          : 'No Colissimo barcode yet',
      }));
    const ready = parcels.filter((p) => p.barcode && p.status === 'En attente');
    if (ready.length === 0) return { manifests: [], accepted: [], refused };

    const result = await handOverParcels(ready.map((p) => p.barcode!));
    if (result.accepted.length)
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('deliveries')
          .set({
            status: 'A enlever',
            status_changed_at: new Date(),
            manifest_id: result.manifests[0] ?? null,
            handed_over_at: new Date(),
            updated_at: new Date(),
          })
          .where('barcode', 'in', result.accepted)
          .where('deleted_at', 'is', null)
          .execute(),
      );
    return {
      manifests: result.manifests,
      accepted: result.accepted,
      refused: [...refused, ...result.refused],
    };
  }

  // "Edit parcel": a parcel waiting for pickup changes at Colissimo, then here and on its order
  // (name, phone, address). Once printed, Colissimo refuses changes; a new price then becomes a
  // price change request instead, which is what Colissimo offers for printed parcels.
  private async edit(
    id: string,
    changes: Partial<ParcelChanges>,
    actor: RequestActor,
  ) {
    if (!colissimoConfigured().add) throw notConfigured('add');
    const row = await this.parcel(id);
    const current: ParcelChanges = {
      nom: row.recipient_name ?? undefined,
      tel: row.phone ?? undefined,
      gouvernerat: row.governorate ?? undefined,
      ville: row.city ?? undefined,
      adresse: row.address ?? undefined,
      designation: row.designation ?? undefined,
      nb_article: row.items_count ?? undefined,
      prix: row.cod_amount ?? undefined,
      tel2: (row.request as { tel2?: string } | null)?.tel2 ?? '',
    };
    const diff = Object.fromEntries(
      Object.entries(changes).filter(
        ([key, value]) =>
          value !== undefined && value !== current[key as keyof ParcelChanges],
      ),
    ) as ParcelChanges;
    if (Object.keys(diff).length === 0)
      return { delivery: row, changed: false, price_change: null };

    try {
      const result = await editParcel(row.barcode!, diff);
      const delivery = await this.db
        .withActor(actor, async (trx) => {
          const updated = await trx
            .updateTable('deliveries')
            .set({
              recipient_name: diff.nom ?? row.recipient_name,
              phone: diff.tel ?? row.phone,
              governorate: diff.gouvernerat ?? row.governorate,
              city: diff.ville ?? row.city,
              address: diff.adresse ?? row.address,
              designation: diff.designation ?? row.designation,
              items_count: diff.nb_article ?? row.items_count,
              cod_amount: diff.prix ?? row.cod_amount,
              request: JSON.stringify({
                ...((row.request as object) ?? {}),
                ...diff,
              }),
              label_url: result.labelUrl ?? row.label_url,
              label_zebra_url: result.labelZebraUrl ?? row.label_zebra_url,
              updated_at: new Date(),
            })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();
          // The order keeps the corrected delivery details too.
          if (
            row.order_id &&
            (diff.nom ||
              diff.tel ||
              diff.adresse ||
              diff.ville ||
              diff.gouvernerat)
          ) {
            const [first, ...rest] = (diff.nom ?? '').trim().split(/\s+/);
            await trx
              .updateTable('orders')
              .set({
                ...(diff.nom
                  ? {
                      customer_first_name: first,
                      customer_last_name: rest.join(' '),
                    }
                  : {}),
                ...(diff.tel ? { customer_phone: diff.tel } : {}),
                ...(diff.adresse ? { shipping_address: diff.adresse } : {}),
                ...(diff.ville ? { shipping_city: diff.ville } : {}),
                ...(diff.gouvernerat
                  ? { shipping_state: diff.gouvernerat }
                  : {}),
              })
              .where('id', '=', row.order_id)
              .where('deleted_at', 'is', null)
              .execute();
          }
          return updated;
        })
        .catch(async (saveError: unknown) => {
          // Colissimo already has the new details: put the old ones back there so both agree.
          const previous = Object.fromEntries(
            Object.keys(diff).map((key) => [
              key,
              current[key as keyof ParcelChanges],
            ]),
          ) as ParcelChanges;
          await editParcel(row.barcode!, previous).catch((undoError) =>
            Sentry.captureException(undoError, {
              tags: { area: 'admin-delivery', action: 'undo-edit' },
            }),
          );
          throw saveError;
        });
      return { delivery, changed: result.changed, price_change: null };
    } catch (error) {
      const printed =
        error instanceof ColissimoError &&
        (error.code === 'ORDER_ALREADY_PRINTED' ||
          error.code === 'ORDER_NOT_EDITABLE');
      const onlyPrice =
        Object.keys(diff).length === 1 && diff.prix !== undefined;
      if (printed && onlyPrice) {
        const request = await this.priceChange(
          id,
          diff.prix!,
          undefined,
          actor,
        );
        return {
          delivery: request.delivery,
          changed: false,
          price_change: request.price_change,
        };
      }
      throw error;
    }
  }

  // "Request a price change": Colissimo records the request and answers later; the parcel keeps
  // its price until then. The request is kept on the parcel to show it's waiting.
  private async priceChange(
    id: string,
    price: number,
    reason: string | undefined,
    actor: RequestActor,
  ) {
    if (!colissimoConfigured().add) throw notConfigured('add');
    const row = await this.parcel(id);
    const request = await requestPriceChange(row.barcode!, price, reason);
    const priceChange = {
      request_id: request.requestId,
      old_price: Number.isFinite(request.oldPrice)
        ? request.oldPrice
        : row.cod_amount,
      new_price: Number.isFinite(request.newPrice) ? request.newPrice : price,
      reason: reason ?? null,
      at: new Date().toISOString(),
    };
    const delivery = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('deliveries')
        .set({
          price_change: JSON.stringify(priceChange),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return { delivery, price_change: priceChange };
  }
}
