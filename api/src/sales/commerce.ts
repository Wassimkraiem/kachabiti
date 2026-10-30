import type { Kysely } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';

// Pricing, shipping, tax, discounts and manual order lines: ports of lib/order-pricing.ts,
// lib/shipping.ts, lib/get-site-settings.ts, lib/product-discounts.ts, lib/manual-order-lines.ts
// and lib/erp/team.ts. The checkout reads used the public client, so they apply the same filters
// the public RLS policies did (live, active rows only).

type Db = Kysely<DB>;

export interface Discount {
  product_id: string;
  discount_percent: number;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string | null;
}

export function isDiscountValid(
  discount: Discount | null | undefined,
): boolean {
  if (!discount?.active) return false;
  const now = new Date();
  if (discount.starts_at && now < new Date(discount.starts_at)) return false;
  if (discount.ends_at && now > new Date(discount.ends_at)) return false;
  return true;
}

/** The most recent valid discount per product. */
export async function activeDiscounts(
  db: Db,
  productIds: string[],
): Promise<Map<string, Discount>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('product_discounts')
    .select([
      'product_id',
      'discount_percent',
      'starts_at',
      'ends_at',
      'active',
      'created_at',
    ])
    .where('product_id', 'in', productIds)
    .where('active', '=', true)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
  const map = new Map<string, Discount>();
  for (const discount of rows.filter(isDiscountValid)) {
    if (!map.has(discount.product_id)) map.set(discount.product_id, discount);
  }
  return map;
}

// ── Site settings, shipping and tax ──

export interface SiteSettings {
  global_free_shipping_threshold: number;
  free_shipping_enabled: boolean;
  default_shipping_cost: number;
  shipping_tax_rate: number;
  general_tax_rate: number;
}

const DEFAULT_SETTINGS: SiteSettings = {
  global_free_shipping_threshold: 300,
  free_shipping_enabled: true,
  default_shipping_cost: 8,
  shipping_tax_rate: 0,
  general_tax_rate: 0.19,
};
let cachedSettings: { value: SiteSettings; at: number } | null = null;

