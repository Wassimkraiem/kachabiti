"use client";

import Image from "next/image";
import { useLanguage } from "@/lib/language-context";
import { cartLineKey } from "@/lib/cart-context";
import { SHOW_RATINGS } from "@/lib/config";

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400";

interface CartItemProps {
    item: {
        id: string;
        name: string;
        name_ar?: string;
        name_fr?: string;
        variantId?: string;
        variantLabel?: string;
        price: number;
        image: string;
        quantity: number;
        rating?: number;
        reviewCount?: number;
    };
    onUpdateQuantity?: (id: string, quantity: number) => void;
    onRemove?: (id: string) => void;
    variant?: "compact" | "default" | "detailed"; // compact for drawer, default for checkout, detailed for cart page
    showTotal?: boolean; // Show item total price
    reviewsText?: string; // Translation for "reviews"
}

// Helper function to get valid image URL
function getImageUrl(image: string): string {
    return image && image.trim() !== '' ? image : FALLBACK_IMAGE;
}

export default function CartItem({
    item,
    onUpdateQuantity,
    onRemove,
    variant = "default",
    showTotal = false,
    reviewsText = "reviews",
}: CartItemProps) {
    const { locale } = useLanguage();
    const itemName = locale === 'ar' && item.name_ar ? item.name_ar :
        locale === 'fr' && item.name_fr ? item.name_fr :
            item.name;

    const itemTotal = item.price * item.quantity;
    const imageUrl = getImageUrl(item.image);

    // Compact variant (for drawer)
    if (variant === "compact") {
        return (
            <div className="flex gap-4 sm:gap-6">
                <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-surface sm:h-30 sm:w-30">
                    <Image
                        src={imageUrl}
                        alt={itemName || "Product"}
                        fill
                        className="object-cover object-top"
                        sizes="120px"
                    />
                </div>

                <div className="flex-1 flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-start mb-1">
                            <h3 className="text-[13px] font-normal text-mute pr-8">
                                {itemName}
                                {item.variantLabel && <span className="block text-[12px] text-mute mt-0.5">{item.variantLabel}</span>}
                            </h3>
                            {onRemove && (
                                <button
                                    onClick={() => onRemove(cartLineKey(item))}
                                    className="text-mute hover:text-red-500 transition shrink-0"
                                >
                                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M18.5625 4.8125H3.4375" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M8.9375 8.9375V14.4375" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M13.0625 8.9375V14.4375" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M17.1875 4.8125V17.875C17.1875 18.0573 17.1151 18.2322 16.9861 18.3611C16.8572 18.4901 16.6823 18.5625 16.5 18.5625H5.5C5.31766 18.5625 5.1428 18.4901 5.01386 18.3611C4.88493 18.2322 4.8125 18.0573 4.8125 17.875V4.8125" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M14.4375 4.8125V3.4375C14.4375 3.07283 14.2926 2.72309 14.0348 2.46523C13.7769 2.20737 13.4272 2.0625 13.0625 2.0625H8.9375C8.57283 2.0625 8.22309 2.20737 7.96523 2.46523C7.70737 2.72309 7.5625 3.07283 7.5625 3.4375V4.8125" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {SHOW_RATINGS && item.rating !== 0  && item.reviewCount !== 0 && (

                            <div className="flex items-center gap-10 mb-1">
                                <div className="flex gap-2">
                                    {[...Array(5)].map((_, i) => (
                                        <svg
                                            key={i}
                                            className={`w-4 h-4 ${i < Math.floor(item.rating!) ? 'text-accent fill-accent' : 'text-mute fill-gray-300'}`}
                                            width="18"
                                            height="18"
                                            viewBox="0 0 18 18"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path d="M6.65394 1.58646C7.5321 -0.528821 10.4679 -0.52882 11.3461 1.58646L11.9577 3.05983C12.3174 3.9261 13.107 4.52663 14.0227 4.63041L15.7297 4.82385C17.8853 5.06813 18.7756 7.7755 17.2013 9.29884L15.752 10.7012C15.1148 11.3177 14.8333 12.2258 15.0069 13.1045L15.3568 14.8758C15.7997 17.118 13.3977 18.8109 11.5018 17.5927L10.3571 16.8572C9.52764 16.3242 8.47236 16.3242 7.64291 16.8572L6.49819 17.5927C4.60234 18.8109 2.20031 17.118 2.64323 14.8758L2.99315 13.1045C3.16673 12.2258 2.88518 11.3177 2.24798 10.7012L0.798712 9.29884C-0.775619 7.7755 0.114716 5.06813 2.27034 4.82385L3.97726 4.63041C4.89305 4.52663 5.68263 3.9261 6.04226 3.05983L6.65394 1.58646Z" fill="currentColor" />
                                        </svg>
                                    ))}
                                </div>
                                <span className="text-[10px] text-mute">
                                    {item.reviewCount ? `${(item.reviewCount / 1000).toFixed(1)} K ${reviewsText}` : ''}
                                </span>
                            </div>
                        )}
                    </div>

                    <div>
                        <p className="mb-4 text-[17px] font-semibold text-ink" dir="ltr">
                            {item.price} TND
                        </p>

                        {onUpdateQuantity && (
                            <div className="flex items-center">
                                <button
                                    onClick={() => onUpdateQuantity(cartLineKey(item), item.quantity - 1)}
                                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-xl text-ink transition hover:bg-surface" aria-label="−"
                                >
                                    −
                                </button>
                                <span className="text-ink text-[15px] font-medium min-w-12 text-center">
                                    {item.quantity}
                                </span>
                                <button
                                    onClick={() => onUpdateQuantity(cartLineKey(item), item.quantity + 1)}
                                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-xl text-ink transition hover:bg-surface" aria-label="+"
                                >
                                    +
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Default variant (for checkout)
    if (variant === "default") {
        return (
            <div className="border rounded-xl p-6">
                <div className="flex gap-6">
                    <div className="relative w-32 h-32 shrink-0 bg-surface rounded-lg overflow-hidden">
                        <Image
                            src={imageUrl}
                            alt={itemName || "Product"}
                            fill
                            className="object-cover object-top"
                            sizes="128px"
                        />
                    </div>

                    <div className="flex-1 flex flex-col justify-between">
                        <div>
                            <div className="flex justify-between items-start mb-1">
                                <h3 className="text-[13px] font-normal text-mute pr-8">
                                    {itemName}
                                    {item.variantLabel && <span className="block text-[12px] text-mute mt-0.5">{item.variantLabel}</span>}
                                </h3>
                                {onRemove && (
                                    <button
                                        onClick={() => onRemove(cartLineKey(item))}
                                        className="text-mute hover:text-red-500 transition shrink-0"
                                    >
                                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M18.5625 4.8125H3.4375" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M8.9375 8.9375V14.4375" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M13.0625 8.9375V14.4375" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M17.1875 4.8125V17.875C17.1875 18.0573 17.1151 18.2322 16.9861 18.3611C16.8572 18.4901 16.6823 18.5625 16.5 18.5625H5.5C5.31766 18.5625 5.1428 18.4901 5.01386 18.3611C4.88493 18.2322 4.8125 18.0573 4.8125 17.875V4.8125" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M14.4375 4.8125V3.4375C14.4375 3.07283 14.2926 2.72309 14.0348 2.46523C13.7769 2.20737 13.4272 2.0625 13.0625 2.0625H8.9375C8.57283 2.0625 8.22309 2.20737 7.96523 2.46523C7.70737 2.72309 7.5625 3.07283 7.5625 3.4375V4.8125" stroke="#777A7E" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            {SHOW_RATINGS && !!item.rating && (
                                <div className="flex items-center gap-10 mb-1">
                                    <div className="flex gap-2">
                                        {[...Array(5)].map((_, i) => (
                                            <svg
                                                key={i}
                                                className={`w-4 h-4 ${i < Math.floor(item.rating!) ? 'text-accent fill-accent' : 'text-mute fill-gray-300'}`}
                                                width="18"
                                                height="18"
                                                viewBox="0 0 18 18"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <path d="M6.65394 1.58646C7.5321 -0.528821 10.4679 -0.52882 11.3461 1.58646L11.9577 3.05983C12.3174 3.9261 13.107 4.52663 14.0227 4.63041L15.7297 4.82385C17.8853 5.06813 18.7756 7.7755 17.2013 9.29884L15.752 10.7012C15.1148 11.3177 14.8333 12.2258 15.0069 13.1045L15.3568 14.8758C15.7997 17.118 13.3977 18.8109 11.5018 17.5927L10.3571 16.8572C9.52764 16.3242 8.47236 16.3242 7.64291 16.8572L6.49819 17.5927C4.60234 18.8109 2.20031 17.118 2.64323 14.8758L2.99315 13.1045C3.16673 12.2258 2.88518 11.3177 2.24798 10.7012L0.798712 9.29884C-0.775619 7.7755 0.114716 5.06813 2.27034 4.82385L3.97726 4.63041C4.89305 4.52663 5.68263 3.9261 6.04226 3.05983L6.65394 1.58646Z" fill="currentColor" />
                                            </svg>
                                        ))}
                                    </div>
                                    <span className="text-[10px] text-mute">
                                        {item.reviewCount ? `${(item.reviewCount / 1000).toFixed(1)} K ${reviewsText}` : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div>
                            <p className="mb-4 text-[17px] font-semibold text-ink" dir="ltr">
                                {item.price} TND
                            </p>

                            {onUpdateQuantity && (
                                <div className="flex items-center">
                                    <button
                                        onClick={() => onUpdateQuantity(cartLineKey(item), item.quantity - 1)}
                                        className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-xl text-ink transition hover:bg-surface" aria-label="−"
                                    >
                                        −
                                    </button>
                                    <span className="text-ink text-[15px] font-medium min-w-12 text-center">
                                        {item.quantity}
                                    </span>
                                    <button
                                        onClick={() => onUpdateQuantity(cartLineKey(item), item.quantity + 1)}
                                        className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-xl text-ink transition hover:bg-surface" aria-label="+"
                                    >
                                        +
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Detailed variant (for cart page)
    return (
        <div className="flex flex-col md:grid md:grid-cols-5 gap-4 items-center border-b pb-6">
            {/* Product Image and Name */}
            <div className="flex items-center gap-4 col-span-2 w-full md:w-auto">
                <div className="relative w-24 h-24 shrink-0 bg-surface rounded-lg overflow-hidden">
                    <Image
                        src={imageUrl}
                        alt={itemName || "Product"}
                        fill
                        className="object-cover object-top"
                        sizes="96px"
                    />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-medium text-ink">
                        {itemName}
                    </h3>
                    {item.variantLabel && <p className="text-sm text-mute mt-0.5">{item.variantLabel}</p>}
                    {SHOW_RATINGS && !!item.rating && (
                        <div className="flex items-center gap-1 text-sm text-mute mt-1">
                            <div className="flex">
                                {[...Array(5)].map((_, i) => (
                                    <svg
                                        key={i}
                                        className={`w-4 h-4 ${i < Math.floor(item.rating!) ? 'text-accent' : 'text-mute'}`}
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                    >
                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                    </svg>
                                ))}
                            </div>
                            <span>({item.reviewCount})</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Price */}
            <span className="text-lg font-medium text-ink mt-4 md:mt-0">
                {item.price} TND
            </span>

            {/* Quantity Controls */}
            {onUpdateQuantity ? (
                <div className="flex items-center gap-2 mt-4 md:mt-0">
                    <button
                        onClick={() => onUpdateQuantity(cartLineKey(item), item.quantity - 1)}
                        className="w-8 h-8 border border-line rounded-md flex items-center justify-center hover:bg-surface transition text-lg font-bold"
                    >
                        −
                    </button>
                    <span className="text-lg font-medium min-w-8 text-center">
                        {item.quantity}
                    </span>
                    <button
                        onClick={() => onUpdateQuantity(cartLineKey(item), item.quantity + 1)}
                        className="w-8 h-8 border border-line rounded-md flex items-center justify-center hover:bg-surface transition text-lg font-bold"
                    >
                        +
                    </button>
                </div>
            ) : (
                <span className="text-lg font-medium text-ink mt-4 md:mt-0">
                    Qty: {item.quantity}
                </span>
            )}

            {/* Total Price */}
            {showTotal && (
                <span className="text-lg font-bold text-[#4CAF50] text-right mt-4 md:mt-0">
                    {itemTotal.toFixed(2)} TND
                </span>
            )}

            {/* Remove Button */}
            {onRemove && (
                <button
                    onClick={() => onRemove(cartLineKey(item))}
                    className="text-mute hover:text-red-500 transition mt-4 md:mt-0"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            )}
        </div>
    );
}

