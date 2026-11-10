"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { headerConfig } from '@/lib/config';
import { useLanguageSafe } from '@/lib/language-context';
import { getCategories } from '@/lib/categories-cache';
import { isRTL } from '@/lib/language-utils';
import CartButton from '../cart/CartButton';
import SearchBox from './SearchBox';
import MobileHeader from './MobileHeader';
import { useCustomer } from '@/lib/customer-auth';
import { useSearchParams, usePathname } from "next/navigation";

const translations = {
    en: {
        followUs: "Follow Us:",
        loading: "Loading...",
        allCategories: "All Categories",
        noCategoriesFound: "No categories found",
        searchPlaceholder: "Search for a product ",
        handmade: "100% handmade",
        categories: "Categories",
        discounts: "Discounts",
        aboutUs: "About Us",
        contactUs: "Contact Us",
        logIn: "Log in",
        myAccount: "My account",
        logOut: "Log out"
    },
    fr: {
        followUs: "Suivez-nous :",
        loading: "Chargement...",
        allCategories: "Toutes les catégories",
        noCategoriesFound: "Aucune catégorie trouvée",
        searchPlaceholder: "Rechercher un produit",
        handmade: "100% fait main",
        categories: "Catégories",
        discounts: "Remises",
        aboutUs: "À propos",
        contactUs: "Contactez-nous",
        logIn: "Se connecter",
        myAccount: "Mon compte",
        logOut: "Se déconnecter"
    },
    ar: {
        followUs: "تابعنا:",
        loading: "جاري التحميل...",
        allCategories: "جميع الفئات",
        noCategoriesFound: "لم يتم العثور على فئات",
        searchPlaceholder: "ابحث عن منتج  ",
        handmade: "100% مصنوع يدوياً",
        categories: "الفئات",
        discounts: "التخفيضات",
        aboutUs: "من نحن",
        contactUs: "اتصل بنا",
        logIn: "تسجيل الدخول",
        myAccount: "حسابي",
        logOut: "تسجيل الخروج"
    }
};

interface Category {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    image_url?: string;
    sort_order: number;
    is_featured?: boolean;
    parent_id?: string | null;
    depth?: number;
}

// Featured top-level categories, each followed by its sub-categories (depth-first).
function flattenCategoryTree(all: Category[]): Category[] {
    const out: Category[] = [];
    const visit = (parentId: string, depth: number) => {
        for (const c of all.filter((x) => x.parent_id === parentId)) {
            out.push({ ...c, depth });
            visit(c.id, depth + 1);
        }
    };
    for (const top of all.filter((c) => c.is_featured && !c.parent_id)) {
        out.push({ ...top, depth: 0 });
        visit(top.id, 1);
    }
    return out;
}

// Helper function to get translated category name
function getCategoryName(category: Category, locale: string): string {
    if (locale === 'ar' && category.name_ar) {
        return category.name_ar;
    }
    if (locale === 'fr' && category.name_fr) {
        return category.name_fr;
    }
    return category.name;
}

interface StaticHeaderProps {
    locale?: string;
}

