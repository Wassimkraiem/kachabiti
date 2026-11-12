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
import {
  allParcels,
  deliveryStatus,
  payouts,
  PortalError,
  portalConfigured,
  searchParcels,
  tunisTime,
} from './colissimo-portal';
import { invalidateCatalog } from '../catalog/revalidate';

const DAY = 86_400_000;

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
  constructor(private readonly db: Database) {}

  /** The account sync every night at 03:00 Tunis time (02:00 UTC), so Delivery keeps matching. */
  onModuleInit() {
    if (!portalConfigured()) return;
    const next = () => {
      const now = new Date();
      const at = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2),
      );
      if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
      setTimeout(() => {
        this.sync()
          .catch((error) =>
            Sentry.captureException(error, {
              tags: { area: 'colissimo-sync' },
            }),
          )
          .finally(next);
      }, at.getTime() - now.getTime()).unref();
    };
    next();
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
  async sync() {
    const parcels = await fromPortal(allParcels);
    const paid = await fromPortal(payouts);
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
      const status = deliveryStatus(parcel.status);
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
            const status = deliveryStatus(p.status);
            const created = tunisTime(p.added_at) ?? new Date();
            return [
              p.barcode,
              {
                barcode: p.barcode,
                recipient_name: p.client || null,
                phone: p.phones.join(' / ') || null,
                cod_amount: p.price,
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
    // Which parcels the account still lists (Admin → Delivery shows those, like Colissimo's own
    // dashboard): its barcodes, plus every parcel this system sent (it has Colissimo's slip link).
    // Only after a full read of the account: a failed read throws before this, hiding nothing.
    if (parcels.length > 0) {
      const inAccount = parcels.map((p) => p.barcode).filter(Boolean);
      await this.db.withActor(null, (trx) =>
        trx
          .updateTable('deliveries')
          .set({
            in_colissimo: sql<boolean>`barcode = any(${inAccount}) or label_url is not null`,
          })
          .where('barcode', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute(),
      );
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
    if (updated) await invalidateCatalog(); // returns put stock back
    return { found: parcels.length, added: rows.length, updated, ...history };
  }
}
