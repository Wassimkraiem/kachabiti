import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { RequestActor } from '../auth/auth.guard';
import { CurrentActor, Public } from '../auth/decorators';
import { ApiError, period, Zod, zId } from '../common/api';
import { publicUrl, putObject } from '../common/storage';
import { metaConnection } from '../crm/meta-connection';
import { tokenInfo } from '../crm/meta-health';
import { Database } from '../db/database';
import type { Upload } from '../files/files.controllers';

const postSchema = z.object({
  caption: z.string().trim().max(2200).default(''),
  media_url: z.url().max(1000).nullable().default(null),
  media_type: z.enum(['image', 'video']).nullable().default(null),
  targets: z.array(z.enum(['facebook', 'instagram'])).min(1),
  scheduled_at: z.iso.datetime({ offset: true }),
});
const updateSchema = postSchema.extend({ id: zId });
const retrySchema = z.object({ id: zId });

const MEDIA: Record<string, ['jpg' | 'mp4', 'image' | 'video', number]> = {
  'image/jpeg': ['jpg', 'image', 8],
  'video/mp4': ['mp4', 'video', 50],
};
// What publishing needs on each platform.
const SCOPES = {
  facebook: 'pages_manage_posts',
  instagram: 'instagram_content_publish',
};

/** Admin → Marketing → Post calendar. Access: lib/api-access.ts (marketing). */
@Controller('social')
@Public()
export class SocialController {
  constructor(private readonly db: Database) {}

  /** ?from=&to= (ISO) → { posts, page } */
  @Get('posts')
  async list(@Query() query: Record<string, string>) {
    const { from, to } = period(query);
    const [posts, page] = await Promise.all([
      this.db
        .selectFrom('scheduled_posts')
        .select([
          'id',
          'caption',
          'media_url',
          'media_type',
          'targets',
          'scheduled_at',
          'status',
          'published',
          'error',
          'created_by_email',
        ])
        .where('deleted_at', 'is', null)
        .where('scheduled_at', '>=', from.toISOString())
        .where('scheduled_at', '<', to.toISOString())
        .orderBy('scheduled_at')
        .limit(500)
        .execute(),
      metaConnection(this.db),
    ]);
    return {
      posts,
      page: page && {
        name: page.page_name,
        instagram: page.instagram_username,
      },
    };
  }

  @Post('posts')
  async create(
    @Body(new Zod(postSchema)) body: z.infer<typeof postSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const page = await this.check(body);
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('scheduled_posts')
        .values({
          ...body,
          page_id: page.page_id,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returning(['id', 'status'])
        .executeTakeFirstOrThrow(),
    );
  }

  /** Changes a post that isn't out yet. */
  @Patch('posts')
  async update(
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...values } = body;
    const { page_id } = await this.check(values);
    return this.change(actor, id, 'scheduled', { ...values, page_id });
  }

  /** { id } — sends what failed again, now. */
  @Post('posts/retry')
  retry(
    @Body(new Zod(retrySchema)) body: z.infer<typeof retrySchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.change(actor, body.id, 'failed', {
      status: 'scheduled',
      scheduled_at: new Date(),
      error: null,
    });
  }

  /** ?id= — off the calendar (what is already published stays on the Page). */
  @Delete('posts')
  remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id || !zId.safeParse(id).success) throw new ApiError('Missing id');
    return this.change(actor, id, null, { deleted_at: new Date() });
  }

  /** multipart `file`: a JPEG (8 MB) or an MP4 (50 MB) → { url, type } */
  @Post('media')
  @HttpCode(200)
  // shortcut: the file passes through the API's memory; upload straight to S3 for larger videos.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async upload(@UploadedFile() file: Upload | undefined) {
    const media = file && MEDIA[file.mimetype];
    if (!media || file.size > media[2] * 1024 * 1024)
      throw new ApiError(
        'Choose a photo (8 MB at most) or an MP4 video (50 MB at most).',
      );
    const key = `post-${Date.now()}-${randomUUID().slice(0, 13)}.${media[0]}`;
    await putObject('products', key, file.buffer, file.mimetype);
    return { url: publicUrl(key), type: media[1] };
  }

  /** Writes only while the post is in that status (null: any but publishing), so a post being sent is left alone. */
  private async change(
    actor: RequestActor,
    id: string,
    status: 'scheduled' | 'failed' | null,
    values: Record<string, unknown>,
  ) {
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('scheduled_posts')
        .set(values)
        .where('id', '=', id)
        .where('status', status ? '=' : '!=', status ?? 'publishing')
        .where('deleted_at', 'is', null)
        .returning(['id', 'status'])
        .executeTakeFirst(),
    );
    if (!row) throw new ApiError('This post can no longer be changed.', 409);
    return row;
  }

  private async check(post: z.infer<typeof postSchema>) {
    const page = await metaConnection(this.db);
    if (!page)
      throw new ApiError(
        'Connect your Facebook Page first (Messenger → Connections).',
        409,
      );
    if (!post.caption && !post.media_url)
      throw new ApiError('Write a text or add a photo or video.');
    if ((post.media_url === null) !== (post.media_type === null))
      throw new ApiError('Choose the photo or video again.');
    if (new Date(post.scheduled_at).getTime() < Date.now() - 60_000)
      throw new ApiError('Choose a time in the future.');
    if (post.targets.includes('instagram')) {
      if (!page.instagram_id)
        throw new ApiError('No Instagram account is linked to this Page.', 409);
      if (!post.media_url)
        throw new ApiError('Instagram needs a photo or a video.');
    }
    const info = await tokenInfo(page.token).catch((error: Error) => {
      throw new ApiError(error.message, 502, 'META');
    });
    if (post.targets.some((t) => !info.scopes?.includes(SCOPES[t])))
      throw new ApiError(
        'The publishing permissions are missing. Add pages_manage_posts and instagram_content_publish to the login configuration, then connect the Page again.',
        409,
      );
    return page;
  }
}
