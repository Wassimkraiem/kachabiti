import type { Metadata } from "next";
import MobileTabBar from "@/components/layout/MobileTabBar";
import { LanguageProvider } from '@/lib/language-context';
import { isRTL } from '@/lib/language-utils';
import { CartProvider } from '@/lib/cart-context';
import CartDrawer from '@/components/cart/CartDrawer';
import TrafficSource from '@/components/layout/TrafficSource';
import StaticHeader from '@/components/layout/StaticHeader';
import Footer from '@/components/footer/Footer';
import { Suspense } from 'react';
import { headers } from "next/headers";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.kachabiti.com";

// Language-specific metadata
const metadataByLocale: Record<string, Metadata> = {
    en: {
        title: "Kachabiti | Handmade Tunisian Kachabia, Burnous & Traditional Clothing",
        description: "Handmade traditional Tunisian clothing: wool and cashmere kachabia, burnous, dengri, chechia and prayer qamis. Delivery across Tunisia, cash on delivery.",
    },
    fr: {
        title: "Kachabiti | Kachabia, burnous et habits traditionnels tunisiens faits main",
        description: "Habits traditionnels tunisiens faits main : kachabia en laine et cachemire, burnous, dengri, chéchia et qamis. Livraison partout en Tunisie, paiement à la livraison.",
    },
    ar: {
        title: "قشابيتي Kachabiti | قشابية، برنوس ولباس تقليدي تونسي",
        description: "لباس تقليدي تونسي مصنوع يدوياً: قشابية صوف وكشمير، برنوس، دنقري، شاشية وقميص صلاة. توصيل لكامل ولايات تونس والدفع عند الاستلام.",
    }
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const baseMetadata = metadataByLocale[locale] || metadataByLocale.en;
    const path = (await headers()).get("x-pathname") || `/${locale}`;

    return {
        ...baseMetadata,
        metadataBase: new URL(SITE_URL),
        authors: [{ name: "Kachabiti" }],
        creator: "Kachabiti",
        publisher: "Kachabiti",
        robots: {
            index: true,
            follow: true,
            googleBot: {
                index: true,
                follow: true,
                "max-video-preview": -1,
                "max-image-preview": "large",
                "max-snippet": -1,
            },
        },
        openGraph: {
            title: baseMetadata.title || "Kachabiti",
            description: baseMetadata.description || "Handcrafted Traditional Products",
            url: path,
            siteName: "Kachabiti",
            images: [
                {
                    url: "/assets/images/logoKachabity.jpg",
                    width: 1200,
                    height: 630,
                    alt: "Kachabiti - Handcrafted Traditional Products",
                },
            ],
            locale: locale === 'ar' ? 'ar_TN' : locale === 'fr' ? 'fr_TN' : 'en_US',
            type: "website",
        },
        twitter: {
            card: "summary_large_image",
            title: baseMetadata.title || "Kachabiti",
            description: baseMetadata.description || "Handcrafted Traditional Products",
            images: ["/assets/images/logoKachabity.jpg"],
        },
        // Each page's own address (the path without query), and the same page in the other languages.
        alternates: {
            canonical: path,
            languages: Object.fromEntries(
                ["en", "fr", "ar", "x-default"].map((l) => [l, path.replace(/^\/(en|fr|ar)(?=\/|$)/, `/${l === "x-default" ? "ar" : l}`)])
            ),
        },
    };
}

export default async function LocaleLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params || { locale: 'ar' };

    return (
        <LanguageProvider locale={locale}>
            <CartProvider>
                {/* Header and footer live here so they stay mounted across navigations
                    (no refetching categories/session or re-rendering them on every page). */}
                <Suspense>
                    <StaticHeader />
                </Suspense>
                {/* Page content and footer follow the locale's direction (Arabic is right-to-left). */}
                <div dir={isRTL(locale) ? "rtl" : "ltr"}>
                    {children}
                    <Footer />
                </div>
                <MobileTabBar locale={locale} />
                <CartDrawer />
                <TrafficSource />
            </CartProvider>
        </LanguageProvider>
    );
}
