import Link from "next/link";
import { isRTL } from "@/lib/language-utils";
import ScrollTrack from "@/components/ui/ScrollTrack";
import type { SpotlightCollection } from "@/lib/landing-products";
import LandingProductCard from "./LandingProductCard";

const translations = {
    en: {
        count: (n: number) => `${n} pieces in this collection, the largest in our shop. Pick a style:`,
        viewCollection: "Shop the whole collection",
    },
    fr: {
        count: (n: number) => `${n} pièces dans cette collection, la plus complète de la boutique. Choisissez un style :`,
        viewCollection: "Voir toute la collection",
    },
    ar: {
        count: (n: number) => `${n} قطعة في هذه المجموعة، الأكبر في متجرنا. اختر الطراز:`,
        viewCollection: "تسوّق المجموعة كاملة",
    },
};

interface CollectionSpotlightProps {
    locale: string;
    collection: SpotlightCollection | null;
}

export default function CollectionSpotlight({ locale, collection }: CollectionSpotlightProps) {
    if (!collection || collection.products.length < 3) return null;
    const t = translations[locale as keyof typeof translations] || translations.en;
    const categoryHref = (slug: string) => `/${locale}/products?category=${slug}`;

    return (
        <ScrollTrack
            rtl={isRTL(locale)}
            className="border-y border-line bg-card text-ink"
            header={
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 text-start">
                    <div className="min-w-0">
                        <h2 className="font-display text-4xl font-bold leading-tight text-ink sm:text-6xl">{collection.name}</h2>
                        <p className="mt-2 hidden max-w-xl text-mute sm:block">{t.count(collection.productCount)}</p>
                        {collection.subcategories.length > 0 && (
                            <ul className="scrollbar-hide mt-3 flex gap-2 overflow-x-auto">
                                {collection.subcategories.map((sub) => (
                                    <li key={sub.slug} className="shrink-0">
                                        <Link
                                            href={categoryHref(sub.slug)}
                                            className="block rounded-full border border-line px-3.5 py-1.5 text-sm transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                        >
                                            {sub.name}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <Link href={categoryHref(collection.slug)} className="pill pill-solid">{t.viewCollection}</Link>
                </div>
            }
        >
            {collection.products.map((product) => (
                <div key={product.id} className="track-card">
                    <LandingProductCard product={product} locale={locale} sizes="300px" />
                </div>
            ))}
        </ScrollTrack>
    );
}
