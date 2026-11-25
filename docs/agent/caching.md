# Caching and performance

Moved verbatim from CLAUDE.md so it loads only when needed. Keep it accurate when you change this area.

### Caching and performance

- **Next.js data cache.** `lib/catalog-cache.ts` wraps public catalog reads in `unstable_cache` with the `catalog` tag and a 5-minute safety revalidate. It covers the product page (`getCachedProductDetail`, from the loader in `lib/product-detail.ts`) and all home page data. The home loaders in `lib/home-data.ts` (featured categories, top and promo products, sale banners, reels, latest reviews) plus the landing and hero data are loaded in `app/[locale]/page.tsx` and passed to the sections as `initial*` props, so they render in the first HTML. Keep new home sections on this pattern instead of fetching in `useEffect` behind a `mounted` flag. `/api/products/top` and `/promo` serve the same cached loaders.
- **Invalidation.** Every admin mutation route (products, variants, product-images, promotions, categories, colors, sizes, sale-banners, stock movements and tracking) calls `invalidateCatalog()` before returning success. **New admin write routes must do the same**, or the storefront serves stale data. Writes that bypass the API (the importer, direct database edits) show up after at most 5 minutes.
- **Product page.** `app/[locale]/products/[slug]/page.tsx` is a server component that passes cached data to `ProductDetailClient.tsx`. It only fetches reviews client-side.
- **Header and footer** are rendered once in `app/[locale]/layout.tsx`. Don't add `<StaticHeader />` or `<Footer />` to pages.
- **Browser-side caching.** `lib/categories-cache.ts` shares the category list across pages. `next.config.ts` sets `staleTimes` so the client router cache makes revisits instant.
- **Admin lists** use `GET /api/products?admin=true&view=summary` (no variants, about 50 KB). The full payload is about 1 MB, so use it only for a single product (`?id=`). Orders and Delivery page, filter, search and sort on the server (`GET /api/orders`, `GET /api/delivery?page=`). Without `page`, `/api/delivery` still sends every parcel: only Admin → Colissimo account needs that.
- **Middleware auth** verifies the `kb_access` JWT locally with `AUTH_SECRET`: no network call, except one refresh every 15 minutes per session.
- `next dev` roughly doubles API calls (React Strict Mode effects) and compiles pages on demand, so judge performance on a production build.
- **Reporting functions and JIT.** Postgres's JIT compiler can take seconds on a big reporting query that runs in milliseconds, and indexes don't help: `owner_overview` spent 7.6 of its 8 seconds compiling, so it has `set jit = off`. If a function is slow, profile it with `auto_explain` (`log_nested_statements`) and look at the plan's `JIT:` timing before adding indexes.
