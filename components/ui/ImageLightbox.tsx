"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

interface LightboxImage {
    src: string;
    alt: string;
}

interface ImageLightboxProps {
    images: LightboxImage[];
    /** Index of the image shown in the trigger and opened first. */
    index: number;
    className?: string;
}

/**
 * Product photo that opens a full-screen, keyboard- and swipe-navigable gallery on click.
 * The photo is framed from the top so a model's face stays in view; the full-screen view
 * shows the whole photo. The overlay is portalled to <body> so sticky page sections can
 * never paint above it.
 */
export default function ImageLightbox({ images, index, className = "" }: ImageLightboxProps) {
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const current = images[index] ?? images[0];

    const close = useCallback(() => setOpenIndex(null), []);
    const step = useCallback(
        (delta: number) => setOpenIndex((i) => (i === null ? i : (i + delta + images.length) % images.length)),
        [images.length]
    );

    useEffect(() => {
        if (openIndex === null) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowRight") step(1);
            if (e.key === "ArrowLeft") step(-1);
        };
        document.addEventListener("keydown", onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = previous;
        };
    }, [openIndex, close, step]);

    if (!current) return null;

    const control = "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white outline-none transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white";

    return (
        <>
            <button
                type="button"
                onClick={() => setOpenIndex(Math.max(0, images.indexOf(current)))}
                className={`relative block aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-2xl lg:aspect-square ${className}`}
                aria-label={current.alt}
            >
                <Image src={current.src} alt={current.alt} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover object-top" />
                <span className="absolute bottom-3 end-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-ink shadow-sm" aria-hidden="true">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                    </svg>
                </span>
            </button>

            {openIndex !== null &&
                createPortal(
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={images[openIndex].alt}
                        className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/95"
                        onClick={close}
                        onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
                        onTouchEnd={(e) => {
                            if (touchStartX === null || images.length < 2) return;
                            const dx = e.changedTouches[0].clientX - touchStartX;
                            setTouchStartX(null);
                            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
                        }}
                    >
                        <div className="relative h-[calc(100dvh-7rem)] w-[calc(100vw-1.5rem)] max-w-5xl" onClick={(e) => e.stopPropagation()}>
                            <Image src={images[openIndex].src} alt={images[openIndex].alt} fill sizes="100vw" className="object-contain" />
                        </div>
                        <button type="button" onClick={close} aria-label="Close" className={`absolute end-3 top-3 ${control}`}>
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                        {images.length > 1 && (
                            <>
                                <button type="button" aria-label="Previous image" onClick={(e) => { e.stopPropagation(); step(-1); }} className={`absolute left-3 top-1/2 hidden -translate-y-1/2 sm:flex ${control}`}>
                                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeWidth={2} d="M15 6l-6 6 6 6" /></svg>
                                </button>
                                <button type="button" aria-label="Next image" onClick={(e) => { e.stopPropagation(); step(1); }} className={`absolute right-3 top-1/2 hidden -translate-y-1/2 sm:flex ${control}`}>
                                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeWidth={2} d="M9 6l6 6-6 6" /></svg>
                                </button>
                                <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white" dir="ltr">
                                    {openIndex + 1} / {images.length}
                                </span>
                            </>
                        )}
                    </div>,
                    document.body
                )}
        </>
    );
}
