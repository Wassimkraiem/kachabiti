"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getProductName } from "@/lib/utils/product-utils";
import { MIN_SEARCH_LENGTH } from "@/lib/product-search";
import { storefront } from "@/lib/storefront-api";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";
const SUGGESTIONS = 6;
const DEBOUNCE_MS = 250;

const translations = {
    en: { seeAll: "See all results for “{query}”", none: "No products match “{query}”", searching: "Searching…" },
    fr: { seeAll: "Voir tous les résultats pour « {query} »", none: "Aucun produit ne correspond à « {query} »", searching: "Recherche…" },
    ar: { seeAll: "عرض كل النتائج لـ «{query}»", none: "لا توجد منتجات تطابق «{query}»", searching: "جاري البحث…" },
};

interface Suggestion {
    id: string;
    slug: string;
    name: string;
    image: string | null;
    price: number;
    originalPrice: number | null;
}

interface SuggestionRow {
    id: string;
    slug: string;
    name: string;
    name_ar: string | null;
    name_fr: string | null;
    base_price: number;
    product_images: { image_url: string; is_main: boolean; position: number; variant_id: string | null }[] | null;
    discount_percent: number;
}

function mainImage(images: SuggestionRow["product_images"]): string | null {
    const pool = (images ?? []).filter((img) => !img.variant_id);
    const list = pool.length > 0 ? pool : images ?? [];
    return (list.find((img) => img.is_main) ?? [...list].sort((a, b) => a.position - b.position)[0])?.image_url ?? null;
}

// The best matches, in rank order, with the same price rule as the product pages.
async function loadSuggestions(query: string, locale: string): Promise<Suggestion[]> {
    const q = query.trim();
    if (q.length < MIN_SEARCH_LENGTH && !/d/.test(q)) return [];
    const { rows } = await storefront<{ rows: SuggestionRow[] }>(`products?search=${encodeURIComponent(q)}&page_size=${SUGGESTIONS}`);
    return rows
        .map((row) => {
            const base = Number(row.base_price);
            const discount = Number(row.discount_percent);
            return {
                id: row.id,
                slug: row.slug,
                name: getProductName(row, locale),
                image: mainImage(row.product_images),
                price: Math.round(discount > 0 ? base * (1 - discount / 100) : base),
                originalPrice: discount > 0 ? Math.round(base) : null,
            };
        });
}

interface SearchBoxProps {
    locale: string;
    rtl: boolean;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** Visual style: the light desktop field or the dark mobile-menu field. */
    variant: "desktop" | "mobile";
    /** Called after navigating (e.g. to close the mobile menu). */
    onNavigate?: () => void;
    /** The results page for a query; defaults to /{locale}/products?search=. */
    resultsHref?: (query: string) => string;
}

