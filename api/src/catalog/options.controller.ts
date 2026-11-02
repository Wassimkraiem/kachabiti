import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  type Type,
} from '@nestjs/common';
import {
  CurrentActor,
  Public,
  Requires,
  RequiresAll,
} from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, idsFrom } from '../common/api';
import { Database } from '../db/database';
import { invalidateCatalog } from './revalidate';

// Port of app/api/colors/route.ts and app/api/sizes/route.ts, which differ only in their fields.

type Body = Record<string, any>;

function optionsController(
  table: 'colors' | 'sizes',
  label: string,
  extraFields: string[],
): Type<unknown> {
  // Optional text fields stored as null when blank on create; sent as is on update.
  const textFields = [...extraFields, 'display_name', 'description'];

  @Controller(table)
  class OptionsController {
    constructor(readonly db: Database) {}

    @Get()
    @Public()
    list() {
      return this.db
        .selectFrom(table)
        .selectAll()
        .where('deleted_at', 'is', null)
        .orderBy('sort_order')
        .orderBy('name')
        .execute();
    }

    @Post()
    @Requires('products')
    async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
      if (!body.name) throw new ApiError(`${label} name is required`);
      const values: Record<string, unknown> = {
        name: body.name,
        sort_order: body.sort_order || 0,
      };
      for (const field of textFields) values[field] = body[field] || null;
      const row = await this.db.withActor(actor, (trx) =>
        trx
          .insertInto(table)
          .values(values as any)
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
      await invalidateCatalog();
      return row;
    }

    @Put()
    @Requires('products')
    async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
      if (!body.id) throw new ApiError(`${label} ID is required`);
      const changes: Record<string, unknown> = {};
      for (const field of ['name', 'sort_order', ...textFields]) {
        if (body[field] !== undefined) changes[field] = body[field];
      }
      const row = await this.db.withActor(actor, (trx) =>
        trx
          .updateTable(table)
          .set(changes)
          .where('id', '=', body.id)
          .returningAll()
          .executeTakeFirst(),
      );
      if (!row) throw new ApiError(`${label} not found`, 404);
      await invalidateCatalog();
      return row;
    }

    /** ?id= or ?ids=a,b: soft-deletes in a single statement. */
    @Delete()
    @RequiresAll('products', 'delete')
    async remove(
      @Query() query: { id?: string; ids?: string },
      @CurrentActor() actor: RequestActor,
    ) {
      const ids = idsFrom(query);
      if (ids.length === 0) throw new ApiError(`${label} ID is required`);
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable(table)
          .set({ deleted_at: new Date() })
          .where('id', 'in', ids)
          .execute(),
      );
      await invalidateCatalog();
    }
  }
  return OptionsController;
}

export const ColorsController = optionsController('colors', 'Color', [
  'hex_code',
  'rgb_code',
]);
export const SizesController = optionsController('sizes', 'Size', []);
