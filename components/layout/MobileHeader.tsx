"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { headerConfig } from "@/lib/config";
import { signOut, type Customer } from "@/lib/customer-auth";
import SearchBox from "./SearchBox";

const translations = {
    en: {
        menu: "Menu", close: "Close", search: "Search", home: "Home", allProducts: "All products", language: "Language",
        callUs: "Call us", followUs: "Follow us", payOnDelivery: "Pay on delivery, delivery across Tunisia",
    },
    fr: {
        menu: "Menu", close: "Fermer", search: "Rechercher", home: "Accueil", allProducts: "Tous les produits", language: "Langue",
        callUs: "Appelez-nous", followUs: "Suivez-nous", payOnDelivery: "Paiement à la livraison, partout en Tunisie",
    },
    ar: {
        menu: "القائمة", close: "إغلاق", search: "بحث", home: "الرئيسية", allProducts: "كل المنتجات", language: "اللغة",
        callUs: "اتصل بنا", followUs: "تابعنا", payOnDelivery: "الدفع عند الاستلام، توصيل لكل ولايات تونس",
    },
};

export interface MobileHeaderCategory {
    id: string;
    slug: string;
    label: string;
    depth: number;
}

interface MobileHeaderProps {
    locale: string;
    rtl: boolean;
    user: Customer | null;
    categories: MobileHeaderCategory[];
    search: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder: string;
    resultsHref: (query: string) => string;
    labels: { categories: string; allCategories: string; discounts: string; aboutUs: string; contactUs: string; logIn: string; myAccount: string; logOut: string };
}

const LANGUAGE_LABELS: Record<string, string> = { ar: "العربية", fr: "Français", en: "English" };

/**
 * The header on phones: one compact bar (menu, logo, search). The menu is a full-height
 * drawer from the start side; search opens a panel under the bar. Cart and account live in
 * the bottom tab bar (MobileTabBar), within thumb reach.
 */
