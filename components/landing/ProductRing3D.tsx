"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LandingProduct } from "@/lib/landing-products";
import type { RingScene } from "./ring-scene";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";

const translations = {
    en: { previous: "Previous product", next: "Next product", hint: "Drag to turn" },
    fr: { previous: "Produit précédent", next: "Produit suivant", hint: "Faites glisser pour tourner" },
    ar: { previous: "المنتج السابق", next: "المنتج التالي", hint: "اسحب للتدوير" },
};

interface ProductRing3DProps {
    locale: string;
    products: LandingProduct[];
    /** Static photos shown until the 3D scene is ready, and instead of it when 3D is off. */
    children: ReactNode;
    /** Positions the ring; it fills this box (the header background). */
    className?: string;
}

// Served through the Next.js image optimizer: same origin (no CORS for WebGL) and a
// 640px copy instead of the full-size upload.
function textureUrl(src: string) {
    return `/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`;
}

function canUse3D() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if ((navigator.hardwareConcurrency || 4) < 4) return false;
    try {
        const canvas = document.createElement("canvas");
        return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
        return false;
    }
}

export default function ProductRing3D({ locale, products, children, className = "" }: ProductRing3DProps) {
    const t = translations[locale as keyof typeof translations] || translations.en;
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<RingScene | null>(null);
    const [ready, setReady] = useState(false);
    const [front, setFront] = useState(0);
    const [showHint, setShowHint] = useState(true);

    const items = products.filter((p) => p.image);
    const itemKey = items.map((p) => p.id).join(",");

    useEffect(() => {
        const container = containerRef.current;
        if (!container || items.length < 4 || !canUse3D()) return;

        let cancelled = false;
        import("./ring-scene")
            .then(({ createRingScene }) => {
                if (cancelled) return;
                sceneRef.current = createRingScene(
                    container,
                    items.map((p) => ({ imageUrl: textureUrl(p.image as string) })),
                    {
                        direction: locale === "ar" ? "rtl" : "ltr",
                        onReady: () => setReady(true),
                        onFrontChange: setFront,
                        onSelect: (index) => router.push(`/${locale}/products/${items[index].slug}`),
                        onInteract: () => setShowHint(false),
                    }
                );
            })
            .catch((error) => console.error("3D showcase unavailable:", error));

        return () => {
            cancelled = true;
            sceneRef.current?.dispose();
            sceneRef.current = null;
            setReady(false);
        };
        // items is derived from products; itemKey tracks its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemKey, locale, router]);

    const current = items[front];

    return (
        <div className={className}>
            <div className={`h-full w-full ${ready ? "invisible" : ""}`} aria-hidden="true">
                {children}
            </div>

            <div
                ref={containerRef}
                aria-hidden="true"
                className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "pointer-events-none opacity-0"}`}
            />

            {ready && current && (
                <div className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex flex-col items-center gap-2 lg:ps-[32%]">
                    {showHint && (
                        <p className="landing-fade rounded-full bg-black/45 px-3 py-1 text-xs text-white backdrop-blur-sm">{t.hint}</p>
                    )}
                    <div className="pointer-events-auto flex items-center gap-2" dir="ltr">
                        <button
                            type="button"
                            onClick={() => sceneRef.current?.step(-1)}
                            aria-label={t.previous}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/15 bg-card text-ink transition-colors hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                <path d="M12.5 15 7.5 10l5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        <Link
                            href={`/${locale}/products/${current.slug}`}
                            dir={locale === "ar" ? "rtl" : "ltr"}
                            className="flex min-w-0 max-w-[16rem] flex-col items-center rounded-[12px] bg-surface/95 px-4 py-2 text-center shadow-sm ring-1 ring-ink/10 backdrop-blur hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:max-w-xs"
                        >
                            <span className="line-clamp-1 text-sm font-medium text-ink">{current.name}</span>
                            <span className="text-sm font-semibold text-accent" dir="ltr">
                                {current.price} {CURRENCY}
                                {current.originalPrice !== null && (
                                    <span className="ms-2 font-normal text-mute line-through">
                                        {current.originalPrice} {CURRENCY}
                                    </span>
                                )}
                            </span>
                        </Link>
                        <button
                            type="button"
                            onClick={() => sceneRef.current?.step(1)}
                            aria-label={t.next}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/15 bg-card text-ink transition-colors hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                <path d="m7.5 15 5-5-5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
