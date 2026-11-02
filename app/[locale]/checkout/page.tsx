"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cartLineKey, useCart } from "@/lib/cart-context";
import { useLanguage } from "@/lib/language-context";
import { governorateLabel, governorateOptions } from "@/lib/colissimo-data";
import { createOrder } from "@/lib/orders";
import { storefront } from "@/lib/storefront-api";
import { checkoutSchema, type CheckoutFormData } from "@/lib/schemas/checkout-schema";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import CartItem from "@/components/cart/CartItem";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { getCustomer } from "@/lib/customer-auth";
import toast from "react-hot-toast";
import { isRTL } from "@/lib/language-utils";

const content = {
    en: {
        summaryOrder: "Summary Order",
        information: "Information",
        payment: "Confirmation",
        summaryOrderConfirmation: "Order Confirmation",
        orderInformation: "Order Information",
        orderConfirmationDesc: "Your order has been placed successfully. We will process it shortly.",
        orderInfoDesc: "Please review your order details below",
        orderDate: "Order Date",
        orderNo: "Order No.",
        paymentMethod: "Payment",
        shippingAddress: "Shipping Address",
        deliveryAddress: "Delivery Address",
        firstName: "First Name",
        lastName: "Last Name",
        emailAddress: "Email Address",
        streetAddress: "Street Address",
        city: "City / Delegation",
        governorate: "Governorate",
        chooseGovernorate: "Choose your governorate",
        governorateRequired: "Choose your governorate",
        cityRequired: "Enter your city",
        phone: "Phone",
        continue: "Continue",
        confirmMyOrder: "Confirm my order",
        processing: "Processing...",
        discountCodes: "Discount Codes",
        enterCoupon: "Enter your coupon code",
        billingSummary: "Billing Summary",
        subtotal: "Subtotal",
        discount: "Discount",
        shipping: "Shipping",
        freeShipping: "Free Shipping",
        tax: "Tax",
        total: "Total",
        grandTotal: "Grand Total",
        orderComment: "Order Comment",
        typeHere: "Type here...",
        reviews: "reviews",
        quantity: "Quantity:",
        cashOnDelivery: "Livraison",
        thankYouMessage: "We'll be sending a shipping confirmation email when the items shipped successfully",
        thankYou: "Thank You For Shopping With Us!",
        artisanTeam: "Kachabity Team",
        continueShopping: "Continue Shopping",
        backToHome: "Back to Home",
        loading: "Loading...",
        fillShippingInfo: "Please fill in your shipping information to continue",
        deliveryTime: "Delivery within 48 hours",
        optional: "Optional",
        enterFirstName: "Enter your first name",
        enterLastName: "Enter your Last Name",
        enterEmail: "Enter your Email Address",
        enterStreetAddress: "Enter your Street Address",
        enterCity: "e.g. Akouda",
        orderConfirmedSuccess: "Order Confirmed Successfully!",
        checkEmailForDetails: "Check your email for order details",
        failedToCreateOrder: "Failed to create order. Please try again.",
        pricesChanged: "Some items in your cart changed price or are no longer available. Please review your cart.",
        totalChanged: "Your order total was updated. Please review it and confirm again.",
        outOfStock: "Some items in your cart are no longer in stock in the quantity you chose. Please update your cart.",
        chooseVariant: "Please choose a size and color for every item in your cart. Remove the item and add it again from its product page.",
        errorOccurred: "An error occurred. Please try again."
    },
    fr: {
        summaryOrder: "Résumé de la commande",
        information: "Information",
        payment: "Confirmation",
        summaryOrderConfirmation: "Confirmation de commande",
        orderInformation: "Informations de commande",
        orderConfirmationDesc: "Votre commande a été passée avec succès. Nous la traiterons sous peu.",
        orderInfoDesc: "Veuillez vérifier les détails de votre commande ci-dessous",
        orderDate: "Date de commande",
        orderNo: "N° de commande",
        paymentMethod: "Paiement",
        shippingAddress: "Adresse de livraison",
        deliveryAddress: "Adresse de livraison",
        firstName: "Prénom",
        lastName: "Nom",
        emailAddress: "Adresse e-mail",
        streetAddress: "Adresse",
        city: "Ville / Délégation",
        governorate: "Gouvernorat",
        chooseGovernorate: "Choisissez votre gouvernorat",
        governorateRequired: "Choisissez votre gouvernorat",
        cityRequired: "Entrez votre ville",
        phone: "Téléphone",
        continue: "Continuer",
        confirmMyOrder: "Confirmer ma commande",
        processing: "Traitement...",
        discountCodes: "Codes de réduction",
        enterCoupon: "Entrez votre code promo",
        billingSummary: "Résumé de facturation",
        subtotal: "Sous-total",
        discount: "Réduction",
        shipping: "Livraison",
        freeShipping: "Livraison Gratuite",
        tax: "Taxe",
        total: "Total",
        grandTotal: "Total général",
        orderComment: "Commentaire de commande",
        typeHere: "Écrivez ici...",
        reviews: "avis",
        quantity: "Quantité:",
        cashOnDelivery: "Livraison",
        thankYouMessage: "Nous vous enverrons un email de confirmation d'expédition",
        thankYou: "Merci d'avoir fait vos achats avec nous!",
        artisanTeam: "Équipe Artisan",
        continueShopping: "Continuer vos achats",
        backToHome: "Retour à l'accueil",
        loading: "Chargement...",
        fillShippingInfo: "Veuillez remplir vos informations de livraison pour continuer",
        deliveryTime: "Livraison sous 48 heures",
        optional: "Facultatif",
        enterFirstName: "Entrez votre prénom",
        enterLastName: "Entrez votre nom",
        enterEmail: "Entrez votre adresse e-mail",
        enterStreetAddress: "Entrez votre adresse",
        enterCity: "ex. Akouda",
        orderConfirmedSuccess: "Commande confirmée avec succès!",
        checkEmailForDetails: "Vérifiez votre e-mail pour les détails de la commande",
        failedToCreateOrder: "Échec de la création de la commande. Veuillez réessayer.",
        pricesChanged: "Certains articles de votre panier ont changé de prix ou ne sont plus disponibles. Veuillez vérifier votre panier.",
        totalChanged: "Le total de votre commande a été mis à jour. Veuillez le vérifier et confirmer à nouveau.",
        outOfStock: "Certains articles de votre panier ne sont plus en stock dans la quantité choisie. Veuillez mettre à jour votre panier.",
        chooseVariant: "Veuillez choisir une taille et une couleur pour chaque article. Retirez l'article et ajoutez-le à nouveau depuis sa page produit.",
        errorOccurred: "Une erreur s'est produite. Veuillez réessayer."
    },
    ar: {
        summaryOrder: "ملخص الطلب",
        information: "معلومات",
        payment: "التأكيد",
        summaryOrderConfirmation: "تأكيد الطلب",
        orderInformation: "معلومات الطلب",
        orderConfirmationDesc: "تم تقديم طلبك بنجاح. سنقوم بمعالجته قريباً.",
        orderInfoDesc: "يرجى مراجعة تفاصيل طلبك أدناه",
        orderDate: "تاريخ الطلب",
        orderNo: "رقم الطلب",
        paymentMethod: "الدفع",
        shippingAddress: "عنوان الشحن",
        deliveryAddress: "عنوان التوصيل",
        firstName: "الاسم الأول",
        lastName: "اسم العائلة",
        emailAddress: "البريد الإلكتروني",
        streetAddress: "العنوان",
        city: "المدينة / المعتمدية",
        governorate: "الولاية",
        chooseGovernorate: "اختر ولايتك",
        governorateRequired: "اختر ولايتك",
        cityRequired: "أدخل مدينتك",
        phone: "الهاتف",
        continue: "متابعة",
        confirmMyOrder: "تأكيد طلبي",
        processing: "جاري المعالجة...",
        discountCodes: "رموز الخصم",
        enterCoupon: "أدخل رمز القسيمة",
        billingSummary: "ملخص الفاتورة",
        subtotal: "المجموع الفرعي",
        discount: "الخصم",
        shipping: "الشحن",
        freeShipping: "شحن مجاني",
        tax: "الضريبة",
        total: "المجموع",
        grandTotal: "المجموع الكلي",
        orderComment: "تعليق الطلب",
        typeHere: "اكتب هنا...",
        reviews: "تقييم",
        quantity: "الكمية:",
        cashOnDelivery: "التوصيل",
        thankYouMessage: "سنرسل بريدًا إلكترونيًا للتأكيد عند الشحن",
        thankYou: "شكرًا لك على التسوق معنا!",
        artisanTeam: "فريق أرتيزان",
        continueShopping: "متابعة التسوق",
        backToHome: "العودة إلى الصفحة الرئيسية",
        loading: "جاري التحميل...",
        fillShippingInfo: "يرجى ملء معلومات الشحن للمتابعة",
        deliveryTime: "التوصيل خلال 48 ساعة",
        optional: "اختياري",
        enterFirstName: "أدخل اسمك الأول",
        enterLastName: "أدخل اسم العائلة",
        enterEmail: "أدخل عنوان بريدك الإلكتروني",
        enterStreetAddress: "أدخل عنوان الشارع",
        enterCity: "مثال: أكودة",
        orderConfirmedSuccess: "تم تأكيد الطلب بنجاح!",
        checkEmailForDetails: "تحقق من بريدك الإلكتروني للحصول على تفاصيل الطلب",
        failedToCreateOrder: "فشل إنشاء الطلب. يرجى المحاولة مرة أخرى.",
        pricesChanged: "تغيّر سعر بعض المنتجات في سلتك أو لم تعد متوفرة. يرجى مراجعة سلتك.",
        totalChanged: "تم تحديث إجمالي طلبك. يرجى مراجعته والتأكيد مرة أخرى.",
        outOfStock: "بعض المنتجات في سلتك لم تعد متوفرة بالكمية التي اخترتها. يرجى تحديث سلتك.",
        chooseVariant: "يرجى اختيار المقاس واللون لكل منتج في سلتك. احذف المنتج وأضفه من جديد من صفحته.",
        errorOccurred: "حدث خطأ. يرجى المحاولة مرة أخرى."
    }
};

