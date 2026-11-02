import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  type Type,
} from '@nestjs/common';
import { sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { z } from 'zod';
import {
  MOVEMENT_TYPES,
  stockErrorMessage,
  stockStatus,
  type MovementType,
} from '@shared/stock';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, Envelope } from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { Database } from '../db/database';

// Ports of app/api/stock/*. Access comes from the shared rules in lib/api-access.ts (stock, costs,
// purchasing…), which the guard applies on top of @Public().

type Body = Record<string, any>;

/** Database refusals (negative stock, …) as the messages the stock screens show. */
const stockFailure =
  (status = 400) =>
  (error: any): never => {
    if (error?.code || error?.message)
      throw new ApiError(stockErrorMessage(error), status);
    throw error;
  };

// ── Lookup tables: suppliers, collections, locations (port of lib/stock-crud.ts) ──

function lookupController(
  table: 'suppliers' | 'collections' | 'locations',
  fields: string[],
  label: string,
  hooks: {
    canDelete?: (db: Database, id: string) => Promise<string | null>;
    beforeSave?: (db: Database, body: Body) => Promise<void>;
  } = {},
): Type<unknown> {
  const pick = (body: Body) => {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      if (!(field in body)) continue;
      const value = body[field];
      row[field] = typeof value === 'string' ? value.trim() || null : value;
    }
    return row;
  };

  @Controller(`stock/${table}`)
  @Public()
  class LookupController {
    constructor(readonly db: Database) {}

    @Get()
    list() {
      return this.db
        .selectFrom(table)
        .selectAll()
        .where('deleted_at', 'is', null)
        .orderBy('name')
        .execute();
    }

    @Post()
    @HttpCode(200)
    async create(@Body() body: Body, @CurrentActor() actor: RequestActor) {
      const row = pick(body);
      if (!row.name) throw new ApiError(`${label} name is required`);
      await hooks.beforeSave?.(this.db, body);
      const saved = await this.db
        .withActor(actor, (trx) =>
          trx
            .insertInto(table)
            .values(row as any)
            .returningAll()
            .executeTakeFirstOrThrow(),
        )
        .catch(stockFailure());
      await invalidateCatalog();
      return saved;
    }

    @Put()
    async update(@Body() body: Body, @CurrentActor() actor: RequestActor) {
      if (!body.id) throw new ApiError('Missing id');
      const row = pick(body);
      if ('name' in row && !row.name)
        throw new ApiError(`${label} name is required`);
      await hooks.beforeSave?.(this.db, body);
      const saved = await this.db
        .withActor(actor, (trx) =>
          trx
            .updateTable(table)
            .set(row)
            .where('id', '=', body.id)
            .returningAll()
            .executeTakeFirst(),
        )
        .catch(stockFailure());
      if (!saved) throw new ApiError(`${label} not found`, 404);
      await invalidateCatalog();
      return saved;
    }

    @Delete()
    async remove(
      @Query('id') id: string | undefined,
      @CurrentActor() actor: RequestActor,
    ) {
      if (!id) throw new ApiError('Missing id');
      const refusal = hooks.canDelete
        ? await hooks.canDelete(this.db, id)
        : null;
      if (refusal) throw new ApiError(refusal, 409);
      await this.db
        .withActor(actor, (trx) =>
          trx
            .updateTable(table)
            .set({ deleted_at: new Date() })
            .where('id', '=', id)
            .execute(),
        )
        .catch(stockFailure());
      await invalidateCatalog();
    }
  }
  return LookupController;
}

export const SuppliersController = lookupController(
  'suppliers',
  [
    'name',
    'email',
    'phone',
    'notes',
    'contact_name',
    'address',
    'tax_id',
    'bank_details',
    'payment_terms_days',
    'kind',
  ],
  'Supplier',
);
export const CollectionsController = lookupController(
  'collections',
  ['name'],
  'Collection',
);
export const LocationsController = lookupController(
  'locations',
  ['name', 'sells_online'],
  'Location',
  {
    // A deleted location would hide its stock, so only empty, offline locations can be deleted.
    canDelete: async (db, id) => {
      const [location, stocked] = await Promise.all([
        db
          .selectFrom('locations')
          .select('sells_online')
          .where('id', '=', id)
          .executeTakeFirst(),
        db
          .selectFrom('inventory_levels')
          .select('variant_id')
          .where('location_id', '=', id)
          .where('available', '>', 0)
          .executeTakeFirst(),
      ]);
      if (location?.sells_online)
        return 'This location sells online. Make another location the online one first.';
      if (stocked)
        return 'This location still holds stock. Transfer it to another location first.';
      return null;
    },
    // Only one location sells online: making one online clears the flag on the others first.
    beforeSave: async (db, body) => {
      if (body.sells_online !== true) return;
      let query = db
        .updateTable('locations')
        .set({ sells_online: false })
        .where('sells_online', '=', true);
      if (body.id) query = query.where('id', '<>', body.id);
      await query.execute();
    },
  },
);

