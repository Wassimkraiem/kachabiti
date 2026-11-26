import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { graph, type IncomingMessage } from '@shared/erp/meta';
import { Database } from '../db/database';
import { imported, metaPageToken } from './meta-connection';
import { apiFiles, MetaMedia, type ApiFile } from './meta-media';
import { keepMessage } from './meta-messages';

// META_POLL_MS: a faster clock for the e2e suite.
const EVERY_MS = Number(process.env.META_POLL_MS) || 120_000;
const FIRST_MS = Number(process.env.META_POLL_MS) || 10_000;
const MAX_CONVERSATIONS = 200; // what the Messenger screen lists
const MAX_MESSAGES = 100; // per conversation
const DAY = 24 * 3600_000;
const FIELDS = 'id,created_time,from,message,attachments';

interface Person {
  id: string;
  name?: string;
  username?: string;
}
interface Message {
  id: string;
  created_time: string;
  from?: Person;
  message?: string;
  attachments?: { data?: ApiFile[] };
}
interface Page<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}
interface Conversation {
  id: string;
  updated_time: string;
  participants?: { data?: Person[] };
  messages?: Page<Message>;
}

/**
 * Reads the Page's conversations, both sides: those from before the webhook, and what the webhook
 * missed. Messages are recognized by their id, so reading them again adds nothing.
 */
