import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/structured-data'

// /api stays crawlable: category and listing pages load their products from it in the browser.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/admin', '/api-docs', '/*/cart', '/*/checkout', '/*/order-confirmation', '/*/settings', '/*/auth'],
        },
        sitemap: absoluteUrl('/sitemap.xml'),
    }
}
