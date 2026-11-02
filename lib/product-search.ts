/**
 * Product search, shared by the header suggestions and the products page (GET /api/storefront/products?search=).
 *
 * Matching and ranking happen in Postgres (public.search_products): names, descriptions,
 * code and category names in all three languages, accent- and Arabic-spelling-insensitive,
 * every word required in any order, with a fallback to similar spellings for typos.
 */

export const MIN_SEARCH_LENGTH = 2;