export default function MobileHeader({ locale, rtl, user, categories, search, onSearchChange, searchPlaceholder, resultsHref, labels }: MobileHeaderProps) {
    const t = translations[locale as keyof typeof translations] || translations.en;
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [categoriesOpen, setCategoriesOpen] = useState(false);
    const searchPanel = useRef<HTMLDivElement>(null);

    // Close everything when the page changes.
    useEffect(() => {
        setMenuOpen(false);
        setSearchOpen(false);
    }, [pathname]);

    // Lock page scroll behind the drawer; Escape closes it.
    useEffect(() => {
        if (!menuOpen) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener("keydown", onKey);
        };
    }, [menuOpen]);

    useEffect(() => {
        if (searchOpen) searchPanel.current?.querySelector("input")?.focus();
    }, [searchOpen]);

    const languageHref = (code: string) => {
        const rest = (pathname || "").replace(/^\/(en|fr|ar)(?=\/|$)/, "") || "";
        const query = searchParams.toString();
        return `/${code}${rest}${query ? `?${query}` : ""}`;
    };
    const phone = headerConfig.contact.phone.replace(/\s/g, "");
    const row = "flex min-h-12 w-full items-center justify-between gap-3 px-5 text-[15px] text-[#2b1a16] transition-colors hover:bg-black/[0.03] focus-visible:bg-black/[0.05] focus-visible:outline-none";

    return (
        <div className="sm:hidden">
            {/* Bar */}
            <div className="flex h-14 items-center justify-between gap-2 border-b border-[#ece4da] bg-white/95 px-1.5 backdrop-blur">
                <button
                    type="button"
                    onClick={() => setMenuOpen(true)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#2b1a16] outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[#7a3b2e]"
                    aria-label={t.menu}
                    aria-expanded={menuOpen}
                >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h10" />
                    </svg>
                </button>
                <Link href={`/${locale}`} className="flex items-center" aria-label="Kachabity">
                    <Image src="/assets/images/logoKachabity.jpg" alt="Kachabity" width={44} height={44} priority className="h-10 w-10 rounded-full object-contain" />
                </Link>
                <button
                    type="button"
                    onClick={() => setSearchOpen((open) => !open)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#2b1a16] outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[#7a3b2e]"
                    aria-label={searchOpen ? t.close : t.search}
                    aria-expanded={searchOpen}
                >
                    {searchOpen ? (
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeWidth={1.8} d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    ) : (
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="11" cy="11" r="6.5" strokeWidth={1.8} />
                            <path strokeLinecap="round" strokeWidth={1.8} d="M16 16l4 4" />
                        </svg>
                    )}
                </button>
            </div>

            {/* Search panel */}
            {searchOpen && (
                <div ref={searchPanel} className="border-b border-[#ece4da] bg-white px-4 py-3">
                    <SearchBox
                        locale={locale}
                        rtl={rtl}
                        value={search}
                        onChange={onSearchChange}
                        placeholder={searchPlaceholder}
                        variant="desktop"
                        resultsHref={resultsHref}
                        onNavigate={() => setSearchOpen(false)}
                    />
                </div>
            )}

            {/* Menu drawer */}
            <div className={`fixed inset-0 z-50 ${menuOpen ? "" : "pointer-events-none"}`} aria-hidden={!menuOpen}>
                <div
                    className={`absolute inset-0 bg-[#2b1a16]/40 transition-opacity duration-200 motion-reduce:transition-none ${menuOpen ? "opacity-100" : "opacity-0"}`}
                    onClick={() => setMenuOpen(false)}
                />
                <nav
                    role="dialog"
                    aria-modal="true"
                    aria-label={t.menu}
                    className={`absolute inset-y-0 start-0 flex w-[86%] max-w-sm flex-col bg-[#faf7f2] shadow-xl transition-transform duration-250 ease-out motion-reduce:transition-none ${
                        menuOpen ? "translate-x-0" : rtl ? "translate-x-full" : "-translate-x-full"
                    }`}
                >
                    <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#ece4da] ps-5 pe-1.5">
                        <Image src="/assets/images/logoKachabity.jpg" alt="Kachabity" width={40} height={40} className="h-9 w-9 rounded-full object-contain" />
                        <button
                            type="button"
                            onClick={() => setMenuOpen(false)}
                            className="flex h-11 w-11 items-center justify-center rounded-full text-[#2b1a16] outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[#7a3b2e]"
                            aria-label={t.close}
                            tabIndex={menuOpen ? 0 : -1}
                        >
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeWidth={1.8} d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto overscroll-contain pb-6">
                        {/* Account */}
                        <Link href={user ? `/${locale}/settings` : `/${locale}/auth`} className={`${row} border-b border-[#ece4da] py-3`} tabIndex={menuOpen ? 0 : -1}>
                            <span className="flex items-center gap-3">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2b1a16] text-sm font-medium text-white">
                                    {user ? (user.user_metadata?.full_name || user.email || "?").charAt(0).toUpperCase() : (
                                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    )}
                                </span>
                                <span className="font-medium">{user ? labels.myAccount : labels.logIn}</span>
                            </span>
                        </Link>

                        <ul className="py-2">
                            <li><Link href={`/${locale}`} className={row} tabIndex={menuOpen ? 0 : -1}>{t.home}</Link></li>
                            <li><Link href={`/${locale}/products`} className={row} tabIndex={menuOpen ? 0 : -1}>{t.allProducts}</Link></li>
                            <li>
                                <button type="button" className={row} onClick={() => setCategoriesOpen((open) => !open)} aria-expanded={categoriesOpen} tabIndex={menuOpen ? 0 : -1}>
                                    <span>{labels.categories}</span>
                                    <svg className={`h-5 w-5 text-[#8a7a70] transition-transform motion-reduce:transition-none ${categoriesOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                {categoriesOpen && (
                                    <ul className="border-y border-[#ece4da] bg-white/60 py-1">
                                        <li>
                                            <Link href={`/${locale}/categories`} className={`${row} font-medium text-[#7a3b2e]`} tabIndex={menuOpen ? 0 : -1}>
                                                {labels.allCategories}
                                            </Link>
                                        </li>
                                        {categories.map((category) => (
                                            <li key={category.id}>
                                                <Link
                                                    href={`/${locale}/products?category=${category.slug}`}
                                                    className={`${row} text-[14px] text-[#5b4a42]`}
                                                    style={{ paddingInlineStart: 20 + category.depth * 16 }}
                                                    tabIndex={menuOpen ? 0 : -1}
                                                >
                                                    {category.label}
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                            <li><Link href={`/${locale}/products?promo=true`} className={row} tabIndex={menuOpen ? 0 : -1}>{labels.discounts}</Link></li>
                            <li><Link href={`/${locale}/about`} className={row} tabIndex={menuOpen ? 0 : -1}>{labels.aboutUs}</Link></li>
                            <li><Link href={`/${locale}/contact`} className={row} tabIndex={menuOpen ? 0 : -1}>{labels.contactUs}</Link></li>
                        </ul>

                        {/* Language */}
                        <div className="border-t border-[#ece4da] px-5 pt-5">
                            <p className="mb-2 text-sm text-[#8a7a70]">{t.language}</p>
                            <div className="grid grid-cols-3 gap-2">
                                {headerConfig.languages.map((lang) => (
                                    <Link
                                        key={lang.code}
                                        href={languageHref(lang.code)}
                                        className={`flex h-11 items-center justify-center rounded-full border text-sm transition-colors ${
                                            lang.code === locale ? "border-[#2b1a16] bg-[#2b1a16] text-white" : "border-[#d9cfc3] text-[#2b1a16] hover:border-[#2b1a16]"
                                        }`}
                                        aria-current={lang.code === locale ? "true" : undefined}
                                        tabIndex={menuOpen ? 0 : -1}
                                    >
                                        {LANGUAGE_LABELS[lang.code] ?? lang.name}
                                    </Link>
                                ))}
                            </div>
                        </div>

                        {/* Contact */}
                        <div className="px-5 pt-6">
                            <a
                                href={`tel:${phone}`}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#7a3b2e] text-[15px] font-medium text-white"
                                tabIndex={menuOpen ? 0 : -1}
                            >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                                {t.callUs} <span dir="ltr">{headerConfig.contact.phone}</span>
                            </a>
                            <p className="mt-3 text-center text-sm text-[#8a7a70]">{t.payOnDelivery}</p>
                            <div className="mt-4 flex items-center justify-center gap-2" aria-label={t.followUs}>
                                {Object.entries(headerConfig.social).map(([platform, data]) => (
                                    <a
                                        key={platform}
                                        href={data.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex h-11 w-11 items-center justify-center rounded-full text-[#5b4a42] hover:bg-black/5"
                                        aria-label={platform}
                                        tabIndex={menuOpen ? 0 : -1}
                                    >
                                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d={data.icon} />
                                        </svg>
                                    </a>
                                ))}
                            </div>
                        </div>

                        {user && (
                            <div className="px-5 pt-4">
                                <button
                                    type="button"
                                    onClick={async () => {
                                        await signOut();
                                        setMenuOpen(false);
                                        router.push(`/${locale}`);
                                    }}
                                    className="h-11 w-full rounded-full text-sm text-[#8a7a70] hover:bg-black/5"
                                    tabIndex={menuOpen ? 0 : -1}
                                >
                                    {labels.logOut}
                                </button>
                            </div>
                        )}
                    </div>
                </nav>
            </div>
        </div>
    );
}
