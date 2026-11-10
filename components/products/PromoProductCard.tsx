"use client";

import Image from "next/image";
import { getProductName } from "@/lib/utils/product-utils";
import Link from "next/link";
import PromoCountdownTimer from "../timers/PromoCountdownTimer";
import StockProgress from "../ui/StockProgress";

// Sold/in-stock counts are hidden from shoppers for now; set to true to show them again.
const SHOW_STOCK_PROGRESS = false;
import AddToCartButton from "../cart/AddToCartButton";
import { useQuickAdd } from "@/lib/quick-add";
import type { PromoProduct } from "@/types/product";

interface PromoProductCardProps {
    product: PromoProduct;
    locale?: string;
    categorySlug?: string;
}

export default function PromoProductCard({ product, locale = 'en', categorySlug = 'all' }: PromoProductCardProps) {
    // Use price_cents if available, otherwise use base_price
    const basePrice = product.price_cents ?? product.base_price ?? 0;
    const quickAdd = useQuickAdd();
    const discountedPrice = product.discount_percent
        ? basePrice * (1 - product.discount_percent / 100)
        : basePrice;

    // Include category in search params for context
    const productUrl = categorySlug && categorySlug !== "all"
        ? `/${locale}/products/${product.slug}?category=${categorySlug}`
        : `/${locale}/products/${product.slug}`;

    return (
        <div className="rounded-2xl transition-shadow">
            <div className="flex flex-col lg:flex-row">
                <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden rounded-2xl bg-surface lg:aspect-auto lg:h-[220px] lg:w-[220px] xl:h-[250px] xl:w-[250px] 2xl:h-[270px] 2xl:w-[270px]">
                    <Link href={productUrl}>
                        <Image
                            src={product?.image_url || '/assets/images/logo.svg'}
                            alt={getProductName(product, locale) || "Product image"}
                            fill
                            sizes="(max-width: 1024px) 80vw, 270px"
                            className="object-cover object-top transition-transform duration-300 hover:scale-[1.03]"
                        />
                    </Link>
                    {/* Discount Badge */}
                    {product.discount_percent && product.discount_percent > 0 && (
                        <span className="absolute start-2 top-2 rounded-full bg-accent px-2.5 py-0.5 text-sm font-semibold text-white" dir="ltr">
                            -{Math.round(product.discount_percent ?? 0)}%
                        </span>
                    )}
                </div>

                {/* Product Info */}
                <div className="flex w-full flex-col justify-between gap-3 pt-1 lg:h-[220px] lg:flex-1 lg:px-5 xl:h-[250px] 2xl:h-[270px]">
                    <div className="space-y-2 lg:space-y-2.5 lg:pt-5">
                        {/* Title */}
                        <Link href={productUrl}>
                            <h3 className="text-[16px] font-medium text-accent hover:text-accent transition leading-tight">
                                {getProductName(product, locale)}
                            </h3>
                        </Link>

                        {/* Price */}
                        <div className="flex items-baseline gap-2 py-2">
                            <span className="text-[14px] font-medium text-ink">
                                {Math.round(discountedPrice)} {product.currency}
                            </span>
                            {product.discount_percent && product.discount_percent > 0 && (
                                <span className="text-[13px] text-mute line-through">
                                    {basePrice} {product.currency || 'TND'}
                                </span>
                            )}
                        </div>

                        {/* Stock Progress */}
                        {SHOW_STOCK_PROGRESS && (
                            <StockProgress sold={product.sold_count ?? 0} inStock={product.stock ?? 0} />
                        )}
                    </div>

                    {/* Countdown and Button */}
                    <div className="space-y-3 pb-5">
                        {product.promo_end_date && (
                            <div className="overflow-x-auto">
                                <PromoCountdownTimer targetDate={new Date(product.promo_end_date)} />
                            </div>
                        )}

                        <AddToCartButton
                            product={{
                                id: product.id,
                                name: product.name,
                                name_ar: product.name_ar,
                                name_fr: product.name_fr,
                                price: Math.round(discountedPrice),
                                image: product.image_url || "",
                                rating: product.rating || 4,
                                reviewCount: product.review_count || 0
                            }}
                            onAdd={() => quickAdd({ ...product, base_price: basePrice })}
                            className="w-full"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

