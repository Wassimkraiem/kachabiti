import type { Metadata } from "next";
import { getCachedProductDetail } from "@/lib/catalog-cache";
import { getProductName, getProductDescription } from "@/lib/utils/product-utils";
import type { SiteSettings } from "@/lib/get-site-settings";
import { storefront } from "@/lib/storefront-api";
import ProductDetailClient from "./ProductDetailClient";

type Params = Promise<{ locale: string; slug: string }>;

// Product data comes from the Next.js data cache (tag "catalog", invalidated by admin edits),
// so opening a product is one server round trip instead of many browser queries.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { locale, slug } = await params;
    const detail = await getCachedProductDetail(slug);
    if (!detail) return {};
    const description = getProductDescription(detail.product, locale).slice(0, 160);
    const image = detail.product.product_images[0]?.url;
    return {
        title: `${getProductName(detail.product, locale)} | Kachabity`,
        description,
        openGraph: image ? { images: [image] } : undefined,
    };
}

export default async function ProductPage({ params }: { params: Params }) {
    const { slug } = await params;
    const [initialData, settings] = await Promise.all([getCachedProductDetail(slug), storefront<SiteSettings>('settings')]);
    // Same free-shipping threshold as checkout (site_settings), not the build-time env value.
    const freeShippingThreshold = settings.free_shipping_enabled ? settings.global_free_shipping_threshold : null;
    return <ProductDetailClient initialData={initialData} freeShippingThreshold={freeShippingThreshold} />;
}
