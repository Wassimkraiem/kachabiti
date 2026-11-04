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
import { sql } from 'kysely';
import {
  parseComments,
  parseWebhook,
  validSignature,
  type IncomingMessage,
} from '@shared/erp/meta';
import { Public } from '../auth/decorators';
import { ApiError, Raw } from '../common/api';
import { Database } from '../db/database';

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

  constructor(private readonly db: Database) {}

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
      this.log.warn(`refused: invalid signature (${raw.length} bytes)`);
      throw new ApiError('Invalid signature', 401);
    }
    try {
      const payload = JSON.parse(raw);
      const comments = parseComments(payload);
      const messages = parseWebhook(payload);
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
        await this.db.withActor(null, async (trx) => {
          const customerId = await this.customerFor(
            trx as unknown as Database,
            message,
          );
          await trx
            .insertInto('customer_interactions')
            .values({
              customer_id: customerId,
              channel: message.channel,
              direction: 'in',
              body: message.text.slice(0, 5000),
              external_id: message.externalId,
              sender_name: message.senderName,
              created_at: message.sentAt,
            })
            .onConflict((oc) =>
              oc.columns(['channel', 'external_id']).doNothing(),
            )
            .execute();
          await trx
            .updateTable('customers')
            .set({ updated_at: new Date() })
            .where('id', '=', customerId)
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

  private async customerFor(
    trx: Database,
    message: IncomingMessage,
  ): Promise<string> {
    const key = message.channel === 'facebook' ? 'messenger' : message.channel;
    const byId = await trx
      .selectFrom('customers')
      .select('id')
      .where(
        sql<boolean>`external_ids @> ${JSON.stringify({ [key]: message.senderId })}::jsonb`,
      )
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (byId) return byId.id;

    let phone: string | null = null;
    if (message.phone) {
      phone =
        (
          await sql<{
            p: string | null;
          }>`select public.normalize_phone(${message.phone}) as p`.execute(trx)
        ).rows[0]?.p ?? null;
      if (phone) {
        const byPhone = await trx
          .selectFrom('customers')
          .select(['id', 'external_ids'])
          .where('phone', '=', phone)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (byPhone) {
          await trx
            .updateTable('customers')
            .set({
              external_ids: JSON.stringify({
                ...((byPhone.external_ids as object) ?? {}),
                [key]: message.senderId,
              }),
            })
            .where('id', '=', byPhone.id)
            .execute();
          return byPhone.id;
        }
      }
    }
    const created = await trx
      .insertInto('customers')
      .values({
        phone,
        full_name: message.senderName ?? '',
        channel: message.channel,
        stage: 'new',
        external_ids: JSON.stringify({ [key]: message.senderId }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return created.id;
  }
}
