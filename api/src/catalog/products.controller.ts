import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  HttpCode,
} from '@nestjs/common';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { stockErrorMessage } from '@shared/stock';
import {
  CurrentActor,
  Public,
  Requires,
  RequiresAll,
} from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, idsFrom, slugify } from '../common/api';
import { Database } from '../db/database';
import { invalidateCatalog } from './revalidate';

// Port of app/api/products/route.ts.

type Body = Record<string, any>;

// Variant payload for save_product: the shapes the admin forms send, normalised.
function variantPayload(variant: any) {
  const price =
    variant.price !== undefined &&
    variant.price !== null &&
    variant.price !== ''
      ? parseFloat(variant.price)
      : variant.price_cents !== undefined
        ? parseFloat(variant.price_cents) / 100
        : null;
  return {
    id: variant.id ?? null,
    color_id: variant.color_id || null,
    size_id: variant.size_id || null,
    sku:
      typeof variant.sku === 'string'
        ? variant.sku.trim() || null
        : (variant.sku ?? null),
    price,
    // The table only has is_available; is_active is accepted from legacy payloads.
    is_available:
      variant.is_available !== undefined
        ? variant.is_available
        : variant.is_active !== undefined
          ? variant.is_active
          : true,
    reorder_point:
      variant.reorder_point === undefined ||
      variant.reorder_point === null ||
      variant.reorder_point === ''
        ? null
        : Math.max(0, parseInt(variant.reorder_point) || 0),
    // Opening stock (only used when the product is created).
    stock: parseInt(variant.stock) || 0,
    images: Array.isArray(variant.images) ? variant.images : null,
  };
}

function checkSkus(variants: { sku: string | null }[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { sku } of variants) {
    if (!sku) continue;
    if (seen.has(sku)) duplicates.add(sku);
    seen.add(sku);
  }
  if (duplicates.size > 0)
    throw new ApiError(
      `Duplicate SKU(s) in variants: ${[...duplicates].join(', ')}`,
    );
}