/** Shipping and tax settings from site_settings, cached for 5 minutes. */
export async function siteSettings(db: Db): Promise<SiteSettings> {
  if (cachedSettings && Date.now() - cachedSettings.at < 5 * 60_000)
    return cachedSettings.value;
  try {
    const rows = await db
      .selectFrom('site_settings')
      .select(['setting_key', 'setting_value'])
      .where('setting_key', 'in', Object.keys(DEFAULT_SETTINGS))
      .execute();
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      const key = row.setting_key as keyof SiteSettings;
      if (key === 'free_shipping_enabled')
        settings[key] = row.setting_value === 'true';
      else settings[key] = parseFloat(row.setting_value) || 0;
    }
    cachedSettings = { value: settings, at: Date.now() };
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Checkout country name → code used by shipping_rates and country_tax_rates (unknown: Tunisia). */
export function countryCode(countryName: string): string {
  const mapping: Record<string, string> = {
    Tunisia: 'TN',
    Algeria: 'DZ',
    Morocco: 'MA',
    Libya: 'LY',
    Egypt: 'EG',
  };
  return mapping[countryName] || 'TN';
}

/** Shipping cost: the country's rate (or the default), free above the threshold when enabled. */
export async function calculateShipping(
  db: Db,
  code: string,
  subtotal: number,
  method: 'standard' | 'express' | 'overnight' = 'standard',
) {
  const settings = await siteSettings(db);
  const rate = await db
    .selectFrom('shipping_rates')
    .selectAll()
    .where('country_code', '=', code)
    .where('shipping_method', '=', method)
    .where('is_active', '=', true)
    .executeTakeFirst();
  const threshold =
    rate?.free_shipping_threshold ?? settings.global_free_shipping_threshold;
  const isFree = settings.free_shipping_enabled && subtotal > threshold;
  return {
    cost: isFree
      ? 0
      : Number(rate ? rate.base_rate : settings.default_shipping_cost),
    isFree,
    threshold,
  };
}

/** The usual delivery fee in Tunisia (before free shipping): the default on agents' orders and parcels. */
export async function deliveryFee(db: Db) {
  return (await calculateShipping(db, 'TN', 0)).cost;
}

/** Sets that fee for the checkout and the agents' forms alike (Tunisia's rate, and the fallback). */
export async function setDeliveryFee(db: Db, fee: number) {
  await db
    .updateTable('shipping_rates')
    .set({ base_rate: fee })
    .where('country_code', '=', 'TN')
    .where('shipping_method', '=', 'standard')
    .execute();
  await db
    .updateTable('site_settings')
    .set({ setting_value: String(fee) })
    .where('setting_key', '=', 'default_shipping_cost')
    .execute();
  cachedSettings = null;
}

export async function countryTaxRate(db: Db, code: string): Promise<number> {
  const row = await db
    .selectFrom('country_tax_rates')
    .select('tax_rate')
    .where('country_code', '=', code)
    .where('is_active', '=', true)
    .executeTakeFirst();
  return row ? Number(row.tax_rate) : (await siteSettings(db)).general_tax_rate;
}

// ── Checkout re-pricing ──

export type OrderPricingErrorCode =
  | 'PRODUCT_UNAVAILABLE'
  | 'PRICES_CHANGED'
  | 'TOTALS_CHANGED'
  | 'VARIANT_REQUIRED';

interface CartLine {
  id: string;
  variantId?: string | null;
  price: number;
  quantity: number;
}

const CENT = 0.01;
type Image = {
  image_url: string;
  is_main: boolean;
  position: number;
  variant_id: string | null;
};

/**
 * Unit prices the storefront can show for a product: the base or any live variant price, with
 * no discount or any valid one, rounded as the product pages round before adding to the cart.
 */
function allowedUnitPrices(
  basePrice: number,
  variantPrices: number[],
  discounts: Discount[],
): number[] {
  const percents = [
    0,
    ...discounts.filter(isDiscountValid).map((d) => Number(d.discount_percent)),
  ];
  return [basePrice, ...variantPrices].flatMap((price) =>
    percents.map((percent) => Math.round(price * (1 - percent / 100))),
  );
}

/** Re-prices a checkout so orders never store client-supplied amounts. */
export async function priceOrder(
  db: Db,
  lines: CartLine[],
  country: string | undefined,
  clientTotal: number,
) {
  const productIds = [...new Set(lines.map((line) => line.id))];
  const [productRows, allVariants, discountRows] = await Promise.all([
    db
      .selectFrom('products as p')
      .select([
        'p.id',
        'p.name',
        'p.name_ar',
        'p.name_fr',
        'p.base_price',
        'p.stock_tracked',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('product_images as i')
            .select(['i.image_url', 'i.is_main', 'i.position', 'i.variant_id'])
            .whereRef('i.product_id', '=', 'p.id')
            .where('i.deleted_at', 'is', null),
        ).as('product_images'),
      )
      .where('p.id', 'in', productIds)
      .where('p.deleted_at', 'is', null)
      .where('p.status', '=', 'active')
      .execute(),
    db
      .selectFrom('product_variants as v')
      .select(['v.id', 'v.product_id', 'v.price', 'v.stock', 'v.is_available'])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('colors as c')
            .select(['c.name', 'c.display_name'])
            .whereRef('c.id', '=', 'v.color_id'),
        ).as('colors'),
        jsonObjectFrom(
          eb
            .selectFrom('sizes as s')
            .select('s.name')
            .whereRef('s.id', '=', 'v.size_id'),
        ).as('sizes'),
      ])
      .where('v.product_id', 'in', productIds)
      .where('v.deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('product_discounts')
      .select([
        'product_id',
        'discount_percent',
        'starts_at',
        'ends_at',
        'active',
        'created_at',
      ])
      .where('product_id', 'in', productIds)
      .where('active', '=', true)
      .where('deleted_at', 'is', null)
      .execute(),
  ]);

  const basePrices = new Map<string, number>();
  const tracked = new Map<string, boolean>();
  const products = new Map<
    string,
    {
      name: string;
      name_ar: string | null;
      name_fr: string | null;
      image: string | null;
    }
  >();
  for (const p of productRows) {
    basePrices.set(p.id, Number(p.base_price));
    tracked.set(p.id, p.stock_tracked);
    const images = (p.product_images as Image[])
      .filter((img) => !img.variant_id)
      .sort(
        (a, b) =>
          Number(b.is_main) - Number(a.is_main) || a.position - b.position,
      );
    products.set(p.id, {
      name: p.name,
      name_ar: p.name_ar,
      name_fr: p.name_fr,
      image: images[0]?.image_url ?? null,
    });
  }
  const fail = (code: OrderPricingErrorCode) => ({ ok: false as const, code });
  if (productIds.some((id) => !products.has(id)))
    return fail('PRODUCT_UNAVAILABLE');

  const variants: ({ id: string; label: string } | null)[] = [];
  for (const line of lines) {
    const productVariants = allVariants.filter((v) => v.product_id === line.id);
    // Older carts have no variant: a product with a single variant can still be resolved.
    const variant = line.variantId
      ? productVariants.find((v) => v.id === line.variantId)
      : productVariants.length === 1
        ? productVariants[0]
        : undefined;
    if (line.variantId && (!variant || !variant.is_available))
      return fail('PRODUCT_UNAVAILABLE');
    if (!variant && tracked.get(line.id) && productVariants.length > 1)
      return fail('VARIANT_REQUIRED');

    // With a known variant only its own price counts; otherwise any live price of the product.
    const prices = variant
      ? []
      : productVariants
          .filter((v) => v.price !== null)
          .map((v) => Number(v.price));
    const base =
      variant?.price != null ? Number(variant.price) : basePrices.get(line.id)!;
    const allowed = allowedUnitPrices(
      base,
      prices,
      discountRows.filter((d) => d.product_id === line.id),
    );
    if (!allowed.some((price) => Math.abs(price - line.price) < CENT))
      return fail('PRICES_CHANGED');

    if (variant) {
      // No stock check: units beyond the stock are made to order ("sur commande").
      const color = variant.colors
        ? variant.colors.display_name || variant.colors.name
        : null;
      variants.push({
        id: variant.id,
        label: [color, variant.sizes?.name].filter(Boolean).join(' / '),
      });
    } else {
      variants.push(null);
    }
  }

  const subtotal = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );
  const code = countryCode(country || 'Tunisia');
  const [{ cost: shippingCost }, taxRate] = await Promise.all([
    calculateShipping(db, code, subtotal),
    countryTaxRate(db, code),
  ]);
  const tax = subtotal * taxRate;
  const total = subtotal + shippingCost + tax;
  if (Math.abs(total - clientTotal) >= CENT) return fail('TOTALS_CHANGED');
  return {
    ok: true as const,
    pricing: { products, variants, subtotal, shippingCost, tax, total },
  };
}

