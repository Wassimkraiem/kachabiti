import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { readCookie } from '@shared/auth-session';
import { graph, META_VERSION } from '@shared/erp/meta';
import type { RequestActor } from '../auth/auth.guard';
import { AdminOnly, CurrentActor } from '../auth/decorators';
import { ApiError, Zod } from '../common/api';
import { config } from '../config';
import { Database } from '../db/database';
import {
  metaAds,
  metaConnection,
  PAGE_FIELDS,
  seal,
  unseal,
} from './meta-connection';
import { tokenInfo } from './meta-health';

const STATE_COOKIE = 'kb_meta_state';
const LOGIN_COOKIE = 'kb_meta_login';
const TEN_MINUTES = 10 * 60_000;
const cookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax', // sent on the redirect back from Facebook
  secure: config.NEXT_PUBLIC_SITE_URL.startsWith('https://'),
  path: '/api/admin/meta',
};

interface Page {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

const connectSchema = z.object({ page_id: z.string().regex(/^\d+$/) });
const adAccountSchema = z.object({ id: z.string().regex(/^act_\d+$/) });

interface AdAccount {
  id: string;
  name: string;
  currency: string;
  account_status: number;
}

/**
 * Admin → Customers → Inbox, "Connect with Facebook" (Facebook Login for Business): login sends the
 * admin to Meta, callback keeps their token encrypted in a 10-minute cookie, pages lists what they
 * granted, and POST stores the chosen Page's token and subscribes it to the webhook.
 */
@Controller('admin/meta')
@AdminOnly()
export class MetaConnectionController {
  private readonly log = new Logger('MetaConnection');

  constructor(private readonly db: Database) {}

  @Get()
  async status() {
    const page = await metaConnection(this.db);
    return {
      available: Boolean(
        process.env.META_APP_ID &&
        process.env.META_APP_SECRET &&
        process.env.META_LOGIN_CONFIG_ID,
      ),
      page: page && {
        name: page.page_name,
        instagram: page.instagram_username,
        data_access_expires_at: page.data_access_expires_at,
        ad_account: page.ad_account_id && {
          id: page.ad_account_id,
          name: page.ad_account_name,
          currency: page.ad_currency,
        },
        // Connected before ads were read: connect again to read them.
        ads_ready: Boolean(page.user_token_encrypted),
      },
    };
  }

  /** The ad accounts the connecting person can read (ads_read). */
  @Get('ad-accounts')
  async adAccounts() {
    const ads = await metaAds(this.db);
    if (!ads)
      throw new ApiError(
        'Connect the Page again to read your ad accounts.',
        409,
      );
    const { data } = await this.ask(
      graph<{ data: AdAccount[] }>(
        '/me/adaccounts?fields=id,name,currency,account_status&limit=100',
        { token: ads.token },
      ),
    );
    return data.map((a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      active: a.account_status === 1,
    }));
  }

  /** { id } — the ad account Admin → Marketing → Meta ads reads. */
  @Post('ad-account')
  async chooseAdAccount(
    @Body(new Zod(adAccountSchema)) body: z.infer<typeof adAccountSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const account = (await this.adAccounts()).find((a) => a.id === body.id);
    if (!account)
      throw new ApiError('This ad account was not granted to the app.', 404);
    await this.db.withActor(actor, async (trx) => {
      await trx
        .updateTable('meta_connection')
        .set({
          ad_account_id: account.id,
          ad_account_name: account.name,
          ad_currency: account.currency,
        })
        .where('deleted_at', 'is', null)
        .execute();
      await this.record(trx, actor, 'update', account.id, account.name);
    });
    return account;
  }

  @Get('login')
  login(@Res() response: Response) {
    const { appId, configId } = this.app();
    const state = randomBytes(24).toString('base64url');
    response.cookie(STATE_COOKIE, state, { ...cookie, maxAge: TEN_MINUTES });
    const query = new URLSearchParams({
      client_id: appId,
      redirect_uri: this.redirectUri(),
      config_id: configId,
      response_type: 'code',
      override_default_response_type: 'true',
      state,
    });
    response.redirect(
      `https://www.facebook.com/${META_VERSION}/dialog/oauth?${query}`,
    );
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Req() request: Request,
    @Res() response: Response,
    @CurrentActor() actor: RequestActor,
  ) {
    const back = (result: string) =>
      response.redirect(
        `${config.NEXT_PUBLIC_SITE_URL}/admin/customers/inbox?meta=${result}`,
      );
    response.clearCookie(STATE_COOKIE, cookie);
    const given = Buffer.from(String(query.state ?? ''));
    const expected = Buffer.from(
      readCookie(request.headers.cookie, STATE_COOKIE) ?? '',
    );
    if (
      !expected.length ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    )
      return back('expired');
    if (typeof query.code !== 'string') return back('cancelled');
    try {
      const { appId, secret } = this.app();
      const exchange = (body: Record<string, string>) =>
        graph<{ access_token: string }>('/oauth/access_token', {
          method: 'POST',
          body: { client_id: appId, client_secret: secret, ...body },
        }).then((r) => r.access_token);
      const short = await exchange({
        redirect_uri: this.redirectUri(),
        code: query.code,
      });
      // A person's token lasts an hour, and so would its Pages' tokens. System-user tokens are
      // already lasting and may refuse this; POST checks the Page's token either way.
      const token = await exchange({
        grant_type: 'fb_exchange_token',
        fb_exchange_token: short,
      }).catch(() => short);
      const login = {
        token,
        user: actor.userId,
        until: Date.now() + TEN_MINUTES,
      };
      response.cookie(LOGIN_COOKIE, seal(JSON.stringify(login)), {
        ...cookie,
        maxAge: TEN_MINUTES,
      });
      return back('choose');
    } catch (error) {
      this.log.warn(`login failed: ${(error as Error).message}`);
      return back('failed');
    }
  }

