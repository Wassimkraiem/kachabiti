import Link from "next/link";
import HeroPiece from "./HeroPiece";
import { isRTL } from "@/lib/language-utils";
import type { LandingProduct } from "@/lib/landing-products";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";

const translations = {
    en: {
        giant: "Kachabia",
        title: "Kachabia, burnous and dengri, made in Tunisia",
        intro: "Wool pieces woven by Tunisian artisans and delivered to your door. You pay when your order arrives.",
        shopCollection: "Shop the collection",
        allProducts: "See all products",
        cashOnDelivery: "Cash on delivery",
        freeDelivery: (amount: number) => `Free delivery above ${amount} ${CURRENCY}`,
        band: ["Wool that keeps you warm", "all winter long"],
    },
    fr: {
        giant: "Kachabia",
        title: "Kachabia, burnous et dengri, faits en Tunisie",
        intro: "Des pièces en laine tissées par des artisans tunisiens et livrées chez vous. Vous payez à la réception de votre commande.",
        shopCollection: "Voir la collection",
        allProducts: "Tous les produits",
        cashOnDelivery: "Paiement à la livraison",
        freeDelivery: (amount: number) => `Livraison offerte dès ${amount} ${CURRENCY}`,
        band: ["La laine qui vous tient chaud", "tout l'hiver"],
    },
    ar: {
        giant: "قشابية",
        title: "قشابية، برنوس ودنقري، صُنعت في تونس",
        intro: "قطع من الصوف ينسجها حرفيون تونسيون وتصلك إلى باب منزلك. تدفع عند استلام طلبك.",
        shopCollection: "تسوّق المجموعة",
        allProducts: "كل المنتجات",
        cashOnDelivery: "الدفع عند الاستلام",
        freeDelivery: (amount: number) => `توصيل مجاني للطلبات التي تتجاوز ${amount} ${CURRENCY}`,
        band: ["صوف يمنحك الدفء", "طوال الشتاء"],
    },
};

interface ProductShowcaseProps {
    locale: string;
    /** Products of the hero fan, the centre one first. */
    products: LandingProduct[];
    collectionSlug: string | null;
    freeShippingThreshold: number | null;
}

// Home hero: a giant faded word, a fan of arched product photos with their names and
// prices, the heading and two buttons, then the moving text band.
export default function ProductShowcase({ locale, products, collectionSlug, freeShippingThreshold }: ProductShowcaseProps) {
    const t = translations[locale as keyof typeof translations] || translations.en;
    const pieces = products.filter((product) => product.image);
    if (pieces.length === 0) return null;
    const rtl = isRTL(locale);
    const collectionHref = collectionSlug
        ? `/${locale}/products?category=${collectionSlug}`
        : `/${locale}/products`;
    const bandText = `${t.band[0]} · ${t.band[1]} · `;

    return (
        <section dir={rtl ? "rtl" : "ltr"} className="relative isolate w-full overflow-hidden bg-surface">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 grid select-none place-items-center pb-[10vh] font-display text-[min(38vw,56vh)] font-bold leading-none text-ink/[0.06]"
            >
                {t.giant}
            </div>

            <div className="mx-auto grid max-w-7xl items-center gap-6 px-4 pt-6 pb-10 lg:min-h-[calc(100svh-72px-5rem)] lg:grid-cols-[2fr_3fr] lg:gap-8 lg:py-10">
                <div className="landing-fade order-2 text-center lg:order-1 lg:text-start">
                    <h1 className="font-display text-3xl font-bold leading-[1.3] text-ink sm:text-5xl sm:leading-[1.25]">
                        {t.title}
                    </h1>
                    <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-mute sm:text-lg lg:mx-0">
                        {t.intro}
                    </p>

                    <div className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start">
                        <Link href={collectionHref} className="pill pill-solid">{t.shopCollection}</Link>
                        <Link href={`/${locale}/products`} className="pill">{t.allProducts}</Link>
                    </div>

                    <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-mute lg:justify-start">
                        <li className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                            {t.cashOnDelivery}
                        </li>
                        {freeShippingThreshold !== null && (
                            <li className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                                {t.freeDelivery(freeShippingThreshold)}
                            </li>
                        )}
                    </ul>
                </div>

                <div className="order-1 flex justify-center lg:order-2">
                    <HeroPiece products={pieces} locale={locale} />
                </div>
            </div>

            {/* Moving text band: the text is repeated so the loop has no seam. */}
            <div
                aria-hidden="true"
                className="overflow-hidden border-y border-line py-3 font-display text-2xl font-bold text-accent/70 sm:text-3xl"
                style={{ "--band-shift": rtl ? "50%" : "-50%" } as React.CSSProperties}
            >
                <div className="band-line whitespace-pre">
                    <span>{bandText.repeat(6)}</span>
                    <span>{bandText.repeat(6)}</span>
                </div>
            </div>
        </section>
    );
}
