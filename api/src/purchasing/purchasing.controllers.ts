import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { MATERIAL_UNITS, PO_STATUSES } from '@shared/erp/constants';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, params, Zod, zDate, zId } from '../common/api';
import { invalidateCatalog } from '../catalog/revalidate';
import { Database } from '../db/database';
import { many, one } from '../db/embed';

// Ports of app/api/purchasing/* (rules in lib/api-access.ts: `purchasing`).

// ── Purchase orders and price requests ──

const lineSchema = z
  .object({
    id: zId.optional(),
    variant_id: zId.nullish(),
    material_id: zId.nullish(),
    description: z.string().trim().max(250).default(''),
    quantity: z.number().positive().max(1_000_000),
    unit_cost: z.number().nonnegative().max(1_000_000),
    vat_rate: z.number().min(0).max(100).default(19),
  })
  .refine(
    (l) => l.variant_id || l.material_id || l.description,
    'Each line needs a product, a material or a description',
  );
const saveSchema = z.object({
  id: zId.optional(),
  supplier_id: zId,
  status: z.enum(['draft', 'rfq', 'ordered']).optional(),
  order_date: zDate.optional(),
  expected_date: zDate.nullable().optional(),
  location_id: zId.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(300),
});
const statusSchema = z.object({ id: zId, status: z.enum(PO_STATUSES) });
const TRANSITIONS: Record<string, string[]> = {
  draft: ['rfq', 'ordered', 'cancelled'],
  rfq: ['draft', 'ordered', 'cancelled'],
  ordered: ['cancelled'],
  partial: ['received'],
  received: [],
  cancelled: ['draft'],
};

@Controller('purchasing/orders')
@Public()
export class PurchaseOrdersController {
  constructor(private readonly db: Database) {}

