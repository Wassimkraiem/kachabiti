import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cachedCatalogQuery, getCachedCategories, getCachedProductDetail } from "@/lib/catalog-cache";
import { getProductName, getProductDescription } from "@/lib/utils/product-utils";
import type { SiteSettings } from "@/lib/get-site-settings";
import { storefront } from "@/lib/storefront-api";
import { SHOW_RATINGS } from "@/lib/config";
import { breadcrumbJsonLd, categoryTrail, productJsonLd } from "@/lib/structured-data";
import JsonLd from "@/components/JsonLd";
import ProductDetailClient from "./ProductDetailClient";

type Params = Promise<{ locale: string; slug: string }>;

// Product data comes from the Next.js data cache (tag "catalog", invalidated by admin edits),
// so opening a product is one server round trip instead of many browser queries.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { locale, slug } = await params;
    const detail = await getCachedProductDetail(slug);
    if (!detail) return {};
    const name = getProductName(detail.product, locale);
    const description = getProductDescription(detail.product, locale).replace(/\s+/g, ' ').trim().slice(0, 160) || name;
    const image = detail.product.product_images[0]?.url;
    return {
        title: `${name} | Kachabiti`,
        description,
        openGraph: { title: name, description, ...(image && { images: [image] }) },
        twitter: { title: name, description, ...(image && { images: [image] }) },
    };
}

export default async function ProductPage({ params }: { params: Params }) {
    const { locale, slug } = await params;
    const [initialData, settings, categories] = await Promise.all([
        getCachedProductDetail(slug),
        storefront<SiteSettings>('settings'),
        getCachedCategories().catch(() => []),
    ]);
    // A slug that isn't a live product is a real 404, not an empty page answered with 200.
    if (!initialData) notFound();
    // Ratings are marked up only while the page shows them (Google's review snippet rules).
    const productId = initialData.product.id;
    const reviews = SHOW_RATINGS
        ? await cachedCatalogQuery(`reviews-${productId}`, () => storefront<never[]>(`reviews?product_id=${productId}`))().catch(() => [])
        : [];
    // Same free-shipping threshold as checkout (site_settings), not the build-time env value.
    const freeShippingThreshold = settings.free_shipping_enabled ? settings.global_free_shipping_threshold : null;
    const product = initialData.product as typeof initialData.product & { slug: string };
    return (
        <>
            <JsonLd data={productJsonLd(initialData, locale, reviews)} />
            <JsonLd
                data={breadcrumbJsonLd([
                    ...categoryTrail(categories, product.category_id, locale),
                    { name: getProductName(product, locale), path: `/${locale}/products/${product.slug}` },
                ])}
            />
            <ProductDetailClient initialData={initialData} freeShippingThreshold={freeShippingThreshold} />
        </>
    );
}
