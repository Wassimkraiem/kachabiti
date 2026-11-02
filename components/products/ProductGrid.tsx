"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { getCategories } from "@/lib/categories-cache";
import Link from "next/link";

interface Category {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    image_url?: string;
    sort_order: number;
    is_featured?: boolean;
}

// Helper function to get translated category name
function getCategoryName(category: Category, locale: string): string {
    if (locale === 'ar' && category.name_ar) {
        return category.name_ar;
    }
    if (locale === 'fr' && category.name_fr) {
        return category.name_fr;
    }
    return category.name;
}

interface ProductGridProps {
    locale?: string;
    /** Server-loaded categories (cached); when given, the section renders in the first HTML. */
    initialCategories?: Category[];
}

const translations = {
    en: {
        featuredCategories: "Featured Categories",
        browseCategories: "Browse through some of our most popular categories",
        seeMoreCategories: "See More Categories"
    },
    fr: {
        featuredCategories: "Catégories en vedette",
        browseCategories: "Parcourez certaines de nos catégories les plus populaires",
        seeMoreCategories: "Voir plus de catégories"
    },
    ar: {
        featuredCategories: "الفئات المميزة",
        browseCategories: "تصفح بعض فئاتنا الأكثر شعبية",
        seeMoreCategories: "عرض المزيد من الفئات"
    }
};

export default function ProductGrid({ locale = 'en', initialCategories }: ProductGridProps) {
    const [categories, setCategories] = useState<Category[]>(initialCategories ?? []);
    const [mounted, setMounted] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const t = translations[locale as keyof typeof translations] || translations.en;

    // Prevent hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        async function fetchCategories() {
            try {
                const data = (await getCategories()).filter((category) => category.is_featured);

                if (data) {
                    setCategories(data);
                }
            } catch (error) {
                console.error('Error fetching categories:', error);
                // Set empty array on error to prevent UI issues
                setCategories([]);
            }
        }

        if (!initialCategories) fetchCategories();
    }, [initialCategories]);

    // Check scroll position to enable/disable buttons
    const checkScrollPosition = () => {
        if (scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            setCanScrollLeft(container.scrollLeft > 0);
            setCanScrollRight(
                container.scrollLeft < container.scrollWidth - container.clientWidth - 10
            );
        }
    };

    useEffect(() => {
        if (!mounted) return;

        checkScrollPosition();
        const container = scrollContainerRef.current;
        if (container) {
            container.addEventListener('scroll', checkScrollPosition);
            window.addEventListener('resize', checkScrollPosition);
            return () => {
                container.removeEventListener('scroll', checkScrollPosition);
                window.removeEventListener('resize', checkScrollPosition);
            };
        }
    }, [categories, mounted]);

    const handlePrev = () => {
        if (scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const scrollAmount = 240; // Card width (224px) + gap (16px)
            container.scrollBy({
                left: -scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    const handleNext = () => {
        if (scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const scrollAmount = 240; // Card width (224px) + gap (16px)
            container.scrollBy({
                left: scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    return (
        <section className="w-full py-12 px-4 bg-white">
            {/* Decorative Flower */}
            <div className="z-9 absolute right-0 top-310 w-64 h-64  pointer-events-none">
                <Image
                    src="/assets/images/flowerFloated.svg"
                    alt="Decorative flower"
                    fill
                    className="object-contain"
                />
            </div>

            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-[#2b1a16] mb-2">
                        {t.featuredCategories}
                    </h2>
                    <p className="text-gray-500 text-sm">
                        {t.browseCategories}
                    </p>
                </div>

                {/* Carousel Container */}
                <div className="relative">
                    {/* Categories Grid */}
                    <div
                        ref={scrollContainerRef}
                        className="overflow-x-auto scrollbar-hide"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {categories.length === 0 ? (
                            <div className="flex gap-4 pb-4">
                                {/* Loading skeleton */}
                                {[1, 2, 3, 4, 5, 6].map((i) => (
                                    <div key={i} className="w-56 flex flex-col items-center">
                                        <div className="w-56 h-68 rounded-2xl bg-gray-200 animate-pulse mb-3" />
                                        <div className="w-32 h-4 bg-gray-200 animate-pulse rounded" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex gap-4 pb-4" style={{ width: 'max-content' }}>
                                {categories.map((category) => (
                                    <Link
                                        key={category.id}
                                        href={`/${locale}/products?category=${category.slug}`}
                                        className="group"
                                    >
                                        <div className="w-56 flex flex-col items-center">
                                            <div className="relative w-56 h-68 rounded-2xl overflow-hidden mb-3 shadow-md group-hover:shadow-xl transition-shadow">
                                                <Image
                                                    src={category.image_url || "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300"}
                                                    alt={getCategoryName(category, locale) || "Category image"}
                                                    fill
                                                    sizes="224px"
                                                    className="object-cover object-top group-hover:scale-105 transition-transform duration-300"
                                                />
                                            </div>
                                            <h3 className="text-center font-medium text-[#2b1a16] text-base group-hover:text-[#7a3b2e] transition">
                                                {getCategoryName(category, locale)}
                                            </h3>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Navigation Buttons - Only show when mounted and has content */}
                    {mounted && categories.length > 0 && (
                        <>
                            {/* Previous Button */}
                            {canScrollLeft && (
                                <button
                                    onClick={handlePrev}
                                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition"
                                    aria-label="Previous"
                                >
                                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                            )}

                            {/* Next Button */}
                            {canScrollRight && (
                                <button
                                    onClick={handleNext}
                                    className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition"
                                    aria-label="Next"
                                >
                                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* See More Categories Link */}
                {mounted && categories.length > 0 && (
                    <div className="text-center mt-8">
                        <Link
                            href={`/${locale}/categories`}
                            className="text-[#842E1B] font-medium hover:underline inline-flex items-center gap-2"
                        >
                            {t.seeMoreCategories}
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </Link>
                    </div>
                )}
            </div>

            <style jsx>{`
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
            `}</style>
        </section>
    );
}
