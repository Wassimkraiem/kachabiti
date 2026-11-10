"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ScrollTrackProps {
    /** Shown above the row and pinned with it. */
    header?: ReactNode;
    /** The row's items; give each a fixed width and `shrink-0`. */
    children: ReactNode;
    rtl: boolean;
    className?: string;
}

/**
 * The landing page's "pieces" move: the section pins under the header while the page
 * scrolls, and the row slides sideways by the distance scrolled (1px down = 1px across),
 * so every item passes through the screen. Without JavaScript or under reduced motion it
 * is a normal swipeable row.
 */
export default function ScrollTrack({ header, children, rtl, className = "" }: ScrollTrackProps) {
    const outer = useRef<HTMLElement>(null);
    const pin = useRef<HTMLDivElement>(null);
    const track = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const o = outer.current;
        const p = pin.current;
        const t = track.current;
        if (!o || !p || !t || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        o.dataset.pinned = "";
        let raf = 0;
        const update = () => {
            raf = 0;
            const extra = Math.max(0, t.offsetWidth - p.clientWidth);
            o.style.setProperty("--extra", `${extra}px`);
            const top = parseFloat(getComputedStyle(p).top) || 0;
            const progress = extra ? Math.min(1, Math.max(0, (top - o.getBoundingClientRect().top) / extra)) : 0;
            t.style.transform = `translateX(${(rtl ? 1 : -1) * progress * extra}px)`;
        };
        const queue = () => {
            raf ||= requestAnimationFrame(update);
        };
        update();
        window.addEventListener("scroll", queue, { passive: true });
        window.addEventListener("resize", queue);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("scroll", queue);
            window.removeEventListener("resize", queue);
            delete o.dataset.pinned;
            t.style.transform = "";
        };
    }, [rtl]);

    // 7.5rem = phone header (56px) + bottom tab bar (64px); 72px = desktop header.
    return (
        <section
            ref={outer}
            dir={rtl ? "rtl" : "ltr"}
            className={`group/track relative w-full data-[pinned]:h-[calc(100svh-7.5rem+var(--extra,0px))] sm:data-[pinned]:h-[calc(100svh-72px+var(--extra,0px))] ${className}`}
        >
            <div
                ref={pin}
                className="top-14 flex flex-col justify-center gap-6 overflow-x-auto py-10 group-data-[pinned]/track:sticky group-data-[pinned]/track:h-[calc(100svh-7.5rem)] group-data-[pinned]/track:overflow-hidden group-data-[pinned]/track:py-4 sm:top-[72px] sm:group-data-[pinned]/track:h-[calc(100svh-72px)]"
            >
                {header && <div className="mx-auto w-full max-w-7xl shrink-0 px-4">{header}</div>}
                <div ref={track} className="flex w-max shrink-0 gap-4 px-4 will-change-transform lg:gap-6 lg:px-[max(1rem,calc((100vw-80rem)/2+1rem))]">
                    {children}
                </div>
            </div>
        </section>
    );
}
