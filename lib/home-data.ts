import { cachedCatalogQuery } from '@/lib/catalog-cache';
import { storefront } from '@/lib/storefront-api';

/**
 * Home page data, loaded on the server from the Next.js data cache (tag "catalog")
 * so the sections render in the first HTML instead of fetching after hydration.
 * The data comes from the NestJS API (/api/storefront/*), which also serves
 * /api/products/top and /api/products/promo.
 */

const loadTopProducts = () => storefront<{ products: unknown[] }>('top');
const loadPromoProducts = () => storefront<{ products: unknown[] }>('promo');
const loadFeaturedCategories = () => storefront<any[]>('featured-categories');
const loadSaleBanners = () => storefront<any[]>('sale-banners');
const loadReels = () => storefront<any[]>('reels');
const loadLatestReviews = () => storefront<any[]>('latest-reviews');

export const getTopProducts = cachedCatalogQuery('top-products', loadTopProducts);
export const getPromoProducts = cachedCatalogQuery('promo-products', loadPromoProducts);
export const getFeaturedCategories = cachedCatalogQuery('featured-categories', loadFeaturedCategories);
export const getSaleBanners = cachedCatalogQuery('sale-banners', loadSaleBanners);
export const getReels = cachedCatalogQuery('reels', loadReels);
// Reviews posted by shoppers (/api/account/reviews) don't invalidate the catalog tag;
// the cache's 5-minute revalidate keeps it fresh enough for the home page.
export const getLatestReviews = cachedCatalogQuery('latest-reviews', loadLatestReviews);