export default function SearchBox({ locale, rtl, value, onChange, placeholder, variant, onNavigate, resultsHref }: SearchBoxProps) {
    const router = useRouter();
    const t = translations[locale as keyof typeof translations] || translations.en;
    const listId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [searchedFor, setSearchedFor] = useState("");
    // -1: nothing highlighted; suggestions.length: the "see all" row.
    const [active, setActive] = useState(-1);

    const query = value.trim();
    const searchable = query.length >= MIN_SEARCH_LENGTH || /\d/.test(query);

    useEffect(() => {
        if (!searchable) {
            setSuggestions([]);
            setSearchedFor("");
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        const timer = setTimeout(async () => {
            try {
                const results = await loadSuggestions(query, locale);
                if (!cancelled) {
                    setSuggestions(results);
                    setSearchedFor(query);
                    setActive(-1);
                }
            } catch (error) {
                console.error("Search suggestions failed:", error);
                if (!cancelled) setSuggestions([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, searchable, locale]);

    // Close when clicking outside.
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, []);

    const goToResults = () => {
        setOpen(false);
        router.push(resultsHref ? resultsHref(query) : `/${locale}/products${query ? `?${new URLSearchParams({ search: query })}` : ""}`);
        onNavigate?.();
    };

    const goToProduct = (slug: string) => {
        setOpen(false);
        router.push(`/${locale}/products/${slug}`);
        onNavigate?.();
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const rows = suggestions.length + (searchable ? 1 : 0);
        if (event.key === "ArrowDown" && rows > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (current + 1) % rows);
        } else if (event.key === "ArrowUp" && rows > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (current <= 0 ? rows - 1 : current - 1));
        } else if (event.key === "Escape") {
            setOpen(false);
            setActive(-1);
        } else if (event.key === "Enter" && open && active >= 0 && active < suggestions.length) {
            event.preventDefault();
            goToProduct(suggestions[active].slug);
        }
    };

    const showPanel = open && searchable;
    const dark = variant === "mobile";
    const inputClass = dark
        ? "w-full py-2 px-4 pr-10 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-gray-400"
        : `color-black w-full py-2 rounded-[15px] font-light border placeholder-[#969696] border-gray-300 br focus:outline-none focus:ring-2 focus:ring-[#7a3b2e] focus:border-transparent ${rtl ? "pl-10 pr-4" : "pl-4 pr-10"}`;

    return (
        <div ref={containerRef} className={dark ? "relative bg-gray-800 rounded-lg" : "relative bg-[#FAF7F2] rounded-[15px] text-black"}>
            <form
                role="search"
                onSubmit={(event) => {
                    event.preventDefault();
                    goToResults();
                }}
            >
                <input
                    type="search"
                    value={value}
                    onChange={(event) => {
                        onChange(event.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    role="combobox"
                    aria-expanded={showPanel}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    autoComplete="off"
                    enterKeyHint="search"
                    className={`${inputClass} [&::-webkit-search-cancel-button]:hidden`}
                />
                <button
                    className={`absolute ${rtl ? "left-2" : "right-2"} top-1/2 transform -translate-y-1/2`}
                    type="submit"
                    aria-label={placeholder}
                >
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>
            </form>

            {showPanel && (
                <div
                    id={listId}
                    role="listbox"
                    dir={rtl ? "rtl" : "ltr"}
                    className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white text-[#2b1a16] shadow-xl"
                >
                    {loading && suggestions.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-500">{t.searching}</p>
                    ) : suggestions.length === 0 && searchedFor === query ? (
                        <p className="px-4 py-3 text-sm text-gray-500">{t.none.replace("{query}", query)}</p>
                    ) : (
                        suggestions.map((item, index) => (
                            <Link
                                key={item.id}
                                id={`${listId}-${index}`}
                                role="option"
                                aria-selected={active === index}
                                href={`/${locale}/products/${item.slug}`}
                                onClick={() => {
                                    setOpen(false);
                                    onNavigate?.();
                                }}
                                onMouseEnter={() => setActive(index)}
                                className={`flex items-center gap-3 px-3 py-2 ${active === index ? "bg-[#FAF7F2]" : "hover:bg-[#FAF7F2]"}`}
                            >
                                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                                    {item.image && <Image src={item.image} alt="" fill sizes="48px" className="object-cover" />}
                                </div>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                                <span className="shrink-0 text-sm font-semibold text-[#7a3b2e]" dir="ltr">
                                    {item.price} {CURRENCY}
                                    {item.originalPrice !== null && (
                                        <span className="ms-1 text-xs font-normal text-gray-400 line-through">{item.originalPrice}</span>
                                    )}
                                </span>
                            </Link>
                        ))
                    )}
                    <button
                        type="button"
                        id={`${listId}-${suggestions.length}`}
                        role="option"
                        aria-selected={active === suggestions.length}
                        onMouseEnter={() => setActive(suggestions.length)}
                        onClick={goToResults}
                        className={`block w-full border-t border-gray-100 px-4 py-3 text-start text-sm font-medium text-[#7a3b2e] ${active === suggestions.length ? "bg-[#FAF7F2]" : "hover:bg-[#FAF7F2]"}`}
                    >
                        {t.seeAll.replace("{query}", query)}
                    </button>
                </div>
            )}
        </div>
    );
}