  /** ?id= (with lines, receipts and bills) or the list: ?status=&supplier_id= */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const id = q.get('id');
    if (id) {
      const [po, lines, receipts, bills] = await Promise.all([
        this.db
          .selectFrom('purchase_orders as po')
          .selectAll('po')
          .select((eb) => [
            one(
              eb,
              'suppliers as s',
              ['s.id', 's.name', 's.phone', 's.email', 's.payment_terms_days'],
              's.id',
              'po.supplier_id',
            ).as('supplier'),
            one(
              eb,
              'locations as l',
              ['l.id', 'l.name'],
              'l.id',
              'po.location_id',
            ).as('location'),
          ])
          .where('po.id', '=', id)
          .where('po.deleted_at', 'is', null)
          .executeTakeFirst(),
        this.db
          .selectFrom('purchase_order_lines as pl')
          .select([
            'pl.id',
            'pl.variant_id',
            'pl.material_id',
            'pl.description',
            'pl.quantity',
            'pl.unit_cost',
            'pl.vat_rate',
            'pl.received_quantity',
            'pl.rejected_quantity',
            'pl.position',
          ])
          .select((eb) => [
            one(
              eb,
              'product_variants as v',
              ['v.sku'],
              'v.id',
              'pl.variant_id',
              (q2) =>
                q2.select((e: any) => [
                  one(
                    e,
                    'products as p',
                    ['p.name'],
                    'p.id',
                    'v.product_id',
                  ).as('product'),
                  one(
                    e,
                    'colors as c',
                    ['c.name', 'c.display_name'],
                    'c.id',
                    'v.color_id',
                  ).as('colors'),
                  one(e, 'sizes as z', ['z.name'], 'z.id', 'v.size_id').as(
                    'sizes',
                  ),
                ]),
            ).as('variant'),
            one(
              eb,
              'raw_materials as m',
              ['m.name', 'm.unit'],
              'm.id',
              'pl.material_id',
            ).as('material'),
          ])
          .where('pl.purchase_order_id', '=', id)
          .where('pl.deleted_at', 'is', null)
          .orderBy('pl.position')
          .execute(),
        this.db
          .selectFrom('purchase_receipts as r')
          .selectAll('r')
          .select((eb) =>
            many(
              eb,
              'purchase_receipt_lines as rl',
              '*',
              'rl.receipt_id',
              'r.id',
            ).as('lines'),
          )
          .where('r.purchase_order_id', '=', id)
          .where('r.deleted_at', 'is', null)
          .orderBy('r.created_at')
          .execute(),
        this.db
          .selectFrom('bills')
          .select([
            'id',
            'number',
            'supplier_reference',
            'total',
            'paid_amount',
            'status',
            'bill_date',
            'due_date',
          ])
          .where('purchase_order_id', '=', id)
          .where('deleted_at', 'is', null)
          .execute(),
      ]);
      if (!po) throw new ApiError('This purchase order no longer exists.', 404);
      return { ...po, lines, receipts, bills };
    }
    let rows = this.db
      .selectFrom('purchase_orders as po')
      .selectAll('po')
      .select((eb) => [
        one(eb, 'suppliers as s', ['s.name'], 's.id', 'po.supplier_id').as(
          'supplier',
        ),
        many(
          eb,
          'purchase_order_lines as pl',
          ['pl.quantity', 'pl.received_quantity'],
          'pl.purchase_order_id',
          'po.id',
          (q2) => q2.where('pl.deleted_at', 'is', null),
        ).as('lines'),
      ])
      .where('po.deleted_at', 'is', null);
    if (q.get('status')) rows = rows.where('po.status', '=', q.get('status')!);
    if (q.get('supplier_id'))
      rows = rows.where('po.supplier_id', '=', q.get('supplier_id')!);
    const list = await rows
      .orderBy('po.order_date', 'desc')
      .orderBy('po.created_at', 'desc')
      .limit(q.int('limit', 300, 1000))
      .execute();
    return list.map(({ lines, ...row }) => {
      const items = lines as { quantity: number; received_quantity: number }[];
      return {
        ...row,
        line_count: items.length,
        ordered_quantity: items.reduce((s, l) => s + Number(l.quantity), 0),
        received_quantity: items.reduce(
          (s, l) => s + Number(l.received_quantity),
          0,
        ),
      };
    });
  }

  /** Create, or update (with id), a purchase order and its lines. */
  @Post()
  async save(
    @Body(new Zod(saveSchema)) body: z.infer<typeof saveSchema>,
    @CurrentActor() actor: RequestActor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { id, lines, ...po } = body;
    if (id) res.status(200);
    return this.db.withActor(actor, (trx) =>
      this.db.call(
        'save_purchase_order',
        {
          p_id: id ?? null,
          p_po: po,
          p_lines: lines,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
  }

  /** { id, status } — send a price request, place the order, or cancel. */
  @Patch()
  async status(
    @Body(new Zod(statusSchema)) body: z.infer<typeof statusSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const po = await this.db
      .selectFrom('purchase_orders')
      .select('status')
      .where('id', '=', body.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!po) throw new ApiError('This purchase order no longer exists.', 404);
    if (!TRANSITIONS[po.status]?.includes(body.status))
      throw new ApiError(
        `A ${po.status} purchase order cannot become ${body.status}.`,
        409,
      );
    if (body.status === 'cancelled') {
      const pending = await this.db
        .selectFrom('purchase_receipts')
        .select('id')
        .where('purchase_order_id', '=', body.id)
        .where('status', '=', 'pending')
        .where('deleted_at', 'is', null)
        .execute();
      if (pending.length)
        throw new ApiError(
          'Validate or cancel its pending receipts first.',
          409,
        );
    }
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('purchase_orders')
        .set({ status: body.status })
        .where('id', '=', body.id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await invalidateCatalog();
    return row;
  }

  /** ?id= — only drafts and price requests nothing was received on. */
  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    const po = await this.db
      .selectFrom('purchase_orders')
      .select('status')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!po) throw new ApiError('This purchase order no longer exists.', 404);
    if (!['draft', 'rfq', 'cancelled'].includes(po.status))
      throw new ApiError(
        'Cancel the purchase order instead: goods may have been received.',
        409,
      );
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('purchase_orders')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

// ── Goods receipts ──

const receiptSchema = z.object({
  purchase_order_id: zId,
  received_on: zDate.optional(),
  location_id: zId.nullish(),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        po_line_id: zId,
        quantity_accepted: z.number().min(0).max(1_000_000),
        quantity_rejected: z.number().min(0).max(1_000_000).default(0),
        reject_reason: z.string().trim().max(250).optional(),
      }),
    )
    .min(1)
    .max(300),
  // Validate now (stock goes up) or leave it pending until the goods are checked.
  validate: z.boolean().default(false),
});
const receiptActionSchema = z.object({
  id: zId,
  action: z.enum(['validate', 'cancel']),
});

@Controller('purchasing/receipts')
@Public()
export class ReceiptsController {
  constructor(private readonly db: Database) {}

  /** ?purchase_order_id= | ?status= | recent receipts */
  @Get()
  list(@Query() query: Record<string, string>) {
    const q = params(query);
    let rows = this.db
      .selectFrom('purchase_receipts as r')
      .selectAll('r')
      .select((eb) => [
        one(
          eb,
          'purchase_orders as po',
          ['po.number'],
          'po.id',
          'r.purchase_order_id',
          (q2) =>
            q2.select((e: any) =>
              one(e, 'suppliers as s', ['s.name'], 's.id', 'po.supplier_id').as(
                'supplier',
              ),
            ),
        ).as('purchase_order'),
        many(
          eb,
          'purchase_receipt_lines as rl',
          '*',
          'rl.receipt_id',
          'r.id',
        ).as('lines'),
      ])
      .where('r.deleted_at', 'is', null);
    if (q.get('purchase_order_id'))
      rows = rows.where(
        'r.purchase_order_id',
        '=',
        q.get('purchase_order_id')!,
      );
    if (q.get('status')) rows = rows.where('r.status', '=', q.get('status')!);
    return rows
      .orderBy('r.created_at', 'desc')
      .limit(q.int('limit', 200, 1000))
      .execute();
  }

