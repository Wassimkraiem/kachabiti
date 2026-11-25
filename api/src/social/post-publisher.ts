import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { graph } from '@shared/erp/meta';
import { metaConnection } from '../crm/meta-connection';
import { Database } from '../db/database';

// META_POLL_MS: a faster clock for the e2e suite.
const EVERY_MS = Number(process.env.META_POLL_MS) || 30_000;
const POLL_MS = Number(process.env.META_POLL_MS) || 5_000;
const MAX_WAIT_MS = 10 * 60_000; // for Instagram's video processing; claim_due_posts() gives up after 20

interface Post {
  id: string;
  page_id: string;
  caption: string;
  media_url: string | null;
  media_type: string | null;
  targets: string[];
  published: Record<string, string>;
}

/** Publishes scheduled posts. Each target's id is saved at once, so a retry never sends it twice. */
@Injectable()
export class PostPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PostPublisher');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: Database) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      // One at a time: a claimed post is being sent, not waiting behind another one's video.
      for (;;) {
        const [post] = await this.db.withActor(null, (trx) =>
          this.db.callRows<Post>('claim_due_posts', {}, trx),
        );
        if (!post) break;
        await this.publish(post);
      }
    } catch (error) {
      this.log.error(`failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async publish(post: Post) {
    const errors: string[] = [];
    const connection = await metaConnection(this.db);
    for (const target of post.targets) {
      if (post.published[target]) continue;
      try {
        if (!connection || connection.page_id !== post.page_id)
          throw new Error('This Page is no longer connected.');
        const id =
          target === 'facebook'
            ? await this.facebook(post, connection.token)
            : await this.instagram(
                post,
                connection.token,
                connection.instagram_id,
              );
        await this.db.withActor(null, (trx) =>
          sql`update scheduled_posts
                 set published = published || ${JSON.stringify({ [target]: id })}::jsonb
               where id = ${post.id}`.execute(trx),
        );
      } catch (error) {
        errors.push(`${target}: ${(error as Error).message}`);
      }
    }
    await this.db.withActor(null, (trx) =>
      this.db.call(
        'finish_post',
        {
          p_id: post.id,
          p_error: errors.length ? errors.join(' · ').slice(0, 1000) : null,
        },
        trx,
      ),
    );
  }

  private async facebook(post: Post, token: string) {
    const [edge, body] =
      post.media_type === 'image'
        ? ['photos', { url: post.media_url, caption: post.caption }]
        : post.media_type === 'video'
          ? ['videos', { file_url: post.media_url, description: post.caption }]
          : ['feed', { message: post.caption }];
    const result = await graph<{ id: string; post_id?: string }>(
      `/${post.page_id}/${edge}`,
      { method: 'POST', token, body, timeout: 120_000 },
    );
    return result.post_id ?? result.id;
  }

  private async instagram(post: Post, token: string, account: string | null) {
    if (!account)
      throw new Error('No Instagram account is linked to this Page.');
    const container = await graph<{ id: string }>(`/${account}/media`, {
      method: 'POST',
      token,
      timeout: 60_000,
      body: {
        caption: post.caption,
        ...(post.media_type === 'video'
          ? { media_type: 'REELS', video_url: post.media_url }
          : { image_url: post.media_url }),
      },
    });
    const until = Date.now() + MAX_WAIT_MS;
    for (;;) {
      const { status_code, status } = await graph<{
        status_code: string;
        status?: string;
      }>(`/${container.id}?fields=status_code,status`, { token });
      if (status_code === 'FINISHED') break;
      if (status_code !== 'IN_PROGRESS' || Date.now() > until)
        throw new Error(status ?? status_code);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const result = await graph<{ id: string }>(`/${account}/media_publish`, {
      method: 'POST',
      token,
      timeout: 60_000,
      body: { creation_id: container.id },
    });
    return result.id;
  }
}
