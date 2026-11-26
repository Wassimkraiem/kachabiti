import {
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';
import {
  parseComments,
  parseReferrals,
  parseWebhook,
  validSignature,
} from '@shared/erp/meta';
import { Public } from '../auth/decorators';
import { ApiError, Raw } from '../common/api';
import { Database } from '../db/database';
import { metaConnection, received } from './meta-connection';
import { MetaMedia } from './meta-media';
import { customerFor, keepMessage } from './meta-messages';

/**
 * Port of app/api/webhooks/meta: Messenger, Instagram Direct and WhatsApp messages, and the public
 * comments on the Page's and Instagram account's posts (social_comments). Public (Meta
 * calls it); every POST must be signed with META_APP_SECRET. Messages are stored on the customer
 * they come from (by platform id, then phone; a new contact gets a record).
 */
@Controller('webhooks/meta')
@Public()
export class MetaWebhookController {
  // One line per call (what arrived and what was kept; no message text or names), so a missing
  // message can be traced: Meta not calling, a refused signature, or an event we don't keep.
  private readonly log = new Logger('MetaWebhook');

  constructor(
    private readonly db: Database,
    private readonly media: MetaMedia,
  ) {}

  /** Subscription check from Meta's dashboard. */
  @Get()
  @Header('Content-Type', 'text/plain')
  verify(@Query() query: Record<string, string>) {
    if (
      query['hub.mode'] === 'subscribe' &&
      process.env.META_VERIFY_TOKEN &&
      query['hub.verify_token'] === process.env.META_VERIFY_TOKEN
    ) {
      return new Raw(query['hub.challenge'] ?? '');
    }
    throw new ApiError('Forbidden', 403);
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() request: RawBodyRequest<Request>) {
    const raw = request.rawBody?.toString('utf8') ?? '';
    if (
      !validSignature(
        raw,
        (request.headers['x-hub-signature-256'] as string | undefined) ?? null,
      )
    ) {
      // Which product the wrong secret is for: its name only, nothing else is trusted.
      const object = /"object"\s*:\s*"(\w{1,40})"/.exec(raw)?.[1] ?? 'unknown';
      received.refused = `${new Date().toISOString()} ${object}`;
      this.log.warn(
        `refused: invalid signature (${object}, ${raw.length} bytes)`,
      );
      throw new ApiError('Invalid signature', 401);
    }
    try {
      const payload = JSON.parse(raw);
      if (payload.object === 'page' || payload.object === 'instagram')
        received[payload.object] = new Date().toISOString();
      // Another Page subscribed to the same Meta app: its customers aren't ours.
      // shortcut: Page events only, match instagram_id too once a second Instagram account is subscribed.
      if (payload.object === 'page' && Array.isArray(payload.entry)) {
        const connection = await metaConnection(this.db);
        if (connection)
          payload.entry = payload.entry.filter(
            (e: { id?: unknown }) => String(e.id) === connection.page_id,
          );
      }
      const comments = parseComments(payload);
      const messages = parseWebhook(payload);
      const referrals = parseReferrals(payload);
      const fields = [
        ...new Set(
          (Array.isArray(payload.entry) ? payload.entry : []).flatMap(
            (e: { changes?: { field?: string }[]; messaging?: unknown[] }) => [
              ...(e.changes ?? []).map((c) => `changes.${c.field}`),
              ...(e.messaging ? ['messaging'] : []),
            ],
          ),
        ),
      ];
      this.log.log(
        `${payload.object}: ${fields.join(', ') || 'no events'} -> ${comments.length} comment(s), ${messages.length} message(s) kept`,
      );
      // Public comments: the database finds a phone number in them and tells the team (social_comment_lead).
      for (const comment of comments) {
        await this.db.withActor(null, (trx) =>
          trx
            .insertInto('social_comments')
            .values({
              platform: comment.platform,
              external_id: comment.externalId,
              post_id: comment.postId,
              author_id: comment.authorId,
              author_name: comment.authorName,
              body: comment.text.slice(0, 5000),
              commented_at: comment.commentedAt,
            })
            .onConflict((oc) =>
              oc.columns(['platform', 'external_id']).doNothing(),
            )
            .execute(),
        );
      }
      for (const message of messages) {
        const kept = await this.db.withActor(null, (trx) =>
          keepMessage(trx as unknown as Database, message, null),
        );
        // Not awaited: Meta wants its answer quickly, and its files and profiles can be slow.
        if (kept.id && message.attachments.length)
          this.media.background(
            this.media.copy(kept.id, kept.customer_id, message.attachments),
          );
        this.media.background(
          this.media.profiles([
            { customer_id: kept.customer_id, channel: message.channel },
          ]),
        );
      }
      // Which ad started the conversation, after its message so the customer is there.
      for (const r of referrals) {
        await this.db.withActor(null, async (trx) => {
          const customerId = await customerFor(trx as unknown as Database, {
            channel: r.channel,
            direction: 'in',
            externalId: r.externalId,
            senderId: r.senderId,
            senderName: null,
            phone: null,
            text: '',
            attachments: [],
            sentAt: r.at,
          });
          await trx
            .insertInto('ad_referrals')
            .values({
              customer_id: customerId,
              channel: r.channel,
              ad_id: r.adId.slice(0, 64),
              source: r.source?.slice(0, 40) ?? null,
              ref: r.ref?.slice(0, 200) ?? null,
              ad_title: r.title?.slice(0, 300) ?? null,
              external_id: r.externalId.slice(0, 200),
              referred_at: r.at,
            })
            .onConflict((oc) =>
              oc.columns(['channel', 'external_id']).doNothing(),
            )
            .execute();
        });
      }
    } catch (error) {
      // Answer 200 anyway: Meta retries failed deliveries for hours and then disables the webhook.
      this.log.error(`failed: ${(error as Error).message}`);
      Sentry.captureException(error, { tags: { area: 'meta-webhook' } });
    }
    return new Raw({ received: true });
  }
}
