import { Controller, Get, Query } from '@nestjs/common';
import { sql } from 'kysely';
import {
  parseLandingConfig,
  type LandingSection,
  type ListSettings,
} from '@shared/landing-config';
import {
  getCategoryName,
  getDescendantCategoryIds,
  getProductImageUrl,
  getProductName,
} from '@shared/utils/product-utils';
import { Public } from '../auth/decorators';
import { Raw } from '../common/api';
import { Database } from '../db/database';
import { many, one } from '../db/embed';
import {
  activeDiscounts,
  calculateShipping,
  countryCode,
  countryTaxRate,
  siteSettings,
} from '../sales/commerce';

// The storefront's public reads, ported from lib/home-data.ts, lib/landing-products.ts,
// lib/product-detail.ts and the home page's hero query. They used the publishable key, so every
// query applies what the public RLS policies did: live, active rows only. Next.js keeps caching
// the results (lib/catalog-cache.ts); these endpoints are always served by NestJS.

type Image = {
  image_url: string;
  is_main: boolean;
  position: number;
  variant_id?: string | null;
};
// An empty result of the same row type, for lists that are switched off.
const none = sql<boolean>`false`;
const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400';

function ratingOf(reviews: { rating: number | null }[] = []) {
  const rated = reviews.filter(
    (r) => typeof r?.rating === 'number' && !Number.isNaN(Number(r.rating)),
  );
  const rating = rated.length
    ? Number(
        (
          rated.reduce((sum, r) => sum + Number(r.rating), 0) / rated.length
        ).toFixed(1),
      )
    : 0;
  return { rating, review_count: rated.length };
}

/** The landing sections' main photo: product-level first, then by is_main, then position. */
function mainImage(images: Image[] | null): string | null {
  if (!images?.length) return null;
  const productLevel = images.filter((img) => !img.variant_id);
  const pool = productLevel.length ? productLevel : images;
  return (
    pool.find((img) => img.is_main)?.image_url ??
    [...pool].sort((a, b) => a.position - b.position)[0].image_url
  );
}

@Controller('storefront')
@Public()
export class StorefrontController {
  constructor(private readonly db: Database) {}

  private liveProducts() {
    return this.db
      .selectFrom('products as p')
      .where('p.status', '=', 'active')
      .where('p.deleted_at', 'is', null);
  }

  private liveCategories() {
    return this.db.selectFrom('categories').where('deleted_at', 'is', null);
  }

  private async landingConfig() {
    const row = await this.db
      .selectFrom('site_settings')
      .select('setting_value')
      .where('setting_key', '=', 'landing_config')
      .executeTakeFirst();
    return parseLandingConfig(row?.setting_value);
  }

  /** The products the admin picked for a section, in their order. */
  private async pickedIds(section: LandingSection): Promise<string[]> {
    const rows = await this.db
      .selectFrom('landing_products')
      .select('product_id')
      .where('section', '=', section)
      .where('deleted_at', 'is', null)
      .orderBy('position')
      .execute();
    return rows.map((r) => r.product_id);
  }

  // ── Home lists (lib/home-data.ts) ──

