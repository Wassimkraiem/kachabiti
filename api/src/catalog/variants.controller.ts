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
import { variantsWithOptions } from './queries';
import { invalidateCatalog } from './revalidate';

// Port of app/api/variants/route.ts. Stock only changes through stock movements.

type Body = Record<string, any>;

@Controller('variants')
export class VariantsController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  list(@Query('product_id') productId?: string) {
    if (!productId) throw new ApiError('Product ID is required');
    return variantsWithOptions(this.db)
      .where('v.product_id', '=', productId)
      .orderBy('v.created_at')
      .execute();
  }

  @Post()
  @Requires('products')
  async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.product_id) throw new ApiError('Product ID is required');
    const id = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('product_variants')
        .values({
          product_id: body.product_id,
          size_id: body.size_id || null,
          color_id: body.color_id || null,
          sku: body.sku || null,
          price:
            body.price !== undefined
              ? parseFloat(body.price)
              : body.price_cents !== undefined
                ? parseFloat(body.price_cents) / 100
                : null,
          is_available:
            body.is_available !== undefined ? body.is_available : true,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return this.one(id.id);
  }

  @Put()
  @Requires('products')
  async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.id) throw new ApiError('Variant ID is required');
    const changes: Record<string, unknown> = {};
    if (body.size_id !== undefined) changes.size_id = body.size_id || null;
    if (body.color_id !== undefined) changes.color_id = body.color_id || null;
    if (body.sku !== undefined) changes.sku = body.sku || null;
    if (body.price !== undefined) changes.price = parseFloat(body.price);
    else if (body.price_cents !== undefined)
      changes.price = parseFloat(body.price_cents) / 100;
    if (body.reorder_point !== undefined)
      changes.reorder_point = Math.max(0, parseInt(body.reorder_point) || 0);
    if (body.is_available !== undefined)
      changes.is_available = body.is_available;

    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('product_variants')
        .set(changes)
        .where('id', '=', body.id)
        .execute(),
    );
    await invalidateCatalog();
    return this.one(body.id);
  }

  /** Soft delete: the row stays (stock history points at it), with its photos, in one transaction. */
  @Delete()
  @RequiresAll('products', 'delete')
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Variant ID is required');
    await this.db.withActor(actor, (trx) =>
      this.db.call('delete_variant', { p_variant_id: id }, trx),
    );
    await invalidateCatalog();
  }

  private async one(id: string) {
    const variant = await variantsWithOptions(this.db)
      .where('v.id', '=', id)
      .executeTakeFirst();
    if (!variant) throw new ApiError('Variant not found', 404);
    return variant;
  }
}
