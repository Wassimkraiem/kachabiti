"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useCarousel } from "@/hooks/useCarousel";

const translations = {
    en: {
        services: [
            {
                title: "Fastest Delivery",
                description: "Order and Receive in 1 day"
            },
            {
                title: "Anima Wallet",
                description: "Earn loyalty points for every order"
            },
            {
                title: "24/7 Online Support",
                description: "Get advice from our pet professionals"
            },
            {
                title: "Customers Trusted",
                description: "5 star reviews from customers"
            }
        ]
    },
    fr: {
        services: [
            {
                title: "Livraison la plus rapide",
                description: "Commandez et recevez en 1 jour"
            },
            {
                title: "Portefeuille Anima",
                description: "Gagnez des points de fidélité pour chaque commande"
            },
            {
                title: "Support en ligne 24/7",
                description: "Obtenez des conseils de nos professionnels"
            },
            {
                title: "Clients de confiance",
                description: "Avis 5 étoiles de nos clients"
            }
        ]
    },
    ar: {
        services: [
            {
                title: "أسرع توصيل",
                description: "اطلب واستلم في يوم واحد"
            },
            {
                title: "محفظة أنيما",
                description: "اكسب نقاط الولاء لكل طلب"
            },
            {
                title: "دعم على الإنترنت 24/7",
                description: "احصل على نصائح من محترفينا"
            },
            {
                title: "عملاء موثوقون",
                description: "تقييمات 5 نجوم من العملاء"
            }
        ]
    }
};

const serviceIcons = [
    "/assets/images/icons/support.svg",
    "/assets/images/icons/wallet.svg",
    "/assets/images/icons/delivery.svg",
    "/assets/images/icons/chat.svg"
];

export default function ServiceHighlights() {
    const params = useParams();
    const locale = (params?.locale as string) || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    const services = t.services.map((service, index) => ({
        ...service,
        icon: serviceIcons[index]
    }));
    const [mounted, setMounted] = useState(false);

    // Carousel for mobile (1 item per slide)
    const {
        currentSlide,
        totalSlides,
        nextSlide,
        goToSlide,
    } = useCarousel({
        totalItems: services.length,
        itemsPerSlide: 1
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    // Auto-advance carousel on mobile
    useEffect(() => {
        if (!mounted || services.length === 0) return;

        const interval = setInterval(() => {
            nextSlide();
        }, 4000); // Change slide every 4 seconds

        return () => clearInterval(interval);
    }, [mounted, services.length, nextSlide]);

    if (!mounted) {
        return null;
    }

    return (
        <section className="w-full py-2 px-1 bg-surface sm:bg-card">
            <div className="max-w-7xl mx-auto">
                {/* Desktop: Show all services in a row */}
                <div className="hidden sm:flex items-center justify-between gap-8">
                    {/* Service Items */}
                    <div className="flex items-center gap-12 flex-1 justify-center">
                        {services.map((service, index) => (
                            <div key={index} className="flex items-center gap-3">
                                <div className="shrink-0">
                                    <div className="w-12 h-12 flex items-center justify-center">
                                        <Image
                                            src={service.icon}
                                            alt={service.title}
                                            width={40}
                                            height={40}
                                            className="object-contain"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col text-accent">
                                    <h3 className="text-sm font-semibold">
                                        {service.title}
                                    </h3>
                                    <p className="text-xs opacity-70 text-mute">
                                        {service.description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Support Button */}
                    <button
                        className="shrink-0 w-14 h-14 bg-accent hover:bg-accent-hover rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-110"
                        aria-label="Chat Support"
                    >
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 .97 4.29L2 22l5.71-.97C9 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.38 0-2.68-.31-3.86-.85l-.28-.13-2.82.48.48-2.82-.13-.28C4.31 14.68 4 13.38 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8zm4-9h-3V8c0-.55-.45-1-1-1s-1 .45-1 1v3H8c-.55 0-1 .45-1 1s.45 1 1 1h3v3c0 .55.45 1 1 1s1-.45 1-1v-3h3c.55 0 1-.45 1-1s-.45-1-1-1z" />
                        </svg>
                    </button>
                </div>

                {/* Mobile: Slider with one service at a time */}
                <div className="sm:hidden">
                    <div className="relative overflow-hidden">
                        <div
                            className="flex transition-transform duration-500 ease-in-out"
                            style={{ transform: `translateX(-${currentSlide * 100}%)` }}
                        >
                            {services.map((service, index) => (
                                <div
                                    key={index}
                                    className="w-full shrink-0 flex items-center justify-center gap-3 px-4 py-3"
                                >
                                    <div className="shrink-0">
                                        <div className="w-12 h-12 flex items-center justify-center">
                                            <Image
                                                src={service.icon}
                                                alt={service.title}
                                                width={40}
                                                height={40}
                                                className="object-contain"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-col text-accent">
                                        <h3 className="text-sm font-semibold">
                                            {service.title}
                                        </h3>
                                        <p className="text-xs opacity-70 text-mute">
                                            {service.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Pagination Dots */}
                    <div className="flex justify-center gap-2 mt-2 pb-2">
                        {Array.from({ length: totalSlides }).map((_, index) => (
                            <button
                                key={index}
                                onClick={() => goToSlide(index)}
                                className={`w-2 h-2 rounded-full transition-colors ${currentSlide === index
                                    ? 'bg-accent'
                                    : 'bg-surface'
                                    }`}
                                aria-label={`Go to slide ${index + 1}`}
                                aria-current={currentSlide === index ? "true" : "false"}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
