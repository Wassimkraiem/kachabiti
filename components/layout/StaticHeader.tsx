"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { headerConfig } from '@/lib/config';
import { useLanguageSafe } from '@/lib/language-context';
import { getCategories } from '@/lib/categories-cache';
import { isRTL } from '@/lib/language-utils';
import CartButton from '../cart/CartButton';
import SearchBox from './SearchBox';
import MobileHeader from './MobileHeader';
import { useCustomer } from '@/lib/customer-auth';
import { useRouter, useSearchParams, usePathname } from "next/navigation";

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
    const router = useRouter();
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

    return (
        <header className="sticky top-0 z-40 w-full sm:static" dir={mounted ? (rtl ? 'rtl' : 'ltr') : 'ltr'}>
            {/* Top Bar - Desktop */}
            <div className="bg-primary text-white py-4 min-h-[64px] hidden sm:block">
                <div className={`max-w-7xl mx-auto flex justify-between items-center text-sm h-8 px-4`}>
                    <div className={`flex items-center ${mounted && rtl ? 'space-x-reverse space-x-4' : 'space-x-4'}`}>
                        <span dir="ltr">{headerConfig.contact.phone}</span>
                    </div>

                    <div className={`flex items-center ${mounted && rtl ? 'space-x-reverse space-x-2' : 'space-x-2'}`}>
                        <span>{t.followUs}</span>
                        <div className={`flex ${mounted && rtl ? 'space-x-reverse space-x-2' : 'space-x-2'} justify-center`}>
                            {Object.entries(headerConfig.social).map(([platform, data]) => (
                                <a
                                    key={platform}
                                    href={data.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-gray-300"
                                    aria-label={`Follow us on ${platform}`}
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                        <path d={data.icon} />
                                    </svg>
                                </a>
                            ))}
                        </div>
                    </div>

                    <div className={`flex items-center ${mounted && rtl ? 'space-x-reverse space-x-4' : 'space-x-4'} min-h-[32px]`}>
                        {/* Authentication removed - sign in/register link removed */}
                        <div className="relative group">
                            <button className={`flex items-center ${mounted && rtl ? 'flex-row-reverse space-x-reverse space-x-1' : 'space-x-1'} hover:text-gray-300`}>
                                <span>{headerConfig.languages.find(lang => lang.code === locale)?.flag || '🇺🇸'}</span>
                                <span>{headerConfig.languages.find(lang => lang.code === locale)?.name || 'English'}</span>
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <div className={`absolute ${mounted && rtl ? 'left-0' : 'right-0'} mt-2 w-48 bg-white rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50`}>
                                <div className="py-1">
                                    {headerConfig.languages.map((lang) => {
                                        // Preserve current path when switching languages
                                        const currentPath = pathname || '';
                                        // Remove current locale from path if it exists
                                        const pathWithoutLocale = currentPath.replace(/^\/(en|fr|ar)/, '') || '/';
                                        // Build new path with selected language
                                        let newPath = pathWithoutLocale === '/' ? `/${lang.code}` : `/${lang.code}${pathWithoutLocale}`;

                                        // Preserve search params if they exist
                                        const queryString = searchParams.toString();
                                        if (queryString) {
                                            newPath += `?${queryString}`;
                                        }

                                        return (
                                            <Link
                                                key={lang.code}
                                                href={newPath}
                                                className={`flex items-center ${mounted && rtl ? 'flex-row-reverse space-x-reverse' : 'space-x-2'} px-4 py-2 text-sm text-gray-700 hover:bg-gray-100`}
                                            >
                                                <span>{lang.flag}</span>
                                                <span>{lang.name}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Header - Desktop */}
            <div className="bg-white border-b border-gray-200 py-4 px-4 hidden sm:block">
                <div className="max-w-7xl mx-auto flex justify-between items-center min-h-[72px]">
                    <div className="cursor-pointer flex items-center space-x-2 shrink-0" onClick={() => router.push(`/${locale}`)}>
                        <Image
                            src="/assets/images/logoKachabity.jpg"
                            alt="logo"
                            width={60}
                            height={60}
                            priority
                            className="object-contain"
                        />
                    </div>

                    {/* Search - Keep original design */}
                    <div className="flex-1 max-w-lg mx-8">
                        <SearchBox
                            locale={locale}
                            rtl={rtl}
                            value={search}
                            onChange={setSearch}
                            placeholder={t.searchPlaceholder + ' ...'}
                            variant="desktop"
                            resultsHref={searchResultsHref}
                        />
                    </div>

                    {/* Account + Cart */}
                    <div className="flex items-center gap-5 shrink-0">
                        <Link
                            href={user ? `/${locale}/settings` : `/${locale}/auth`}
                            className="flex items-center gap-2 text-sm font-medium text-[#2b1a16] hover:text-[#7a3b2e] transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {user ? t.myAccount : t.logIn}
                        </Link>
                        <CartButton />
                    </div>
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

            {/* Navigation Bar - Desktop */}
            <div className="bg-black text-white py-3 px-4 min-h-[52px] hidden sm:block">
                <div className={`max-w-7xl mx-auto flex justify-between items-center ${mounted && rtl ? 'flex-row-reverse' : ''}`}>
                    <nav className={`flex ${mounted && rtl ? 'space-x-reverse space-x-8' : 'space-x-8'}`}>
                        {headerConfig.navigation.map((item) => (
                            item.label === "Categories" ? (
                                <div
                                    key={item.href}
                                    className="relative"
                                    onMouseEnter={() => setIsCategoriesOpen(true)}
                                    onMouseLeave={() => setIsCategoriesOpen(false)}
                                >
                                    <button
                                        className="text-white hover:text-gray-300 transition flex items-center space-x-1"
                                    >

                                        <>

                                            <span>{t.categories}</span>
                                            <svg
                                                className={`w-4 h-4 transition-transform ${isCategoriesOpen ? 'rotate-180' : ''}`}
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </>


                                    </button>

                                    {/* Dropdown Menu */}
                                    <div
                                        className={`absolute top-full ${rtl ? 'right-0' : 'left-0'} mt-2 w-56 bg-white rounded-md shadow-lg transition-all duration-200 z-50 ${isCategoriesOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
                                            }`}
                                    >
                                        <div className="py-2">
                                            {isLoadingCategories ? (
                                                <div className={`px-4 py-2 text-sm text-gray-500 ${rtl ? 'text-right' : 'text-left'}`}>{t.loading}</div>
                                            ) : categories.length > 0 ? (
                                                <>
                                                    <Link
                                                        key={'all-categories'}
                                                        href={`/${locale}/categories`}
                                                        className={`block px-4 py-1 text-lg font-medium text-gray-700 hover:bg-gray-100 hover:text-[#7a3b2e] transition ${rtl ? 'text-right' : 'text-left'}`}
                                                    >
                                                        {t.allCategories}
                                                    </Link>
                                                    {
                                                        categories.map((category) => (
                                                            <Link
                                                                key={category.id}
                                                                href={`/${locale}/products?category=${category.slug}`}
                                                                className={`block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-[#7a3b2e] transition ${rtl ? 'text-right' : 'text-left'}`}
                                                                style={{ paddingInlineStart: 16 + (category.depth ?? 0) * 16 }}
                                                            >
                                                                {getCategoryName(category, locale)}
                                                            </Link>
                                                        ))
                                                    }

                                                </>

                                            ) : (
                                                <div className={`px-4 py-2 text-sm text-gray-500 ${rtl ? 'text-right' : 'text-left'}`}>{t.noCategoriesFound}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : item.label === "Discounts" ?
                                <Link
                                    key={`/${locale}/products?promo=true`}
                                    href={`/${locale}/products?promo=true`}
                                    className="text-white hover:text-gray-300 transition"
                                >
                                    {t.discounts}
                                </Link>
                                : item.label === "About Us" ?
                                    <Link
                                        key={item.href}
                                        href={`/${locale}${item.href}`}
                                        className="text-white hover:text-gray-300 transition"
                                    >
                                        {t.aboutUs}
                                    </Link>
                                    : item.label === "Contact Us" ?
                                        <Link
                                            key={item.href}
                                            href={`/${locale}${item.href}`}
                                            className="text-white hover:text-gray-300 transition"
                                        >
                                            {t.contactUs}
                                        </Link>
                                        :
                                        (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className="text-white hover:text-gray-300 transition"
                                            >
                                                {item.label}
                                            </Link>
                                        )
                        ))}
                    </nav>
                    <div className={`gap-5 cursor-pointer flex items-center ${mounted && rtl ? 'flex-row-reverse space-x-reverse space-x-2' : 'space-x-2'} border border-[#FFFFFF] px-4 py-2 rounded-[11px]`} onClick={() => router.push(`/${locale}/products`)} >
                        <Image src="/assets/images/icons/Cup.svg" alt="handmade" width={16} height={16} />
                        <span className="font-medium">{t.handmade}</span>
                    </div>
                </div>
            </div>
        </header>
    );
}
