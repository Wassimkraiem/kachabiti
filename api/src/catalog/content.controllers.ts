import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import {
  CurrentActor,
  Public,
  Requires,
  RequiresAll,
} from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError } from '../common/api';
import { Database } from '../db/database';
import { invalidateCatalog } from './revalidate';

// Ports of app/api/promotions (product discounts), app/api/sale-banners (table `promotions`)
// and app/api/reels. Their DELETE takes the id in a JSON body.

type Body = Record<string, any>;

/** Copies the fields present in the body, through an optional per-field conversion. */
function pick(
  body: Body,
  fields: Record<string, ((v: any) => unknown) | null>,
) {
  const changes: Record<string, unknown> = {};
  for (const [field, convert] of Object.entries(fields)) {
    if (body[field] !== undefined)
      changes[field] = convert ? convert(body[field]) : body[field];
  }
  return changes;
}

const toInt = (v: any) => parseInt(v) || 0;

async function updateRow(
  db: Database,
  table: 'product_discounts' | 'promotions' | 'reels',
  id: string,
  changes: Record<string, unknown>,
  actor: RequestActor,
  label: string,
) {
  const row = await db.withActor(actor, (trx) =>
    trx
      .updateTable(table)
      .set(changes)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst(),
  );
  if (!row) throw new ApiError(`${label} not found`, 404);
  await invalidateCatalog();
  return row;
}

@Controller('promotions')
export class ProductDiscountsController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  list() {
    return this.db
      .selectFrom('product_discounts as d')
      .selectAll('d')
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('products as p')
            .select(['p.id', 'p.name', 'p.base_price'])
            .whereRef('p.id', '=', 'd.product_id'),
        ).as('products'),
      )
      .where('d.deleted_at', 'is', null)
      .orderBy('d.created_at', 'desc')
      .execute();
  }

  @Post()
  @Requires('discounts')
  async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('product_discounts')
        .values({
          product_id: body.product_id,
          discount_percent: parseFloat(body.discount_percent),
          starts_at: body.starts_at || null,
          ends_at: body.ends_at || null,
          active: body.active !== false,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return row;
  }

  @Put()
  @Requires('discounts')
  async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.id) throw new ApiError('Promotion ID is required');
    const changes = pick(body, {
      product_id: null,
      discount_percent: parseFloat,
      starts_at: null,
      ends_at: null,
      active: null,
    });
    return updateRow(
      this.db,
      'product_discounts',
      body.id,
      changes,
      actor,
      'Promotion',
    );
  }

  @Delete()
  @RequiresAll('discounts', 'delete')
  async remove(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body?.id) throw new ApiError('Promotion ID is required');
    await updateRow(
      this.db,
      'product_discounts',
      body.id,
      { active: false, deleted_at: new Date() },
      actor,
      'Promotion',
    );
  }
}

@Controller('sale-banners')
export class SaleBannersController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  list() {
    return this.db
      .selectFrom('promotions')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
  }

  @Post()
  @Requires('marketing')
  async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('promotions')
        .values({
          title: body.title,
          subtitle: body.subtitle || null,
          badge_text: body.badge_text || null,
          discount_percent: toInt(body.discount_percent),
          image_url: body.image_url,
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          active: body.active !== false,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return row;
  }

  @Put()
  @Requires('marketing')
  update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.id) throw new ApiError('Banner ID is required');
    const changes = pick(body, {
      title: null,
      subtitle: null,
      badge_text: null,
      discount_percent: toInt,
      image_url: null,
      starts_at: null,
      ends_at: null,
      active: null,
    });
    return updateRow(this.db, 'promotions', body.id, changes, actor, 'Banner');
  }

  @Delete()
  @RequiresAll('marketing', 'delete')
  async remove(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body?.id) throw new ApiError('Banner ID is required');
    await updateRow(
      this.db,
      'promotions',
      body.id,
      { active: false, deleted_at: new Date() },
      actor,
      'Banner',
    );
  }
}

@Controller('reels')
export class ReelsController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  list() {
    return this.db
      .selectFrom('reels')
      .selectAll()
      .where('active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .execute();
  }

  @Post()
  @Requires('marketing')
  async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('reels')
        .values({
          title: body.title,
          description: body.description || null,
          username: body.username || '@kachabiti',
          thumbnail_url: body.thumbnail_url,
          video_url: body.video_url,
          sort_order: body.sort_order || 0,
          active: body.active !== false,
          is_new: body.is_new || false,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return row;
  }

  @Put()
  @Requires('marketing')
  async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.id) throw new ApiError('Reel ID is required');
    const changes = {
      ...pick(body, {
        title: null,
        description: null,
        username: null,
        thumbnail_url: null,
        video_url: null,
        sort_order: null,
        active: null,
        is_new: null,
      }),
      updated_at: new Date(),
    };
    return updateRow(this.db, 'reels', body.id, changes, actor, 'Reel');
  }

  @Delete()
  @RequiresAll('marketing', 'delete')
  async remove(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body?.id) throw new ApiError('Reel ID is required');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('reels')
        .set({ active: false, deleted_at: new Date() })
        .where('id', '=', body.id)
        .execute(),
    );
    await invalidateCatalog();
  }
}
