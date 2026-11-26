import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  graph,
  metaConfigured,
  metaFile,
  sendMetaFile,
  type MetaChannel,
} from '@shared/erp/meta';
import type { RequestActor } from '../auth/auth.guard';
import { CurrentActor, Public } from '../auth/decorators';
import { ApiError, params, Zod, zId } from '../common/api';
import { deleteObject, putObject, signedUrl } from '../common/storage';
import { Database } from '../db/database';
import type { Upload } from '../files/files.controllers';
import { metaPageToken } from './meta-connection';
import { claimCustomer } from './meta-messages';

/** path: our copy in `documents`; url: Meta's, until it is copied. */
export interface Attachment {
  type: string;
  path?: string;
  url?: string;
}

/** A file as the Graph API lists it (the webhook's shape is another). */
export interface ApiFile {
  mime_type?: string;
  file_url?: string;
  image_data?: { url?: string };
  video_data?: { url?: string };
}

export const apiFiles = (files: ApiFile[]) =>
  files.flatMap((a) => {
    const url = a.image_data?.url ?? a.video_data?.url ?? a.file_url;
    const type = a.mime_type?.startsWith('audio/')
      ? 'audio'
      : a.image_data
        ? 'image'
        : a.video_data
          ? 'video'
          : 'file';
    return url && metaFile(url) ? [{ type, url }] : [];
  });

const MAX_BYTES = 25 * 1024 * 1024; // Meta's own limit
const HOUR = 3600_000;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/mp4': 'mp4',
};
export const idKey = (channel: string) =>
  channel === 'facebook' ? 'messenger' : channel;