  @Post()
  async create(
    @Body(new Zod(receiptSchema)) body: z.infer<typeof receiptSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const data = await this.db.withActor(actor, (trx) =>
      this.db.call(
        'create_purchase_receipt',
        {
          p_po_id: body.purchase_order_id,
          p_receipt: {
            received_on: body.received_on ?? '',
            location_id: body.location_id ?? '',
            notes: body.notes ?? '',
          },
          p_lines: body.lines,
          p_validate: body.validate,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
    if (body.validate) await invalidateCatalog();
    return data;
  }

  /** { id, action: validate | cancel } */
  @Put()
  async act(
    @Body(new Zod(receiptActionSchema))
    body: z.infer<typeof receiptActionSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.action === 'validate') {
      const data = await this.db.withActor(actor, (trx) =>
        this.db.call(
          'validate_purchase_receipt',
          {
            p_receipt_id: body.id,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
      await invalidateCatalog();
      return data;
    }
    const receipt = await this.db
      .selectFrom('purchase_receipts')
      .select('status')
      .where('id', '=', body.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!receipt) throw new ApiError('This receipt no longer exists.', 404);
    if (receipt.status !== 'pending')
      throw new ApiError(
        'Only receipts waiting for their check can be cancelled.',
        409,
      );
    return this.db.withActor(actor, (trx) =>
      trx
        .updateTable('purchase_receipts')
        .set({ status: 'cancelled' })
        .where('id', '=', body.id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
}

// ── Raw materials ──

const materialFields = {
  name: z.string().trim().min(1).max(150),
  code: z.string().trim().max(50).nullable(),
  unit: z.enum(MATERIAL_UNITS),
  supplier_id: zId.nullable(),
  reorder_point: z.number().min(0).max(1_000_000),
  notes: z.string().trim().max(2000).nullable(),
};
const materialCreate = z
  .object(materialFields)
  .partial()
  .required({ name: true });
const materialUpdate = z
  .object({ id: zId, ...materialFields })
  .partial()
  .required({ id: true });
const materialMovement = z.object({
  id: zId,
  type: z.enum(['purchase', 'adjustment', 'consumption', 'return']),
  quantity: z
    .number()
    .finite()
    .refine((v) => v !== 0, 'Quantity cannot be zero'),
  unit_cost: z.number().min(0).max(1_000_000).optional(),
  note: z.string().trim().max(500).default(''),
});

@Controller('purchasing/materials')
@Public()
export class MaterialsController {
  constructor(private readonly db: Database) {}

  private materials() {
    return this.db
      .selectFrom('raw_materials as m')
      .selectAll('m')
      .select((eb) =>
        one(
          eb,
          'suppliers as s',
          ['s.id', 's.name'],
          's.id',
          'm.supplier_id',
        ).as('supplier'),
      )
      .where('m.deleted_at', 'is', null);
  }

  /** ?id= (with movements and purchase history) or the list. */
  @Get()
  async get(@Query('id') id?: string) {
    if (!id) return this.materials().orderBy('m.name').execute();
    const [material, movements, purchases] = await Promise.all([
      this.materials().where('m.id', '=', id).executeTakeFirst(),
      this.db
        .selectFrom('material_movements')
        .selectAll()
        .where('material_id', '=', id)
        .orderBy('created_at', 'desc')
        .limit(300)
        .execute(),
      this.db
        .selectFrom('purchase_order_lines as pl')
        .innerJoin('purchase_orders as po', 'po.id', 'pl.purchase_order_id')
        .select(['pl.quantity', 'pl.unit_cost', 'pl.received_quantity'])
        .select((eb) =>
          one(
            eb,
            'purchase_orders as o',
            ['o.id', 'o.number', 'o.order_date', 'o.status', 'o.deleted_at'],
            'o.id',
            'pl.purchase_order_id',
            (q2) =>
              q2.select((e: any) =>
                one(
                  e,
                  'suppliers as s',
                  ['s.name'],
                  's.id',
                  'o.supplier_id',
                ).as('supplier'),
              ),
          ).as('purchase_order'),
        )
        .where('pl.material_id', '=', id)
        .where('pl.deleted_at', 'is', null)
        .where('po.deleted_at', 'is', null)
        .orderBy('pl.created_at', 'desc')
        .limit(100)
        .execute(),
    ]);
    if (!material)
      throw new ApiError('This raw material no longer exists.', 404);
    return { ...material, movements, purchases };
  }

  @Post()
  create(
    @Body(new Zod(materialCreate)) body: z.infer<typeof materialCreate>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('raw_materials')
        .values({ ...body, code: body.code || null })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Put()
  async update(
    @Body(new Zod(materialUpdate)) body: z.infer<typeof materialUpdate>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...row } = body;
    const saved = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('raw_materials')
        .set(row)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!saved) throw new ApiError('This raw material no longer exists.', 404);
    return saved;
  }

  /**
   * A stock movement: { id, type, quantity, unit_cost?, note }. `purchase` (bought outside a
   * purchase order, or opening stock) moves the average cost.
   */
  @Patch()
  async move(
    @Body(new Zod(materialMovement)) body: z.infer<typeof materialMovement>,
    @CurrentActor() actor: RequestActor,
  ) {
    const quantity =
      body.type === 'consumption'
        ? -Math.abs(body.quantity)
        : body.type === 'adjustment'
          ? body.quantity
          : Math.abs(body.quantity);
    await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('material_movements')
        .values({
          material_id: body.id,
          type: body.type,
          quantity,
          note: body.note,
          unit_cost: body.type === 'purchase' ? (body.unit_cost ?? null) : null,
          reference: body.type === 'adjustment' ? 'Count' : '',
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .execute(),
    );
    return this.db
      .selectFrom('raw_materials')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
  }

  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    const used = await this.db
      .selectFrom('product_bom')
      .select('id')
      .where('material_id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (used)
      throw new ApiError(
        'This material is in a bill of materials. Remove it there first.',
        409,
      );
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('raw_materials')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

// ── Cost prices and production ──

const costingSchema = z.object({
  product_id: zId,
  labor_cost: z.number().min(0).max(1_000_000).default(0),
  overhead_cost: z.number().min(0).max(1_000_000).default(0),
  notes: z.string().trim().max(2000).optional(),
  bom: z
    .array(
      z.object({
        material_id: zId,
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .max(100),
});
const productionSchema = z.object({
  variant_id: zId,
  quantity: z.number().int().min(1).max(100_000),
  location_id: zId,
  note: z.string().trim().max(500).default(''),
});

@Controller('purchasing/costing')
@Public()
export class CostingController {
  constructor(private readonly db: Database) {}

  /** Cost price of every product; ?product_id= gives its bill of materials and costing. */
  @Get()
  async get(@Query('product_id') productId?: string) {
    if (!productId) return this.db.call('product_cost_prices');
    const [bom, costing] = await Promise.all([
      this.db
        .selectFrom('product_bom as b')
        .select(['b.id', 'b.material_id', 'b.quantity'])
        .select((eb) =>
          one(
            eb,
            'raw_materials as m',
            ['m.name', 'm.unit', 'm.avg_cost', 'm.stock'],
            'm.id',
            'b.material_id',
          ).as('material'),
        )
        .where('b.product_id', '=', productId)
        .where('b.deleted_at', 'is', null)
        .execute(),
      this.db
        .selectFrom('product_costing')
        .selectAll()
        .where('product_id', '=', productId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
    ]);
    return { bom, costing: costing ?? null };
  }

  /** Saves a product's bill of materials, labor and overhead together. */
  @Put()
  async save(
    @Body(new Zod(costingSchema)) body: z.infer<typeof costingSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    await this.db.withActor(actor, (trx) =>
      this.db.call(
        'save_product_costing',
        {
          p_product_id: body.product_id,
          p_labor: body.labor_cost,
          p_overhead: body.overhead_cost,
          p_notes: body.notes ?? '',
          p_bom: body.bom,
        },
        trx,
      ),
    );
    return { product_id: body.product_id };
  }

  /** A production run: materials are consumed and the units enter stock at cost price. */
  @Post()
  async produce(
    @Body(new Zod(productionSchema)) body: z.infer<typeof productionSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const data = await this.db.withActor(actor, (trx) =>
      this.db.call(
        'record_production',
        {
          p_variant_id: body.variant_id,
          p_quantity: body.quantity,
          p_location_id: body.location_id,
          p_note: body.note,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
    await invalidateCatalog();
    return data;
  }
}

/** Purchase prices by item and supplier (quotes and orders): last, lowest and average price. */
@Controller('purchasing/prices')
@Public()
export class PurchasePricesController {
  constructor(private readonly db: Database) {}

  @Get()
  get(@Query() query: Record<string, string>) {
    const q = params(query);
    return this.db.call('purchase_price_comparison', {
      p_variant_id: q.get('variant_id'),
      p_material_id: q.get('material_id'),
    });
  }
}
