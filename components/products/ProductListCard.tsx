"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { SHOW_RATINGS } from "@/lib/config";

export interface ProductListItem {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    image_url?: string;
    base_price: number;
    currency?: string;
    rating?: number;
    review_count?: number;
    discount_percent?: number;
    product_images?: Array<{
        id: string;
        image_url: string;
        alt_text?: string | null;
        is_main: boolean;
        position: number;
    }>;
}

type Locale = 'en' | 'fr' | 'ar';

const translations: Record<Locale, {
    discount: string;
    addToFavorites: string;
    removeFavorite: string;
    reviews: string;
    add: string;
}> = {
    en: {
        discount: "Discount",
        addToFavorites: "Add to favorites",
        removeFavorite: "Remove from favorites",
        reviews: "reviews",
        add: "Add"
    },
    fr: {
        discount: "Réduction",
        addToFavorites: "Ajouter aux favoris",
        removeFavorite: "Retirer des favoris",
        reviews: "avis",
        add: "Ajouter"
    },
    ar: {
        discount: "خصم",
        addToFavorites: "إضافة إلى المفضلة",
        removeFavorite: "إزالة من المفضلة",
        reviews: "تقييم",
        add: "أضف"
    }
};

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400";
const DEFAULT_CURRENCY = 'TND';

// Helper function to get translated product name
function getProductName(product: ProductListItem, locale: string): string {
    if (locale === 'ar' && product.name_ar) {
        return product.name_ar;
    }
    if (locale === 'fr' && product.name_fr) {
        return product.name_fr;
    }
    return product.name;
}

// Helper function to get product image (sorted by position)
function getProductImage(product: ProductListItem): string {
    if (product.product_images && product.product_images.length > 0) {
        // Sort by position, then find main image
        const sortedImages = [...product.product_images].sort((a, b) => a.position - b.position);
        const mainImage = sortedImages.find(img => img.is_main);
        if (mainImage?.image_url) return mainImage.image_url;
        if (sortedImages[0]?.image_url) return sortedImages[0].image_url;
    }
    return product.image_url || FALLBACK_IMAGE;
}

// Helper function to format price
function formatPrice(price: number, currency: string): string {
    return `${Math.round(price)} ${currency}`;
}

interface ProductListCardProps {
    product: ProductListItem;
    locale: string;
    isFavorite: boolean;
    onToggleFavorite: (productId: string) => void;
    onAddToCart: (product: ProductListItem) => void;
    categorySlug?: string;
    /** "large" shows a taller card in carousels (landing page). */
    size?: "default" | "large";
    /** "grid" fills its grid cell (two per row on phones); "carousel" keeps a fixed width for horizontal rows. */
    layout?: "grid" | "carousel";
}

export default function ProductListCard({
    product,
    locale,
    isFavorite,
    onToggleFavorite,
    onAddToCart,
    size = "default",
    layout = "grid",
}: ProductListCardProps) {
    const productUrl = useMemo(() => `/${locale}/products/${product.slug}`, [locale, product.slug]);
    const t = useMemo(() => translations[locale as Locale] || translations.en, [locale]);
    const productName = useMemo(() => getProductName(product, locale), [product, locale]);
    const productImage = useMemo(() => getProductImage(product), [product]);

    const { discountedPrice, hasDiscount } = useMemo(() => {
        const discountPercent = product.discount_percent;
        const hasDiscount = !!discountPercent && discountPercent > 0;
        const price = hasDiscount ? product.base_price * (1 - discountPercent / 100) : product.base_price;
        return { discountedPrice: price, hasDiscount };
    }, [product.base_price, product.discount_percent]);

    const currency = product.currency || DEFAULT_CURRENCY;
    const reviewCount = product.review_count || 0;
    const rating = product.rating || 0;
    const width = layout === "carousel" ? (size === "large" ? "w-48 sm:w-64" : "w-44 sm:w-60") : "w-full";

    return (
        <article className={`${width} min-w-0 shrink-0`}>
            {/* Photo */}
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface">
                <Link href={productUrl} aria-label={productName} className="block h-full w-full">
                    <Image
                        src={productImage}
                        alt={productName || "Product image"}
                        fill
                        sizes={layout === "carousel" ? "(max-width: 640px) 48vw, 256px" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"}
                        className="object-cover object-top transition-transform duration-300 hover:scale-[1.03]"
                    />
                </Link>
                {hasDiscount && (
                    <span className="absolute start-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
                        -{Math.round(product.discount_percent ?? 0)}%
                    </span>
                )}
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        onToggleFavorite(product.id);
                    }}
                    className="absolute end-1.5 top-1.5 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm outline-none backdrop-blur transition hover:bg-card focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={isFavorite ? `${t.removeFavorite}: ${productName}` : `${t.addToFavorites}: ${productName}`}
                    aria-pressed={isFavorite}
                    type="button"
                >
                    <svg className={`h-5 w-5 ${isFavorite ? "fill-accent text-accent" : "fill-none text-ink"}`} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                </button>
            </div>

            {/* Details */}
            <div className="pt-2.5">
                <Link href={productUrl}>
                    <h3 className="line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-ink transition hover:text-accent">{productName}</h3>
                </Link>

                {SHOW_RATINGS && reviewCount > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-mute" aria-label={`${rating} / 5`}>
                        <svg className="h-3.5 w-3.5 fill-accent" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                        </svg>
                        <span>{rating.toFixed(1)}</span>
                        <span>({reviewCount} {t.reviews})</span>
                    </div>
                )}

                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                        <span className={`text-[15px] font-semibold ${hasDiscount ? "text-accent" : "text-ink"}`}>
                            {formatPrice(discountedPrice, currency)}
                        </span>
                        {hasDiscount && <span className="text-xs text-mute line-through">{formatPrice(product.base_price, currency)}</span>}
                    </div>
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            onAddToCart(product);
                        }}
                        className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-ink px-3 text-sm font-medium text-white outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                        aria-label={`${t.add}: ${productName}`}
                        type="button"
                    >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                        <span className="hidden sm:inline">{t.add}</span>
                    </button>
                </div>
            </div>
        </article>
    );
}