// save_product errors as messages an admin can act on.
function saveError(error: any): never {
  const message: string = error?.message ?? '';
  if (error?.code === '23505' && message.includes('product_variants_sku_key'))
    throw new ApiError(
      'SKU must be unique across all variants. Please use distinct SKUs or leave blank.',
      400,
    );
  if (error?.code === '23505' && message.includes('products_slug_key'))
    throw new ApiError('Another product already uses this slug.', 409);
  if (error?.code === '23505' && message.includes('products_code_key'))
    throw new ApiError('Another product already uses this product code.', 409);
  if (message.includes('variants_with_stock'))
    throw new ApiError(stockErrorMessage(error), 409);
  if (message.includes('product_not_found'))
    throw new ApiError('Product not found', 404);
  throw error;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  async list(@Query() query: Record<string, string | undefined>) {
    const isAdmin = query.admin === 'true';

    // Lightweight list for admin tables and pickers: no variants (~50 KB instead of ~1 MB), just a count.
    if (query.view === 'summary') {
      let summary = this.db
        .selectFrom('products as p')
        .select([
          'p.id',
          'p.name',
          'p.name_ar',
          'p.name_fr',
          'p.slug',
          'p.status',
          'p.base_price',
          'p.category_id',
          'p.deleted_at',
          'p.created_at',
        ])
        .select((eb) => [
          jsonObjectFrom(
            eb
              .selectFrom('categories as c')
              .select(['c.name', 'c.slug'])
              .whereRef('c.id', '=', 'p.category_id'),
          ).as('categories'),
          jsonArrayFrom(
            eb
              .selectFrom('product_images as i')
              .select([
                'i.id',
                'i.image_url',
                'i.alt_text',
                'i.is_main',
                'i.position',
              ])
              .whereRef('i.product_id', '=', 'p.id')
              .where('i.variant_id', 'is', null)
              .where('i.deleted_at', 'is', null)
              .orderBy('i.position'),
          ).as('product_images'),
          eb
            .selectFrom('product_variants as v')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('v.product_id', '=', 'p.id')
            .as('variant_count'),
        ])
        .orderBy('p.created_at', 'desc');
      if (!isAdmin)
        summary = summary
          .where('p.status', '=', 'active')
          .where('p.deleted_at', 'is', null);
      return summary.execute();
    }

    let products = this.db
      .selectFrom('products as p')
      .selectAll('p')
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('categories as c')
            .select(['c.name', 'c.slug'])
            .whereRef('c.id', '=', 'p.category_id'),
        ).as('categories'),
        jsonArrayFrom(
          eb
            .selectFrom('product_images as i')
            .selectAll('i')
            .whereRef('i.product_id', '=', 'p.id')
            .where('i.deleted_at', 'is', null)
            .orderBy('i.position'),
        ).as('product_images'),
      ]);
    if (query.id) products = products.where('p.id', '=', query.id);
    else if (query.slug) products = products.where('p.slug', '=', query.slug);
    if (!isAdmin)
      products = products
        .where('p.status', '=', 'active')
        .where('p.deleted_at', 'is', null);
    if (!query.id && !query.slug)
      products = products.orderBy('p.created_at', 'desc');

    const withVariants = await this.attachVariants(await products.execute());
    if (query.id || query.slug) {
      if (withVariants.length === 0)
        throw new ApiError('Product not found', 404);
      return withVariants[0];
    }
    return withVariants;
  }

  @Post()
  @Requires('products')
  async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    const name = body.name || body.title || '';

    // Unique slug from the name unless one is given.
    const baseSlug = slugify(body.slug || name) || 'product';
    let slug = baseSlug;
    for (let n = 1; ; n++) {
      const existing = await this.db
        .selectFrom('products')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirst();
      if (!existing) break;
      slug = `${baseSlug}-${n}`;
    }

    const variants = Array.isArray(body.variants)
      ? body.variants.map(variantPayload)
      : [];
    checkSkus(variants);

    const productId = await this.db
      .withActor(actor, (trx) =>
        this.db.call<string>(
          'save_product',
          {
            p_product_id: null,
            p_product: {
              name,
              slug,
              description: body.description || null,
              name_ar: body.name_ar || null,
              name_fr: body.name_fr || null,
              description_ar: body.description_ar || null,
              description_fr: body.description_fr || null,
              category_id: body.category_id || null,
              base_price:
                body.base_price !== undefined
                  ? parseFloat(body.base_price)
                  : body.price_cents !== undefined
                    ? parseFloat(body.price_cents) / 100
                    : 0,
              status: body.status || 'active',
              supplier_id: body.supplier_id || null,
              collection_id: body.collection_id || null,
              // Blank code: the database generates one from the category.
              code: typeof body.code === 'string' ? body.code : null,
            },
            p_variants: variants,
            p_images: Array.isArray(body.images) ? body.images : [],
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      )
      .catch(saveError);

    await invalidateCatalog();
    return this.loadSaved(productId);
  }

  @Put()
  @Requires('products')
  async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    if (!body.id) throw new ApiError('Product ID is required');

    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes.name = body.name;
    // A typed slug is cleaned like a generated one: spaces or a trailing space break the link.
    const slug = slugify(body.slug || body.name || '');
    if ((body.slug !== undefined || body.name !== undefined) && slug)
      changes.slug = slug;
    for (const field of [
      'description',
      'name_ar',
      'name_fr',
      'description_ar',
      'description_fr',
      'category_id',
      'code',
      'supplier_id',
      'collection_id',
    ]) {
      if (body[field] !== undefined)
        changes[field] =
          typeof body[field] === 'string'
            ? body[field].trim() || null
            : body[field];
    }
    if (body.base_price !== undefined)
      changes.base_price = parseFloat(body.base_price);
    if (body.status !== undefined) changes.status = body.status;
    if (typeof body.stock_tracked === 'boolean')
      changes.stock_tracked = body.stock_tracked;

    const variants = Array.isArray(body.variants)
      ? body.variants.map(variantPayload)
      : null;
    checkSkus(variants ?? []);

    await this.db
      .withActor(actor, (trx) =>
        this.db.call(
          'save_product',
          {
            p_product_id: body.id,
            p_product: changes,
            p_variants: variants,
            p_images: Array.isArray(body.images) ? body.images : null,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      )
      .catch(saveError);

    await invalidateCatalog();
    return this.loadSaved(body.id);
  }

  /** ?id= or ?ids=a,b: soft-deletes one or several products in a single statement. */
  @Delete()
  @RequiresAll('products', 'delete')
  @HttpCode(200)
  async remove(
    @Query() query: { id?: string; ids?: string },
    @CurrentActor() actor: RequestActor,
  ) {
    const ids = idsFrom(query);
    if (ids.length === 0) throw new ApiError('Product ID is required');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('products')
        .set({ status: 'archived', deleted_at: new Date() })
        .where('id', 'in', ids)
        .execute(),
    );
    await invalidateCatalog();
  }

  /** Variants (with size, color and their photos) under each product; product_images keeps product-level photos only. */
  private async attachVariants<P extends { id: string; product_images: any[] }>(
    products: P[],
  ) {
    if (products.length === 0) return [];
    const variants = await this.variantsQuery()
      .where(
        'v.product_id',
        'in',
        products.map((p) => p.id),
      )
      .execute();
    return products.map((product) => {
      const images = product.product_images ?? [];
      return {
        ...product,
        product_images: images.filter((img) => !img.variant_id),
        product_variants: variants
          .filter((v) => v.product_id === product.id)
          .map((variant) => ({
            ...variant,
            images: images
              .filter((img) => img.variant_id === variant.id)
              .map((img) => ({
                id: img.id,
                url: img.image_url,
                alt: img.alt_text,
                is_main: img.is_main,
                position: img.position,
              })),
          })),
      };
    });
  }

  private variantsQuery() {
    return this.db
      .selectFrom('product_variants as v')
      .selectAll('v')
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('sizes as s')
            .selectAll('s')
            .whereRef('s.id', '=', 'v.size_id'),
        ).as('sizes'),
        jsonObjectFrom(
          eb
            .selectFrom('colors as c')
            .selectAll('c')
            .whereRef('c.id', '=', 'v.color_id'),
        ).as('colors'),
      ])
      .where('v.deleted_at', 'is', null);
  }

  // The saved product with its images and variants, as the admin forms expect it.
  private async loadSaved(productId: string) {
    const product = await this.db
      .selectFrom('products as p')
      .selectAll('p')
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('categories as c')
            .select(['c.name', 'c.slug'])
            .whereRef('c.id', '=', 'p.category_id'),
        ).as('categories'),
        jsonArrayFrom(
          eb
            .selectFrom('product_images as i')
            .selectAll('i')
            .whereRef('i.product_id', '=', 'p.id')
            .where('i.deleted_at', 'is', null),
        ).as('product_images'),
      ])
      .where('p.id', '=', productId)
      .executeTakeFirst();
    if (!product) throw new ApiError('Product not found', 404);
    return (await this.attachVariants([product]))[0];
  }
}
