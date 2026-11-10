"use client";

import React, { useEffect } from "react";
import { cartLineKey, useCart } from "@/lib/cart-context";
import Link from "next/link";
import { useLanguage } from "@/lib/language-context";
import { isRTL } from "@/lib/language-utils";
import CartItem from "./CartItem";

const content = {
    en: {
        myCart: "My cart",
        reviews: "reviews",
        subtotal: "Subtotal",
        checkout: "Checkout",
        viewCart: "View Cart",
        emptyCart: "Your cart is empty",
        startShopping: "Start Shopping"
    },
    fr: {
        myCart: "Mon Panier",
        reviews: "avis",
        subtotal: "Sous-total",
        checkout: "Commander",
        viewCart: "Voir le Panier",
        emptyCart: "Votre panier est vide",
        startShopping: "Commencer vos achats"
    },
    ar: {
        myCart: "سلتي",
        reviews: "تقييم",
        subtotal: "المجموع الفرعي",
        checkout: "الدفع",
        viewCart: "عرض السلة",
        emptyCart: "سلتك فارغة",
        startShopping: "ابدأ التسوق"
    }
};

export default function CartDrawer() {
    const { items, subtotal, updateQuantity, removeItem, isCartOpen, closeCart } = useCart();
    const { locale } = useLanguage();
    const text = content[locale as keyof typeof content] || content.en;
    const rtl = isRTL(locale);

    useEffect(() => {
        if (typeof document === "undefined") return;

        if (isCartOpen) {
            const originalStyle = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = originalStyle;
            };
        }
    }, [isCartOpen]);

    if (!isCartOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-1500 bg-black/30 backdrop-blur-[2px]"
                onClick={closeCart}
            />
            {/* Phones: bottom sheet. Larger screens: popover under the header's cart button. */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label={text.myCart}
                dir={rtl ? "rtl" : "ltr"}
                className={`theme-cream fixed inset-x-0 bottom-0 z-1510 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:inset-x-auto sm:bottom-auto sm:top-[72px] sm:mt-2 sm:max-h-[calc(100vh-140px)] sm:w-full sm:max-w-[500px] sm:rounded-[12px] sm:border sm:border-line ${rtl ? 'sm:left-6' : 'sm:right-6'}`}
            >
                <div className={`absolute -top-2 hidden ${rtl ? 'left-10' : 'right-10'} w-4 h-4 bg-card border-t border-l border-line transform rotate-45 sm:block`}></div>
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden="true" />
                <div className="flex min-h-0 flex-1 flex-col">

                    <div className="flex shrink-0 items-center justify-between border-b bg-card px-5 py-3 sm:px-8 sm:py-6">
                        <h2 className="text-[20px] font-bold text-ink">
                            {text.myCart}
                        </h2>
                        <button
                            onClick={closeCart}
                            className="-me-2 flex h-11 w-11 items-center justify-center rounded-full text-mute transition hover:bg-surface hover:text-ink"
                            aria-label="Close"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Cart Items */}
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-card px-5 pt-4 sm:max-h-100 sm:px-8 sm:pt-6">
                        {items.length === 0 ? (
                            <div className="pb-12 flex flex-col items-center justify-center h-full text-center">
                                <svg className="w-24 h-24 text-mute mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                </svg>
                                <p className="text-mute text-lg mb-2">{text.emptyCart}</p>
                                <Link
                                    href={`/${locale}`}
                                    onClick={closeCart}
                                    className="text-accent hover:text-accent font-medium"
                                >
                                    {text.startShopping}
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-2 sm:space-y-8">
                                {items.map((item) => (
                                    <React.Fragment key={cartLineKey(item)}>
                                        <CartItem
                                            item={item}
                                            onUpdateQuantity={updateQuantity}
                                            onRemove={removeItem}
                                            variant="compact"
                                            reviewsText={text.reviews}
                                        />
                                        <hr className="my-4 border-line" />
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer with Subtotal and Actions */}
                    {items.length > 0 && (
                        <div className="shrink-0 space-y-3 border-t bg-card px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:space-y-6 sm:px-8 sm:pb-6">
                            {/* Subtotal */}
                            <div className="flex justify-between items-center">
                                <span className="text-[16px] font-bold text-accent">{text.subtotal}</span>
                                <span className="text-[17px] font-semibold text-ink" dir="ltr">{subtotal} TND</span>
                            </div>

                            {/* Checkout Button */}
                            <Link
                                href={`/${locale}/checkout`}
                                onClick={closeCart}
                                className="block w-full rounded-full bg-accent py-3.5 text-center text-lg font-medium text-white transition hover:bg-accent-hover"
                            >
                                {text.checkout}
                            </Link>

                            {/* View Cart Button */}
                            <Link
                                href={`/${locale}/cart`}
                                onClick={closeCart}
                                className="block w-full rounded-full border border-accent py-3 text-center text-base font-medium text-accent transition hover:bg-surface"
                            >
                                {text.viewCart}
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