export default function CheckoutPage() {
    const { items, subtotal, updateQuantity, removeItem, clearCart, isCartLoaded } = useCart();
    const { locale } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const text = content[locale as keyof typeof content] || content.en;
    const rtl = isRTL(locale);

    // Get step from URL or default to 1
    const stepFromUrl = parseInt(searchParams.get('step') || '1', 10);
    const [currentStep, setCurrentStep] = useState(stepFromUrl);
    const [isProcessing, setIsProcessing] = useState(false);
    const [orderConfirmed, setOrderConfirmed] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    // Initialize savedItems and savedOrderSummary from sessionStorage if available
    const [savedItems, setSavedItems] = useState<typeof items>(() => {
        if (typeof window !== 'undefined') {
            const saved = sessionStorage.getItem('checkoutSavedItems');
            return saved ? JSON.parse(saved) : [];
        }
        return [];
    });

    const [savedOrderSummary, setSavedOrderSummary] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = sessionStorage.getItem('checkoutOrderSummary');
            return saved ? JSON.parse(saved) : {
                subtotal: 0,
                shippingCost: 0,
                tax: 0,
                taxRate: 0,
                discount: 0,
                total: 0
            };
        }
        return {
            subtotal: 0,
            shippingCost: 0,
            tax: 0,
            taxRate: 0,
            discount: 0,
            total: 0
        };
    });
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    const [isBillingOpen, setIsBillingOpen] = useState(true);
    const [isDiscountOpen, setIsDiscountOpen] = useState(false);

    // React Hook Form setup with Zod validation
    const {
        register,
        handleSubmit: handleFormSubmit,
        formState: { errors },
        watch,
    } = useForm<CheckoutFormData>({
        resolver: zodResolver(checkoutSchema),
        defaultValues: {
            firstName: "",
            lastName: "",
            email: "",
            phone: "",
            address: "",
            city: "",
            state: "",
            zipCode: "",
            country: "Tunisia",
            orderNotes: "",
            couponCode: "",
        },
    });

    // Watch form values for calculations and display
    const formCountry = watch("country");
    const formCity = watch("city");
    const formState = watch("state");

    const [shippingCost, setShippingCost] = useState(7);
    const [taxRate, setTaxRate] = useState(0.19);
    const discount = 0;
    const tax = subtotal * taxRate;
    const total = subtotal - discount + shippingCost + tax;

    // Generate temporary order number for display
    const tempOrderNo = `NIAKZUA${Math.floor(Math.random() * 10000)}`;
    const currentDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    // Get authenticated user ID
    useEffect(() => {
        async function fetchUserId() {
            const user = await getCustomer();
            if (user) {
                setUserId(user.id);
            }
        }
        fetchUserId();
    }, []);

    // Load saved data from sessionStorage on mount (for page refreshes)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedItemsData = sessionStorage.getItem('checkout_savedItems');
            const savedSummaryData = sessionStorage.getItem('checkout_savedOrderSummary');
            const confirmedStatus = sessionStorage.getItem('checkout_orderConfirmed');

            if (savedItemsData) {
                try {
                    setSavedItems(JSON.parse(savedItemsData));
                } catch (e) {
                    console.error('Error parsing saved items:', e);
                }
            }

            if (savedSummaryData) {
                try {
                    setSavedOrderSummary(JSON.parse(savedSummaryData));
                } catch (e) {
                    console.error('Error parsing saved summary:', e);
                }
            }

            if (confirmedStatus === 'true') {
                setOrderConfirmed(true);
            }
        }
    }, []);

    const handleContinueFromSummary = () => {
        setCurrentStep(2);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleContinueFromInformation = () => {
        // Save cart items and order summary before moving to step 3
        const itemsToSave = [...items];
        const summaryToSave = {
            subtotal: subtotal,
            shippingCost: shippingCost,
            tax: tax,
            taxRate: taxRate,
            discount: discount,
            total: total
        };

        setSavedItems(itemsToSave);
        setSavedOrderSummary(summaryToSave);

        // Persist to sessionStorage for page refresh
        if (typeof window !== 'undefined') {
            sessionStorage.setItem('checkoutSavedItems', JSON.stringify(itemsToSave));
            sessionStorage.setItem('checkoutOrderSummary', JSON.stringify(summaryToSave));
        }

        setCurrentStep(3);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const onSubmit = async (formData: CheckoutFormData) => {
        setIsProcessing(true);

        try {
            const orderData = {
                userId: userId || undefined, // Include user ID if authenticated
                customerEmail: formData.email?.trim() || undefined,
                customerFirstName: formData.firstName,
                customerLastName: formData.lastName,
                customerPhone: formData.phone,
                shippingAddress: formData.address?.trim() || undefined,
                shippingCity: formData.city?.trim() || undefined,
                shippingState: formData.state?.trim() || undefined,
                shippingZip: formData.zipCode?.trim() || undefined,
                shippingCountry: formData.country?.trim() || undefined,
                items: items,
                subtotal: subtotal,
                shippingCost: shippingCost,
                total: total,
                orderNotes: formData.orderNotes?.trim() || ""
            };

            const { order, error, code } = await createOrder(orderData);

            if (error || !order) {
                toast.error(
                    code === 'TOTALS_CHANGED' ? text.totalChanged
                        : code === 'PRICES_CHANGED' || code === 'PRODUCT_UNAVAILABLE' ? text.pricesChanged
                        : code === 'OUT_OF_STOCK' ? text.outOfStock
                        : code === 'VARIANT_REQUIRED' ? text.chooseVariant
                            : text.failedToCreateOrder
                );
                setIsProcessing(false);
                return;
            }

            // The confirmation email is sent by POST /api/orders.

            // Save cart items and order summary for confirmation page
            const itemsToSave = [...items];
            const summaryToSave = {
                subtotal: subtotal,
                shippingCost: shippingCost,
                tax: tax,
                taxRate: taxRate,
                discount: discount,
                total: total
            };

            setSavedItems(itemsToSave);
            setSavedOrderSummary(summaryToSave);

            // Persist to sessionStorage for page refresh
            if (typeof window !== 'undefined') {
                sessionStorage.setItem('checkoutSavedItems', JSON.stringify(itemsToSave));
                sessionStorage.setItem('checkoutOrderSummary', JSON.stringify(summaryToSave));
                sessionStorage.setItem('orderConfirmed', 'true');
            }

            clearCart();

            // Reset processing state, mark order as confirmed, and move to confirmation step
            setIsProcessing(false);
            setOrderConfirmed(true);
            setCurrentStep(3);
        } catch {
            toast.error("An error occurred. Please try again.");
            setIsProcessing(false);
        }
    };
    // Calculate shipping cost and tax rate dynamically based on country
    useEffect(() => {
        async function fetchShippingAndTax() {
            // Use default country (Tunisia) if no country is selected
            const country = formCountry || "Tunisia";
            if (subtotal === 0) return;

            // The order is re-priced on the server when it's placed.
            const quote = await storefront<{ shipping_cost: number; tax_rate: number }>(
                `checkout-quote?country=${encodeURIComponent(country)}&subtotal=${subtotal}`
            );
            setShippingCost(quote.shipping_cost);
            setTaxRate(quote.tax_rate);
        }

        fetchShippingAndTax();
    }, [formCountry, subtotal]);

    // Sync step with URL
    useEffect(() => {
        const newUrl = `/${locale}/checkout?step=${currentStep}`;
        router.replace(newUrl, { scroll: false });
    }, [currentStep, locale, router]);

    // Redirect to cart only after cart is loaded and if there are no items
    useEffect(() => {
        if (isCartLoaded && items.length === 0 && savedItems.length === 0 && currentStep !== 3) {
            router.push(`/${locale}/cart`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCartLoaded]); // Only check after cart is loaded

    // Show loading while cart is loading
    if (!isCartLoaded) {
        return <LoadingSpinner message={text.loading} />;
    }

    // Show loading or null while redirecting (but allow step 3 to show even with saved items)
    if (items.length === 0 && savedItems.length === 0 && currentStep !== 3) {
        return null;
    }

    // Use savedItems for step 3, regular items for other steps
    const displayItems = currentStep === 3 ? savedItems : items;

    return (
        <>

            <div className="min-h-screen bg-[#FFFFFF] py-12" dir={rtl ? 'rtl' : 'ltr'}>
                <div className=" mx-auto px-4">
                    {/* Step Progress */}
                    <div className="mb-12">
                        <div className="flex items-center justify-center gap-2 sm:gap-4">
                            {/* Step 1: Summary Order (on phones only the current step shows its label, so the row fits) */}
                            <div className="flex items-center">
                                <div className="flex items-center gap-2 sm:gap-3">
                                    <div className={`h-8 w-8 shrink-0 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white font-bold ${currentStep > 1 ? 'bg-green-600' : currentStep === 1 ? 'bg-[#7a3b2e]' : 'bg-gray-300'}`}>
                                        {currentStep > 1 ? '✓' : '1'}
                                    </div>
                                    <span className={`text-sm sm:text-base font-medium ${currentStep === 1 ? '' : 'hidden sm:inline'} ${currentStep === 1 ? 'text-[#7a3b2e]' : currentStep > 1 ? 'text-green-600' : 'text-gray-600'}`}>
                                        {text.summaryOrder}
                                    </span>
                                </div>
                            </div>

                            {/* Divider */}
                            <div className={`w-6 sm:w-16 h-0.5 shrink-0 ${currentStep > 1 ? 'bg-green-600' : 'bg-gray-300'}`}></div>

                            {/* Step 2: Information */}
                            <div className="flex items-center">
                                <div className="flex items-center gap-2 sm:gap-3">
                                    <div className={`h-8 w-8 shrink-0 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white font-bold ${currentStep > 2 ? 'bg-green-600' : currentStep === 2 ? 'bg-[#7a3b2e]' : 'bg-gray-300'}`}>
                                        {currentStep > 2 ? '✓' : '2'}
                                    </div>
                                    <span className={`text-sm sm:text-base font-medium ${currentStep === 2 ? '' : 'hidden sm:inline'} ${currentStep === 2 ? 'text-[#7a3b2e]' : currentStep > 2 ? 'text-green-600' : 'text-gray-600'}`}>
                                        {text.information}
                                    </span>
                                </div>
                            </div>

                            {/* Divider */}
                            <div className={`w-6 sm:w-16 h-0.5 shrink-0 ${currentStep > 2 ? 'bg-green-600' : 'bg-gray-300'}`}></div>

                            {/* Step 3: Payment */}
                            <div className="flex items-center">
                                <div className="flex items-center gap-2 sm:gap-3">
                                    <div className={`h-8 w-8 shrink-0 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white font-bold ${currentStep === 3 ? 'bg-green-600' : 'bg-gray-300'}`}>
                                        {currentStep === 3 ? '✓' : '3'}
                                    </div>
                                    <span className={`text-sm sm:text-base font-medium ${currentStep === 3 ? '' : 'hidden sm:inline'} ${currentStep === 3 ? 'text-green-600' : 'text-gray-600'}`}>
                                        {text.payment}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="pointer-events-none absolute left-[-150px] hidden lg:block" aria-hidden="true">
                        <Image src="/assets/images/checkout/backgroundCheckout.svg" alt="bg-checkout" width={100} height={100} className="w-full h-full object-cover" />
                    </div>
                    {/* Step 1: Summary Order */}
                    {currentStep === 1 && (
                        <div className="max-w-3xl mx-auto">
                            <div className="p-4 sm:p-8">
                                <h2 className="text-2xl font-bold text-gray-900 mb-6">{text.summaryOrder}</h2>

                                <div className="space-y-6 mb-8">
                                    {items.map((item) => (
                                        <CartItem
                                            key={cartLineKey(item)}
                                            item={item}
                                            onUpdateQuantity={updateQuantity}
                                            onRemove={removeItem}
                                            variant="default"
                                            reviewsText="reviews"
                                        />
                                    ))}
                                </div>

                                <button
                                    onClick={handleContinueFromSummary}
                                    type="button"
                                    className="w-full py-4 bg-[#7a3b2e] text-white text-lg rounded-lg hover:bg-[#5e2d23] transition font-medium"
                                >
                                    {text.continue}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Information */}
                    {currentStep === 2 && (
                        <div className=" mx-auto max-w-6xl grid lg:grid-cols-3 gap-8">
                            {/* Left Side - Form */}
                            <div className="lg:col-span-2">
                                <form onSubmit={handleFormSubmit(handleContinueFromInformation)} className="bg-white rounded-lg shadow-sm p-4 sm:p-8">
                                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{text.information}</h2>
                                    <p className="text-gray-500 text-sm mb-6">{text.fillShippingInfo}</p>
                                    <p className="text-sm text-[#7a3b2e] mb-6">{text.deliveryTime}</p>

                                    <div className="space-y-6">
                                        <h3 className="text-xl font-bold text-gray-900">{text.deliveryAddress}</h3>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    {text.firstName} <span className="text-red-600">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    {...register("firstName")}
                                                    autoComplete="given-name"
                                                    placeholder={text.enterFirstName}
                                                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] ${errors.firstName ? 'border-red-500' : 'border-gray-300'}`}
                                                />
                                                {errors.firstName && (
                                                    <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    {text.lastName} <span className="text-red-600">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    {...register("lastName")}
                                                    autoComplete="family-name"
                                                    placeholder={text.enterLastName}
                                                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] ${errors.lastName ? 'border-red-500' : 'border-gray-300'}`}
                                                />
                                                {errors.lastName && (
                                                    <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
                                                )}
                                            </div>

                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                {text.phone} <span className="text-red-600">*</span>
                                            </label>
                                            <input
                                                type="tel"
                                                {...register("phone", {
                                                    // Tunisian numbers: 8 digits, nothing else.
                                                    onChange: (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 8); },
                                                })}
                                                autoComplete="tel"
                                                inputMode="numeric"
                                                maxLength={8}
                                                placeholder="20 000 000"
                                                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] ${errors.phone ? 'border-red-500' : 'border-gray-300'}`}
                                            />
                                            {errors.phone && (
                                                <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
                                            )}
                                        </div>
                                        {/* Delivery details as Colissimo needs them: governorate, city, address. */}
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div>
                                                <label htmlFor="checkout-state" className="block text-sm font-medium text-gray-700 mb-2">
                                                    {text.governorate} <span className="text-red-600">*</span>
                                                </label>
                                                <select
                                                    id="checkout-state"
                                                    {...register("state")}
                                                    autoComplete="address-level1"
                                                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] bg-white ${errors.state ? 'border-red-500' : 'border-gray-300'} ${formState ? '' : 'text-[#9b9b9b]'}`}
                                                >
                                                    <option value="" disabled>{text.chooseGovernorate}</option>
                                                    {governorateOptions(locale).map((g) => (
                                                        <option key={g.value} value={g.value} className="text-black">{g.label}</option>
                                                    ))}
                                                </select>
                                                {errors.state && (
                                                    <p className="mt-1 text-sm text-red-600">{text.governorateRequired}</p>
                                                )}
                                            </div>
                                            <div>
                                                <label htmlFor="checkout-city" className="block text-sm font-medium text-gray-700 mb-2">
                                                    {text.city} <span className="text-red-600">*</span>
                                                </label>
                                                <input
                                                    id="checkout-city"
                                                    type="text"
                                                    {...register("city")}
                                                    autoComplete="address-level2"
                                                    placeholder={text.enterCity}
                                                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] ${errors.city ? 'border-red-500' : 'border-gray-300'}`}
                                                />
                                                {errors.city && (
                                                    <p className="mt-1 text-sm text-red-600">{text.cityRequired}</p>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                {text.streetAddress} <span className="text-red-600">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                {...register("address")}
                                                autoComplete="street-address"
                                                placeholder={text.enterStreetAddress}
                                                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] ${errors.address ? 'border-red-500' : 'border-gray-300'}`}
                                            />
                                            {errors.address && (
                                                <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                {text.emailAddress} <span className="text-gray-400 font-normal">({text.optional})</span>
                                            </label>
                                            <input
                                                type="email"
                                                {...register("email")}
                                                autoComplete="email" inputMode="email"
                                                placeholder={text.enterEmail}
                                                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#842E1B] focus:border-transparent text-black placeholder:text-[#C9C9C9] ${errors.email ? 'border-red-500' : 'border-gray-300'}`}
                                            />
                                            {errors.email && (
                                                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                                            )}
                                        </div>



                                        <button
                                            type="submit"
                                            className="w-full py-4 bg-[#7a3b2e] text-white text-lg rounded-lg hover:bg-[#5e2d23] transition font-medium"
                                        >
                                            {text.continue}
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Right Side - Summary */}
                            <div className="lg:col-span-1 space-y-6">
                                {/* Summary Order - Collapsible */}
                                <div className="bg-white  shadow-sm">
                                    <button
                                        onClick={() => setIsSummaryOpen(!isSummaryOpen)}
                                        className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition"
                                    >
                                        <h3 className="text-[20px] font-semibold text-black">{text.summaryOrder}</h3>
                                        <svg
                                            className={`w-6 h-6 transition-transform ${isSummaryOpen ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    {isSummaryOpen && (
                                        <div className="px-6 pb-6 space-y-3 border-t pt-4">
                                            {items.map((item) => (
                                                <CartItem
                                                    key={cartLineKey(item)}
                                                    item={item}
                                                    variant="compact"
                                                    reviewsText={text.reviews}
                                                    showTotal={false}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Discount Codes - Collapsible */}
                                <div className="bg-white shadow-sm">
                                    <button
                                        onClick={() => setIsDiscountOpen(!isDiscountOpen)}
                                        className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition"
                                    >
                                        <h3 className="text-[20px] font-semibold text-black">{text.discountCodes}</h3>
                                        <svg
                                            className={`w-6 h-6 transition-transform ${isDiscountOpen ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    {isDiscountOpen && (
                                        <div className="px-6 pb-6 border-t pt-4">
                                            <input
                                                type="text"
                                                {...register("couponCode")}
                                                placeholder={text.enterCoupon}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7a3b2e] focus:border-transparent text-black placeholder:text-[#C9C9C9]"
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Billing Summary - Collapsible */}
                                <div className="bg-white  shadow-sm">
                                    <button
                                        onClick={() => setIsBillingOpen(!isBillingOpen)}
                                        className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition"
                                    >
                                        <h3 className="text-[20px] font-semibold text-black">{text.billingSummary}</h3>
                                        <svg
                                            className={`w-6 h-6 transition-transform ${isBillingOpen ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    {isBillingOpen && (
                                        <div className="px-6 pb-6 border-t pt-4 space-y-4">
                                            <div className="space-y-3">
                                                <div className="flex justify-between text-gray-700">
                                                    <span>{text.subtotal}</span>
                                                    <span className="font-semibold">{subtotal.toFixed(2)} TND</span>
                                                </div>
                                                {discount > 0 && (
                                                    <div className="flex justify-between text-gray-700">
                                                        <span>{text.discount}</span>
                                                        <span className="font-semibold">-{discount.toFixed(2)} TND</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between text-gray-700">
                                                    <span>{text.shipping}</span>
                                                    {shippingCost === 0 ? (
                                                        <span className="font-semibold text-green-600">{text.freeShipping}</span>
                                                    ) : (
                                                        <span className="font-semibold">{shippingCost.toFixed(2)} TND</span>
                                                    )}
                                                </div>
                                                {tax > 0 && (
                                                    <div className="flex justify-between text-gray-700">
                                                        <span>{text.tax} ({(taxRate * 100).toFixed(0)}%)</span>
                                                        <span className="font-semibold">{tax.toFixed(2)} TND</span>
                                                    </div>
                                                )}
                                                <div className="border-t pt-3">
                                                    <div className="flex justify-between text-xl font-bold text-gray-900">
                                                        <span>{text.grandTotal}</span>
                                                        <span>{total.toFixed(2)} TND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Order Comment */}
                                            <div className="mt-4">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    {text.orderComment}
                                                </label>
                                                <textarea
                                                    {...register("orderNotes")}
                                                    placeholder={text.typeHere}
                                                    rows={4}
                                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7a3b2e] focus:border-transparent resize-none text-black placeholder:text-[#C9C9C9]"
                                                />
                                            </div>

                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Confirmation */}
                    {currentStep === 3 && (
                        <div className="max-w-3xl mx-auto">
                            <div className="bg-white rounded-lg shadow-sm p-4 sm:p-8">
                                <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">{text.summaryOrderConfirmation}</h2>
                                <p className="text-gray-500 text-sm text-center mb-8">{text.orderConfirmationDesc}</p>

                                {/* Order Information */}
                                <div className="mb-8">
                                    <h3 className="text-xl font-bold text-gray-900 mb-4">{text.orderInformation}</h3>
                                    <p className="text-gray-500 text-sm mb-6">{text.orderInfoDesc}</p>

                                    <div className="grid grid-cols-4 gap-6">
                                        <div>
                                            <p className="text-sm text-gray-500 mb-1">{text.orderDate}</p>
                                            <p className="font-semibold text-gray-900">{currentDate}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500 mb-1">{text.orderNo}</p>
                                            <p className="font-semibold text-gray-900">{tempOrderNo}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500 mb-1">{text.paymentMethod}</p>
                                            <p className="font-semibold text-gray-900">{text.cashOnDelivery}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500 mb-1">{text.shippingAddress}</p>
                                            <p className="font-semibold text-gray-900">
                                                {[formCity, governorateLabel(formState, locale)].filter(Boolean).join(", ") || text.shippingAddress}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Products List */}
                                <div className="space-y-6 mb-8">
                                    {displayItems.map((item) => (
                                        <CartItem
                                            key={cartLineKey(item)}
                                            item={item}
                                            variant="default"
                                            reviewsText={text.reviews}
                                        />
                                    ))}
                                </div>

                                {/* Billing Summary */}
                                <div className="border-t pt-6 mb-8">
                                    <div className="flex justify-end">
                                        <div className="w-80 space-y-3">
                                            <div className="flex justify-between text-gray-700">
                                                <span>{text.subtotal}</span>
                                                <span className="font-semibold">{savedOrderSummary.subtotal.toFixed(2)} TND</span>
                                            </div>
                                            {savedOrderSummary.discount > 0 && (
                                                <div className="flex justify-between text-gray-700">
                                                    <span>{text.discount}</span>
                                                    <span className="font-semibold">-{savedOrderSummary.discount.toFixed(2)} TND</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between text-gray-700">
                                                <span>{text.shipping}</span>
                                                {savedOrderSummary.shippingCost === 0 ? (
                                                    <span className="font-semibold text-green-600">{text.freeShipping}</span>
                                                ) : (
                                                    <span className="font-semibold">{savedOrderSummary.shippingCost.toFixed(2)} TND</span>
                                                )}
                                            </div>
                                            {savedOrderSummary.tax > 0 && (
                                                <div className="flex justify-between text-gray-700">
                                                    <span>{text.tax} ({(savedOrderSummary.taxRate * 100).toFixed(0)}%)</span>
                                                    <span className="font-semibold">{savedOrderSummary.tax.toFixed(2)} TND</span>
                                                </div>
                                            )}
                                            <div className="border-t pt-3">
                                                <div className="flex justify-between text-xl font-bold text-gray-900">
                                                    <span>{text.total}</span>
                                                    <span>{savedOrderSummary.total.toFixed(2)} TND</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Conditional Rendering: Policy & Confirm Button OR Continue Shopping */}
                                {!orderConfirmed ? (
                                    <>
                                        {/* Confirm Order Button */}
                                        <form onSubmit={handleFormSubmit(onSubmit)}>
                                            <button
                                                type="submit"
                                                disabled={isProcessing}
                                                className="w-full py-4 bg-[#7a3b2e] text-white text-lg rounded-lg hover:bg-[#5e2d23] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isProcessing ? text.processing : text.confirmMyOrder}
                                            </button>
                                        </form>
                                    </>
                                ) : (
                                    <>
                                        {/* Order Confirmed - Show Continue Shopping Button */}
                                        <div className="mb-6 p-4 bg-green-50 border-2 border-green-500 rounded-lg text-center">
                                            <div className="flex items-center justify-center gap-2 text-green-700 font-semibold text-lg mb-2">
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                {text.orderConfirmedSuccess}
                                            </div>
                                            <p className="text-green-600 text-sm">
                                                {text.checkEmailForDetails}
                                            </p>
                                        </div>

                                        {/* Continue Shopping Button */}
                                        <button
                                            onClick={() => {
                                                // Clear checkout session data
                                                if (typeof window !== 'undefined') {
                                                    sessionStorage.removeItem('checkoutSavedItems');
                                                    sessionStorage.removeItem('checkoutOrderSummary');
                                                    sessionStorage.removeItem('orderConfirmed');
                                                }
                                                router.push(`/${locale}`);
                                            }}
                                            className="w-full py-4 bg-[#7a3b2e] text-white text-lg rounded-lg hover:bg-[#5e2d23] transition font-medium flex items-center justify-center gap-2"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                                            </svg>
                                            {text.continueShopping}
                                        </button>
                                    </>
                                )}

                                {/* Thank You Message */}
                                <div className="mt-8 text-center">
                                    <p className="text-sm text-gray-500 mb-4">
                                        {text.thankYouMessage}
                                    </p>
                                    <h3 className="text-xl font-bold text-gray-900 mb-1">
                                        {text.thankYou}
                                    </h3>
                                    <p className="text-gray-600">
                                        {text.artisanTeam}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="pointer-events-none absolute top-70 right-0 hidden lg:block" aria-hidden="true">
                        <Image src="/assets/images/checkout/bgCheckoutRight.svg" alt="bg-checkout" width={100} height={100} className="w-full h-full object-cover" />
                    </div>
                </div>
            </div>

        </>
    );
}
