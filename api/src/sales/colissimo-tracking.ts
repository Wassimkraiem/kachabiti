import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  colissimoConfigured,
  deleteParcels,
  trackParcels,
} from '@shared/colissimo';
import { FINAL_STATUSES } from '@shared/colissimo-data';
import type { Actor } from '../db/database';
import { Database } from '../db/database';
import { invalidateCatalog } from '../catalog/revalidate';

const EVERY_MS = 15 * 60_000;

export interface TrackingRun {
  at: string;
  checked: number;
  changed: number;
  failures: { barcode: string; error: string }[];
}

/**
 * Keeps parcels in step with Colissimo (v2 tracking, 200 barcodes per request): every 15 minutes
 * for every parcel that can still change, and on demand (Admin → Delivery → Refresh). Changes go
 * through record_delivery_status, which moves the order (shipped, delivered, returned) and records
 * cash on delivery. Scheduled runs write without a staff member, so the activity log skips them.
 * One API instance is assumed, as for notifications.
 */
@Injectable()
export class ColissimoTracking implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Colissimo');
  private timers: NodeJS.Timeout[] = [];
  private scheduled: Promise<TrackingRun> | null = null;
  lastRun: TrackingRun | null = null;

  constructor(private readonly db: Database) {}

  onModuleInit() {
    if (!colissimoConfigured().tracking) return;
    const tick = () =>
      void this.runScheduled().catch((error) => {
        this.logger.error('Scheduled tracking failed', error);
        Sentry.captureException(error, {
          tags: { area: 'colissimo-tracking' },
        });
      });
    this.timers.push(setTimeout(tick, 60_000), setInterval(tick, EVERY_MS));
    this.timers.forEach((timer) => timer.unref());
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  /** A scheduled run, unless one is already going. */
  private runScheduled() {
    this.scheduled ??= this.run(null).finally(() => (this.scheduled = null));
    return this.scheduled;
  }

  /** Checks the given parcels, or every parcel that can still change, and records what moved. */
  async run(actor: Actor | null, ids?: string[]): Promise<TrackingRun> {
    let query = this.db
      .selectFrom('deliveries')
      .select(['id', 'barcode'])
      .where('deleted_at', 'is', null)
      .where('barcode', 'is not', null);
    query = ids?.length
      ? query.where('id', 'in', ids)
      : query
          .where('status', 'not in', FINAL_STATUSES)
          .where((eb) =>
            eb.not(
              eb.and([eb('status', '=', 'Livrer'), eb('paid', '=', true)]),
            ),
          );
    const parcels = await query.limit(2000).execute();

    const failures: TrackingRun['failures'] = [];
    let changed = 0;
    if (parcels.length) {
      const tracked = await trackParcels(parcels.map((p) => p.barcode!));
      for (const parcel of parcels) {
        const status = tracked.get(parcel.barcode!);
        if (!status) {
          failures.push({
            barcode: parcel.barcode!,
            error: 'Colissimo has no parcel with this barcode',
          });
          continue;
        }
        try {
          const moved = await this.db.withActor(actor, (trx) =>
            this.db.call<boolean>(
              'record_delivery_status',
              {
                p_id: parcel.id,
                p_status: status.status,
                p_reason: status.reason,
                p_actor: actor?.userId ?? null,
                p_actor_email: actor?.email ?? null,
                p_paid: status.paid,
                p_driver_status: status.driverStatus,
                p_driver_reason: status.driverReason,
              },
              trx,
            ),
          );
          if (moved) changed += 1;
        } catch (error) {
          failures.push({
            barcode: parcel.barcode!,
            error: (error as Error).message,
          });
        }
      }
    }
    if (changed > 0) await invalidateCatalog(); // returns put stock back
    const run = {
      at: new Date().toISOString(),
      checked: parcels.length,
      changed,
      failures,
    };
    if (!ids?.length) this.lastRun = run;
    if (changed || failures.length)
      this.logger.log(
        `Tracking: ${parcels.length} checked, ${changed} changed, ${failures.length} failed`,
      );
    return run;
  }

  /**
   * Deletes an order's parcel at Colissimo when it's still waiting for pickup (the order was
   * cancelled or deleted): its status becomes "Supprime". Others are left alone and reported.
   */
  async cancelForOrders(orderIds: string[], actor: Actor) {
    if (!colissimoConfigured().add || orderIds.length === 0) return [];
    const parcels = await this.db
      .selectFrom('deliveries')
      .select(['id', 'barcode', 'status'])
      .where('order_id', 'in', orderIds)
      .where('deleted_at', 'is', null)
      .where('barcode', 'is not', null)
      .where('status', 'in', ['En attente', 'A enlever'])
      .execute();
    if (parcels.length === 0) return [];
    const results = await deleteParcels(parcels.map((p) => p.barcode!));
    const notes: { barcode: string; deleted: boolean; message: string }[] = [];
    for (const parcel of parcels) {
      const result = results.get(parcel.barcode!);
      if (result?.deleted) {
        await this.db.withActor(actor, (trx) =>
          this.db.call(
            'record_delivery_status',
            {
              p_id: parcel.id,
              p_status: 'Supprime',
              p_reason: 'Order cancelled',
              p_actor: actor.userId,
              p_actor_email: actor.email,
            },
            trx,
          ),
        );
      }
      notes.push({
        barcode: parcel.barcode!,
        deleted: !!result?.deleted,
        message: result?.message ?? '',
      });
    }
    return notes;
  }
}