  /** Pinned products first (in order), then the best sellers if autofill is on. */
  @Get('top')
  async top() {
    const [config, pinnedIds] = await Promise.all([
      this.landingConfig(),
      this.pickedIds('top_products'),
    ]);
    const { count, autofill } = config.lists.top_products;
    const query = () =>
      this.liveProducts()
        .select([
          'p.id',
          'p.name',
          'p.name_ar',
          'p.name_fr',
          'p.slug',
          'p.description',
          'p.base_price',
          'p.category_id',
          'p.status',
          'p.sold_count',
          'p.created_at',
        ])
        .select((eb) => [
          many(
            eb,
            'product_images as i',
            ['i.id', 'i.image_url', 'i.alt_text', 'i.is_main', 'i.position'],
            'i.product_id',
            'p.id',
            (q) =>
              q
                .where('i.variant_id', 'is', null)
                .where('i.deleted_at', 'is', null),
          ).as('product_images'),
          many(eb, 'reviews as r', ['r.rating'], 'r.product_id', 'p.id').as(
            'reviews',
          ),
        ]);
    const [pinned, auto] = await Promise.all([
      pinnedIds.length
        ? query().where('p.id', 'in', pinnedIds).execute()
        : query().where(none).execute(),
      autofill
        ? query()
            .orderBy('p.sold_count', (ob) => ob.desc().nullsLast())
            .orderBy('p.created_at', 'desc')
            .limit(count + pinnedIds.length)
            .execute()
        : query().where(none).execute(),
    ]);
    const rows = [
      ...pinned.sort(
        (a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id),
      ),
      ...auto.filter((p) => !pinnedIds.includes(p.id)),
    ].slice(0, count);
    if (!rows.length) return { products: [] };

    const ids = rows.map((p) => p.id);
    const [discounts, categories] = await Promise.all([
      this.db
        .selectFrom('product_discounts')
        .select(['product_id', 'discount_percent', 'ends_at'])
        .where('product_id', 'in', ids)
        .where('active', '=', true)
        .where('deleted_at', 'is', null)
        .execute(),
      this.liveCategories().select(['id', 'slug']).execute(),
    ]);
    // The last active discount per product wins, as the map built in lib/home-data.ts did.
    const discountMap = new Map(discounts.map((d) => [d.product_id, d]));
    const categorySlug = new Map(categories.map((c) => [c.id, c.slug]));
    return {
      products: rows.map((product) => {
        const discount = discountMap.get(product.id);
        const basePrice = Number(product.base_price ?? 0);
        return {
          id: product.id,
          name: product.name,
          name_ar: product.name_ar,
          name_fr: product.name_fr,
          title: product.name,
          slug: product.slug,
          description: product.description,
          base_price: basePrice,
          price_cents: basePrice,
          image_url: getProductImageUrl(product) || FALLBACK_IMAGE,
          product_images: product.product_images ?? [],
          category_id: product.category_id,
          categorySlug: product.category_id
            ? categorySlug.get(product.category_id) || 'all'
            : 'all',
          currency: 'TND',
          status: product.status,
          discount_percent: discount?.discount_percent,
          promo_end_date: discount?.ends_at || undefined,
          sold_count: Number(product.sold_count) || 0,
          ...ratingOf(product.reviews as { rating: number | null }[]),
        };
      }),
    };
  }

  /** Active discounts on live products: pinned first, then the latest ones if autofill is on. */
  @Get('promo')
  async promo() {
    const [config, pinnedIds] = await Promise.all([
      this.landingConfig(),
      this.pickedIds('promo_products'),
    ]);
    const { count, autofill } = config.lists.promo_products;
    const discounts = () =>
      this.db
        .selectFrom('product_discounts as d')
        .innerJoin('products as p', 'p.id', 'd.product_id')
        .select(['d.product_id', 'd.discount_percent', 'd.ends_at'])
        .where('d.active', '=', true)
        .where('d.deleted_at', 'is', null)
        .where('p.status', '=', 'active')
        .where('p.deleted_at', 'is', null);
    const [pinned, auto] = await Promise.all([
      pinnedIds.length
        ? discounts().where('d.product_id', 'in', pinnedIds).execute()
        : discounts().where(none).execute(),
      autofill
        ? discounts()
            .orderBy('d.created_at', 'desc')
            .limit(count + pinnedIds.length)
            .execute()
        : discounts().where(none).execute(),
    ]);
    const chosen: typeof pinned = [];
    for (const d of [
      ...pinned.sort(
        (a, b) =>
          pinnedIds.indexOf(a.product_id) - pinnedIds.indexOf(b.product_id),
      ),
      ...auto,
    ]) {
      if (!chosen.some((x) => x.product_id === d.product_id)) chosen.push(d);
    }
    chosen.splice(count);
    if (!chosen.length) return { products: [] };

    const ids = chosen.map((d) => d.product_id);
    const [products, variants] = await Promise.all([
      this.liveProducts()
        .select([
          'p.id',
          'p.name',
          'p.name_ar',
          'p.name_fr',
          'p.slug',
          'p.base_price',
          'p.sold_count',
          'p.category_id',
        ])
        .select((eb) => [
          many(
            eb,
            'product_images as i',
            ['i.id', 'i.image_url', 'i.alt_text', 'i.is_main', 'i.position'],
            'i.product_id',
            'p.id',
            (q) => q.where('i.deleted_at', 'is', null),
          ).as('product_images'),
          many(eb, 'reviews as r', ['r.rating'], 'r.product_id', 'p.id').as(
            'reviews',
          ),
        ])
        .where('p.id', 'in', ids)
        .execute(),
      // Stock is the sum of live, available variants.
      this.db
        .selectFrom('product_variants')
        .select(['product_id', 'stock'])
        .where('product_id', 'in', ids)
        .where('is_available', '=', true)
        .where('deleted_at', 'is', null)
        .execute(),
    ]);
    const stock = new Map<string, number>();
    for (const v of variants)
      stock.set(
        v.product_id,
        (stock.get(v.product_id) ?? 0) + Number(v.stock ?? 0),
      );
    const discountMap = new Map(chosen.map((d) => [d.product_id, d]));
    return {
      products: products
        .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
        .map((product) => {
          const discount = discountMap.get(product.id);
          return {
            id: product.id,
            name: product.name,
            name_ar: product.name_ar,
            name_fr: product.name_fr,
            title: product.name,
            slug: product.slug,
            base_price: Number(product.base_price ?? 0),
            price_cents: Number(product.base_price ?? 0),
            image_url: getProductImageUrl(product) || FALLBACK_IMAGE,
            category_id: product.category_id,
            currency: 'TND',
            discount_percent: discount?.discount_percent,
            promo_end_date: discount?.ends_at || undefined,
            sold_count: Number(product.sold_count ?? 0),
            stock: stock.get(product.id) ?? 0,
            ...ratingOf(product.reviews as { rating: number | null }[]),
          };
        }),
    };
  }

