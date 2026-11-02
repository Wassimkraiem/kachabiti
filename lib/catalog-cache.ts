import { unstable_cache, revalidateTag } from 'next/cache';
import { loadProductDetail } from '@/lib/product-detail';

/**
 * Server-side Next.js data cache for public catalog reads.
 *
 * Every entry is tagged `catalog`, and admin API mutations call invalidateCatalog(), so
 * edits show up immediately while shoppers are served from the cache. The time-based
 * revalidate is only a safety net for writes that bypass the API (e.g. the WooCommerce
 * importer or direct database edits).
 */
export const CATALOG_TAG = 'catalog';
const REVALIDATE_SECONDS = 300;

export const getCachedProductDetail = unstable_cache(
    async (slug: string) => loadProductDetail(slug),
    ['product-detail'],
    { tags: [CATALOG_TAG], revalidate: REVALIDATE_SECONDS }
);

/** Wraps a loader so its result is cached under the catalog tag. */
export function cachedCatalogQuery<T>(key: string, loader: () => Promise<T>) {
    return unstable_cache(loader, [key], { tags: [CATALOG_TAG], revalidate: REVALIDATE_SECONDS });
}

export function invalidateCatalog() {
    revalidateTag(CATALOG_TAG);
}