// ── Tracking and costs ──

@Controller('stock/tracking')
@Public()
export class StockTrackingController {
  constructor(private readonly db: Database) {}

  /** { product_ids, tracked }: switching on copies the online location's counts into the shop's stock. */
  @Put()
  async set(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    const { product_ids, tracked } = body ?? {};
    if (
      !Array.isArray(product_ids) ||
      product_ids.length === 0 ||
      typeof tracked !== 'boolean'
    ) {
      throw new ApiError('product_ids and tracked are required');
    }
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('products')
        .set({ stock_tracked: tracked })
        .where('id', 'in', product_ids)
        .execute(),
    );
    await invalidateCatalog();
  }
}

@Controller('stock/costs')
@Public()
export class StockCostsController {
  constructor(private readonly db: Database) {}

  @Get()
  list() {
    return this.db
      .selectFrom('product_costs')
      .select(['product_id', 'cost', 'updated_at'])
      .where('deleted_at', 'is', null)
      .execute();
  }

  /** { product_id, cost } sets the cost; a null cost marks it deleted. */
  @Put()
  async set(@Body() body: Body, @CurrentActor() actor: RequestActor) {
    const { product_id, cost } = body ?? {};
    if (!product_id) throw new ApiError('Missing product_id');
    if (cost === null || cost === undefined || cost === '') {
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('product_costs')
          .set({ deleted_at: new Date() })
          .where('product_id', '=', product_id)
          .execute(),
      );
      return null;
    }
    const value = Number(cost);
    if (!Number.isFinite(value) || value < 0)
      throw new ApiError('Cost must be zero or more');
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('product_costs')
        .values({ product_id, cost: value, deleted_at: null })
        .onConflict((oc) =>
          oc
            .column('product_id')
            .doUpdateSet({ cost: value, deleted_at: null }),
        )
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
}

// ── Movements ──

const itemSchema = z.object({
  variant_id: z.guid(),
  quantity: z.number().int(),
  // Optional per-item location (counting several locations at once).
  location_id: z.guid().optional(),
  // Restocks: purchase cost per unit, which moves the variant's weighted average cost.
  unit_cost: z.number().nonnegative().optional(),
});
const movementSchema = z.object({
  // 'count' sets the counted quantity and records the difference as adjustments.
  type: z.enum([
    'sale',
    'restock',
    'adjustment',
    'return',
    'transfer',
    'count',
  ]),
  location_id: z.guid(),
  to_location_id: z.guid().optional(),
  items: z.array(itemSchema).min(1).max(500),
  reference: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
  // Also start tracking these products' stock on the website.
  track: z.boolean().optional(),
});

@Controller('stock/movements')
@Public()
export class StockMovementsController {
  constructor(private readonly db: Database) {}

  /** Movement history, newest first. Filters: type, location_id, variant_id, search (sku/product/reference). */
  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    let filtered = this.db.selectFrom('stock_movements as m');
    if (query.type && MOVEMENT_TYPES.includes(query.type as MovementType))
      filtered = filtered.where('m.type', '=', query.type as MovementType);
    if (query.location_id)
      filtered = filtered.where('m.location_id', '=', query.location_id);
    if (query.variant_id)
      filtered = filtered.where('m.variant_id', '=', query.variant_id);
    const search = query.search?.trim().replace(/[%,()]/g, '');
    if (search) {
      const like = `%${search}%`;
      filtered = filtered.where((eb) =>
        eb.or([
          eb('m.sku', 'ilike', like),
          eb('m.product_name', 'ilike', like),
          eb('m.reference', 'ilike', like),
        ]),
      );
    }

    const [rows, count] = await Promise.all([
      filtered
        .select([
          'm.id',
          'm.type',
          'm.quantity',
          'm.sku',
          'm.product_name',
          'm.reference',
          'm.note',
          'm.created_at',
          'm.created_by_email',
          'm.order_id',
          'm.variant_id',
          'm.location_id',
        ])
        .select((eb) => [
          jsonObjectFrom(
            eb
              .selectFrom('locations as l')
              .select('l.name')
              .whereRef('l.id', '=', 'm.location_id'),
          ).as('locations'),
          jsonObjectFrom(
            eb
              .selectFrom('product_variants as v')
              .select('v.product_id')
              .select((eb2) => [
                jsonObjectFrom(
                  eb2
                    .selectFrom('colors as c')
                    .select(['c.name', 'c.display_name'])
                    .whereRef('c.id', '=', 'v.color_id'),
                ).as('colors'),
                jsonObjectFrom(
                  eb2
                    .selectFrom('sizes as s')
                    .select('s.name')
                    .whereRef('s.id', '=', 'v.size_id'),
                ).as('sizes'),
              ])
              .whereRef('v.id', '=', 'm.variant_id'),
          ).as('product_variants'),
        ])
        .orderBy('m.created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
    ]);
    return new Envelope(rows, { total: count.n });
  }