/** A file from Meta's servers (and nowhere else, redirects included). */
async function download(url: string) {
  for (let hop = 0; hop < 4; hop++) {
    if (!metaFile(url)) throw new Error('not a Meta address');
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    const next = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && next) {
      url = new URL(next, url).toString();
      continue;
    }
    const type = (response.headers.get('content-type') ?? '').split(';')[0];
    if (!response.ok || !EXTENSIONS[type])
      throw new Error(`${response.status} ${type}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error('too large');
      chunks.push(chunk);
    }
    return { type, data: Buffer.concat(chunks) };
  }
  throw new Error('too many redirects');
}

async function store(customerId: string, type: string, data: Buffer) {
  const path = `messages/${customerId}/${randomUUID()}.${EXTENSIONS[type]}`;
  await putObject('documents', path, data, type);
  return path;
}

/** Where a reply goes, with the token that sends it. */
export async function replyTarget(
  db: Database,
  customerId: string,
  channel: MetaChannel,
) {
  const pageToken = await metaPageToken(db);
  if (!metaConfigured(pageToken)[channel])
    throw new ApiError(
      `${channel} is not connected yet. Log the message instead.`,
      503,
      'NOT_CONFIGURED',
    );
  const customer = await db
    .selectFrom('customers')
    .select(['phone', 'external_ids'])
    .where('id', '=', customerId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  const ids = (customer?.external_ids ?? {}) as Record<string, string>;
  const recipient =
    channel === 'whatsapp'
      ? (ids.whatsapp ?? (customer?.phone ? `216${customer.phone}` : null))
      : ids[idKey(channel)];
  if (!recipient)
    throw new ApiError(
      'This customer has never written to us on this channel.',
      409,
    );
  return { recipient, pageToken };
}

/** Copies what customers send, and their names and photos: Meta's links expire. */
@Injectable()
export class MetaMedia {
  private readonly log = new Logger('MetaMedia');
  private readonly tried = new Map<string, number>();

  constructor(private readonly db: Database) {}

  // shortcut: in memory, so a restart asks Meta again; enough for one API server.
  private due(key: string) {
    const last = this.tried.get(key);
    if (last && Date.now() - last < HOUR) return false;
    if (this.tried.size > 5000) this.tried.clear();
    this.tried.set(key, Date.now());
    return true;
  }

  /** Replaces Meta's links of a message with our copies. Until then (or if it fails) theirs are used. */
  async copy(id: string, customerId: string, attachments: Attachment[]) {
    const copies: Attachment[] = [];
    for (const a of attachments) {
      try {
        const file = await download(a.url!);
        copies.push({
          type: a.type === 'audio' ? 'audio' : file.type.split('/')[0],
          path: await store(customerId, file.type, file.data),
        });
      } catch (error) {
        this.log.warn(`${a.type} not copied: ${(error as Error).message}`);
        copies.push(a);
      }
    }
    if (!copies.some((c) => c.path)) return;
    const saved = await this.db.withActor(null, (trx) =>
      trx
        .updateTable('customer_interactions')
        .set({ attachments: JSON.stringify(copies) })
        .where('id', '=', id)
        .where(
          sql<boolean>`attachments = ${JSON.stringify(attachments)}::jsonb`,
        )
        .returning('id')
        .executeTakeFirst(),
    );
    // Changed meanwhile (sent from here, or the customer was erased): no stray files.
    if (!saved)
      for (const c of copies)
        if (c.path) await deleteObject('documents', c.path);
  }

  /** Messages kept as "[image]" before files were: asks Meta for them. */
  async recover(
    rows: {
      id: string;
      customer_id: string;
      channel: string;
      external_id: string | null;
      body: string;
      attachments: unknown;
    }[],
  ) {
    const lost = rows
      .filter(
        (r) =>
          !r.attachments &&
          r.external_id &&
          ['facebook', 'instagram'].includes(r.channel) &&
          /^\[(image|audio|video|file)\b.*\]$/.test(r.body),
      )
      .slice(-30)
      .filter((r) => this.due(r.id));
    if (!lost.length) return;
    const token = await metaPageToken(this.db);
    if (!token) return;
    for (const row of lost) {
      try {
        const { data } = await graph<{ data?: ApiFile[] }>(
          `/${encodeURIComponent(row.external_id!)}/attachments`,
          { token },
        );
        const found = apiFiles(data ?? []);
        if (!found.length) continue;
        await this.db.withActor(null, (trx) =>
          trx
            .updateTable('customer_interactions')
            .set({ attachments: JSON.stringify(found) })
            .where('id', '=', row.id)
            .where('attachments', 'is', null)
            .where('body', '=', row.body)
            .execute(),
        );
        await this.copy(row.id, row.customer_id, found);
      } catch (error) {
        this.log.warn(`attachment not found: ${(error as Error).message}`);
      }
    }
  }

  /** Names (when we have none) and profile photos of the people in these conversations. */
  async profiles(people: { customer_id: string; channel: string }[]) {
    const wanted = people.filter(
      (p) =>
        ['facebook', 'instagram'].includes(p.channel) &&
        this.due(`${p.customer_id}:${p.channel}`),
    );
    if (!wanted.length) return;
    const token = await metaPageToken(this.db);
    if (!token) return;
    for (const { customer_id, channel } of wanted)
      try {
        await this.profile(customer_id, channel, token);
      } catch (error) {
        this.log.warn(`${channel} profile: ${(error as Error).message}`);
      }
  }

  private async profile(customerId: string, channel: string, token: string) {
    const customer = await this.db
      .selectFrom('customers')
      .select(['full_name', 'external_ids'])
      .where('id', '=', customerId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const ids = (customer?.external_ids ?? {}) as Record<string, string>;
    const key = idKey(channel);
    const metaId = ids[key];
    if (!customer || !metaId || (customer.full_name && ids[`${key}_photo`]))
      return;
    const person = await graph<{
      name?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    }>(
      `/${encodeURIComponent(metaId)}?fields=${channel === 'facebook' ? 'first_name,last_name,profile_pic' : 'name,username,profile_pic'}`,
      { token },
    ).catch((error: Error) => {
      this.log.warn(`${channel} profile: ${error.message}`);
      return null;
    });
    let name =
      person?.name ||
      [person?.first_name, person?.last_name].filter(Boolean).join(' ') ||
      person?.username;
    if (!name && !customer.full_name) {
      // Meta hides some profiles; the conversation still names its people.
      const { data } = await graph<{
        data?: {
          participants?: {
            data?: { id: string; name?: string; username?: string }[];
          };
        }[];
      }>(
        `/me/conversations?${new URLSearchParams({ platform: channel === 'facebook' ? 'messenger' : 'instagram', user_id: metaId, fields: 'participants' })}`,
        { token },
      );
      const them = data?.[0]?.participants?.data?.find((p) => p.id === metaId);
      name = them?.name || them?.username;
    }
    let photo: string | null = null;
    if (person?.profile_pic && !ids[`${key}_photo`]) {
      const file = await download(person.profile_pic).catch(() => null);
      if (file?.type.startsWith('image/'))
        photo = await store(customerId, file.type, file.data);
    }
    if (!photo && (customer.full_name || !name)) return;
    const added = JSON.stringify(photo ? { [`${key}_photo`]: photo } : {});
    const saved = await this.db.withActor(null, (trx) =>
      trx
        .updateTable('customers')
        .set({
          full_name: sql<string>`case when full_name = '' then ${name?.slice(0, 150) ?? ''}::text else full_name end`,
          external_ids: sql`external_ids || ${added}::jsonb`,
        })
        .where('id', '=', customerId)
        .where(
          sql<boolean>`external_ids @> ${JSON.stringify({ [key]: metaId })}::jsonb`,
        )
        .returning('id')
        .executeTakeFirst(),
    );
    if (!saved && photo) await deleteObject('documents', photo);
  }

  /** Runs on its own: the caller never waits for Meta. */
  background(work: Promise<unknown>) {
    work.catch((error: Error) => this.log.error(error.message));
  }

  /** The stored files of a customer, to delete once their data is erased. */
  async files(customerId: string) {
    const [customer, messages] = await Promise.all([
      this.db
        .selectFrom('customers')
        .select('external_ids')
        .where('id', '=', customerId)
        .executeTakeFirst(),
      this.db
        .selectFrom('customer_interactions')
        .select('attachments')
        .where('customer_id', '=', customerId)
        .where('attachments', 'is not', null)
        .execute(),
    ]);
    const ids = (customer?.external_ids ?? {}) as Record<string, string>;
    return [
      ids.messenger_photo,
      ids.instagram_photo,
      ...messages.flatMap((m) =>
        (m.attachments as unknown as Attachment[]).map((a) => a.path),
      ),
    ].filter((p): p is string => Boolean(p));
  }
}

const sendSchema = z.object({
  customer_id: zId,
  channel: z.enum(['facebook', 'instagram']),
});
// What the browser makes of any photo or recording (messenger-media.tsx); both platforms take these.
const SENDABLE: Record<string, ['image' | 'audio', (b: Buffer) => boolean]> = {
  'image/jpeg': ['image', (b) => b[0] === 0xff && b[1] === 0xd8],
  'audio/wav': ['audio', (b) => b.toString('latin1', 0, 4) === 'RIFF'],
};

/** Photos and audio of the Messenger screen. Access: lib/api-access.ts (customers). */
@Controller('crm/media')
@Public()
export class MetaMediaController {
  constructor(private readonly db: Database) {}

  /** ?id=&i= — a message's file. The address stays the same, so a refresh doesn't cut what plays. */
  @Get()
  async file(
    @Query() query: Record<string, string>,
    @Res() response: Response,
  ) {
    if (!zId.safeParse(query.id).success) throw new ApiError('Missing id');
    const row = await this.db
      .selectFrom('customer_interactions')
      .select('attachments')
      .where('id', '=', query.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const list = (row?.attachments ?? []) as unknown as Attachment[];
    const file = list[Number(query.i ?? 0)];
    if (!file) throw new ApiError('This file no longer exists.', 404);
    await this.show(response, file);
  }

  /** ?customer_id=&channel= — their profile photo. */
  @Get('photo')
  async photo(
    @Query() query: Record<string, string>,
    @Res() response: Response,
  ) {
    if (!zId.safeParse(query.customer_id).success)
      throw new ApiError('Missing id');
    const row = await this.db
      .selectFrom('customers')
      .select('external_ids')
      .where('id', '=', query.customer_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const ids = (row?.external_ids ?? {}) as Record<string, string>;
    const path = ids[`${idKey(query.channel)}_photo`];
    if (!path) throw new ApiError('This file no longer exists.', 404);
    await this.show(response, { type: 'image', path });
  }

  /** ?q= — products with their photos, to send one. */
  @Get('products')
  async products(@Query() query: Record<string, string>) {
    const term = params(query).get('q');
    const like = term ? `%${term.replace(/[\\%_]/g, ' ')}%` : null;
    const { rows } = await sql`
      select p.id, p.name, p.name_fr, p.name_ar,
             json_agg(i.image_url order by i.is_main desc, i.position) as images
      from products p
      join product_images i on i.product_id = p.id and i.deleted_at is null
      where p.deleted_at is null
        and (${like}::text is null or p.name ilike ${like} or p.name_fr ilike ${like}
             or p.name_ar ilike ${like} or p.code ilike ${like})
      group by p.id
      order by p.created_at desc
      limit 40`.execute(this.db);
    return rows;
  }

  /** multipart: file (JPEG or WAV), customer_id, channel — sends it and keeps it in the conversation. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  async send(
    @UploadedFile() file: Upload | undefined,
    @Body(new Zod(sendSchema)) body: z.infer<typeof sendSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const kind = file && SENDABLE[file.mimetype];
    if (!file || !kind?.[1](file.buffer))
      throw new ApiError('Choose a photo or an audio recording.');
    await claimCustomer(this.db, actor, body.customer_id);
    const { recipient, pageToken } = await replyTarget(
      this.db,
      body.customer_id,
      body.channel,
    );
    const path = await store(body.customer_id, file.mimetype, file.buffer);
    let externalId: string | null;
    try {
      externalId = await sendMetaFile(
        recipient,
        kind[0],
        await signedUrl('documents', path, 3600),
        pageToken!,
      );
    } catch (error) {
      await deleteObject('documents', path).catch(() => {});
      throw new ApiError(`Not sent: ${(error as Error).message}`, 502, 'META');
    }
    const attachments = JSON.stringify([{ type: kind[0], path }]);
    return this.db.withActor(actor, async (trx) => {
      const row = await trx
        .insertInto('customer_interactions')
        .values({
          ...body,
          direction: 'out',
          body: `[${kind[0]}]`,
          attachments,
          external_id: externalId,
          read_at: new Date(),
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        // Meta's echo may have been stored first.
        .onConflict((oc) =>
          oc.columns(['channel', 'external_id']).doUpdateSet({
            attachments,
            created_by: actor.userId,
            created_by_email: actor.email,
          }),
        )
        .returning(['id'])
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('customers')
        .set({ updated_at: new Date() })
        .where('id', '=', body.customer_id)
        .execute();
      return row;
    });
  }

  private async show(response: Response, file: Attachment) {
    const url = file.path
      ? await signedUrl('documents', file.path, 3600)
      : file.url!;
    response.setHeader('Cache-Control', 'private, max-age=1800');
    response.redirect(url);
  }
}
