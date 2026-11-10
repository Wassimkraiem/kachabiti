"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart-context";
import { useRouter, usePathname } from "next/navigation";

const translations = {
    en: {
        cart: "Cart",
        item: "item",
        items: "items"
    },
    fr: {
        cart: "Panier",
        item: "article",
        items: "articles"
    },
    ar: {
        cart: "السلة",
        item: "عنصر",
        items: "عناصر"
    }
};

export default function CartButton() {
    const router = useRouter();
    const pathname = usePathname();

    // Extract locale from pathname
    const locale = pathname?.split('/')[1] || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    // The header hydrates inside a Suspense boundary after the cart has loaded from storage;
    // showing the count only once mounted keeps the first client render equal to the server HTML.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Try to use cart context, fallback to defaults if outside provider
    let totalItems = 0;
    let openCart = () => router.push(`/${locale}/cart`);

    try {
        const cartContext = useCart();
        totalItems = cartContext.totalItems;
        openCart = cartContext.openCart;
    } catch {
        // Outside CartProvider, use defaults
    }

    return (
        <button
            onClick={openCart}
            className="cursor-pointer flex items-center gap-2 text-ink hover:text-accent transition relative"
            aria-label="Shopping cart"
        >
            <div className="relative">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                {mounted && totalItems > 0 && (
                    <span className="absolute -top-2 -end-2 bg-accent text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {totalItems}
                    </span>
                )}
            </div>
            <span className="hidden text-sm font-medium lg:inline">{t.cart}</span>
        </button>
    );
}