  /** Records movements in one transaction (record_stock_movements): a shortage on any line rejects them all. */
  @Post()
  @HttpCode(200)
  async record(@Body() raw: unknown, @CurrentActor() actor: RequestActor) {
    const parsed = movementSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError('Invalid movement data');
    const body = parsed.data;
    if (
      body.type === 'transfer' &&
      (!body.to_location_id || body.to_location_id === body.location_id)
    ) {
      throw new ApiError('Choose a different destination location.');
    }
    if (body.type === 'count' && body.items.some((i) => i.quantity < 0))
      throw new ApiError('Counted quantities cannot be negative.');

    const recorded = await this.db
      .withActor(actor, (trx) =>
        this.db.call<number>(
          'record_stock_movements',
          {
            p_type: body.type,
            p_location_id: body.location_id,
            p_items: body.items,
            p_to_location_id: body.to_location_id ?? null,
            p_reference: body.reference?.trim() ?? '',
            p_note: body.note?.trim() ?? '',
            p_track: body.track ?? false,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      )
      .catch(stockFailure(409));
    await invalidateCatalog(); // the shop's stock display may have changed
    return { recorded };
  }
}

// ── Inventory and overview ──

type Image = { image_url: string; is_main: boolean; position: number };
const byMain = (a: Image, b: Image) =>
  Number(b.is_main) - Number(a.is_main) || a.position - b.position;

@Controller('stock')
@Public()
export class StockReportsController {
  constructor(private readonly db: Database) {}

  /** One row per variant with stock per location, totals and status. */
  @Get('inventory')
  async inventory() {
    const locations = await this.db
      .selectFrom('locations')
      .select(['id', 'name', 'sells_online'])
      .where('deleted_at', 'is', null)
      .orderBy('sells_online', 'desc')
      .orderBy('name')
      .execute();
    const variants = await this.db
      .selectFrom('product_variants as v')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .where('v.deleted_at', 'is', null)
      .where('p.deleted_at', 'is', null)
      .select([
        'v.id',
        'v.sku',
        'v.reorder_point',
        'p.id as product_id',
        'p.name',
        'p.name_ar',
        'p.code',
        'p.status',
        'p.stock_tracked',
        'p.category_id',
        'p.supplier_id',
      ])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('colors as c')
            .select(['c.name', 'c.display_name', 'c.hex_code'])
            .whereRef('c.id', '=', 'v.color_id'),
        ).as('colors'),
        jsonObjectFrom(
          eb
            .selectFrom('sizes as s')
            .select(['s.name', 's.sort_order'])
            .whereRef('s.id', '=', 'v.size_id'),
        ).as('sizes'),
        jsonArrayFrom(
          eb
            .selectFrom('inventory_levels as l')
            .select(['l.location_id', 'l.available'])
            .whereRef('l.variant_id', '=', 'v.id'),
        ).as('levels'),
        jsonArrayFrom(
          eb
            .selectFrom('product_images as i')
            .select(['i.image_url', 'i.is_main', 'i.position'])
            .whereRef('i.variant_id', '=', 'v.id')
            .where('i.deleted_at', 'is', null),
        ).as('variant_images'),
        jsonArrayFrom(
          eb
            .selectFrom('product_images as i')
            .select(['i.image_url', 'i.is_main', 'i.position'])
            .whereRef('i.product_id', '=', 'p.id')
            .where('i.variant_id', 'is', null)
            .where('i.deleted_at', 'is', null),
        ).as('product_images'),
        eb
          .selectFrom('categories as cat')
          .select('cat.name')
          .whereRef('cat.id', '=', 'p.category_id')
          .as('category'),
        eb
          .selectFrom('suppliers as sup')
          .select('sup.name')
          .whereRef('sup.id', '=', 'p.supplier_id')
          .as('supplier'),
      ])
      .execute();

