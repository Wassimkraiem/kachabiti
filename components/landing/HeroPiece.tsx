"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { LandingProduct } from "@/lib/landing-products";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";

// life: Infinity for drifting dust, a frame count for burst particles.
interface Mote { x: number; y: number; vx: number; vy: number; r: number; life: number }

// Place in the fan of the 1st, 2nd, … product: centre first, then alternating sides.
const OFFSETS = [0, -1, 1, -2, 2];
const BRIGHTNESS = ["brightness-100", "brightness-[.8]", "brightness-[.62]"];

/**
 * The hero's fan of arched product photos (up to five), with wool dust drifting over the
 * whole hero section (the canvas fills the nearest positioned ancestor). The fan opens on
 * load and spreads further as the page scrolls; pressing a photo bursts the dust, then
 * opens the product. Under reduced motion: open fan, no dust, no scroll effect.
 */
export default function HeroPiece({ products, locale }: { products: LandingProduct[]; locale: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fanRef = useRef<HTMLDivElement>(null);
    const burst = useRef<(x: number, y: number) => void>(() => {});

    useEffect(() => {
        const fan = fanRef.current;
        const cv = canvasRef.current;
        const cx = cv?.getContext("2d");
        if (!fan || !cv || !cx) return;
        fan.style.setProperty("--open", "1");
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        // --p: how far the hero has been scrolled away, 0 to 1.
        const onScroll = () => fan.style.setProperty("--p", String(Math.min(1, window.scrollY / window.innerHeight)));
        window.addEventListener("scroll", onScroll, { passive: true });

        const size = () => {
            cv.width = cv.clientWidth;
            cv.height = cv.clientHeight;
        };
        size();
        window.addEventListener("resize", size);

        let motes: Mote[] = Array.from({ length: 60 }, () => ({
            x: Math.random() * cv.width,
            y: Math.random() * cv.height,
            vx: (Math.random() - 0.5) * 0.2,
            vy: -Math.random() * 0.3 - 0.05,
            r: Math.random() * 1.6 + 0.4,
            life: Infinity,
        }));
        burst.current = (clientX, clientY) => {
            const rect = cv.getBoundingClientRect();
            for (let i = 0; i < 80; i++) {
                const angle = Math.random() * 7;
                const speed = Math.random() * 5 + 1;
                motes.push({
                    x: clientX - rect.left,
                    y: clientY - rect.top,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 2,
                    r: Math.random() * 2.6 + 0.6,
                    life: 60 + Math.random() * 50,
                });
            }
        };

        let raf = 0;
        let visible = true;
        const frame = () => {
            cx.clearRect(0, 0, cv.width, cv.height);
            cx.fillStyle = "#e9b860";
            motes = motes.filter((m) => m.life-- > 0);
            for (const m of motes) {
                m.x += m.vx;
                m.y += m.vy;
                if (m.life !== Infinity) {
                    m.vy += 0.03;
                    m.vx *= 0.98;
                } else if (m.y < -5) {
                    m.y = cv.height + 5;
                }
                cx.globalAlpha = m.life === Infinity ? 0.45 : Math.min(1, m.life / 60);
                cx.beginPath();
                cx.arc(m.x, m.y, m.r, 0, 7);
                cx.fill();
            }
            if (visible) raf = requestAnimationFrame(frame);
        };
        // Only animate while the hero is on screen.
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            cancelAnimationFrame(raf);
            if (visible) raf = requestAnimationFrame(frame);
        });
        observer.observe(cv);

        return () => {
            observer.disconnect();
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", size);
            window.removeEventListener("scroll", onScroll);
        };
    }, []);

    return (
        <>
            <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 h-full w-full" />
            <div
                ref={fanRef}
                className="hero-float relative h-[calc(var(--w)*1.43)] w-[var(--w)] [--w:min(32svh,50vw)] [perspective:1200px] lg:[--w:min(42vh,20vw)]"
                style={{ "--open": 0, "--p": 0 } as React.CSSProperties}
            >
                {products.slice(0, OFFSETS.length).map((product, index) => {
                    const i = OFFSETS[index];
                    const away = Math.abs(i);
                    return (
                        <Link
                            key={product.id}
                            href={`/${locale}/products/${product.slug}`}
                            onPointerDown={(event) => burst.current(event.clientX, event.clientY)}
                            className={`group absolute inset-0 block outline-none transition-[transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:brightness-100 focus-visible:brightness-100 motion-reduce:transition-none ${BRIGHTNESS[away]}`}
                            style={{
                                zIndex: 10 - away,
                                transform: `translateX(calc(var(--w) * ${0.46 * i} * var(--open) * (1 + var(--p) * 0.35))) translateY(calc(var(--p) * ${-36 * away}px)) scale(${1 - away * 0.13}) rotateY(calc(${-14 * i}deg * var(--open)))`,
                            }}
                        >
                            <div className="arch relative h-full border border-accent bg-black shadow-[0_0_90px_10px_rgba(217,165,72,0.14)] group-focus-visible:ring-2 group-focus-visible:ring-accent">
                                {product.image && (
                                    <Image
                                        src={product.image}
                                        alt={product.name}
                                        fill
                                        priority={index === 0}
                                        sizes="(max-width: 1024px) 50vw, 300px"
                                        className="zoom-img object-cover object-[50%_30%]"
                                    />
                                )}
                                {/* Side pieces overlap, so their label shows only on hover or focus. */}
                                <span className={`absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 to-transparent px-3 pt-12 pb-3 text-center transition-opacity duration-300 ${away ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : ""}`}>
                                    <span className="block truncate font-display text-sm font-bold text-[#f4e6cf] lg:text-base">{product.name}</span>
                                    <span className="block text-sm font-semibold text-accent" dir="ltr">
                                        {product.price} {CURRENCY}
                                        {product.originalPrice !== null && (
                                            <s className="ms-2 text-xs font-normal text-[#a8987f]">{product.originalPrice}</s>
                                        )}
                                    </span>
                                </span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </>
    );
}
