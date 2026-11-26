import { Controller, Get, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { graph } from '@shared/erp/meta';
import { Public } from '../auth/decorators';
import { ApiError, zDate } from '../common/api';
import { metaAds } from '../crm/meta-connection';
import { Database } from '../db/database';

const CACHE_MS = 5 * 60_000; // Meta's figures move slowly; the page refreshes them
const ATTRIBUTION_DAYS = 30; // an order counts for an ad up to 30 days after the conversation
const CONVERSATION_STARTED =
  'onsite_conversion.messaging_conversation_started_7d';

interface Insight {
  campaign_id: string;
  campaign_name: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: { action_type: string; value: string }[];
}
interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}
interface Paged<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

const number = (v: string | undefined) => (v === undefined ? 0 : Number(v));

/**
 * Admin → Marketing → Meta ads: the ad account's campaigns with Meta's figures, next to what the CRM
 * saw: conversations started from their ads (ad_referrals), and those customers' orders. Access:
 * lib/api-access.ts (marketing).
 */
@Controller('marketing/meta-ads')
@Public()
export class MetaAdsController {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  /** ad id → campaign id: ads don't change campaign. */
  private readonly adCampaigns = new Map<string, string>();

  constructor(private readonly db: Database) {}

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD (both included). */
  @Get()
  async report(@Query() query: Record<string, string>) {
    const from = zDate.parse(query.from);
    const to = zDate.parse(query.to);
    if (from > to) throw new ApiError('The start comes after the end.');
    const ads = await metaAds(this.db);
    if (!ads?.ad_account_id)
      throw new ApiError(
        'Choose your ad account first (Messenger → Connections).',
        409,
        'NO_AD_ACCOUNT',
      );
    const account = ads.ad_account_id;
    const [insights, campaigns] = await this.cached(
      `${account}:${from}:${to}`,
      () =>
        Promise.all([
          this.all<Insight>(
            `/${account}/insights?${new URLSearchParams({
              level: 'campaign',
              fields:
                'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions',
              time_range: JSON.stringify({ since: from, until: to }),
              limit: '200',
            })}`,
            ads.token,
          ),
          this.all<Campaign>(
            `/${account}/campaigns?${new URLSearchParams({
              fields:
                'id,name,status,effective_status,objective,daily_budget,lifetime_budget',
              limit: '200',
            })}`,
            ads.token,
          ),
        ]),
    );

    // What the CRM saw: who wrote after an ad in the period, and what they ordered within 30 days.
    const { rows } = await sql<{
      ad_id: string;
      ad_title: string | null;
      customer_id: string;
      full_name: string;
      channel: string;
      referred_at: Date;
      order_id: string | null;
      status: string | null;
      total: string | null;
    }>`
      with r as (
        select distinct on (r.customer_id, r.ad_id) r.customer_id, r.ad_id, r.ad_title, r.channel, r.referred_at
        from ad_referrals r
        where r.deleted_at is null
          and r.referred_at >= ${from}::date and r.referred_at < ${to}::date + 1
        order by r.customer_id, r.ad_id, r.referred_at
      )
      select r.ad_id, r.ad_title, r.customer_id, c.full_name, r.channel, r.referred_at,
             o.id as order_id, o.status, o.total
      from r
      join customers c on c.id = r.customer_id
      left join orders o on o.customer_id = r.customer_id and o.deleted_at is null
        and o.created_at >= r.referred_at - interval '10 minutes' -- Meta's clock and ours differ by a little
        and o.created_at < r.referred_at + make_interval(days => ${ATTRIBUTION_DAYS})
      order by r.referred_at desc`.execute(this.db);

    await this.learnCampaigns(
      [...new Set(rows.map((r) => r.ad_id))].filter(
        (id) => !this.adCampaigns.has(id),
      ),
      ads.token,
    );

    // Per campaign, each customer and order once, whichever of its ads they came from.
    type Result = {
      customers: Map<
        string,
        {
          id: string;
          name: string;
          channel: string;
          referred_at: Date;
          ad: string | null;
          orders: number;
          delivered: number;
        }
      >;
      orders: Map<string, { status: string; total: number }>;
    };
    const results = new Map<string, Result>();
    for (const row of rows) {
      const campaign = this.adCampaigns.get(row.ad_id) ?? 'other';
      const result = results.get(campaign) ?? {
        customers: new Map(),
        orders: new Map(),
      };
      results.set(campaign, result);
      const person = result.customers.get(row.customer_id) ?? {
        id: row.customer_id,
        name: row.full_name,
        channel: row.channel,
        referred_at: row.referred_at,
        ad: row.ad_title,
        orders: 0,
        delivered: 0,
      };
      result.customers.set(row.customer_id, person);
      if (row.order_id && !result.orders.has(row.order_id)) {
        result.orders.set(row.order_id, {
          status: row.status!,
          total: Number(row.total),
        });
        person.orders += 1;
        if (row.status === 'delivered') person.delivered += 1;
      }
    }
    const crm = (id: string) => {
      const result = results.get(id);
      const orders = [...(result?.orders.values() ?? [])];
      const delivered = orders.filter((o) => o.status === 'delivered');
      return {
        conversations: result?.customers.size ?? 0,
        orders: orders.length,
        delivered: delivered.length,
        revenue: delivered.reduce((sum, o) => sum + o.total, 0),
        people: [...(result?.customers.values() ?? [])].slice(0, 200),
      };
    };

    const byId = new Map(insights.map((i) => [i.campaign_id, i]));
    // The period's campaigns: those Meta has figures for, those running, and those the CRM saw.
    const shown = campaigns.filter(
      (c) =>
        byId.has(c.id) || c.effective_status === 'ACTIVE' || results.has(c.id),
    );
    const list = shown.map((c) => {
      const i = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.effective_status,
        objective: c.objective ?? null,
        // Meta gives budgets in the currency's smallest unit.
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget
          ? Number(c.lifetime_budget) / 100
          : null,
        meta: {
          spend: number(i?.spend),
          impressions: number(i?.impressions),
          reach: number(i?.reach),
          clicks: number(i?.clicks),
          ctr: number(i?.ctr),
          cpc: number(i?.cpc),
          cpm: number(i?.cpm),
          frequency: number(i?.frequency),
          conversations_started: number(
            i?.actions?.find((a) => a.action_type === CONVERSATION_STARTED)
              ?.value,
          ),
        },
        crm: crm(c.id),
      };
    });
    list.sort(
      (a, b) =>
        b.meta.spend - a.meta.spend ||
        b.crm.conversations - a.crm.conversations,
    );
    return {
      account: {
        id: account,
        name: ads.ad_account_name,
        currency: ads.ad_currency,
      },
      campaigns: list,
      // Conversations from ads Meta didn't list in this account (another account, or deleted ads).
      other: crm('other'),
      attribution_days: ATTRIBUTION_DAYS,
    };
  }

  /** Every page of a Graph list (a few hundred rows at most here). */
  private async all<T>(path: string, token: string) {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < 10; page++) {
      const result: Paged<T> = await graph<Paged<T>>(next, {
        token,
        timeout: 60_000,
      }).catch((error: Error) => {
        throw new ApiError(error.message, 502, 'META');
      });
      out.push(...(result.data ?? []));
      const after = result.paging?.next && result.paging.cursors?.after;
      next = after ? `${path}&after=${encodeURIComponent(after)}` : undefined;
    }
    return out;
  }

  /** Which campaign each ad belongs to, 50 ads per request. */
  private async learnCampaigns(adIds: string[], token: string) {
    for (let i = 0; i < adIds.length; i += 50) {
      const ids = adIds.slice(i, i + 50);
      const found: Record<string, { campaign_id?: string }> = await graph<
        Record<string, { campaign_id?: string }>
      >(
        `/?${new URLSearchParams({ ids: ids.join(','), fields: 'campaign_id' })}`,
        { token, timeout: 60_000 },
      ).catch(() => ({})); // unknown ads stay "other ads", asked again next time
      for (const id of ids) {
        const campaign = found[id]?.campaign_id;
        if (campaign) this.adCampaigns.set(id, campaign);
      }
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const value = await load();
    if (this.cache.size > 100) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
