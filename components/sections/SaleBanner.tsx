"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import CountdownTimer from "../timers/CountdownTimer";
import { storefront } from '@/lib/storefront-api';
import { useParams } from "next/navigation";

const translations = {
    en: {
        shopNow: "Shop Now"
    },
    fr: {
        shopNow: "Acheter maintenant"
    },
    ar: {
        shopNow: "تسوق الآن"
    }
};

interface Promotion {
    id: string;
    title: string;
    subtitle: string | null;
    badge_text: string | null;
    discount_percent: number;
    image_url: string;
    starts_at: string | null;
    ends_at: string | null;
    active: boolean;
}

/**
 * Picks the banner to show: currently running promotions, preferring timed ones
 * (with an end date) over permanent ones; highest discount first (input order).
 */
function pickPromotion(promotions: Promotion[]): Promotion | null {
    const now = new Date();
    const running = promotions.filter((p) =>
        (!p.ends_at || new Date(p.ends_at) >= now) && (!p.starts_at || new Date(p.starts_at) <= now));
    return running.find((p) => p.ends_at && new Date(p.ends_at) > now) ?? running.find((p) => !p.ends_at) ?? null;
}

export default function SaleBanner({ initialPromotions }: { initialPromotions?: Promotion[] }) {
    const params = useParams();
    const locale = (params?.locale as string) || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    const [promotion, setPromotion] = useState<Promotion | null>(() => (initialPromotions ? pickPromotion(initialPromotions) : null));
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (initialPromotions) return;
        async function fetchPromotion() {
            try {
                setPromotion(pickPromotion(await storefront<any[]>('sale-banners')));
            } catch (error) {
                console.error('Error fetching promotion:', error);
            }
        }
        fetchPromotion();
    }, [initialPromotions]);

    // If no promotion is running, don't show anything
    if (!promotion) {
        return null;
    }

    // Banners without an end date are permanent (as the admin form describes) and show no countdown.
    const hasEndDate = Boolean(promotion.ends_at && new Date(promotion.ends_at) > new Date());

    return (
        <section className="w-full py-1 px-2 bg-[#ECE5DD] h-[400px]">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col lg:flex-row items-center gap-12">
                    {/* Left Content */}
                    <div className="flex-1 text-center lg:text-center">
                        <h2 className="text-5xl lg:text-6xl font-bold text-[#2b1a16] mb-4">
                            {promotion.title}
                            {promotion.discount_percent > 0 && (
                                <span className="text-[#842E1B]"> {promotion.discount_percent}%</span>
                            )}
                        </h2>

                        {promotion.subtitle && (
                            <p className=" text-gray-600 text-[16px] font-normal max-w-lg mb-8 mx-auto lg:mx-0">
                                {promotion.subtitle}
                            </p>
                        )}

                        {/* The countdown depends on the current time, so it renders only in the browser. */}
                        {hasEndDate && mounted && (
                            <div className="mb-8 flex justify-center lg:justify-center">
                                <CountdownTimer targetDate={new Date(promotion.ends_at!)} />
                            </div>
                        )}

                        <Link
                            href={`/${locale}/products`}
                            className="inline-block bg-[#842E1B] text-white px-12 py-4 rounded-[9px] text-lg font-semibold hover:bg-[#6b2516] transition-colors uppercase"
                        >
                            {t.shopNow}
                        </Link>
                    </div>

                    <div className="flex-1 relative w-full h-[360px] lg:h-[360px]">
                        <Image
                            src={promotion.image_url}
                            alt={promotion.title}
                            fill
                            className="object-contain"
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}


