"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isRTL } from "@/lib/language-utils";

type HeroData = {
    id: string;
    title: string;
    title_ar?: string;
    title_fr?: string;
    subtitle?: string;
    subtitle_ar?: string;
    subtitle_fr?: string;
    sub_subtitle?: string;
    sub_subtitle_ar?: string;
    sub_subtitle_fr?: string;
    left_image_url?: string;
    cta_label?: string;
    cta_label_ar?: string;
    cta_label_fr?: string;
    cta_href?: string;
    image_url?: string;
    background_image_url?: string; // Separate background image
    bg_color?: string; // Background color (e.g., 'bg-pink-100', '#ACDEE6')
    text_color?: string; // Text color for better contrast
    is_active: boolean;
    sort_order: number;
};

// Common translations mapping (fallback only - database columns are primary)
// This provides automatic translation for common terms until database columns are populated
const commonTranslations: Record<string, Record<string, string>> = {
    'Shop Now': { ar: 'تسوق الآن', fr: 'Acheter maintenant' },
    'Buy Now': { ar: 'اشتري الآن', fr: 'Acheter maintenant' },
    'Order Now': { ar: 'اطلب الآن', fr: 'Commander maintenant' },
    'Handmade': { ar: 'مصنوع يدوياً', fr: 'Fait main' },
    'Premium Quality': { ar: 'جودة عالية', fr: 'Qualité supérieure' },
    'Traditional Elegance': { ar: 'أناقة تقليدية', fr: 'Élégance traditionnelle' },
    'Top Saled': { ar: 'الأكثر مبيعاً', fr: 'Les plus vendus' },
    'Top Sold': { ar: 'الأكثر مبيعاً', fr: 'Les plus vendus' },
    'New Arrival': { ar: 'وصل حديثاً', fr: 'Nouveautés' },
    'Big deal': { ar: 'عرض كبير', fr: 'Grosse affaire' },
    'Big Deal': { ar: 'عرض كبير', fr: 'Grosse affaire' },
    'New': { ar: 'جديد', fr: 'Nouveau' },
    'Quachabia': { ar: 'قشّابية', fr: 'Qachabiya' },
    'Qachabiya': { ar: 'قشّابية', fr: 'Qachabiya' }
};

/**
 * Get translated text for hero sections
 * Priority: 1. Database columns (title_ar, subtitle_ar, etc.) - RECOMMENDED
 *           2. Common translations mapping (fallback for common terms)
 *           3. Original English text
 * 
 * @param text - Original English text from database
 * @param textAr - Arabic translation from database column (if exists)
 * @param textFr - French translation from database column (if exists)
 * @param locale - Current locale ('en', 'fr', 'ar')
 * @returns Translated text based on priority
 */
function getHeroText(text: string | undefined, textAr: string | undefined, textFr: string | undefined, locale: string): string {
    if (!text) return '';

    // PRIORITY 1: Database translation columns (RECOMMENDED APPROACH)
    // These are edited in the admin and allow for custom, language-specific content
    if (locale === 'ar' && textAr) return textAr;
    if (locale === 'fr' && textFr) return textFr;

    // PRIORITY 2: Common translations mapping (fallback)
    // Provides automatic translation for common terms until database columns are populated
    const common = commonTranslations[text];
    if (common) {
        if (locale === 'ar' && common.ar) return common.ar;
        if (locale === 'fr' && common.fr) return common.fr;
    }

    // PRIORITY 3: Fallback to original text
    return text;
}

type SmallCardData = {
    id: string;
    title: string;
    subtitle: string;
    image_url: string;
    bg_color: string;
    background_image_url?: string; // Optional background image
    text_color?: string; // Custom text color
    is_active: boolean;
    sort_order: number;
};

type HeroSectionProps = {
    heroData: HeroData[];
    smallCardsData: SmallCardData[];
};

const translations = {
    en: {
        where: "Where",
        tradition: "Tradition",
        meets: "Meets",
        elegance: "Elegance",
        loading: "Loading...",
        bigDeal: "Big deal",
        new: "New"
    },
    fr: {
        where: "Où",
        tradition: "Tradition",
        meets: "Rencontre",
        elegance: "Élégance",
        loading: "Chargement...",
        bigDeal: "Grosse affaire",
        new: "Nouveau"
    },
    ar: {
        where: "حيث",
        tradition: "التقليد",
        meets: "يلتقي",
        elegance: "الأناقة",
        loading: "جاري التحميل...",
        bigDeal: "عرض كبير",
        new: "جديد"
    }
};

