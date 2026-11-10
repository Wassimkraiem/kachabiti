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
import { reemKufi } from '@/lib/fonts';
import Script from "next/script";

// Language-specific metadata
const metadataByLocale: Record<string, Metadata> = {
    en: {
        title: "Kachabity - Handcrafted Traditional Products | Premium Quality",
        description: "Discover authentic handcrafted traditional products at Kachabiti. Premium quality HBarnous ROSSINI, Serviette de table, and unique handmade items. 100% authentic craftsmanship.",
        keywords: "handcrafted, traditional products, HBarnous ROSSINI, Serviette de table, artisan, handmade, premium quality, Tunisia, traditional wear, home accessories",
    },
    fr: {
        title: "Kachabity - Produits Traditionnels Artisanaux | Qualité Premium",
        description: "Découvrez des produits traditionnels artisanaux authentiques chez Artisan par Kraiem. Qualité premium HBarnous ROSSINI, Serviette de table et articles uniques faits main. 100% artisanat authentique.",
        keywords: "artisanal, produits traditionnels, HBarnous ROSSINI, Serviette de table, artisan, fait main, qualité premium, Tunisie, vêtements traditionnels, accessoires maison",
    },
    ar: {
        title: "Kachabity - منتجات تقليدية حرفية | جودة ممتازة",
        description: "اكتشف المنتجات التقليدية الحرفية الأصيلة في حرفي من قبل كريم. جودة ممتازة حبرنوس روسيني، مناديل المائدة، وقطع فريدة مصنوعة يدوياً. 100% حرفية أصيلة.",
        keywords: "حرفي, منتجات تقليدية, حبرنوس روسيني, مناديل المائدة, حرفي, مصنوع يدوياً, جودة ممتازة, تونس, ملابس تقليدية, إكسسوارات منزلية",
    }
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const baseMetadata = metadataByLocale[locale] || metadataByLocale.en;

    return {
        ...baseMetadata,
        metadataBase: new URL("https://your-ecommerce-site.com"),
        authors: [{ name: "Kachabity" }],
        creator: "Kachabity",
        publisher: "Kachabity",
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
            url: "https://your-ecommerce-site.com",
            siteName: "Kachabiti",
            images: [
                {
                    url: "https://your-ecommerce-site.com/og-image.jpg",
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
            images: ["https://your-ecommerce-site.com/twitter-image.jpg"],
        },
        alternates: {
            canonical: "https://your-ecommerce-site.com",
            languages: {
                'en': 'https://your-ecommerce-site.com/en',
                'fr': 'https://your-ecommerce-site.com/fr',
                'ar': 'https://your-ecommerce-site.com/ar',
            },
        },
        verification: {
            google: "your-google-verification-code",
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
              <div className={`storefront ${reemKufi.variable}`}>
                {/* Without JavaScript nothing adds .is-in, so show revealed content at once. */}
                <noscript><style>{`.reveal{opacity:1;transform:none}`}</style></noscript>
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
                <Script
                    id="json-ld-organization"
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "Organization",
                            "name": "Kachabiti",
                            "url": "https://your-ecommerce-site.com",
                            "logo": "https://your-ecommerce-site.com/logo.png",
                            "contactPoint": {
                                "@type": "ContactPoint",
                                "telephone": "+216-55-558-648",
                                "contactType": "Customer Service"
                            },
                            "sameAs": [
                                "https://www.facebook.com/profile.php?id=61562718525332",
                                "https://www.instagram.com/kachabitii/",
                                "https://www.tiktok.com/@kachabitii"
                            ],
                            "address": {
                                "@type": "PostalAddress",
                                "streetAddress": "123 Artisan Street",
                                "addressLocality": "Tunis",
                                "addressRegion": "Tunis",
                                "postalCode": "1000",
                                "addressCountry": "TN"
                            }
                        })
                    }}
                />
              </div>
            </CartProvider>
        </LanguageProvider>
    );
}