  @Get('featured-categories')
  featuredCategories() {
    return (
      this.liveCategories()
        .select([
          'id',
          'name',
          'name_ar',
          'name_fr',
          'slug',
          'image_url',
          'sort_order',
          'is_featured',
          'featured_position',
        ])
        .where('is_featured', '=', true)
        // The order set in Admin → Landing page, then the menu order.
        .orderBy('featured_position', (ob) => ob.asc().nullsLast())
        .orderBy('sort_order')
        .execute()
    );
  }

  @Get('sale-banners')
  saleBanners() {
    return this.db
      .selectFrom('promotions')
      .selectAll()
      .where('active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('discount_percent', 'desc')
      .execute();
  }

  @Get('reels')
  reels() {
    return this.db
      .selectFrom('reels')
      .selectAll()
      .where('active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .execute();
  }

  /** Newest reviews across the shop (?limit=, default 12, at most 50). */
  @Get('latest-reviews')
  latestReviews(@Query('limit') limit?: string) {
    return this.db
      .selectFrom('reviews as r')
      .selectAll('r')
      .select((eb) =>
        one(
          eb,
          'users as u',
          ['u.id', 'u.name', 'u.avatar_url'],
          'u.id',
          'r.user_id',
        ).as('users'),
      )
      .orderBy('r.updated_at', 'desc')
      .limit(Math.min(Math.max(Number(limit) || 12, 1), 50))
      .execute();
  }

  /** One product's reviews, newest first. */
  @Get('reviews')
  reviews(@Query('product_id') productId = '') {
    return this.db
      .selectFrom('reviews as r')
      .selectAll('r')
      .select((eb) =>
        one(
          eb,
          'users as u',
          ['u.name', 'u.avatar_url'],
          'u.id',
          'r.user_id',
        ).as('users'),
      )
      .where('r.product_id', '=', productId)
      .orderBy('r.created_at', 'desc')
      .execute();
  }

  /** What "add to cart" from a product card needs: the available variants and whether stock is tracked. */
  @Get('quick-add')
  async quickAdd(@Query('product_id') productId = '') {
    const [variants, product] = await Promise.all([
      this.db
        .selectFrom('product_variants as v')
        .select(['v.id', 'v.price', 'v.stock'])
        .select((eb) => [
          one(
            eb,
            'colors as c',
            ['c.name', 'c.display_name'],
            'c.id',
            'v.color_id',
          ).as('colors'),
          one(eb, 'sizes as s', ['s.name'], 's.id', 'v.size_id').as('sizes'),
        ])
        .where('v.product_id', '=', productId)
        .where('v.deleted_at', 'is', null)
        .where('v.is_available', 'is not', false)
        .execute(),
      this.liveProducts()
        .select('p.stock_tracked')
        .where('p.id', '=', productId)
        .executeTakeFirst(),
    ]);
    return { variants, stock_tracked: product?.stock_tracked ?? false };
  }

  /** Shipping and tax settings (free-shipping threshold on the product page). */
  @Get('settings')
  settings() {
    return siteSettings(this.db);
  }

  /** Shipping cost and tax rate shown at checkout (?country=&subtotal=); the order is re-priced on submit. */
  @Get('checkout-quote')
  async checkoutQuote(
    @Query('country') country = 'Tunisia',
    @Query('subtotal') subtotal = '0',
  ) {
    const code = countryCode(country);
    const [shipping, taxRate] = await Promise.all([
      calculateShipping(this.db, code, Number(subtotal) || 0),
      countryTaxRate(this.db, code),
    ]);
    return { shipping_cost: shipping.cost, tax_rate: taxRate };
  }

  /** Hero rows (sort_order 0–1 right cards, 2 left card, 3+ carousel) and small cards. */
  @Get('hero')
  async hero() {
    const [heroData, smallCardsData] = await Promise.all([
      this.db
        .selectFrom('hero_sections')
        .selectAll()
        .where('is_active', '=', true)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order')
        .execute(),
      this.db
        .selectFrom('small_cards')
        .selectAll()
        .where('is_active', '=', true)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order')
        .execute(),
    ]);
    return { heroData, smallCardsData };
  }

  // ── Landing sections (lib/landing-products.ts) ──

  /** Everything the product-led home sections need for one locale. */
  @Get('landing')
  async landing(@Query('locale') locale = 'ar') {
    const [config, categories, settings] = await Promise.all([
      this.landingConfig(),
      this.liveCategories()
        .select([
          'id',
          'name',
          'name_ar',
          'name_fr',
          'slug',
          'parent_id',
          'sort_order',
        ])
        .orderBy('sort_order')
        .execute(),
      siteSettings(this.db),
    ]);
    const [showcase, ringPicks, newArrivals, spotlight] = await Promise.all([
      this.picks(locale, 'showcase', categories, true),
      this.picks(locale, 'ring', categories, false),
      this.newArrivals(locale, config.lists.new_arrivals, categories),
      this.spotlight(
        locale,
        config.lists.spotlight,
        config.spotlightCategoryId,
        categories,
      ),
    ]);
    return {
      showcase,
      ringPicks,
      newArrivals,
      spotlight,
      freeShippingThreshold: settings.free_shipping_enabled
        ? settings.global_free_shipping_threshold
        : null,
      layout: config.layout,
    };
  }

  private landingProducts() {
    return this.liveProducts()
      .select([
        'p.id',
        'p.slug',
        'p.name',
        'p.name_ar',
        'p.name_fr',
        'p.base_price',
        'p.category_id',
      ])
      .select((eb) =>
        many(
          eb,
          'product_images as i',
          ['i.image_url', 'i.is_main', 'i.position', 'i.variant_id'],
          'i.product_id',
          'p.id',
          (q) => q.where('i.deleted_at', 'is', null),
        ).as('product_images'),
      );
  }

  // Prices follow the storefront rule: round(base × (1 − discount%)).
  private async toLanding(
    rows: {
      id: string;
      slug: string;
      base_price: number;
      category_id: string | null;
      product_images: unknown;
    }[],
    categories: any[],
    locale: string,
  ) {
    const discounts = await activeDiscounts(
      this.db,
      rows.map((r) => r.id),
    );
    const byId = new Map(categories.map((c) => [c.id, c]));
    return rows.map((row) => {
      const base = Number(row.base_price);
      const percent = Number(discounts.get(row.id)?.discount_percent ?? 0);
      const hasDiscount = percent > 0 && percent <= 100;
      const category = row.category_id ? byId.get(row.category_id) : undefined;
      return {
        id: row.id,
        slug: row.slug,
        name: getProductName(row, locale),
        image: mainImage(row.product_images as Image[]),
        price: Math.round(hasDiscount ? base * (1 - percent / 100) : base),
        originalPrice: hasDiscount ? Math.round(base) : null,
        discountPercent: hasDiscount ? Math.round(percent) : 0,
        categoryName: category ? getCategoryName(category, locale) : null,
      };
    });
  }

  // Products by id in the given order; unpublished ones and ones without a photo are skipped.
  private async byIds(locale: string, ids: string[], categories: any[]) {
    if (!ids.length) return [];
    const rows = (
      await this.landingProducts().where('p.id', 'in', ids).execute()
    )
      .filter((r) => mainImage(r.product_images as Image[]))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return this.toLanding(rows, categories, locale);
  }

  private async newest(
    locale: string,
    limit: number,
    excludeIds: string[],
    categories: any[],
  ) {
    if (limit <= 0) return [];
    const rows = (
      await this.landingProducts()
        .orderBy('p.created_at', 'desc')
        .limit(limit * 2 + excludeIds.length)
        .execute()
    )
      .filter(
        (r) =>
          !excludeIds.includes(r.id) && mainImage(r.product_images as Image[]),
      )
      .slice(0, limit);
    return this.toLanding(rows, categories, locale);
  }

  /** A section's picks; unless `fallback` is false, an empty section falls back to the newest products. */
  private async picks(
    locale: string,
    section: 'showcase' | 'ring',
    categories: any[],
    fallback: boolean,
  ) {
    const picks = await this.byIds(
      locale,
      await this.pickedIds(section),
      categories,
    );
    if (picks.length || !fallback) return picks;
    return this.newest(locale, section === 'showcase' ? 3 : 11, [], categories);
  }

  private async newArrivals(
    locale: string,
    settings: ListSettings,
    categories: any[],
  ) {
    const pinned = (
      await this.byIds(locale, await this.pickedIds('new_arrivals'), categories)
    ).slice(0, settings.count);
    if (!settings.autofill) return pinned;
    const newest = await this.newest(
      locale,
      settings.count - pinned.length,
      pinned.map((p) => p.id),
      categories,
    );
    return [...pinned, ...newest];
  }

  /** The chosen category, or the top-level one with the most live products; pinned first, then best sellers. */
  private async spotlight(
    locale: string,
    settings: ListSettings,
    categoryId: string | null,
    categories: any[],
  ) {
    const counts = await this.liveProducts().select('p.category_id').execute();
    const perCategory = new Map<string, number>();
    for (const row of counts)
      if (row.category_id)
        perCategory.set(
          row.category_id,
          (perCategory.get(row.category_id) || 0) + 1,
        );
    const subtree = (root: any) => {
      const ids = getDescendantCategoryIds(root.id, categories);
      return {
        root,
        ids,
        total: ids.reduce((sum, id) => sum + (perCategory.get(id) || 0), 0),
      };
    };
    const chosen = categoryId
      ? categories.find((c) => c.id === categoryId)
      : undefined;
    let best: ReturnType<typeof subtree> | null = chosen
      ? subtree(chosen)
      : null;
    if (!best) {
      for (const root of categories.filter((c) => !c.parent_id)) {
        const candidate = subtree(root);
        if (!best || candidate.total > best.total) best = candidate;
      }
    }
    if (!best) return null;

    const pinned = (
      await this.byIds(locale, await this.pickedIds('spotlight'), categories)
    ).slice(0, settings.count);
    let filled: Awaited<ReturnType<StorefrontController['toLanding']>> = [];
    const remaining = settings.count - pinned.length;
    if (settings.autofill && remaining > 0 && best.ids.length) {
      const rows = (
        await this.landingProducts()
          .where('p.category_id', 'in', best.ids)
          .orderBy('p.sold_count', 'desc')
          .orderBy('p.created_at', 'desc')
          .limit(remaining + pinned.length)
          .execute()
      )
        .filter(
          (r) =>
            mainImage(r.product_images as Image[]) &&
            !pinned.some((p) => p.id === r.id),
        )
        .slice(0, remaining);
      filled = await this.toLanding(rows, categories, locale);
    }
    const products = [...pinned, ...filled];
    if (products.length < 3) return null;
    const rootId = best.root.id;
    return {
      name: getCategoryName(best.root, locale).trim(),
      slug: best.root.slug,
      productCount: Math.max(best.total, products.length),
      subcategories: categories
        .filter((c) => c.parent_id === rootId)
        .map((c) => ({
          name: getCategoryName(c, locale).trim(),
          slug: c.slug,
        })),
      products,
    };
  }

  // ── Product listings (products page, category pages, header search) ──

  /**
   * Live products with their photos and current discount, filtered in the database:
   * ?search= (ranked by public.search_products), category_ids=, size_ids=, color_ids= (variants),
   * promo=1, price_min=, price_max=, sort=new|popular (default newest; a search without a sort is
   * ranked by relevance), page=, page_size=. Returns { rows, total }.
   */
  @Get('products')
  async products(@Query() query: Record<string, string | undefined>) {
    const list = (name: string) =>
      (query[name] ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    const pageSize = Math.min(Math.max(Number(query.page_size) || 12, 1), 100);
    const page = Math.max(Number(query.page) || 1, 1);
    const empty = { rows: [], total: 0 };

    let filtered = this.liveProducts();
    let ranks: Map<string, number> | null = null;
    const search = query.search?.trim() ?? '';
    if (search) {
      const hits = await this.db.call<{ product_id: string; rank: number }[]>(
        'search_products',
        { p_query: search, p_limit: 200 },
      );
      if (!hits.length) return empty;
      ranks = new Map(hits.map((h) => [h.product_id, h.rank]));
      filtered = filtered.where('p.id', 'in', [...ranks.keys()]);
    }
    if (query.promo === '1') {
      filtered = filtered.where((eb) =>
        eb.exists(
          eb
            .selectFrom('product_discounts as d')
            .select('d.id')
            .whereRef('d.product_id', '=', 'p.id')
            .where('d.active', '=', true)
            .where('d.deleted_at', 'is', null),
        ),
      );
    }
    if (Number(query.price_min) > 0)
      filtered = filtered.where('p.base_price', '>=', Number(query.price_min));
    if (query.price_max && Number(query.price_max) < 1000)
      filtered = filtered.where('p.base_price', '<=', Number(query.price_max));
    const categoryIds = list('category_ids');
    if (categoryIds.length)
      filtered = filtered.where('p.category_id', 'in', categoryIds);
    const sizeIds = list('size_ids');
    const colorIds = list('color_ids');
    if (sizeIds.length || colorIds.length) {
      filtered = filtered.where((eb) => {
        let variants = eb
          .selectFrom('product_variants as v')
          .select('v.id')
          .whereRef('v.product_id', '=', 'p.id')
          .where('v.deleted_at', 'is', null);
        if (sizeIds.length)
          variants = variants.where('v.size_id', 'in', sizeIds);
        if (colorIds.length)
          variants = variants.where('v.color_id', 'in', colorIds);
        return eb.exists(variants);
      });
    }
    if (query.sort === 'new')
      filtered = filtered.where(
        'p.created_at',
        '>=',
        new Date(Date.now() - 30 * 86_400_000).toISOString(),
      );

    // A search without an explicit sort is ranked here; the matches are a few hundred at most.
    const byRelevance = ranks !== null && !query.sort;
    let rows = filtered
      .selectAll('p')
      .select((eb) =>
        many(
          eb,
          'product_images as i',
          [
            'i.id',
            'i.image_url',
            'i.alt_text',
            'i.is_main',
            'i.position',
            'i.variant_id',
          ],
          'i.product_id',
          'p.id',
          (q) => q.where('i.deleted_at', 'is', null),
        ).as('product_images'),
      );
    rows =
      query.sort === 'popular'
        ? rows
            .orderBy('p.sold_count', (ob) => ob.desc().nullsLast())
            .orderBy('p.created_at', 'desc')
        : rows.orderBy('p.created_at', 'desc');
    if (!byRelevance) rows = rows.limit(pageSize).offset((page - 1) * pageSize);

    const [found, count] = await Promise.all([
      rows.execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
    ]);
    let pageRows = found;
    if (byRelevance) {
      pageRows = [...found]
        .sort((a, b) => (ranks!.get(b.id) ?? 0) - (ranks!.get(a.id) ?? 0))
        .slice((page - 1) * pageSize, page * pageSize);
    }
    const discounts = await activeDiscounts(
      this.db,
      pageRows.map((p) => p.id),
    );
    return {
      rows: pageRows.map((p) => ({
        ...p,
        discount_percent: Number(discounts.get(p.id)?.discount_percent ?? 0),
      })),
      total: count.n,
    };
  }

  // ── Product page (lib/product-detail.ts) ──

  /** Everything the product page needs except reviews; null when the product isn't live. */
  @Get('product')
  async product(@Query('slug') slug = '') {
    const product = await this.liveProducts()
      .selectAll('p')
      .where('p.slug', '=', slug)
      .executeTakeFirst();
    if (!product) return null;
    const toImage = (img: {
      id: string;
      image_url: string;
      alt_text: string | null;
    }) => ({ id: img.id, url: img.image_url, alt: img.alt_text });
    const liveImages = () =>
      this.db
        .selectFrom('product_images')
        .selectAll()
        .where('product_id', '=', product.id)
        .where('deleted_at', 'is', null)
        .orderBy('position');

    const [images, variants, variantImages, discounts, similar, categories] =
      await Promise.all([
        liveImages().where('variant_id', 'is', null).execute(),
        this.db
          .selectFrom('product_variants as v')
          .selectAll('v')
          .select((eb) => [
            one(
              eb,
              'colors as c',
              ['c.id', 'c.name', 'c.hex_code', 'c.display_name'],
              'c.id',
              'v.color_id',
            ).as('colors'),
            one(
              eb,
              'sizes as s',
              ['s.id', 's.name', 's.display_name'],
              's.id',
              'v.size_id',
            ).as('sizes'),
          ])
          .where('v.product_id', '=', product.id)
          .where('v.deleted_at', 'is', null)
          .execute(),
        liveImages().where('variant_id', 'is not', null).execute(),
        activeDiscounts(this.db, [product.id]),
        product.category_id
          ? this.liveProducts()
              .selectAll('p')
              .select((eb) =>
                many(
                  eb,
                  'product_images as i',
                  [
                    'i.id',
                    'i.image_url',
                    'i.alt_text',
                    'i.is_main',
                    'i.position',
                    'i.variant_id',
                  ],
                  'i.product_id',
                  'p.id',
                  (q) => q.where('i.deleted_at', 'is', null),
                ).as('product_images'),
              )
              .where('p.category_id', '=', product.category_id)
              .where('p.id', '<>', product.id)
              .limit(4)
              .execute()
          : Promise.resolve([]),
        this.liveCategories()
          .select(['id', 'name', 'name_ar', 'name_fr', 'slug'])
          .orderBy('name')
          .execute(),
      ]);
    const similarDiscounts = await activeDiscounts(
      this.db,
      similar.map((p) => p.id),
    );

    return {
      product: {
        ...product,
        // Discounts live in product_discounts, not on the product row.
        discount_percent: Number(
          discounts.get(product.id)?.discount_percent ?? 0,
        ),
        product_images: images.map(toImage),
        product_variants: variants.map((v) => ({
          ...v,
          images: variantImages
            .filter((img) => img.variant_id === v.id)
            .map(toImage),
        })),
      },
      similarProducts: similar.map(({ product_images, ...p }) => {
        const gallery = (product_images as Image[])
          .filter((img) => !img.variant_id)
          .sort(
            (a, b) =>
              Number(b.is_main) - Number(a.is_main) ||
              (a.position ?? 0) - (b.position ?? 0),
          );
        return {
          ...p,
          image_url: gallery[0]?.image_url,
          discount_percent: Number(
            similarDiscounts.get(p.id)?.discount_percent ?? 0,
          ),
        };
      }),
      relatedCategories: categories
        .filter((c) => c.id !== product.category_id)
        .slice(0, 6),
    };
  }
}

/** /api/products/top and /promo: the same home lists, in their original { products } shape. */
@Controller('products')
@Public()
export class HomeListsController {
  private readonly storefront: StorefrontController;

  constructor(db: Database) {
    this.storefront = new StorefrontController(db);
  }

  @Get('top')
  async top() {
    return new Raw(await this.storefront.top());
  }

  @Get('promo')
  async promo() {
    return new Raw(await this.storefront.promo());
  }
}
