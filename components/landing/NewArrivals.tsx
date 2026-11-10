import Link from "next/link";
import { isRTL } from "@/lib/language-utils";
import ScrollTrack from "@/components/ui/ScrollTrack";
import type { LandingProduct } from "@/lib/landing-products";
import LandingProductCard from "./LandingProductCard";

const translations = {
    en: {
        title: "New in the shop",
        subtitle: "The latest pieces we've added, photographed in our shop.",
        seeAll: "See all products",
    },
    fr: {
        title: "Nouveautés",
        subtitle: "Les dernières pièces arrivées, photographiées dans notre boutique.",
        seeAll: "Voir tous les produits",
    },
    ar: {
        title: "وصل حديثاً",
        subtitle: "آخر القطع التي أضفناها، مصوّرة في متجرنا.",
        seeAll: "عرض كل المنتجات",
    },
};

interface NewArrivalsProps {
    locale: string;
    products: LandingProduct[];
}

export default function NewArrivals({ locale, products }: NewArrivalsProps) {
    if (products.length < 3) return null;
    const t = translations[locale as keyof typeof translations] || translations.en;

    return (
        <ScrollTrack
            rtl={isRTL(locale)}
            className="bg-surface"
            header={
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="text-start">
                        <h2 className="font-display text-3xl font-bold text-ink sm:text-5xl">{t.title}</h2>
                        <p className="mt-2 text-mute">{t.subtitle}</p>
                    </div>
                    <Link href={`/${locale}/products`} className="pill">{t.seeAll}</Link>
                </div>
            }
        >
            {products.map((product) => (
                <div key={product.id} className="track-card">
                    <LandingProductCard product={product} locale={locale} sizes="300px" />
                </div>
            ))}
            {/* The track ends on the way to the whole catalog. */}
            <Link
                href={`/${locale}/products`}
                className="track-card arch group flex aspect-[3/4] items-center justify-center self-start border border-line bg-card p-6 text-center font-display text-2xl font-bold text-ink transition-colors hover:border-accent hover:text-accent"
            >
                {t.seeAll}
            </Link>
        </ScrollTrack>
    );
}
