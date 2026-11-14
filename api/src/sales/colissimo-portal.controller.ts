import {
  Controller,
  Get,
  HttpCode,
  OnModuleInit,
  Post,
  Query,
} from '@nestjs/common';
import { sql } from 'kysely';
import * as Sentry from '@sentry/nestjs';
import { OwnerOnly } from '../auth/decorators';
import { ApiError, zDate } from '../common/api';
import { Database } from '../db/database';
import { statusInfo } from '@shared/colissimo-data';
import { ColissimoTracking } from './colissimo-tracking';
import {
  allParcels,
  cardParcels,
  deliveryStatus,
  payouts,
  PortalError,
  portalConfigured,
  searchParcels,
  tunisTime,
} from './colissimo-portal';
import { invalidateCatalog } from '../catalog/revalidate';

const DAY = 86_400_000;
export const SYNC_EVERY_MS = 5 * 60_000;

/** Turns a portal failure into a 502 with its message (and reports the unexpected ones). */
async function fromPortal<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof PortalError))
      Sentry.captureException(error, { tags: { area: 'colissimo-portal' } });
    throw new ApiError((error as Error).message, 502);
  }
}

/**
 * Admin → Colissimo account (owners): every parcel of the Colissimo account with its status, read
 * live from the shipper's dashboard on Colissimo's website, and one parcel's details and history.
 */
