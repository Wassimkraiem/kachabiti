import type { MetadataRoute } from 'next'
import { cachedCatalogQuery, getCachedCategories } from '@/lib/catalog-cache'
import { storefront } from '@/lib/storefront-api'
import { absoluteUrl } from '@/lib/structured-data'
import { supportedLanguages, defaultLanguage } from '@/lib/language-utils'

// The public pages and every live category and product, once per language, each listing all
// languages as hreflang alternates (x-default: Arabic, the default).
const PAGES = ['', '/products', '/categories', '/about', '/contact', '/shipping', '/privacy', '/terms-and-conditions']

const liveProducts = cachedCatalogQuery('sitemap-products', async () => {
    const rows: { slug: string; updated_at?: string }[] = []
    for (let page = 1; ; page++) {
        const batch = await storefront<{ rows: { slug: string; updated_at?: string }[]; total: number }>(`products?page_size=100&page=${page}`)
        rows.push(...batch.rows.map(({ slug, updated_at }) => ({ slug, updated_at })))
        if (!batch.rows.length || rows.length >= batch.total) return rows
    }
})

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const [products, categories] = await Promise.all([
        liveProducts().catch(() => []),
        getCachedCategories().catch(() => []),
    ])
    const paths: [string, string?][] = [
        ...PAGES.map((p): [string] => [p]),
        ...categories.map((c): [string] => [`/categories/${encodeURIComponent(c.slug)}`]),
        ...products.map((p): [string, string?] => [`/products/${encodeURIComponent(p.slug)}`, p.updated_at]),
    ]
    return paths.flatMap(([path, lastModified]) => {
        const languages = Object.fromEntries(supportedLanguages.map((l) => [l, absoluteUrl(`/${l}${path}`)]))
        languages['x-default'] = languages[defaultLanguage]
        return supportedLanguages.map((l) => ({ url: languages[l], ...(lastModified && { lastModified }), alternates: { languages } }))
    })
}
