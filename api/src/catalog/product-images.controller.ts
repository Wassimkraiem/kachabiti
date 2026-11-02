import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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

// Port of app/api/product-images/route.ts.

type Body = Record<string, any>;

@Controller('product-images')
export class ProductImagesController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  list(
    @Query('product_id') productId?: string,
    @Query('variant_id') variantId?: string,
  ) {
    let query = this.db
      .selectFrom('product_images')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('position');
    if (productId) query = query.where('product_id', '=', productId);
    if (variantId) query = query.where('variant_id', '=', variantId);
    return query.execute();
  }

  @Post()
  @Requires('products')
  async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.product_id) throw new ApiError('Product ID is required');

    // Without a position, the photo goes after the existing ones of the same product/variant.
    let position = body.position;
    if (position === undefined) {
      const count = await this.db
        .selectFrom('product_images')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('product_id', '=', body.product_id)
        .where('deleted_at', 'is', null)
        .where(
          'variant_id',
          body.variant_id ? '=' : 'is',
          body.variant_id || null,
        )
        .executeTakeFirstOrThrow();
      position = count.n;
    }

    const row = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('product_images')
        .values({
          product_id: body.product_id,
          variant_id: body.variant_id || null,
          image_url: body.image_url,
          alt_text: body.alt_text || null,
          is_main: body.is_main || false,
          position,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return row;
  }

  @Put()
  @Requires('products')
  async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.id) throw new ApiError('Image ID is required');
    const changes: Record<string, unknown> = {};
    for (const field of ['image_url', 'alt_text', 'is_main', 'position']) {
      if (body[field] !== undefined) changes[field] = body[field];
    }
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('product_images')
        .set(changes)
        .where('id', '=', body.id)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!row) throw new ApiError('Image not found', 404);
    await invalidateCatalog();
    return row;
  }

  @Delete()
  @RequiresAll('products', 'delete')
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Image ID is required');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('product_images')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    await invalidateCatalog();
  }
}