  /** The Pages granted at login, without their tokens. */
  @Get('pages')
  async pages(@Req() request: Request, @CurrentActor() actor: RequestActor) {
    return (await this.granted(request, actor)).pages.map((p) => ({
      id: p.id,
      name: p.name,
      instagram: p.instagram_business_account?.username ?? null,
    }));
  }

  /** { page_id } — connects that Page, replacing the previous one. */
  @Post()
  async connect(
    @Body(new Zod(connectSchema)) body: z.infer<typeof connectSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentActor() actor: RequestActor,
  ) {
    const login = await this.granted(request, actor);
    const page = login.pages.find((p) => p.id === body.page_id);
    if (!page) throw new ApiError('This Page was not granted to the app.', 404);
    const { appId } = this.app();
    const info = await this.ask(tokenInfo(page.access_token));
    if (!info.is_valid || info.app_id !== appId || info.expires_at !== 0)
      throw new ApiError(
        'Meta gave a token that expires. Set the login configuration to a token that never expires, then connect again.',
        409,
      );
    if (
      !['pages_messaging', 'pages_manage_metadata'].every((s) =>
        info.scopes?.includes(s),
      )
    )
      throw new ApiError(
        'The permissions pages_messaging and pages_manage_metadata are missing. Add them to the login configuration, then connect again.',
        409,
      );

    const previous = await metaConnection(this.db);
    await this.ask(
      graph(`/${page.id}/subscribed_apps`, {
        method: 'POST',
        token: page.access_token,
        body: { subscribed_fields: PAGE_FIELDS.join(',') },
      }),
    );
    const row = {
      page_id: page.id,
      page_name: page.name,
      instagram_id: page.instagram_business_account?.id ?? null,
      instagram_username: page.instagram_business_account?.username ?? null,
      token_encrypted: seal(page.access_token),
      // The person's own token reads the ad accounts (ads_read); the Page's token can't.
      user_token_encrypted: seal(login.token),
      data_access_expires_at: info.data_access_expires_at
        ? new Date(info.data_access_expires_at * 1000)
        : null,
      connected_by: actor.userId,
      connected_by_email: actor.email,
      deleted_at: null,
    };
    await this.db.withActor(actor, async (trx) => {
      await trx
        .insertInto('meta_connection')
        .values(row)
        .onConflict((oc) => oc.column('id').doUpdateSet(row))
        .execute();
      await this.record(trx, actor, 'create', page.id, page.name);
    });
    if (previous && previous.page_id !== page.id)
      await this.unsubscribe(previous.page_id, previous.token);
    response.clearCookie(LOGIN_COOKIE, cookie);
    return { name: page.name };
  }

  /** Forgets the Page's token and stops its events. */
  @Delete()
  async disconnect(@CurrentActor() actor: RequestActor) {
    const current = await metaConnection(this.db);
    await this.db.withActor(actor, async (trx) => {
      const row = await trx
        .updateTable('meta_connection')
        .set({
          deleted_at: new Date(),
          token_encrypted: '',
          user_token_encrypted: null,
          ad_account_id: null,
          ad_account_name: null,
          ad_currency: null,
        })
        .where('deleted_at', 'is', null)
        .returning(['page_id', 'page_name'])
        .executeTakeFirst();
      if (!row) throw new ApiError('No Page is connected.', 404);
      await this.record(trx, actor, 'delete', row.page_id, row.page_name);
    });
    if (current) await this.unsubscribe(current.page_id, current.token);
    return { disconnected: true };
  }

  private app() {
    const {
      META_APP_ID: appId,
      META_APP_SECRET: secret,
      META_LOGIN_CONFIG_ID: configId,
    } = process.env;
    if (!appId || !secret || !configId)
      throw new ApiError(
        'Connecting with Facebook is not set up on the server.',
        503,
        'NOT_CONFIGURED',
      );
    return { appId, secret, configId };
  }

  private redirectUri() {
    return `${config.NEXT_PUBLIC_SITE_URL}/api/admin/meta/callback`;
  }

  private async granted(
    request: Request,
    actor: RequestActor,
  ): Promise<{ pages: Page[]; token: string }> {
    const sealed = readCookie(request.headers.cookie, LOGIN_COOKIE);
    const text = sealed && unseal(sealed);
    const login = text
      ? (JSON.parse(text) as { token: string; user: string; until: number })
      : null;
    if (!login || login.user !== actor.userId || login.until < Date.now())
      throw new ApiError(
        'The Facebook sign-in has expired. Connect again.',
        409,
      );
    // shortcut: the first 100 Pages, follow paging.next if an account ever has more.
    const { data } = await this.ask(
      graph<{ data: Page[] }>(
        '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100',
        { token: login.token },
      ),
    );
    return { pages: data, token: login.token };
  }

  /** Meta's refusal, shown to the admin. */
  private ask<T>(call: Promise<T>): Promise<T> {
    return call.catch((error: Error) => {
      throw new ApiError(error.message, 502, 'META');
    });
  }

  private async unsubscribe(pageId: string, token: string) {
    await graph(`/${pageId}/subscribed_apps`, {
      method: 'DELETE',
      token,
    }).catch((error: Error) =>
      this.log.warn(`Page ${pageId} not unsubscribed: ${error.message}`),
    );
  }

  private record(
    trx: Pick<Database, 'insertInto'>,
    actor: RequestActor,
    action: string,
    id: string,
    label: string,
  ) {
    return trx
      .insertInto('activity_log')
      .values({
        actor_id: actor.userId,
        actor_email: actor.email,
        actor_role: actor.role,
        action,
        entity: 'meta_connection',
        entity_id: id,
        label,
      })
      .execute();
  }
}
