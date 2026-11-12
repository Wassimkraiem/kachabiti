import type { Kysely } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';

/** Variant columns the public product reads may return: everything except the purchase cost (avg_cost). */
export const VARIANT_COLUMNS = [
  'v.id',
  'v.product_id',
  'v.size_id',
  'v.color_id',
  'v.sku',
  'v.price',
  'v.stock',
  'v.is_available',
  'v.reorder_point',
  'v.deleted_at',
  'v.created_at',
  'v.updated_at',
] as const;

/** Live variants with their size and color, like PostgREST's `*, sizes(*), colors(*)`. */
export function variantsWithOptions(db: Kysely<DB>) {
  return db
    .selectFrom('product_variants as v')
    .select(VARIANT_COLUMNS)
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
