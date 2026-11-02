import {
  Injectable,
  Logger,
  type MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { Client } from 'pg';
import { interval, map, merge, Observable, takeUntil, timer } from 'rxjs';
import webpush from 'web-push';
import { config } from '../config';
import { Database } from '../db/database';

// Delivers notifications rows (written by the database: private.notify) and runs the daily alerts.
// private.announce_notification announces each new or changed row on the `notifications` channel;
// this service streams it to the recipient's open admin tabs (SSE) and sends new ones as Web Push.
// shortcut: one API instance is assumed (several would each push and run the alerts); add a
// "pushed_at" claim and an advisory lock when the API runs on more than one instance.

type Announcement = {
  id: number;
  recipient_id: string;
  op: 'insert' | 'update';
};
type Lang = 'en' | 'fr' | 'ar';

const COLUMNS = [
  'id',
  'recipient_id',
  'created_at',
  'kind',
  'type',
  'severity',
  'title',
  'body',
  'url',
  'data',
  'read_at',
] as const;
const STREAM_MS = 15 * 60_000; // then EventSource reconnects, which re-checks the session
const HEARTBEAT_MS = 25_000; // keeps proxies from closing an idle stream

// VAPID_KEYS keeps the Edge Function's format ({ publicKey, privateKey } as JWK); web-push wants
// the raw keys in base64url.
const vapid = (() => {
  if (!config.VAPID_KEYS) return null;
  const { publicKey, privateKey } = JSON.parse(config.VAPID_KEYS) as {
    publicKey: { x: string; y: string };
    privateKey: { d: string };
  };
  return {
    subject: config.VAPID_SUBJECT,
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(publicKey.x, 'base64url'),
      Buffer.from(publicKey.y, 'base64url'),
    ]).toString('base64url'),
    privateKey: privateKey.d,
  };
})();

const pick = (text: unknown, lang: Lang) => {
  const t = (text ?? {}) as Record<string, string>;
  return t[lang] || t.en || '';
};

@Injectable()
export class NotificationEvents implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Notifications');
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent) => void>
  >();
  private client: Client | null = null;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(private readonly db: Database) {}

  onModuleInit() {
    void this.listen();
    this.scheduleDailyAlerts();
  }

  async onModuleDestroy() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    await this.client?.end().catch(() => undefined);
  }

  /** The recipient's live notifications, for one admin tab. */
  stream(userId: string): Observable<MessageEvent> {
    const rows = new Observable<MessageEvent>((subscriber) => {
      const send = (event: MessageEvent) => subscriber.next(event);
      const set = this.listeners.get(userId) ?? new Set();
      set.add(send);
      this.listeners.set(userId, set);
      return () => {
        set.delete(send);
        if (set.size === 0) this.listeners.delete(userId);
      };
    });
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map(() => ({ type: 'ping', data: '' })),
    );
    return merge(rows, heartbeat).pipe(takeUntil(timer(STREAM_MS)));
  }

  // LISTEN needs a session of its own (not a transaction pooler): LISTEN_DATABASE_URL when
  // DATABASE_URL is one. Reconnects after a drop; the bell's 60-second poll covers the gap.
  private async listen() {
    if (this.stopped) return;
    const client = new Client({
      connectionString: config.LISTEN_DATABASE_URL ?? config.DATABASE_URL,
    });
    const retry = () => {
      if (this.client !== client) return;
      this.client = null;
      client.end().catch(() => undefined);
      this.timers.push(setTimeout(() => void this.listen(), 5_000));
    };
    client.on('error', (error) => {
      this.logger.warn(`Listener lost: ${error.message}`);
      retry();
    });
    client.on('end', retry);
    client.on('notification', (message) => {
      if (!message.payload) return;
      this.handle(JSON.parse(message.payload) as Announcement).catch((error) =>
        this.logger.error('Delivering a notification failed', error),
      );
    });
    this.client = client;
    try {
      await client.connect();
      await client.query('listen notifications');
    } catch (error) {
      this.logger.warn(
        `Cannot listen for notifications: ${(error as Error).message}`,
      );
      retry();
    }
  }

  private async handle({ id, recipient_id, op }: Announcement) {
    const tabs = this.listeners.get(recipient_id);
    if (!tabs?.size && op !== 'insert') return;
    const row = await this.db
      .selectFrom('notifications')
      .select([...COLUMNS])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return;
    tabs?.forEach((send) => send({ data: { op, row } }));
    if (op === 'insert') await this.push(row);
  }

  /** Web Push to every browser the recipient turned desktop notifications on in. */
  private async push(row: {
    id: number;
    recipient_id: string;
    kind: string;
    severity: string;
    title: unknown;
    body: unknown;
    url: string | null;
  }) {
    if (!vapid) return;
    const subscriptions = await this.db
      .selectFrom('push_subscriptions')
      .select(['id', 'endpoint', 'p256dh', 'auth', 'locale'])
      .where('user_id', '=', row.recipient_id)
      .where('deleted_at', 'is', null)
      .execute();
    for (const sub of subscriptions) {
      const lang = (
        ['en', 'fr', 'ar'].includes(sub.locale ?? '') ? sub.locale : 'en'
      ) as Lang;
      const payload = JSON.stringify({
        id: row.id,
        title: pick(row.title, lang),
        body: pick(row.body, lang),
        url: row.url ?? '/admin/notifications',
        severity: row.severity,
        kind: row.kind,
        lang,
      });
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          {
            TTL: 24 * 60 * 60,
            urgency: row.severity === 'info' ? 'normal' : 'high',
            vapidDetails: vapid,
          },
        );
        await this.db
          .updateTable('push_subscriptions')
          .set({ last_success_at: new Date(), last_error: null })
          .where('id', '=', sub.id)
          .execute();
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // An expired or revoked browser subscription is retired (soft delete).
        await this.db
          .updateTable('push_subscriptions')
          .set({
            last_error: String(error).slice(0, 500),
            ...(status === 404 || status === 410
              ? { deleted_at: new Date() }
              : {}),
          })
          .where('id', '=', sub.id)
          .execute();
      }
    }
  }

  /** private.daily_alerts() every day at 07:00 UTC (was pg_cron). */
  private scheduleDailyAlerts() {
    if (this.stopped) return;
    const next = new Date();
    next.setUTCHours(7, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    this.timers.push(
      setTimeout(() => {
        sql`select private.daily_alerts()`
          .execute(this.db)
          .catch((error) => this.logger.error('Daily alerts failed', error))
          .finally(() => this.scheduleDailyAlerts());
      }, next.getTime() - Date.now()),
    );
  }
}