@Controller('owner/colissimo')
@OwnerOnly()
export class ColissimoPortalController implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly tracking: ColissimoTracking,
  ) {}

  /** The account sync every 5 minutes (a minute after start-up), so Delivery keeps matching. */
  onModuleInit() {
    if (!portalConfigured()) return;
    const tick = () =>
      void this.sync().catch((error) =>
        Sentry.captureException(error, { tags: { area: 'colissimo-sync' } }),
      );
    setTimeout(tick, 60_000).unref();
    setInterval(tick, SYNC_EVERY_MS).unref();
  }

  @Get()
  async list(@Query() query: { from?: string; to?: string }) {
    if (!portalConfigured()) return { configured: false, rows: [] };
    const today = new Date().toISOString().slice(0, 10);
    const to = zDate.parse(query.to ?? today);
    const from = zDate.parse(
      query.from ??
        new Date(Date.parse(to) - 30 * DAY).toISOString().slice(0, 10),
    );
    const days = (Date.parse(to) - Date.parse(from)) / DAY;
    if (days < 0) throw new ApiError('The start date is after the end date');
    if (days > 62)
      throw new ApiError('Colissimo shows at most 2 months at a time');

    const parcels = await fromPortal(() => searchParcels(from, to));
    // Our order for each barcode we know.
    const barcodes = parcels.map((p) => p.barcode).filter(Boolean);
    const ours = barcodes.length
      ? await this.db
          .selectFrom('deliveries as d')
          .innerJoin('orders as o', 'o.id', 'd.order_id')
          .select(['d.barcode', 'o.id', 'o.order_number'])
          .where('d.barcode', 'in', barcodes)
          .where('d.deleted_at', 'is', null)
          .where('o.deleted_at', 'is', null)
          .execute()
      : [];
    const orders = new Map(
      ours.map((o) => [o.barcode, { id: o.id, order_number: o.order_number }]),
    );
    return {
      configured: true,
      from,
      to,
      rows: parcels.map((p) => ({
        ...p,
        order: orders.get(p.barcode) ?? null,
      })),
    };
  }

  /**
   * Makes deliveries match the Colissimo account: parcels already here take the account's status,
   * those we don't have yet are added (not linked to an order; API tracking keeps them up to date),
   * and in_colissimo marks which ones the account lists.
   */
  @Post('sync')
  @HttpCode(200)
  sync() {
    // One run at a time: the 5-minute schedule and the owner's button share it.
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private running: ReturnType<ColissimoPortalController['run']> | null = null;

  private async run() {
    const parcels = await fromPortal(allParcels);
    const paid = await fromPortal(payouts);
    // The dashboard's cards: the status Colissimo counts each parcel under (its search list names
    // some differently, e.g. exchanges as "Inconnu"), with its attempts and contents.
    const cards = await fromPortal(cardParcels);
    const statusOf = (p: { barcode: string; status: string }) =>
      cards.get(p.barcode)?.status ?? deliveryStatus(p.status);
    const stored = await this.db
      .selectFrom('deliveries')
      .select(['id', 'barcode', 'status', 'paid', 'deleted_at'])
      .where('barcode', 'is not', null)
      .execute();
    const known = new Set(stored.map((d) => d.barcode));
    // Parcels we already have take the account's status (it's what Colissimo's dashboard counts),
    // through record_delivery_status so their orders follow: delivered, returned (stock back),
    // carrier payment. Each parcel in its own transaction, like API tracking.
    const listed = new Map(parcels.map((p) => [p.barcode, p]));
    let updated = 0;
    for (const row of stored) {
      const parcel = row.deleted_at ? undefined : listed.get(row.barcode!);
      if (!parcel) continue;
      const status = statusOf(parcel);
      const paid = status === 'Livre paye' ? true : null;
      if (row.status === status && (paid === null || row.paid === paid))
        continue;
      const moved = await this.db.withActor(null, (trx) =>
        this.db.call<boolean>(
          'record_delivery_status',
          { p_id: row.id, p_status: status, p_reason: null, p_paid: paid },
          trx,
        ),
      );
      if (moved) updated += 1;
    }
    const rows = [
      ...new Map(
        parcels
          .filter((p) => p.barcode && !known.has(p.barcode))
          .map((p) => {
            const status = statusOf(p);
            const created = tunisTime(p.added_at) ?? new Date();
            return [
              p.barcode,
              {
                barcode: p.barcode,
                recipient_name: p.client || null,
                phone: p.phones.join(' / ') || null,
                cod_amount: p.price,
                designation: cards.get(p.barcode)?.designation ?? null,
                attempts: cards.get(p.barcode)?.attempts ?? null,
                status,
                paid: status === 'Livre paye',
                created_at: created,
                status_changed_at:
                  tunisTime(p.delivered_at) ??
                  tunisTime(p.picked_up_at) ??
                  created,
              },
            ] as const;
          }),
      ).values(),
    ];
    // An import, like the WooCommerce one: no staff member, so not in the activity log. One
    // transaction: all or nothing.
    await this.db.withActor(null, async (trx) => {
      for (let i = 0; i < rows.length; i += 500)
        await trx
          .insertInto('deliveries')
          .values(rows.slice(i, i + 500))
          .onConflict((oc) => oc.doNothing())
          .execute();
    });
    // Which parcels Colissimo's dashboard counts (Admin → Delivery shows those): the ones on its
    // cards, plus every parcel this system sent (it has Colissimo's slip link). The account also
    // lists parcels on no card (pickup anomalies, "Inconnu"); those stay under "All my data". If
    // the cards couldn't be read, the account's list stands in. Only after a full read of the
    // account: a failed read throws before this, hiding nothing.
    let archived = 0;
    if (parcels.length > 0) {
      const inAccount = cards.size
        ? [...cards.keys()]
        : parcels.map((p) => p.barcode).filter(Boolean);
      archived = await this.db.withActor(null, async (trx) => {
        await trx
          .updateTable('deliveries')
          .set({
            in_colissimo: sql<boolean>`barcode = any(${inAccount}) or label_url is not null`,
          })
          .where('barcode', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute();
        // Attempts and contents as the dashboard's cards show them (only rows that differ).
        // Every card a parcel is on too, as the dashboard counts it.
        const shown = [...cards.values()].map((c) => ({
          barcode: c.barcode,
          attempts: c.attempts,
          designation: c.designation,
          cards: c.cards ?? [c.status],
        }));
        if (shown.length)
          await sql`
            update public.deliveries d
               set attempts = r.attempts,
                   designation = coalesce(r.designation, d.designation),
                   dashboard_cards = array(select jsonb_array_elements_text(r.cards)),
                   updated_at = now()
              from jsonb_to_recordset(${JSON.stringify(shown)}::jsonb)
                   as r (barcode text, attempts integer, designation text, cards jsonb)
             where d.barcode = r.barcode and d.deleted_at is null
               and (d.attempts is distinct from r.attempts
                    or d.designation is distinct from coalesce(r.designation, d.designation)
                    or d.dashboard_cards is distinct from array(select jsonb_array_elements_text(r.cards)))`.execute(
            trx,
          );
        // Parcels no card lists any more: back to their status alone.
        if (cards.size)
          await trx
            .updateTable('deliveries')
            .set({ dashboard_cards: null })
            .where('dashboard_cards', 'is not', null)
            .where(sql<boolean>`barcode <> all(${[...cards.keys()]})`)
            .execute();
        // The old tools' parcels stuck mid-way that the account no longer lists: nobody can say
        // what became of them, so they get a final status of their own (their orders stay as is).
        const result = await trx
          .updateTable('deliveries')
          .set({
            status: 'OLD-ORDERS-UNKNOWN',
            status_changed_at: sql`now()`,
            updated_at: sql`now()`,
          })
          .where('in_colissimo', '=', false)
          // Not in the account's list at all (some listed parcels are on no dashboard card).
          .where(
            sql<boolean>`barcode <> all(${parcels.map((p) => p.barcode).filter(Boolean)})`,
          )
          .where('label_url', 'is', null)
          .where('deleted_at', 'is', null)
          .where('status', 'in', ['A enlever', 'Au depot', 'En cours'])
          .executeTakeFirst();
        return Number(result.numUpdatedRows);
      });
    }
    // Then orders for the parcels without one, and Colissimo's payouts as money (one transaction).
    const history = await this.db.withActor(null, async (trx) =>
      this.db.call<{
        orders: number;
        payments: number;
        payouts: number;
        carrier_open: number;
      }>('import_colissimo_history', { p_payouts: paid }, trx),
    );
    // Status changes above are saved at the sync's time: give delivered parcels, their orders,
    // carrier payments and draft entries Colissimo's own delivery date (also repairs earlier runs).
    const delivered = parcels
      .filter(
        (p) =>
          p.barcode &&
          p.delivered_at &&
          statusInfo(statusOf(p)).group === 'delivered',
      )
      .map((p) => ({ barcode: p.barcode, at: p.delivered_at }));
    const redated = delivered.length
      ? await this.db.withActor(null, (trx) =>
          this.db.call<Record<string, number>>(
            'redate_deliveries',
            { p_parcels: delivered },
            trx,
          ),
        )
      : null;
    if (updated) await invalidateCatalog(); // returns put stock back
    // Admin → Delivery's "last check": this sync is the scheduled update when it's configured.
    this.tracking.lastRun = {
      at: new Date().toISOString(),
      checked: parcels.length,
      changed: updated,
      failures: [],
    };
    return {
      found: parcels.length,
      added: rows.length,
      updated,
      archived,
      redated,
      ...history,
    };
  }
}
