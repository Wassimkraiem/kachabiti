"use client";

import { cartLineKey, useCart } from "@/lib/cart-context";
import { useLanguage } from "@/lib/language-context";
import { storefront } from "@/lib/storefront-api";
import { useState, useEffect } from "react";
import Link from "next/link";
import CartItem from "@/components/cart/CartItem";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import Image from "next/image";

const content = {
    en: {
        myCart: "My Cart",
        emptyCart: "Your cart is empty",
        startShopping: "Start Shopping",
        startAddingItems: "Start adding items to your cart",
        subtotal: "Subtotal",
        shipping: "Shipping",
        freeShipping: "Free Shipping",
        calculating: "Calculating...",
        orderTotal: "Order Total",
        orderSummary: "Order Summary",
        continueShopping: "Continue Shopping",
        checkout: "Proceed to Checkout",
        reviews: "reviews",
        loadingCart: "Loading cart..."
    },
    fr: {
        myCart: "Mon Panier",
        emptyCart: "Votre panier est vide",
        startShopping: "Commencer vos achats",
        startAddingItems: "Commencez à ajouter des articles à votre panier",
        subtotal: "Sous-total",
        shipping: "Livraison",
        freeShipping: "Livraison Gratuite",
        calculating: "Calcul en cours...",
        orderTotal: "Total de la commande",
        orderSummary: "Résumé de la commande",
        continueShopping: "Continuer vos achats",
        checkout: "Passer à la caisse",
        reviews: "avis",
        loadingCart: "Chargement du panier..."
    },
    ar: {
        myCart: "سلة التسوق",
        emptyCart: "سلتك فارغة",
        startShopping: "ابدأ التسوق",
        startAddingItems: "ابدأ بإضافة العناصر إلى سلة التسوق",
        subtotal: "المجموع الفرعي",
        shipping: "الشحن",
        freeShipping: "شحن مجاني",
        calculating: "جاري الحساب...",
        orderTotal: "إجمالي الطلب",
        orderSummary: "ملخص الطلب",
        continueShopping: "متابعة التسوق",
        checkout: "المتابعة للدفع",
        reviews: "تقييم",
        loadingCart: "جاري تحميل السلة..."
    }
};

export default function CartPage() {
    const { items, subtotal, updateQuantity, removeItem, isCartLoaded } = useCart();
    const { locale } = useLanguage();
    const text = content[locale as keyof typeof content] || content.en;
    const [shippingCost, setShippingCost] = useState(0);
    const [isLoadingShipping, setIsLoadingShipping] = useState(true);

    useEffect(() => {

        async function fetchShipping() {

            try {
                const quote = await storefront<{ shipping_cost: number }>(`checkout-quote?country=Tunisia&subtotal=${subtotal}`);
                setShippingCost(quote.shipping_cost);
                setIsLoadingShipping(true)
            } catch (error) {
                console.error('Error calculating shipping:', error);
                setShippingCost(7); // Default shipping cost
            } finally {
                setIsLoadingShipping(false);
            }
        }

        fetchShipping();
    }, [subtotal]);
    const total = subtotal + shippingCost;

    // Show loading while cart is loading from localStorage
    if (!isCartLoaded || isLoadingShipping) {
        return <LoadingSpinner message={text.loadingCart} />;
    }

    if (items.length === 0) {
        return (
            <>
                <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                    <div className="text-center">
                        <svg
                            className="w-32 h-32 text-gray-300 mx-auto mb-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1}
                                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                            />
                        </svg>
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">{text.emptyCart}</h2>
                        <p className="text-gray-600 mb-6">{text.startAddingItems}</p>
                        <Link
                            href={`/${locale}`}
                            className="inline-block px-6 py-3 bg-[#842E1B] text-white rounded-lg hover:bg-[#6b2516] transition font-medium"
                        >
                            {text.startShopping}
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <div className="min-h-screen bg-[#FFFFFF] py-12">
                <div className="max-w-7xl mx-auto px-4">

                    <div className="absolute  left-[-150px] ">
                        <Image src="/assets/images/checkout/backgroundCheckout.svg" alt="bg-checkout" width={100} height={100} className="w-full h-[full] object-cover" />
                    </div>
                    <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-8">

                        <div className="lg:col-span-2">
                            <div className="space-y-6">
                                {items.map((item) => (
                                    <CartItem
                                        key={cartLineKey(item)}
                                        item={item}
                                        onUpdateQuantity={updateQuantity}
                                        onRemove={removeItem}
                                        variant="default"
                                        reviewsText={text.reviews}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Order Summary */}
                        <div className="lg:col-span-1">
                            <div className="bg-white rounded-[2px] shadow-sm p-6 sticky top-4">
                                <h2 className="text-xl font-bold text-gray-900 mb-6">{text.orderSummary}</h2>

                                <div className="space-y-3 border-b pb-4 mb-4">
                                    <div className="flex justify-between text-gray-700">
                                        <span>{text.subtotal}</span>
                                        <span className="font-semibold">{subtotal} TND</span>
                                    </div>
                                    <div className="flex justify-between text-gray-700">
                                        <span>{text.shipping}</span>
                                        {isLoadingShipping ? (
                                            <span className="text-gray-400">{text.calculating}</span>
                                        ) : shippingCost === 0 ? (
                                            <span className="font-semibold text-green-600">{text.freeShipping}</span>
                                        ) : (
                                            <span className="font-semibold">{shippingCost} TND</span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex justify-between text-lg font-bold text-gray-900 mb-6">
                                    <span>{text.orderTotal}</span>
                                    <span>{total} TND</span>
                                </div>

                                <Link
                                    href={`/${locale}/checkout`}
                                    className="block w-full py-4 bg-[#7a3b2e] text-white text-center rounded-lg hover:bg-[#5e2d23] transition font-medium text-lg mb-4"
                                >
                                    {text.checkout}
                                </Link>

                                <Link
                                    href={`/${locale}`}
                                    className="block w-full py-3 border-2 border-gray-300 text-gray-700 text-center rounded-lg hover:bg-gray-50 transition font-medium"
                                >
                                    {text.continueShopping}
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
            <div className="absolute top-70 right-10 ">
                <Image src="/assets/images/checkout/backgroundDots.svg" alt="bg-checkout" width={100} height={100} className="w-full h-full object-cover" />
            </div>
        </>
    );
}