    const onlineId = locations.find((l) => l.sells_online)?.id ?? null;
    const rows = variants.map((v) => {
      const levels: Record<string, number> = {};
      for (const l of v.levels) levels[l.location_id] = l.available;
      const total = Object.values(levels).reduce((sum, n) => sum + n, 0);
      const online = onlineId ? (levels[onlineId] ?? 0) : 0;
      const productImage =
        [...v.product_images].sort(byMain)[0]?.image_url ?? null;
      // The variant's own photo when it has one (e.g. per color), otherwise the product's.
      const variantImage =
        [...v.variant_images].sort(byMain)[0]?.image_url ?? null;
      return {
        variant_id: v.id,
        sku: v.sku,
        reorder_point: v.reorder_point,
        color: v.colors ? v.colors.display_name || v.colors.name : null,
        color_hex: v.colors?.hex_code ?? null,
        size: v.sizes?.name ?? null,
        size_order: v.sizes?.sort_order ?? 0,
        product_id: v.product_id,
        product_name: v.name,
        product_name_ar: v.name_ar,
        product_code: v.code,
        product_status: v.status,
        category: v.category ?? null,
        category_id: v.category_id,
        supplier: v.supplier ?? null,
        supplier_id: v.supplier_id,
        stock_tracked: v.stock_tracked,
        image: variantImage ?? productImage,
        product_image: productImage,
        levels,
        total,
        online,
        // Status follows what the online shop can sell.
        status: stockStatus(online, v.reorder_point, v.stock_tracked),
      };
    });
    rows.sort(
      (a, b) =>
        a.product_name.localeCompare(b.product_name) ||
        (a.color ?? '').localeCompare(b.color ?? '') ||
        a.size_order - b.size_order,
    );
    return { locations, rows };
  }

  /**
   * Dashboard figures: units on hand, low/out counts (tracked products, online location), the
   * 30-day movement series and the latest movements. Stock value at cost needs `costs`.
   */
  @Get('overview')
  async overview(@CurrentActor() actor: RequestActor) {
    const [locations, daily, recent, untracked, levels, uncounted, costs] =
      await Promise.all([
        this.db
          .selectFrom('locations')
          .select(['id', 'name', 'sells_online'])
          .where('deleted_at', 'is', null)
          .execute(),
        sql`select * from public.daily_movement_stats`
          .execute(this.db)
          .then((r) => r.rows),
        this.db
          .selectFrom('stock_movements as m')
          .select([
            'm.id',
            'm.type',
            'm.quantity',
            'm.sku',
            'm.product_name',
            'm.reference',
            'm.created_at',
            'm.created_by_email',
          ])
          .select((eb) =>
            jsonObjectFrom(
              eb
                .selectFrom('locations as l')
                .select('l.name')
                .whereRef('l.id', '=', 'm.location_id'),
            ).as('locations'),
          )
          .orderBy('m.created_at', 'desc')
          .limit(8)
          .execute(),
        this.db
          .selectFrom('products')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('deleted_at', 'is', null)
          .where('stock_tracked', '=', false)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('inventory_levels as l')
          .innerJoin('product_variants as v', 'v.id', 'l.variant_id')
          .innerJoin('products as p', 'p.id', 'v.product_id')
          .where('v.deleted_at', 'is', null)
          .where('p.deleted_at', 'is', null)
          .select([
            'l.location_id',
            'l.available',
            'v.reorder_point',
            'v.product_id',
            'p.stock_tracked',
          ])
          .execute(),
        // Tracked variants that never had a movement have no inventory row yet: they count as out of stock.
        this.db
          .selectFrom('product_variants as v')
          .innerJoin('products as p', 'p.id', 'v.product_id')
          .where('v.deleted_at', 'is', null)
          .where('p.deleted_at', 'is', null)
          .where('p.stock_tracked', '=', true)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('inventory_levels as l')
                  .select('l.variant_id')
                  .whereRef('l.variant_id', '=', 'v.id'),
              ),
            ),
          )
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .executeTakeFirstOrThrow(),
        actor?.permissions.includes('costs')
          ? this.db
              .selectFrom('product_costs')
              .select(['product_id', 'cost'])
              .where('deleted_at', 'is', null)
              .execute()
          : Promise.resolve(null),
      ]);

    const onlineId = locations.find((l) => l.sells_online)?.id ?? null;
    let units = 0;
    let lowStock = 0;
    let outOfStock = 0;
    const unitsByProduct = new Map<string, number>();
    for (const level of levels) {
      units += level.available;
      unitsByProduct.set(
        level.product_id,
        (unitsByProduct.get(level.product_id) ?? 0) + level.available,
      );
      if (level.location_id !== onlineId || !level.stock_tracked) continue;
      if (level.available <= 0) outOfStock += 1;
      else if (level.available <= level.reorder_point) lowStock += 1;
    }
    if (onlineId) outOfStock += uncounted.n;

    const stockValue = costs
      ? costs.reduce(
          (sum, c) =>
            sum + Number(c.cost) * (unitsByProduct.get(c.product_id) ?? 0),
          0,
        )
      : null;
    return {
      units,
      low_stock: lowStock,
      out_of_stock: outOfStock,
      untracked_products: untracked.n,
      stock_value: stockValue,
      daily,
      recent,
    };
  }
}
