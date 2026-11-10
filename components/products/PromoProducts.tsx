"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import PromoProductCard from "./PromoProductCard";
import type { PromoProduct } from "@/types/product";

const translations = {
    en: {
        promotionalProducts: "Promotional Products",
        limitedTimeOffers: "Limited time offers on our best products",
        // scrollToSeeMore: "Scroll to see more",
        seeAll: "See All"
    },
    fr: {
        promotionalProducts: "Produits promotionnels",
        limitedTimeOffers: "Offres à durée limitée sur nos meilleurs produits",
        // scrollToSeeMore: "Faites défiler pour voir plus",
        seeAll: "Voir tout"
    },
    ar: {
        promotionalProducts: "المنتجات الترويجية",
        limitedTimeOffers: "عروض محدودة على أفضل منتجاتنا",
        // scrollToSeeMore: "قم بالتمرير لرؤية المزيد",
        seeAll: "عرض الكل"
    }
};

interface PromoProductsProps {
    locale?: string;
    /** Server-loaded products (cached); when given, the section renders in the first HTML. */
    initialProducts?: PromoProduct[];
}

export default function PromoProducts({ locale = 'en', initialProducts }: PromoProductsProps) {
    const [products, setProducts] = useState<PromoProduct[]>(initialProducts ?? []);
    const [isLoading, setIsLoading] = useState(!initialProducts);
    const [mounted, setMounted] = useState(false);
    const t = translations[locale as keyof typeof translations] || translations.en;

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        async function fetchPromoProducts() {
            try {
                setIsLoading(true);
                const response = await fetch('/api/products/promo', {
                    cache: 'no-store', // Prevent caching
                });

                if (!response.ok) {
                    console.error('❌ Response not OK:', response.status, response.statusText);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                setProducts(data.products || []);
            } catch (error) {
                console.error('❌ Error fetching promo products:', error);
                setProducts([]);
            } finally {
                setIsLoading(false);
            }
        }

        if (mounted && !initialProducts) {
            fetchPromoProducts();
        }
    }, [mounted, initialProducts]);

    return (
        <>  
       { products.length >0 && <section className="w-full py-16 px-4 bg-card">
            <div className="max-w-7xl 2xl:max-w-[1581px] mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <h2 className="text-4xl font-bold text-ink mb-2">
                        {t.promotionalProducts}
                    </h2>
                    <p className="text-mute text-sm mb-4">
                        {t.limitedTimeOffers}
                    </p>
                    <Image
                        src="/assets/images/highlight.svg"
                        alt="Decorative"
                        height={100}
                        width={150}
                        className="mx-auto block"
                    />
                </div>

                {/* Products Slider */}
                {isLoading ? (
                    <div className="flex gap-6 overflow-x-auto overflow-y-hidden pb-4 snap-x snap-mandatory scrollbar-hide">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-card rounded-2xl border border-line overflow-hidden animate-pulse shrink-0 w-[80%] md:w-[45%] lg:w-[400px] xl:w-[490px] 2xl:w-[500px] snap-start">
                                <div className="h-64 bg-line" />
                                <div className="p-6 space-y-4">
                                    <div className="h-6 bg-line rounded w-3/4" />
                                    <div className="h-8 bg-line rounded w-1/2" />
                                    <div className="h-4 bg-line rounded w-full" />
                                    <div className="h-12 bg-line rounded w-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                )  : (
                    <>
                        <div className="flex gap-6 overflow-x-auto overflow-y-hidden pb-4 snap-x snap-mandatory scrollbar-hide">
                            {products.map((product) => (
                                <div key={product.id} className="shrink-0 w-[80%] md:w-[45%] lg:w-[500px] xl:w-[490px] 2xl:w-[500px] snap-start">
                                    <PromoProductCard
                                        product={product}
                                        locale={locale}
                                        categorySlug="all"
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Scroll Indicator */}
                        {/* {products.length == 3 && (
                            <div className="flex justify-center items-center gap-2 mt-2 text-sm text-mute">
                                <svg className="w-5 h-5 animate-bounce-x" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                                <span>{t.scrollToSeeMore}</span>
                            </div>
                        )} */}
                    </>
                )}

                {products.length > 3 && (
                    <div className="text-center mt-4">
                        <Link
                            href={`/${locale}/products?promo=true`}
                            className="text-accent font-medium hover:underline inline-flex items-center gap-2"
                        >
                            {t.seeAll}
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </Link>
                    </div>
                )}
            </div>
        </section>}
        </>
       
    );
}

