"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { useCustomer } from "@/lib/customer-auth";

const translations = {
    en: { home: "Home", categories: "Categories", cart: "Cart", account: "Account", nav: "Main navigation" },
    fr: { home: "Accueil", categories: "Catégories", cart: "Panier", account: "Compte", nav: "Navigation principale" },
    ar: { home: "الرئيسية", categories: "الفئات", cart: "السلة", account: "حسابي", nav: "التنقل الرئيسي" },
};

/**
 * Bottom tab bar on phones, where the thumb reaches. Hidden on the product page (its sticky
 * buy bar takes the spot) and during checkout. Renders a spacer so content isn't covered.
 */
export default function MobileTabBar({ locale }: { locale: string }) {
    const pathname = usePathname() || "";
    const { totalItems, openCart } = useCart();
    const { user } = useCustomer();
    const t = translations[locale as keyof typeof translations] || translations.en;

    const rest = pathname.replace(/^\/(en|fr|ar)(?=\/|$)/, "") || "/";
    if (/^\/products\/[^/]+/.test(rest) || rest.startsWith("/checkout")) return null;

    const tab = (active: boolean) =>
        `relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none transition-colors focus-visible:bg-ink/5 ${
            active ? "text-accent" : "text-mute"
        }`;
    const icon = "h-6 w-6";

    return (
        <>
            <div className="h-[calc(4rem+env(safe-area-inset-bottom))] sm:hidden" aria-hidden="true" />
            <nav
                aria-label={t.nav}
                className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
            >
                <div className="flex h-16 items-stretch">
                    <Link href={`/${locale}`} className={tab(rest === "/")} aria-current={rest === "/" ? "page" : undefined}>
                        <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1v-8.5z" />
                        </svg>
                        {t.home}
                    </Link>
                    <Link
                        href={`/${locale}/categories`}
                        className={tab(rest.startsWith("/categories") || rest === "/products")}
                        aria-current={rest.startsWith("/categories") ? "page" : undefined}
                    >
                        <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" strokeWidth={1.8} />
                            <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" strokeWidth={1.8} />
                            <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" strokeWidth={1.8} />
                            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" strokeWidth={1.8} />
                        </svg>
                        {t.categories}
                    </Link>
                    <button type="button" onClick={openCart} className={tab(rest.startsWith("/cart"))} aria-label={`${t.cart} (${totalItems})`}>
                        <span className="relative">
                            <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                            {totalItems > 0 && (
                                <span className="absolute -top-1.5 -end-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white">
                                    {totalItems > 99 ? "99+" : totalItems}
                                </span>
                            )}
                        </span>
                        {t.cart}
                    </button>
                    <Link
                        href={user ? `/${locale}/settings` : `/${locale}/auth`}
                        className={tab(rest.startsWith("/settings") || rest.startsWith("/auth"))}
                        aria-current={rest.startsWith("/settings") ? "page" : undefined}
                    >
                        <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="8" r="3.75" strokeWidth={1.8} />
                            <path strokeLinecap="round" strokeWidth={1.8} d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5" />
                        </svg>
                        {t.account}
                    </Link>
                </div>
            </nav>
        </>
    );
}