// ── Orders typed in by staff ──

/** A refusal to show the admin as is (unknown product, size/colour missing). */
export class ManualLineError extends Error {}

export interface ManualLineInput {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
}

/**
 * Priced lines in create_order's shape from the catalog (round(variant or base price × (1 −
 * discount%))), plus `stock`: units the online location holds, or null when not stock-tracked.
 */
export async function buildManualOrderLines(db: Db, input: ManualLineInput[]) {
  const productIds = [...new Set(input.map((line) => line.product_id))];
  const [productRows, variants, discounts] = await Promise.all([
    db
      .selectFrom('products as p')
      .select([
        'p.id',
        'p.name',
        'p.name_ar',
        'p.name_fr',
        'p.base_price',
        'p.stock_tracked',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('product_images as i')
            .select(['i.image_url', 'i.is_main', 'i.position', 'i.variant_id'])
            .whereRef('i.product_id', '=', 'p.id')
            .where('i.deleted_at', 'is', null),
        ).as('product_images'),
      )
      .where('p.id', 'in', productIds)
      .where('p.deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('product_variants as v')
      .select(['v.id', 'v.product_id', 'v.price', 'v.stock'])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('colors as c')
            .select(['c.name', 'c.display_name'])
            .whereRef('c.id', '=', 'v.color_id'),
        ).as('colors'),
        jsonObjectFrom(
          eb
            .selectFrom('sizes as s')
            .select('s.name')
            .whereRef('s.id', '=', 'v.size_id'),
        ).as('sizes'),
      ])
      .where('v.product_id', 'in', productIds)
      .where('v.deleted_at', 'is', null)
      .where('v.is_available', 'is not', false)
      .execute(),
    activeDiscounts(db, productIds),
  ]);
  const products = new Map(productRows.map((p) => [p.id, p]));

  return input.map((line) => {
    const product = products.get(line.product_id);
    if (!product)
      throw new ManualLineError('A selected product no longer exists');
    const productVariants = variants.filter((v) => v.product_id === product.id);
    const variant = line.variant_id
      ? productVariants.find((v) => v.id === line.variant_id)
      : undefined;
    if (line.variant_id && !variant)
      throw new ManualLineError(
        `The size/colour chosen for ${product.name} is no longer available`,
      );
    if (!variant && productVariants.length > 1)
      throw new ManualLineError(`Choose a size/colour for ${product.name}`);
    const chosen = variant ?? productVariants[0];

    const base =
      chosen?.price != null ? Number(chosen.price) : Number(product.base_price);
    const discount = Number(discounts.get(product.id)?.discount_percent ?? 0);
    const price = Math.round(
      discount > 0 && discount <= 100 ? base * (1 - discount / 100) : base,
    );
    // The variant's own photo first, then the product's main photo.
    const all = product.product_images as Image[];
    const firstOf = (images: Image[]) =>
      images.find((img) => img.is_main)?.image_url ||
      [...images].sort((a, b) => a.position - b.position)[0]?.image_url;
    const image =
      (chosen && firstOf(all.filter((img) => img.variant_id === chosen.id))) ||
      firstOf(all.filter((img) => !img.variant_id)) ||
      null;
    const label = chosen
      ? [chosen.colors?.display_name || chosen.colors?.name, chosen.sizes?.name]
          .filter(Boolean)
          .join(' / ')
      : '';

    return {
      product_id: product.id,
      variant_id: chosen?.id ?? null,
      variant_label: label || null,
      product_name: product.name,
      product_name_ar: product.name_ar,
      product_name_fr: product.name_fr,
      product_image: image,
      quantity: line.quantity,
      price,
      subtotal: price * line.quantity,
      stock: product.stock_tracked && chosen ? Number(chosen.stock) : null,
    };
  });
}

/** The e-mail of a back-office user, or null when they are not (or no longer) on the team. */
export async function memberEmail(
  db: Db,
  userId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('back_office_users')
    .select('email')
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row?.email ?? null;
}
