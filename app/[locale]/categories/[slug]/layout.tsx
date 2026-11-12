import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedCategories } from "@/lib/catalog-cache";
import { getCategoryName } from "@/lib/utils/product-utils";
import { breadcrumbJsonLd, categoryTrail } from "@/lib/structured-data";
import JsonLd from "@/components/JsonLd";

// The category page itself renders in the browser; its title, description, breadcrumb markup and
// 404 for unknown slugs come from here, in the server HTML.
type Params = Promise<{ locale: string; slug: string }>;

const TAGLINE: Record<string, (name: string) => string> = {
    ar: (name) => `${name} تونسية تقليدية مصنوعة يدوياً. توصيل لكامل ولايات تونس والدفع عند الاستلام.`,
    fr: (name) => `${name} : artisanat tunisien traditionnel fait main. Livraison partout en Tunisie, paiement à la livraison.`,
    en: (name) => `${name}: traditional handmade Tunisian craft. Delivery across Tunisia, cash on delivery.`,
};

async function findCategory(slug: string) {
    const categories = await getCachedCategories();
    let decoded = slug;
    try {
        decoded = decodeURIComponent(slug);
    } catch {
        // as typed
    }
    return { categories, category: categories.find((c) => c.slug === decoded) };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { locale, slug } = await params;
    const { category } = await findCategory(slug);
    if (!category) return {};
    const name = getCategoryName(category, locale);
    const description = (TAGLINE[locale] ?? TAGLINE.en)(name);
    return { title: `${name} | Kachabiti`, description, openGraph: { title: name, description }, twitter: { title: name, description } };
}

export default async function CategoryLayout({ children, params }: { children: React.ReactNode; params: Params }) {
    const { locale, slug } = await params;
    const { categories, category } = await findCategory(slug);
    if (!category) notFound();
    return (
        <>
            <JsonLd data={breadcrumbJsonLd(categoryTrail(categories, category.id, locale))} />
            {children}
        </>
    );
}
