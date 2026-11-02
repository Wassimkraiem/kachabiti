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
import {
  CurrentActor,
  Public,
  Requires,
  RequiresAll,
} from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, idsFrom, slugify, Zod } from '../common/api';
import { Database } from '../db/database';
import { invalidateCatalog } from './revalidate';

// Port of app/api/categories/route.ts.

const optionalText = z.string().nullish();
const fields = {
  slug: z.string().optional(),
  sort_order: z.number().int().optional(),
  is_featured: z.boolean().optional(),
  image_url: optionalText,
  name_ar: optionalText,
  name_fr: optionalText,
  parent_id: z.string().uuid().nullish().or(z.literal('')),
};
const createSchema = z.object({
  name: z
    .string({ error: 'Category name is required' })
    .min(1, 'Category name is required'),
  ...fields,
});
const updateSchema = z.object({
  id: z.string({ error: 'Category ID is required' }).uuid(),
  name: z.string().min(1).optional(),
  ...fields,
});

@Controller('categories')
export class CategoriesController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  list() {
    return this.db
      .selectFrom('categories')
      .select([
        'id',
        'name',
        'name_ar',
        'name_fr',
        'slug',
        'sort_order',
        'is_featured',
        'image_url',
        'parent_id',
      ])
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
  }

  @Post()
  @Requires('products')
  async create(
    @Body(new Zod(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('categories')
        .values({
          name: body.name,
          slug: slugify(body.slug || body.name),
          sort_order: body.sort_order || 0,
          is_featured: body.is_featured || false,
          image_url: body.image_url || null,
          name_ar: body.name_ar || null,
          name_fr: body.name_fr || null,
          parent_id: body.parent_id || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return row;
  }

  @Put()
  @Requires('products')
  async update(
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...changes } = body;
    if (changes.parent_id && changes.parent_id === id)
      throw new ApiError('A category cannot be its own parent');
    const values = {
      ...changes,
      ...('name_ar' in changes ? { name_ar: changes.name_ar || null } : {}),
      ...('name_fr' in changes ? { name_fr: changes.name_fr || null } : {}),
      ...('parent_id' in changes
        ? { parent_id: changes.parent_id || null }
        : {}),
    };
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('categories')
        .set(values)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!row) throw new ApiError('Category not found', 404);
    await invalidateCatalog();
    return row;
  }

  /** ?id= or ?ids=a,b: soft-deletes one or several categories in a single statement. */
  @Delete()
  @RequiresAll('products', 'delete')
  async remove(
    @Query() query: { id?: string; ids?: string },
    @CurrentActor() actor: RequestActor,
  ) {
    const list = idsFrom(query);
    if (list.length === 0) throw new ApiError('Category ID is required');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('categories')
        .set({ deleted_at: new Date() })
        .where('id', 'in', list)
        .execute(),
    );
    await invalidateCatalog();
  }
}
