import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AD_PLATFORMS } from '@shared/erp/constants';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, params, Zod, zDate, zId } from '../common/api';
import { Database } from '../db/database';

/**
 * Port of app/api/marketing/campaigns: advertising campaigns and their spend. Orders tagged with a
 * campaign give the cost per delivered sale; spend books itself as an advertising expense.
 */

const fields = {
  name: z.string().trim().min(1).max(150),
  platform: z.enum(AD_PLATFORMS),
  starts_on: zDate.nullable(),
  ends_on: zDate.nullable(),
  budget: z.number().min(0).max(100_000_000).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  active: z.boolean(),
};
const campaignSchema = z
  .object(fields)
  .partial()
  .required({ name: true, platform: true });
const updateSchema = z
  .object({ id: zId, ...fields })
  .partial()
  .required({ id: true });
const spendSchema = z.object({
  kind: z.literal('spend'),
  campaign_id: zId.nullable(),
  spend_date: zDate,
  amount: z.number().positive().max(100_000_000),
  account: z.enum(['bank', 'cash', 'payable']).default('bank'),
  note: z.string().trim().max(500).optional(),
});

@Controller('marketing/campaigns')
@Public()
export class CampaignsController {
  constructor(private readonly db: Database) {}

  /** Campaigns with spend and orders; ?id= adds the spend lines; ?active=1 for pickers. */
  @Get()
  async list(@Query() query: Record<string, string>) {
    const q = params(query);
    const id = q.get('id');
    if (id) {
      const [campaign, spend] = await Promise.all([
        this.db
          .selectFrom('ad_campaigns')
          .selectAll()
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst(),
        this.db
          .selectFrom('ad_spend')
          .selectAll()
          .where('campaign_id', '=', id)
          .where('deleted_at', 'is', null)
          .orderBy('spend_date', 'desc')
          .execute(),
      ]);
      if (!campaign) throw new ApiError('This campaign no longer exists.', 404);
      return { ...campaign, spend };
    }
    let campaigns = this.db
      .selectFrom('ad_campaigns')
      .selectAll()
      .where('deleted_at', 'is', null);
    if (q.bool('active')) campaigns = campaigns.where('active', '=', true);
    const rows = await campaigns.orderBy('created_at', 'desc').execute();
    if (q.bool('active')) return rows;
    const ids = rows.map((c) => c.id);
    const [spend, orders] = ids.length
      ? await Promise.all([
          this.db
            .selectFrom('ad_spend')
            .select(['campaign_id', 'amount'])
            .where('campaign_id', 'in', ids)
            .where('deleted_at', 'is', null)
            .execute(),
          this.db
            .selectFrom('orders')
            .select(['campaign_id', 'status', 'total'])
            .where('campaign_id', 'in', ids)
            .where('deleted_at', 'is', null)
            .execute(),
        ])
      : [[], []];
    return rows.map((c) => {
      const mine = orders.filter((o) => o.campaign_id === c.id);
      const delivered = mine.filter((o) => o.status === 'delivered');
      const spent = spend
        .filter((s) => s.campaign_id === c.id)
        .reduce((sum, r) => sum + Number(r.amount), 0);
      return {
        ...c,
        spent,
        orders: mine.length,
        delivered: delivered.length,
        revenue: delivered.reduce((sum, o) => sum + Number(o.total), 0),
        cost_per_delivered: delivered.length ? spent / delivered.length : null,
      };
    });
  }

  /** A campaign, or { kind: 'spend', ... } an amount spent. */
  @Post()
  async create(@Body() json: any, @CurrentActor() actor: RequestActor) {
    if (json?.kind === 'spend') {
      const { kind: _kind, ...row } = spendSchema.parse(json);
      void _kind;
      return this.db.withActor(actor, (trx) =>
        trx
          .insertInto('ad_spend')
          .values({
            ...row,
            note: row.note || null,
            created_by: actor.userId,
            created_by_email: actor.email,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    }
    const body = campaignSchema.parse(json);
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('ad_campaigns')
        .values({
          ...body,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Put()
  async update(
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...row } = body;
    const saved = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('ad_campaigns')
        .set(row)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!saved) throw new ApiError('This campaign no longer exists.', 404);
    return saved;
  }

  /** ?id= (campaign) | ?spend_id= (a spend line; its expense entry is reversed). */
  @Delete()
  async remove(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const q = params(query);
    const spendId = q.get('spend_id');
    if (spendId) {
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('ad_spend')
          .set({ deleted_at: new Date() })
          .where('id', '=', spendId)
          .execute(),
      );
      return { id: spendId };
    }
    const id = q.get('id');
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('ad_campaigns')
        .set({ deleted_at: new Date(), active: false })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}
