import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { graph } from '@shared/erp/meta';
import { AdminOnly } from '../auth/decorators';
import { ApiError } from '../common/api';
import { Database } from '../db/database';
import { metaPageToken, PAGE_FIELDS, received } from './meta-connection';

export interface TokenInfo {
  is_valid: boolean;
  app_id: string;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
}

interface Subscription {
  object: string;
  callback_url: string;
  active: boolean;
  fields: { name: string }[];
}

const appId = () => process.env.META_APP_ID ?? '';
const appToken = () => `${appId()}|${process.env.META_APP_SECRET ?? ''}`;

/** What Meta says about a token (its app, permissions and expiry). */
export const tokenInfo = (token: string) =>
  graph<{ data: TokenInfo }>(
    `/debug_token?${new URLSearchParams({ input_token: token })}`,
    { token: appToken() },
  ).then((r) => r.data);

const APP_FIELDS: Record<string, string[]> = {
  page: PAGE_FIELDS,
  instagram: ['messages', 'comments'],
};
const SCOPES: Record<string, string[]> = {
  messages: ['pages_messaging', 'pages_manage_metadata'],
  comments: ['pages_read_engagement', 'pages_read_user_content'],
  instagram_messages: ['instagram_basic', 'instagram_manage_messages'],
  instagram_comments: ['instagram_basic', 'instagram_manage_comments'],
  publish: ['pages_manage_posts', 'instagram_content_publish'],
};
const without = (needed: string[], have: string[] = []) =>
  needed.filter((x) => !have.includes(x));

const subscriptions = () =>
  graph<{ data: Subscription[] }>(`/${appId()}/subscriptions`, {
    token: appToken(),
  }).then((r) => r.data);

const pageFields = async (token: string) =>
  (
    await graph<{ data: { id: string; subscribed_fields?: string[] }[] }>(
      '/me/subscribed_apps',
      { token },
    )
  ).data.find((a) => a.id === appId())?.subscribed_fields ?? [];

/** Messenger → Connections → Check: asks Meta what is missing, and repairs the subscriptions. */
@Controller('admin/meta')
@AdminOnly()
export class MetaHealthController {
  constructor(private readonly db: Database) {}

  @Get('check')
  async check() {
    const token = await metaPageToken(this.db);
    const checks: { id: string; ok: boolean; detail: string | null }[] = [];
    /** `work` returns what is wrong, or null. */
    const add = async (
      id: string,
      work: () => Promise<string | null> | string | null,
    ) => {
      let detail: string | null;
      try {
        detail = await work();
      } catch (error) {
        detail = (error as Error).message;
      }
      checks.push({ id, ok: detail === null, detail });
    };
    await add('app', () =>
      graph(`/${appId()}?fields=id`, { token: appToken() }).then(() => null),
    );
    if (!token) checks.push({ id: 'page', ok: false, detail: null });
    else {
      const info = await tokenInfo(token).catch(() => null);
      await add('token', () =>
        !info?.is_valid ? '' : info.app_id === appId() ? null : info.app_id,
      );
      for (const [id, scopes] of Object.entries(SCOPES))
        await add(
          `scope_${id}`,
          () => without(scopes, info?.scopes).join(', ') || null,
        );
      await add('instagram', async () => {
        const page = await graph<{ instagram_business_account?: object }>(
          '/me?fields=instagram_business_account',
          { token },
        );
        return page.instagram_business_account ? null : '';
      });
      await add(
        'page_subscription',
        async () =>
          without(PAGE_FIELDS, await pageFields(token)).join(', ') || null,
      );
    }
    const list = await subscriptions().catch((): Subscription[] => []);
    for (const [object, fields] of Object.entries(APP_FIELDS))
      await add(`webhook_${object}`, () => {
        const s = list.find((x) => x.object === object && x.active);
        if (s && !s.callback_url.endsWith('/api/webhooks/meta'))
          return s.callback_url;
        const have = s?.fields.map((f) => f.name);
        return without(fields, have).join(', ') || null;
      });
    return { checks, received };
  }

  /** Subscribes the Page and the app to the events that are missing; what is there already stays. */
  @Post('repair')
  @HttpCode(200)
  async repair() {
    const token = await metaPageToken(this.db);
    if (!token) throw new ApiError('No Page is connected.', 409);
    const { META_VERIFY_TOKEN: verify_token, SITE_DOMAIN: domain } =
      process.env;
    try {
      const list = await subscriptions();
      for (const [object, fields] of Object.entries(APP_FIELDS)) {
        const s = list.find((x) => x.object === object);
        const have = s?.fields.map((f) => f.name) ?? [];
        if (s?.active && !without(fields, have).length) continue;
        // Another address stays as it is: moving it would cut off whatever listens there.
        const callback_url =
          s?.callback_url ?? (domain && `https://${domain}/api/webhooks/meta`);
        if (!verify_token || !callback_url)
          throw new Error(
            'META_VERIFY_TOKEN or SITE_DOMAIN is not set on the server.',
          );
        await graph(`/${appId()}/subscriptions`, {
          method: 'POST',
          token: appToken(),
          timeout: 30_000, // Meta calls the webhook back before it answers
          body: {
            object,
            callback_url,
            verify_token,
            fields: [...new Set([...have, ...fields])].join(','),
          },
        });
      }
      await graph('/me/subscribed_apps', {
        method: 'POST',
        token,
        body: {
          subscribed_fields: [
            ...new Set([...(await pageFields(token)), ...PAGE_FIELDS]),
          ].join(','),
        },
      });
    } catch (error) {
      throw new ApiError((error as Error).message, 502, 'META');
    }
    return { repaired: true };
  }
}
