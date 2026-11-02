import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';

// PostgREST-style embeds for the ported ERP routes, where rows are loose JSON anyway:
// one(eb, 'orders as o', ['o.order_number'], 'o.id', 'p.order_id').as('order')
// many(eb, 'order_items as i', '*', 'i.order_id', 'o.id').as('items')
// `extra` adds filters or nested embeds to the inner query.

type Columns = string[] | '*';
const pick = (query: any, columns: Columns) =>
  columns === '*' ? query.selectAll() : query.select(columns);

export function one(
  eb: any,
  from: string,
  columns: Columns,
  column: string,
  ref: string,
  extra: (q: any) => any = (q) => q,
) {
  return jsonObjectFrom(
    extra(pick(eb.selectFrom(from), columns).whereRef(column, '=', ref)),
  );
}

export function many(
  eb: any,
  from: string,
  columns: Columns,
  column: string,
  ref: string,
  extra: (q: any) => any = (q) => q,
) {
  return jsonArrayFrom(
    extra(pick(eb.selectFrom(from), columns).whereRef(column, '=', ref)),
  );
}