export default function HeroSection({ heroData, smallCardsData }: HeroSectionProps) {
    const router = useRouter()
    const pathname = usePathname();
    const [currentSlide, setCurrentSlide] = useState(0);
    const [mounted, setMounted] = useState(false);

    // Detect locale from pathname
    const locale = pathname?.split('/')[1] || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    const rtl = isRTL(locale);

    // Prevent hydration mismatch by only rendering carousel after mount
    useEffect(() => {
        setMounted(true);
    }, []);

    // NEW STRUCTURE:
    // sort_order 0-1: Right promotional cards (fixed - always 2 cards)
    // sort_order 2: Left sidebar card
    // sort_order 3+: Carousel slides (infinite - add as many as you want)

    const rightCards = heroData.filter(h => h.sort_order === 0 || h.sort_order === 1).sort((a, b) => a.sort_order - b.sort_order);
    const leftCard = heroData.find(h => h.sort_order === 2)
    const carouselSlides = heroData.filter(h => h.sort_order >= 3).sort((a, b) => a.sort_order - b.sort_order);

    const currentSlideData = carouselSlides[currentSlide];

    useEffect(() => {
        if (!mounted || carouselSlides.length === 0) return;

        const interval = setInterval(() => {
            setCurrentSlide((prev) => (prev + 1) % carouselSlides.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [carouselSlides.length, mounted]);

    const nextSlide = () => {
        setCurrentSlide((prev) => (prev + 1) % carouselSlides.length);
    };

    const prevSlide = () => {
        setCurrentSlide((prev) => (prev - 1 + carouselSlides.length) % carouselSlides.length);
    };

    const goToSlide = (index: number) => {
        setCurrentSlide(index);
    };


    return (
        <section className="w-full py-8 px-4" aria-label="Featured Products" >
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-2">
                        <div
                            className="relative rounded-2xl px-3 py-9 h-[500px] flex flex-col justify-between items-center overflow-hidden"
                            style={{ backgroundColor: leftCard?.bg_color || '#ACDEE6' }}
                        >
                            {/* Background Image (optional) */}
                            {leftCard?.background_image_url && (
                                <div className="absolute inset-0">
                                    <Image
                                        src={leftCard.background_image_url}
                                        alt="Background"
                                        fill
                                        className="object-cover"
                                    />
                                    {/* Overlay for text readability */}
                                    <div className="absolute inset-0 bg-black/20"></div>
                                </div>
                            )}

                            {/* Content */}
                            <div className='relative z-10 justify-between items-center flex flex-col align-baseline'>
                                <div className="text-sm font-medium mb-2" style={{ color: leftCard?.text_color || 'inherit' }}>{t.where}</div>
                                <div className="text-[16px] font-bold text-black mb-2" style={{ color: leftCard?.text_color || 'inherit' }}>{t.tradition}</div>
                                <div className="text-[16px] font-semimedium text-black mb-2" style={{ color: leftCard?.text_color || 'inherit' }}>{t.meets}</div>
                                <div className="text-[16px] font-medium text-black mb-2" style={{ color: leftCard?.text_color || 'inherit' }}>{t.elegance}</div>
                            </div>

                            {leftCard?.left_image_url && (
                                <div className="relative z-10 flex justify-center">
                                    <div className="relative w-32 h-32">
                                        <Image
                                            src={leftCard.left_image_url}
                                            alt={`${leftCard.title || ''} - Premium handcrafted traditional product`}
                                            fill
                                            className="object-cover rounded-lg"
                                        />
                                    </div>
                                </div>
                            )}

                            {leftCard?.cta_label && (
                                <button
                                    onClick={() => router.push('/products')}
                                    className="relative z-10 bg-white cursor-pointer text-[#2b1a16] px-2 py-2 rounded-[8px] text-sm font-medium hover:bg-gray-50 transition"
                                >
                                    {getHeroText(leftCard.cta_label, leftCard.cta_label_ar, leftCard.cta_label_fr, locale)}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="lg:col-span-7 relative">
                        <div className="relative rounded-2xl overflow-hidden h-[350px]">
                            {/* Background Image - Use background_image_url if available, otherwise use image_url */}
                            <div className="absolute inset-0"
                            >
                                {(currentSlideData?.background_image_url || currentSlideData?.image_url) && (
                                    <Image
                                        src={(currentSlideData.background_image_url || currentSlideData.image_url)!}
                                        alt="Background"
                                        fill
                                        className="object-cover"
                                        priority
                                    />
                                )}
                                {/* Overlay for better text readability */}
                                <div className="absolute inset-0 bg-linear-to-r from-[#F4D3C6]/95 via-[#F4D3C6]/60 to-transparent"></div>
                            </div>

                            {/* Carousel slides are hero_sections rows with sort_order >= 3. */}
                            {!mounted ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-gray-400">{t.loading}</div>
                                </div>
                            ) : !currentSlideData ? null : (
                                <div className="absolute inset-0 flex items-center p-8 pb-0">
                                    <div className="flex-1 z-10">
                                        <div className="text-sm text-[#000000] font-medium mb-2">
                                            {getHeroText(currentSlideData.title, currentSlideData.title_ar, currentSlideData.title_fr, locale)}
                                        </div>
                                        <h1 className="text-[36px]  font-semibold text-[#000000] mb-2">
                                            {getHeroText(currentSlideData.subtitle, currentSlideData.subtitle_ar, currentSlideData.subtitle_fr, locale)}
                                        </h1>
                                        <div className="text-sm text-[#000000] font-medium mb-5">
                                            {getHeroText(currentSlideData.sub_subtitle, currentSlideData.sub_subtitle_ar, currentSlideData.sub_subtitle_fr, locale)}
                                        </div>

                                        <button
                                            onClick={() => router.push(currentSlideData.cta_href || '/products')}
                                            className="bg-[#7a3b2e] text-white px-3 py-2 rounded-[8px] border border-black text-lg font-medium hover:bg-[#5e2d23] transition cursor-pointer"
                                        >
                                            {getHeroText(currentSlideData.cta_label, currentSlideData.cta_label_ar, currentSlideData.cta_label_fr, locale)}
                                        </button>
                                    </div>
                                    {/* Product/Person Image (with transparent background) */}
                                    {currentSlideData?.image_url && <div className="flex-1 flex justify-end items-end">
                                        <div className="relative w-[300px] h-[350px]">
                                            <Image
                                                src={currentSlideData.image_url || "/vercel.svg"}
                                                alt={`${currentSlideData.subtitle} - Premium handcrafted traditional product`}
                                                fill
                                                className="object-contain object-bottom"
                                                priority
                                            />
                                        </div>
                                    </div>}
                                </div>
                            )}
                            {mounted && carouselSlides.length > 0 && (
                                <>
                                    <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex space-x-2">
                                        {carouselSlides.map((_, index) => (
                                            <button
                                                key={index}
                                                onClick={() => goToSlide(index)}
                                                className={`w-2 h-2 rounded-full transition ${index === currentSlide ? 'bg-white' : 'bg-gray-300'
                                                    }`}
                                            />
                                        ))}
                                    </div>
                                    <button
                                        onClick={prevSlide}
                                        className="cursor-pointer absolute right-16 top-6    p-2 transition"
                                    >
                                        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={nextSlide}
                                        className="cursor-pointer absolute right-6 top-6    p-2 transition"
                                    >
                                        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                </>
                            )}


                        </div>

                        {/* Small Cards Under Carousel */}
                        <div className="mt-6 grid grid-cols-3 gap-4">
                            {smallCardsData.slice(0, 3).map((card) => (
                                <div
                                    key={card.id}
                                    className="relative rounded-2xl p-4 h-32 flex flex-col justify-between hover:shadow-md transition overflow-hidden"
                                    style={{ backgroundColor: card.bg_color }}
                                >
                                    {/* Background Image (optional) */}
                                    {card.background_image_url && (
                                        <div className="absolute inset-0">
                                            <Image
                                                src={card.background_image_url}
                                                alt="Background"
                                                fill
                                                className="object-cover"
                                            />
                                            {/* Light overlay for text readability */}
                                            {<div className="absolute inset-0 bg-white/50"></div>}
                                        </div>
                                    )}

                                    {/* Content */}
                                    <div className="flex-1 flex flex-col justify-center relative z-10">
                                        <h3
                                            className="text-sm font-bold mb-1"
                                            style={{ color: card.text_color || '#2b1a16' }}
                                        >
                                            {card.title}
                                        </h3>
                                        <p
                                            className="text-xs"
                                            style={{ color: card.text_color ? `${card.text_color}CC` : '#6b4e45' }}
                                        >
                                            {card.subtitle}
                                        </p>
                                    </div>
                                    {card.image_url && <div className="flex justify-center relative z-10">
                                        <div className="relative w-12 h-12">
                                            <Image
                                                src={card.image_url}
                                                alt={card.title}
                                                fill
                                                className="object-cover rounded-lg"
                                            />
                                        </div>
                                    </div>}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="lg:col-span-3 space-y-4">
                        {rightCards.map((card, index) => (
                            <div
                                key={card.id || index}
                                onClick={() => router.push(card.cta_href || '/products')}
                                className="relative rounded-2xl p-6 h-[167px] flex items-center cursor-pointer hover:shadow-lg transition-shadow overflow-hidden"
                            // style={{ backgroundColor: card.bg_color || (index === 0 ? '#FDE0E6' : '#D4F4DD') }}

                            >
                                {/* Background Image (optional) */}
                                {card.background_image_url && (
                                    <div className="absolute inset-0" style={{ backgroundColor: card.bg_color || (index === 0 ? '#FDE0E6' : '#D4F4DD') }}>
                                        <Image
                                            src={card.background_image_url}
                                            alt="Background"
                                            fill
                                            className="object-cover"
                                        />
                                        {/* Overlay for text readability */}
                                        <div className="absolute inset-0 bg-white/60"></div>
                                    </div>
                                )}

                                {/* Content */}
                                <div className="flex-1 relative z-10">
                                    <div className="text-sm text-[#7a3b2e] font-medium mb-1" style={{ color: card.text_color || '#7a3b2e' }}>
                                        {getHeroText(card.title, card.title_ar, card.title_fr, locale) || (index === 0 ? t.bigDeal : t.new)}
                                    </div>
                                    <h3 className="text-lg font-bold text-[#2b1a16] mb-2" style={{ color: card.text_color || '#2b1a16' }}>
                                        {getHeroText(card.subtitle, card.subtitle_ar, card.subtitle_fr, locale)}
                                    </h3>
                                    <p className="text-[#6b4e45] mb-4 text-sm" style={{ color: card.text_color ? `${card.text_color}99` : '#6b4e45' }}>
                                        {getHeroText(card.sub_subtitle, card.sub_subtitle_ar, card.sub_subtitle_fr, locale)}
                                    </p>
                                </div>

                                {/* Product Image */}
                                {card.image_url && (
                                    <div className="w-20 h-20 relative z-10">
                                        <Image
                                            src={card.image_url}
                                            alt={card.subtitle || card.title || "Product"}
                                            fill
                                            className="object-cover rounded-lg"
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                        <div className="grid grid-cols-2 gap-4 h-[167px]">
                            {smallCardsData.slice(3, 5).map((card) => (
                                <div
                                    key={card.id}
                                    className="relative rounded-2xl p-4 flex flex-col justify-between hover:shadow-md transition h-32 overflow-hidden"
                                    style={{ backgroundColor: card.bg_color }}
                                >
                                    {/* Background Image (optional) */}
                                    {card.background_image_url && (
                                        <div className="absolute inset-0">
                                            <Image
                                                src={card.background_image_url}
                                                alt="Background"
                                                fill
                                                className="object-cover"
                                            />
                                            {/* Light overlay for text readability */}
                                            <div className="absolute inset-0 bg-white/50"></div>
                                        </div>
                                    )}

                                    {/* Content */}
                                    <div className="flex-1 flex flex-col justify-center relative z-10">
                                        <h3
                                            className="text-lg font-bold mb-1"
                                            style={{ color: card.text_color || '#2b1a16' }}
                                        >
                                            {card.title}
                                        </h3>
                                        <p
                                            className="text-sm"
                                            style={{ color: card.text_color ? `${card.text_color}CC` : '#6b4e45' }}
                                        >
                                            {card.subtitle}
                                        </p>
                                    </div>
                                    {card.image_url && <div className="flex justify-center relative z-10">
                                        <div className="relative w-12 h-12">
                                            <Image
                                                src={card.image_url}
                                                alt={card.title}
                                                fill
                                                className="object-cover rounded-lg"
                                            />
                                        </div>
                                    </div>}
                                </div>
                            ))}

                        </div>

                    </div>

                </div>
            </div>
        </section>
    );
}
