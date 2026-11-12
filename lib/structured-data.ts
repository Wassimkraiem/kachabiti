import { getCategoryName, getProductDescription, getProductName } from '@/lib/utils/product-utils';
import type { ProductDetailData } from '@/lib/product-detail';
import { headerConfig } from '@/lib/config';

/**
 * schema.org JSON-LD for the storefront (rendered by components/JsonLd.tsx in the server HTML, as
 * Google asks for Product markup). Only what the page shows: no ratings while reviews are hidden.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.kachabiti.com').replace(/\/$/, '');
export const BRAND = 'Kachabiti';
const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export const absoluteUrl = (path: string) => new URL(path, `${SITE_URL}/`).toString();

/** Organization + WebSite, for the home page. */
export function siteJsonLd(locale: string) {
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Organization',
                '@id': ORGANIZATION_ID,
                name: BRAND,
                alternateName: ['Kachabity', 'قشابيتي'],
                url: SITE_URL,
                logo: absoluteUrl('/assets/images/logoKachabity.jpg'),
                description: 'Handcrafted traditional Tunisian clothing: kachabia, burnous, dengri, chechia.',
                address: { '@type': 'PostalAddress', addressLocality: 'Khniss', addressRegion: 'Monastir', addressCountry: 'TN' },
                contactPoint: {
                    '@type': 'ContactPoint',
                    telephone: headerConfig.contact.phone.replace(/\s+/g, ''),
                    contactType: 'customer service',
                    areaServed: 'TN',
                    availableLanguage: ['ar', 'fr', 'en'],
                },
                sameAs: Object.values(headerConfig.social).map((s) => s.url),
            },
            {
                '@type': 'WebSite',
                '@id': `${SITE_URL}/#website`,
                name: BRAND,
                alternateName: 'Kachabity',
                url: `${SITE_URL}/${locale}`,
                inLanguage: locale,
                publisher: { '@id': ORGANIZATION_ID },
            },
        ],
    };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: absoluteUrl(item.path) })),
    };
}

interface CategoryRow { id: string; slug: string; name: string; name_ar?: string | null; name_fr?: string | null; parent_id?: string | null }

/** Home › parent categories › category, as breadcrumb items. */
export function categoryTrail(categories: CategoryRow[], categoryId: string | null | undefined, locale: string) {
    const HOME: Record<string, string> = { ar: 'الرئيسية', fr: 'Accueil', en: 'Home' };
    const trail: { name: string; path: string }[] = [];
    const seen = new Set<string>();
    for (let c = categories.find((x) => x.id === categoryId); c && !seen.has(c.id); c = categories.find((x) => x.id === c!.parent_id)) {
        seen.add(c.id);
        trail.unshift({ name: getCategoryName(c, locale), path: `/${locale}/categories/${c.slug}` });
    }
    return [{ name: HOME[locale] ?? HOME.en, path: `/${locale}` }, ...trail];
}

interface Review { rating: number; comment?: string | null; created_at: string; user_name?: string | null; users?: { name?: string | null } | null }

/**
 * Product with its offer as the product page shows it: unit price = round((variant price or base
 * price) × (1 − active discount %)), in TND; in stock when stock isn't tracked or a variant has
 * some, otherwise made to order (every product stays orderable).
 */
export function productJsonLd(detail: ProductDetailData, locale: string, reviews: Review[] = []) {
    const p = detail.product as ProductDetailData['product'] & {
        slug: string; code?: string | null; base_price: number; currency?: string | null; stock?: number | null; stock_tracked?: boolean;
    };
    const variants = (p.product_variants as { price?: number | null; stock?: number | null; is_available?: boolean; images: { url: string }[] }[])
        .filter((v) => v.is_available !== false);
    const discount = Number(p.discount_percent) || 0;
    const prices = (variants.length ? variants.map((v) => v.price || p.base_price) : [p.base_price])
        .map((price) => Math.round(Number(price) * (1 - discount / 100)));
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const inStock = !p.stock_tracked || (variants.length ? variants.some((v) => (v.stock ?? 0) > 0) : (p.stock ?? 0) > 0);
    const url = absoluteUrl(`/${locale}/products/${p.slug}`);
    const images = [...new Set([...p.product_images, ...variants.flatMap((v) => v.images)].map((img) => img.url).filter(Boolean))]
        .slice(0, 10)
        .map(absoluteUrl);
    const common = {
        priceCurrency: p.currency || 'TND',
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/MadeToOrder',
        itemCondition: 'https://schema.org/NewCondition',
        url,
        seller: { '@id': ORGANIZATION_ID, '@type': 'Organization', name: BRAND },
    };
    const offers = low === high
        ? { '@type': 'Offer', price: low, ...common }
        : { '@type': 'AggregateOffer', lowPrice: low, highPrice: high, offerCount: prices.length, ...common };

    const named = reviews.filter((r) => r.users?.name || r.user_name);
    const description = getProductDescription(p, locale).trim();
    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${url}#product`,
        name: getProductName(p, locale),
        ...(description && { description: description.slice(0, 5000) }),
        ...(images.length && { image: images }),
        ...(p.code && { sku: p.code, productID: p.code }),
        brand: { '@type': 'Brand', name: BRAND },
        url,
        offers,
        ...(reviews.length && {
            aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10,
                reviewCount: reviews.length,
                bestRating: 5,
                worstRating: 1,
            },
        }),
        ...(named.length && {
            review: named.slice(0, 5).map((r) => ({
                '@type': 'Review',
                author: { '@type': 'Person', name: r.users?.name || r.user_name },
                datePublished: r.created_at.slice(0, 10),
                reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
                ...(r.comment && { reviewBody: r.comment }),
            })),
        }),
    };
}