export default function StaticHeader({ locale: propLocale }: StaticHeaderProps = {}) {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
    const { user } = useCustomer();
    const [categories, setCategories] = useState<Category[]>([]);
    const [isLoadingCategories, setIsLoadingCategories] = useState(true);
    const [mounted, setMounted] = useState(false);

    // Always call the hook - safe version returns null if outside provider
    const languageContext = useLanguageSafe();

    // Use prop locale if provided, otherwise use context, fallback to 'en'
    const locale = propLocale || languageContext?.locale || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    const rtl = isRTL(locale);

    // Prevent hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    // Close language menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (isLanguageMenuOpen && !target.closest('.language-menu-container')) {
                setIsLanguageMenuOpen(false);
            }
        };

        if (isLanguageMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isLanguageMenuOpen]);

    // Authentication removed

    // Fetch categories from API
    useEffect(() => {
        async function fetchCategories() {
            try {
                const data = await getCategories();

                if (data) {
                    setCategories(flattenCategoryTree(data));
                }
            } catch (error) {
                console.error('Error fetching categories:', error);
                // Set empty array on error to prevent UI issues
                setCategories([]);
            } finally {
                setIsLoadingCategories(false);
            }
        }

        fetchCategories();
    }, []);

    const [search, setSearch] = useState("");

    // Initialize search from URL after mount to prevent hydration mismatch
    useEffect(() => {
        if (mounted) {
            setSearch(searchParams.get("search") || "");
        }
    }, [mounted, searchParams]);

    // Results page for a search, keeping the other filters already in the URL.
    // Absolute, locale-prefixed path: a relative 'products' breaks on nested routes.
    const searchResultsHref = (query: string) => {
        const params = new URLSearchParams(searchParams);
        if (query) {
            params.set("search", query);
        } else {
            params.delete("search");
        }
        return `/${locale}/products?${params.toString()}`;
    };

    const languageHref = (code: string) => {
        const rest = (pathname || '').replace(/^\/(en|fr|ar)(?=\/|$)/, '');
        const query = searchParams.toString();
        return `/${code}${rest}${query ? `?${query}` : ''}`;
    };
    const navLink = "text-sm text-ink/85 transition-colors hover:text-accent";

    return (
        <header className="sticky top-0 z-40 w-full border-b border-line bg-surface/90 backdrop-blur" dir={mounted ? (rtl ? 'rtl' : 'ltr') : 'ltr'}>
            {/* Desktop: navigation, centred wordmark, then search, language, account and cart */}
            <div className="mx-auto hidden h-[72px] max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-6 px-4 sm:grid">
                <nav className="flex items-center gap-6">
                    <div
                        className="relative"
                        onMouseEnter={() => setIsCategoriesOpen(true)}
                        onMouseLeave={() => setIsCategoriesOpen(false)}
                    >
                        <button
                            type="button"
                            className={`${navLink} flex items-center gap-1`}
                            aria-expanded={isCategoriesOpen}
                            onClick={() => setIsCategoriesOpen((open) => !open)}
                        >
                            <span>{t.categories}</span>
                            <svg className={`h-4 w-4 transition-transform ${isCategoriesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        <div className={`absolute start-0 top-full z-50 w-60 pt-3 transition-opacity duration-200 ${isCategoriesOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}>
                            <div className="rounded-xl border border-line bg-card py-2 shadow-xl">
                                {isLoadingCategories ? (
                                    <div className="px-4 py-2 text-sm text-mute">{t.loading}</div>
                                ) : categories.length > 0 ? (
                                    <>
                                        <Link href={`/${locale}/categories`} className="block px-4 py-2 font-medium text-accent hover:bg-ink/5">
                                            {t.allCategories}
                                        </Link>
                                        {categories.map((category) => (
                                            <Link
                                                key={category.id}
                                                href={`/${locale}/products?category=${category.slug}`}
                                                className="block py-2 pe-4 text-sm text-ink/85 hover:bg-ink/5 hover:text-accent"
                                                style={{ paddingInlineStart: 16 + (category.depth ?? 0) * 16 }}
                                            >
                                                {getCategoryName(category, locale)}
                                            </Link>
                                        ))}
                                    </>
                                ) : (
                                    <div className="px-4 py-2 text-sm text-mute">{t.noCategoriesFound}</div>
                                )}
                            </div>
                        </div>
                    </div>
                    <Link href={`/${locale}/products?promo=true`} className={navLink}>{t.discounts}</Link>
                    <Link href={`/${locale}/about`} className={`${navLink} hidden lg:inline`}>{t.aboutUs}</Link>
                    <Link href={`/${locale}/contact`} className={`${navLink} hidden lg:inline`}>{t.contactUs}</Link>
                </nav>

                <Link href={`/${locale}`} className="font-display text-3xl font-bold leading-none text-ink" aria-label="Kachabiti">
                    قشابيتي
                </Link>

                <div className="flex items-center justify-end gap-4">
                    <div className="w-40 lg:w-64">
                        <SearchBox
                            locale={locale}
                            rtl={rtl}
                            value={search}
                            onChange={setSearch}
                            placeholder={t.searchPlaceholder.trim() + ' …'}
                            variant="desktop"
                            resultsHref={searchResultsHref}
                        />
                    </div>
                    <div className="flex items-center gap-2 text-xs uppercase" dir="ltr">
                        {headerConfig.languages.map((lang) => (
                            <Link
                                key={lang.code}
                                href={languageHref(lang.code)}
                                aria-label={lang.name}
                                aria-current={lang.code === locale ? 'true' : undefined}
                                className={lang.code === locale ? 'font-bold text-accent' : 'text-mute transition-colors hover:text-ink'}
                            >
                                {lang.code}
                            </Link>
                        ))}
                    </div>
                    <Link
                        href={user ? `/${locale}/settings` : `/${locale}/auth`}
                        className="text-ink transition-colors hover:text-accent"
                        aria-label={user ? t.myAccount : t.logIn}
                        title={user ? t.myAccount : t.logIn}
                    >
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                    </Link>
                    <CartButton />
                </div>
            </div>

            {/* Phones: compact bar with menu drawer and search panel */}
            <MobileHeader
                locale={locale}
                rtl={rtl}
                user={user}
                categories={categories.map((c) => ({ id: c.id, slug: c.slug, label: getCategoryName(c, locale), depth: c.depth ?? 0 }))}
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder={t.searchPlaceholder.trim() + ' …'}
                resultsHref={searchResultsHref}
                labels={t}
            />
        </header>
    );
}
