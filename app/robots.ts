import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/structured-data'

// /api stays crawlable: category and listing pages load their products from it in the browser.
// Cart, checkout, account and sign-in pages aren't blocked here: they say noindex themselves
// (lib/page-metadata.ts), which Google only sees if it may crawl them.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/admin', '/api-docs'],
        },
        sitemap: absoluteUrl('/sitemap.xml'),
    }
}
