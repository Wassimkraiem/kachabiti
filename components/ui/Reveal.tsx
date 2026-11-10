"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Fades and lifts its content the first time it enters the screen (styles: `.reveal` in globals.css). */
export default function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    el.classList.add("is-in");
                    observer.disconnect();
                }
            },
            { rootMargin: "0px 0px -10% 0px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return <div ref={ref} className={`reveal ${className}`}>{children}</div>;
}
