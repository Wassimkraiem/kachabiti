import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
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
export class ColissimoPortalController {
  constructor(private readonly db: Database) {}

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
   * Adds every parcel of the Colissimo account we don't have yet to deliveries, so the Delivery
   * tab lists and searches them all. Parcels already here (or removed from the list) are left
   * alone; new ones aren't linked to an order and API tracking keeps them up to date.
   */
  @Post('sync')
  @HttpCode(200)
  async sync() {
    const parcels = await fromPortal(allParcels);
    const paid = await fromPortal(payouts);
    const known = new Set(
      (
        await this.db
          .selectFrom('deliveries')
          .select('barcode')
          .where('barcode', 'is not', null)
          .execute()
      ).map((d) => d.barcode),
    );
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
    // Then orders for the parcels without one, and Colissimo's payouts as money (one transaction).
    const history = await this.db.withActor(null, async (trx) =>
      this.db.call<{
        orders: number;
        payments: number;
        payouts: number;
        carrier_open: number;
      }>('import_colissimo_history', { p_payouts: paid }, trx),
    );
    return { found: parcels.length, added: rows.length, ...history };
  }
}
