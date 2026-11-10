import Image from "next/image";
import Link from "next/link";
import type { LandingProduct } from "@/lib/landing-products";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";

interface LandingProductCardProps {
    product: LandingProduct;
    locale: string;
    sizes: string;
}

// Image-led product card: arched portrait photo, category, name and price.
export default function LandingProductCard({ product, locale, sizes }: LandingProductCardProps) {
    return (
        <Link
            href={`/${locale}/products/${product.slug}`}
            className="group flex h-full flex-col rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
        >
            <div className="arch relative aspect-[3/4] w-full border border-line bg-card transition-colors duration-300 group-hover:border-accent">
                {product.image && (
                    <Image src={product.image} alt={product.name} fill sizes={sizes} className="zoom-img object-cover object-top" />
                )}
                {product.discountPercent > 0 && (
                    <span className="absolute bottom-3 start-3 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold">
                        -{product.discountPercent}%
                    </span>
                )}
            </div>

            <div className="pt-3 text-start">
                {product.categoryName && <p className="text-xs text-mute">{product.categoryName}</p>}
                <h3 className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-snug text-ink transition-colors group-hover:text-accent">
                    {product.name}
                </h3>
                <p className="mt-1.5 flex items-baseline gap-2" dir="ltr">
                    <span className="font-semibold text-accent">{product.price} {CURRENCY}</span>
                    {product.originalPrice !== null && (
                        <span className="text-sm text-mute line-through">{product.originalPrice} {CURRENCY}</span>
                    )}
                </p>
            </div>
        </Link>
    );
}