@Injectable()
export class MetaImport implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MetaImport');
  private timer?: NodeJS.Timeout;
  private stopped = false;
  /** Latest change already read, per Page and platform. In memory: a restart reads again. */
  private readonly since = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly media: MetaMedia,
  ) {}

  onModuleInit() {
    this.next(FIRST_MS);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private next(ms: number) {
    this.timer = setTimeout(() => {
      void this.run().finally(() => {
        if (!this.stopped) this.next(EVERY_MS);
      });
    }, ms);
    this.timer.unref();
  }

  private async run() {
    try {
      const token = await metaPageToken(this.db);
      if (!token) return;
      const page = await graph<{
        id: string;
        instagram_business_account?: Person;
      }>('/me?fields=id,instagram_business_account{id,username}', { token });
      await this.platform('facebook', token, page.id, [page.id]);
      const instagram = page.instagram_business_account;
      if (instagram)
        await this.platform('instagram', token, page.id, [
          page.id,
          instagram.id,
          instagram.username ?? '',
        ]);
      else delete imported.instagram;
    } catch (error) {
      imported.facebook = { ok: false, detail: (error as Error).message };
      this.log.warn(`failed: ${(error as Error).message}`);
    }
  }

  /** `ours`: the ids and names of the shop among a conversation's people. */
  private async platform(
    channel: 'facebook' | 'instagram',
    token: string,
    pageId: string,
    ours: string[],
  ) {
    const key = `${pageId}:${channel}`;
    const since = this.since.get(key) ?? 0;
    let latest = since;
    let conversations = 0;
    let added = 0;
    try {
      let after: string | undefined;
      do {
        const query = new URLSearchParams({
          platform: channel === 'facebook' ? 'messenger' : 'instagram',
          // Instagram refuses messages inside this list ("reduce the amount of data"): they're read apart.
          fields:
            channel === 'facebook'
              ? `id,updated_time,participants,messages.limit(20){${FIELDS}}`
              : 'id,updated_time,participants',
          limit: channel === 'facebook' ? '10' : '25',
          ...(after ? { after } : {}),
        });
        const list = await graph<Page<Conversation>>(
          `/me/conversations?${query}`,
          { token, timeout: 60_000 },
        );
        after = list.paging?.next ? list.paging.cursors?.after : undefined;
        for (const conversation of list.data ?? []) {
          const updated = Date.parse(conversation.updated_time);
          // Latest first: the rest was read before. Equal is read again, a second can hold two.
          if (updated < since) {
            after = undefined;
            break;
          }
          latest = Math.max(latest, updated);
          conversations++;
          added += await this.conversation(channel, token, ours, conversation);
        }
      } while (after && conversations < MAX_CONVERSATIONS && !this.stopped);
      this.since.set(key, latest);
      imported[channel] = {
        ok: true,
        // A first reading says what it found; the later ones only that they work.
        detail: since
          ? (imported[channel]?.detail ?? null)
          : `${conversations} / ${added}`,
      };
      if (added)
        this.log.log(`${channel}: ${added} message(s) from ${conversations}`);
    } catch (error) {
      imported[channel] = { ok: false, detail: (error as Error).message };
      this.log.warn(`${channel}: ${(error as Error).message}`);
    }
  }

  private async conversation(
    channel: 'facebook' | 'instagram',
    token: string,
    ours: string[],
    { id, participants, messages }: Conversation,
  ) {
    const others = (participants?.data ?? []).filter(
      (p) => !ours.includes(p.id) && !ours.includes(p.username ?? '-'),
    );
    if (others.length !== 1) return 0;
    const [customer] = others;
    let added = 0;
    let read = 0;
    let page =
      channel === 'facebook'
        ? messages
        : await graph<Page<Message>>(
            `/${encodeURIComponent(id)}/messages?fields=id,created_time&limit=20`,
            { token },
          );
    let gone = 0;
    for (;;) {
      const list = page?.data ?? [];
      const known = await this.known(channel, list);
      gone = Math.max(gone, known.gone);
      const news = list.filter(
        (m) => !known.ids.has(m.id) && Date.parse(m.created_time) > gone,
      );
      for (const listed of news.reverse()) {
        // Instagram lists ids only; each message is read on its own (20 at most per conversation).
        const m =
          channel === 'facebook'
            ? listed
            : await graph<Message>(
                `/${encodeURIComponent(listed.id)}?fields=${FIELDS}`,
                { token },
              );
        const kept = await this.keep(channel, customer, m);
        if (kept) added++;
      }
      read += list.length;
      const after = page?.paging?.next && page.paging.cursors?.after;
      // Older ones only while they are new to us. Meta gives 20 at most on Instagram.
      if (!news.length || !after || read >= MAX_MESSAGES) return added;
      if (channel === 'instagram') return added;
      page = await graph<Page<Message>>(
        `/${encodeURIComponent(id)}/messages?${new URLSearchParams({ fields: FIELDS, limit: '20', after })}`,
        { token },
      );
    }
  }

  /** Those stored, and when their customer's data was erased or record removed: nothing older comes back. */
  private async known(channel: string, list: Message[]) {
    if (!list.length) return { ids: new Set<string | null>(), gone: 0 };
    const known = await this.db
      .selectFrom('customer_interactions as i')
      .innerJoin('customers as c', 'c.id', 'i.customer_id')
      .select(['i.external_id', 'c.anonymized_at', 'c.deleted_at'])
      .where('i.channel', '=', channel)
      .where(
        'i.external_id',
        'in',
        list.map((m) => m.id),
      )
      .execute();
    const ids = new Set(known.map((k) => k.external_id));
    const gone = Math.max(
      0,
      ...known.map((k) =>
        new Date(k.anonymized_at ?? k.deleted_at ?? 0).getTime(),
      ),
    );
    return { ids, gone };
  }

  private async keep(
    channel: 'facebook' | 'instagram',
    customer: Person,
    m: Message,
  ) {
    const sentAt = new Date(m.created_time);
    const files = m.attachments?.data ?? [];
    const found = apiFiles(files);
    const message: IncomingMessage = {
      channel,
      // Not "from us": Instagram's id of the shop differs between endpoints.
      direction: m.from?.id === customer.id ? 'in' : 'out',
      externalId: m.id,
      senderId: customer.id,
      senderName: customer.name || customer.username || null,
      phone: null,
      text:
        m.message ||
        (found.length
          ? `[${found.map((f) => f.type).join(', ')}]`
          : files.length
            ? '[file]'
            : '[message]'),
      attachments: found,
      sentAt,
    };
    const kept = await this.db.withActor(null, async (trx) => {
      // The same message under another id (the webhook's or a reply's).
      const { rows } = await sql`
        select 1 from customer_interactions i join customers c on c.id = i.customer_id
        where c.external_ids @> ${JSON.stringify({ [channel === 'facebook' ? 'messenger' : 'instagram']: customer.id })}::jsonb
          and i.channel = ${channel} and i.direction = ${message.direction}
          and (i.body = ${message.text} or (i.attachments is not null and ${found.length > 0}::boolean))
          and i.created_at between ${sentAt}::timestamptz - interval '5 seconds'
                               and ${sentAt}::timestamptz + interval '10 seconds'
          and i.external_id is not null
        limit 1`.execute(trx);
      if (rows.length) return null;
      return keepMessage(
        trx as unknown as Database,
        message,
        // Days old: nobody is waiting for someone to notice it here.
        Date.now() - sentAt.getTime() > DAY ? new Date() : null,
      );
    });
    if (!kept?.id) return false;
    if (found.length) await this.media.copy(kept.id, kept.customer_id, found);
    this.media.background(
      this.media.profiles([{ customer_id: kept.customer_id, channel }]),
    );
    return true;
  }
}
