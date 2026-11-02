import type { Kysely } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';

/** Live variants with their size and color, like PostgREST's `*, sizes(*), colors(*)`. */
export function variantsWithOptions(db: Kysely<DB>) {
  return db
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
