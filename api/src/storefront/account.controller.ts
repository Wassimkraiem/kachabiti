import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { z } from 'zod';
import { customerStage } from '@shared/colissimo-data';
import { CurrentUserId, Public } from '../auth/decorators';
import { ApiError, Zod } from '../common/api';
import { Database } from '../db/database';
import { many, one } from '../db/embed';
import { activeDiscounts } from '../sales/commerce';

// A signed-in shopper's own data (favorites, orders, reviews). These were browser-side
// Supabase calls under RLS; here the user is always the session's, never one sent by the client.

const productId = z.object({ product_id: z.string().uuid() });
const reviewSchema = z.object({
  product_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).default(''),
});

function signedIn(userId: string | null): string {
  if (!userId) throw new ApiError('Sign in again', 401);
  return userId;
}

@Controller('account')
@Public()
export class AccountController {
  constructor(private readonly db: Database) {}

  /** Live favorited products with images, ratings and the active discount (lib/favorites.ts shapes them). */
  @Get('favorites')
  async favorites(@CurrentUserId() userId: string | null) {
    const rows = await this.db
      .selectFrom('user_favorites as f')
      .select(['f.id', 'f.user_id', 'f.product_id', 'f.created_at'])
      .select((eb) =>
        one(
          eb,
          'products as p',
          [
            'p.id',
            'p.name',
            'p.slug',
            'p.description',
            'p.base_price',
            'p.category_id',
            'p.status',
          ],
          'p.id',
          'f.product_id',
          (q) =>
            q
              .where('p.status', '=', 'active')
              .where('p.deleted_at', 'is', null)
              .select((e: any) => [
                many(
                  e,
                  'product_images as i',
                  [
                    'i.id',
                    'i.product_id',
                    'i.image_url',
                    'i.alt_text',
                    'i.is_main',
                    'i.position',
                  ],
                  'i.product_id',
                  'p.id',
                  (iq) => iq.where('i.deleted_at', 'is', null),
                ).as('product_images'),
                many(
                  e,
                  'reviews as r',
                  ['r.rating'],
                  'r.product_id',
                  'p.id',
                ).as('reviews'),
              ]),
        ).as('products'),
      )
      .where('f.user_id', '=', signedIn(userId))
      .where('f.deleted_at', 'is', null)
      .orderBy('f.created_at', 'desc')
      .execute();
    const live = rows.filter((row) => row.products);
    const discounts = await activeDiscounts(
      this.db,
      live.map((row) => row.product_id),
    );
    return live.map((row) => ({
      ...row,
      discount_percent: discounts.get(row.product_id)?.discount_percent ?? null,
    }));
  }

  /** Adds a favorite; a removed one is kept (deleted_at) and brought back. */
  @Post('favorites')
  @HttpCode(200)
  async add(
    @CurrentUserId() userId: string | null,
    @Body(new Zod(productId)) body: z.infer<typeof productId>,
  ) {
    const user = signedIn(userId);
    await this.db.withActor(null, (trx) =>
      trx
        .insertInto('user_favorites')
        .values({
          user_id: user,
          product_id: body.product_id,
          deleted_at: null,
        })
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'product_id'])
            .doUpdateSet({ deleted_at: null }),
        )
        .execute(),
    );
    return { favorited: true };
  }

  @Delete('favorites')
  async remove(
    @CurrentUserId() userId: string | null,
    @Query(new Zod(productId)) query: z.infer<typeof productId>,
  ) {
    const user = signedIn(userId);
    await this.db.withActor(null, (trx) =>
      trx
        .updateTable('user_favorites')
        .set({ deleted_at: new Date() })
        .where('user_id', '=', user)
        .where('product_id', '=', query.product_id)
        .where('deleted_at', 'is', null)
        .execute(),
    );
    return { favorited: false };
  }

  /**
   * The shopper's orders, newest first, each with its lines and, once sent, where its parcel
   * stands (`delivery.stage`, see customerStage) with its barcode; no internal parcel details.
   */
  @Get('orders')
  async orders(@CurrentUserId() userId: string | null) {
    const orders = await this.db
      .selectFrom('orders as o')
      .selectAll('o')
      .select((eb) =>
        many(eb, 'order_items as i', '*', 'i.order_id', 'o.id').as('items'),
      )
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('deliveries as d')
            .select(['d.barcode', 'd.status', 'd.status_changed_at'])
            .whereRef('d.order_id', '=', 'o.id')
            .where('d.deleted_at', 'is', null)
            .where('d.barcode', 'is not', null),
        ).as('parcel'),
      )
      .where('o.user_id', '=', signedIn(userId))
      .where('o.deleted_at', 'is', null)
      .orderBy('o.created_at', 'desc')
      .execute();
    return orders.map(({ parcel, ...order }) => ({
      ...order,
      delivery: parcel
        ? {
            stage: customerStage(parcel.status),
            barcode: parcel.barcode,
            updated_at: parcel.status_changed_at,
          }
        : null,
    }));
  }

  /** A review under the account's own name (as shown in public.users). */
  @Post('reviews')
  @HttpCode(200)
  async review(
    @CurrentUserId() userId: string | null,
    @Body(new Zod(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'email'])
      .where('id', '=', signedIn(userId))
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw new ApiError('Sign in again', 401);
    const product = await this.db
      .selectFrom('products')
      .select('id')
      .where('id', '=', body.product_id)
      .where('status', '=', 'active')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!product) throw new ApiError('Product not found', 404);
    return this.db.withActor(null, (trx) =>
      trx
        .insertInto('reviews')
        .values({
          product_id: body.product_id,
          user_id: user.id,
          user_name: user.name || user.email?.split('@')[0] || null,
          rating: body.rating,
          comment: body.comment,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
}
