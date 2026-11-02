"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import AddToCartButton from "@/components/cart/AddToCartButton";
import { FormTextarea } from "@/components/forms";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { getProductName, getProductDescription } from "@/lib/utils/product-utils";
import { loadProductDetail, type ProductDetailData } from "@/lib/product-detail";
import { storefront } from "@/lib/storefront-api";
import { getCategories } from "@/lib/categories-cache";
import toast from "react-hot-toast";
import { headerConfig, SHOW_RATINGS } from "@/lib/config";
import { accountApi, authHref, customerName, useCustomer } from "@/lib/customer-auth";
import { isRTL } from "@/lib/language-utils";
import { reemKufi } from "@/lib/fonts";

interface ProductImage {
    id: string;
    url: string;
    alt?: string;
}

interface Color {
    id: string;
    name: string;
    hex_code?: string;
    display_name?: string;
}

interface Size {
    id: string;
    name: string;
    code?: string;
    display_name?: string;
}

interface ProductVariant {
    id: string;
    product_id: string;
    // New structure with foreign keys
    color_id?: string | null;
    size_id?: string | null;
    // Joined data
    colors?: Color;
    sizes?: Size;
    // Legacy fields (for backward compatibility)
    color?: string;
    size?: string;
    sku?: string;
    price_cents?: number;
    price?: number;
    stock: number;
    images?: ProductImage[];
    image_url?: string;
    is_available?: boolean;
    is_active?: boolean;
}

interface Product {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    description?: string;
    description_ar?: string;
    description_fr?: string;
    base_price: number;
    currency?: string;
    discount_percent?: number;
    image_url?: string;
    product_images?: ProductImage[];
    stock?: number;
    /** Off until the shop's stock is counted: the product stays orderable whatever the stock says. */
    stock_tracked?: boolean;
    category_id?: string;
    colors?: string[];
    sizes?: string[];
    weight?: number;
    product_details?: string[];
    shipping_info?: string;
    seller_info?: string;
    views?: number;
    product_variants?: ProductVariant[];
}

interface Category {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
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

interface Review {
    id: string;
    product_id: string;
    user_id?: string;
    user_name?: string;
    rating: number;
    comment: string;
    created_at: string;
    users?: {
        name: string;
        avatar_url?: string;
    };
}

const commentSchema = z.object({
    comment: z.string().trim().min(5, "Comment is too short").max(2000, "Comment is too long"),
    rating: z.number().min(1).max(5).optional(),
});

type CommentFormData = z.infer<typeof commentSchema>;

const content = {
    en: {
        home: "Home",
        category: "Category",
        status: "Status",
        inStock: "In Stock",
        onOrder: "Made to order",
        onOrderNote: "This item is prepared after you order. We'll call you to confirm the delivery date.",
        reviews: "reviews",
        quantity: "Quantity",
        selectColor: "Select Color",
        selectSize: "Select Size",
        addToCart: "Add to cart",
        productDetails: "Product Details",
        shippingDetails: "Shipping Details",
        sellerDetails: "Seller Details",
        similarProducts: "Similar Products",
        homeDelivery: "Home Delivery",
        deliveryCost: "Delivery cost",
        relatedCategories: "Explore related categories",
        loading: "Loading product...",
        comments: "Comments",
        writeComment: "Write your Comment",
        commentPlaceholder: "Share your thoughts about this product...",
        yourName: "Your Name",
        namePlaceholder: "Enter your name",
        yourRating: "Your Rating",
        send: "Send",
        helpful: "Helpful",
        reportAbuse: "Report Abuse",
        submittingComment: "Submitting...",
        commentSuccess: "Comment submitted successfully!",
        commentError: "Failed to submit comment. Please try again.",
        reviewLoginPrompt: "Log in or create an account to write a review.",
        logIn: "Log in",
        createAccount: "Create an account",
        postingAs: "Posting as",
        aboutPiece: "About this piece",
        color: "Color",
        size: "Size",
        reviewsTitle: "Customer reviews",
        writeReview: "Write a review",
        cancel: "Cancel",
        noReviews: "No reviews yet. Be the first to share your opinion on this piece.",
        seeMoreReviews: "Show more reviews",
        cashOnDelivery: "Pay in cash when your order arrives",
        deliveryCostLine: "Home delivery: {cost} TND",
        freeFrom: "Free delivery above {amount} TND",
        deliveryTime: "Delivered within 48 hours",
        callUs: "Call us",
        products: "Products",
        basedOn: "Based on {count} reviews",
        noRatingYet: "No ratings yet",
        off: "off",
        colon: ": "
    },
    fr: {
        home: "Accueil",
        category: "Catégorie",
        status: "Statut",
        inStock: "En stock",
        onOrder: "Sur commande",
        onOrderNote: "Cet article est préparé après votre commande. Nous vous appellerons pour confirmer la date de livraison.",
        reviews: "avis",
        quantity: "Quantité",
        selectColor: "Sélectionner la couleur",
        selectSize: "Sélectionner la taille",
        addToCart: "Ajouter au panier",
        productDetails: "Détails du produit",
        shippingDetails: "Détails de livraison",
        sellerDetails: "Détails du vendeur",
        similarProducts: "Produits similaires",
        homeDelivery: "Livraison à domicile",
        deliveryCost: "Frais de livraison",
        relatedCategories: "Explorer les catégories connexes",
        loading: "Chargement du produit...",
        comments: "Commentaires",
        writeComment: "Écrivez votre commentaire",
        commentPlaceholder: "Partagez vos impressions sur ce produit...",
        yourName: "Votre nom",
        namePlaceholder: "Entrez votre nom",
        yourRating: "Votre évaluation",
        send: "Envoyer",
        helpful: "Utile",
        reportAbuse: "Signaler un abus",
        submittingComment: "Envoi en cours...",
        commentSuccess: "Commentaire soumis avec succès!",
        commentError: "Échec de l'envoi du commentaire. Veuillez réessayer.",
        reviewLoginPrompt: "Connectez-vous ou créez un compte pour laisser un avis.",
        logIn: "Se connecter",
        createAccount: "Créer un compte",
        postingAs: "Publié en tant que",
        aboutPiece: "À propos de cette pièce",
        color: "Couleur",
        size: "Taille",
        reviewsTitle: "Avis clients",
        writeReview: "Écrire un avis",
        cancel: "Annuler",
        noReviews: "Aucun avis pour le moment. Soyez le premier à donner votre avis sur cette pièce.",
        seeMoreReviews: "Afficher plus d'avis",
        cashOnDelivery: "Paiement en espèces à la livraison",
        deliveryCostLine: "Livraison à domicile : {cost} TND",
        freeFrom: "Livraison gratuite au-delà de {amount} TND",
        deliveryTime: "Livrée sous 48 heures",
        callUs: "Appelez-nous",
        products: "Produits",
        basedOn: "Sur la base de {count} avis",
        noRatingYet: "Pas encore de note",
        off: "de réduction",
        colon: " : "
    },
    ar: {
        home: "الرئيسية",
        category: "الفئة",
        status: "الحالة",
        inStock: "متوفر",
        onOrder: "حسب الطلب",
        onOrderNote: "يُحضَّر هذا المنتج بعد طلبك، وسنتصل بك لتأكيد موعد التوصيل.",
        reviews: "تقييم",
        quantity: "الكمية",
        selectColor: "اختر اللون",
        selectSize: "اختر المقاس",
        addToCart: "أضف إلى السلة",
        productDetails: "تفاصيل المنتج",
        shippingDetails: "تفاصيل الشحن",
        sellerDetails: "تفاصيل البائع",
        similarProducts: "منتجات مماثلة",
        homeDelivery: "التوصيل المنزلي",
        deliveryCost: "تكلفة التوصيل",
        relatedCategories: "استكشف الفئات ذات الصلة",
        loading: "جاري تحميل المنتج...",
        comments: "التعليقات",
        writeComment: "اكتب تعليقك",
        commentPlaceholder: "شارك أفكارك حول هذا المنتج...",
        yourName: "اسمك",
        namePlaceholder: "أدخل اسمك",
        yourRating: "تقييمك",
        send: "إرسال",
        helpful: "مفيد",
        reportAbuse: "الإبلاغ عن إساءة",
        submittingComment: "جاري الإرسال...",
        commentSuccess: "تم إرسال التعليق بنجاح!",
        commentError: "فشل إرسال التعليق. يرجى المحاولة مرة أخرى.",
        reviewLoginPrompt: "سجّل الدخول أو أنشئ حساباً لكتابة تقييم.",
        logIn: "تسجيل الدخول",
        createAccount: "إنشاء حساب",
        postingAs: "النشر باسم",
        aboutPiece: "عن هذه القطعة",
        color: "اللون",
        size: "المقاس",
        reviewsTitle: "آراء العملاء",
        writeReview: "اكتب تقييماً",
        cancel: "إلغاء",
        noReviews: "لا توجد تقييمات بعد. كن أول من يشارك رأيه في هذه القطعة.",
        seeMoreReviews: "عرض المزيد من التقييمات",
        cashOnDelivery: "الدفع نقداً عند استلام طلبك",
        deliveryCostLine: "التوصيل إلى المنزل: {cost} دينار",
        freeFrom: "التوصيل المجاني للطلبات التي تتجاوز {amount} دينار",
        deliveryTime: "يصلك خلال 48 ساعة",
        callUs: "اتصل بنا",
        products: "المنتجات",
        basedOn: "بناءً على {count} تقييم",
        noRatingYet: "لا توجد تقييمات بعد",
        off: "تخفيض",
        colon: ": "
    }
};

export default function ProductDetailClient({ initialData, freeShippingThreshold }: { initialData?: ProductDetailData | null; freeShippingThreshold?: number | null }) {
    const params = useParams();
    const searchParams = useSearchParams();
    const locale = (params.locale as string) || 'en';
    const text = content[locale as keyof typeof content] || content.en;
    const slug = params.slug as string;
    const categorySlug = searchParams.get('category');

    const [product, setProduct] = useState<Product | null>();
    const [categoryName, setCategoryName] = useState<string>('');
    const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
    const [relatedCategories, setRelatedCategories] = useState<Category[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState(0);
    const [quantity, setQuantity] = useState(1);
    // Phones: a sticky buy bar shows whenever the main add-to-cart row is out of view.
    const [buyRowEl, setBuyRowEl] = useState<HTMLDivElement | null>(null);
    const [buyRowVisible, setBuyRowVisible] = useState(true);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    useEffect(() => {
        if (!buyRowEl) return;
        const observer = new IntersectionObserver(([entry]) => setBuyRowVisible(entry.isIntersecting), { threshold: 0.1 });
        observer.observe(buyRowEl);
        return () => observer.disconnect();
    }, [buyRowEl]);
    const [selectedColor, setSelectedColor] = useState<string | null>(null);
    const [selectedSize, setSelectedSize] = useState<string | null>(null);
    const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [selectedRating, setSelectedRating] = useState(5);
    const [visibleComments, setVisibleComments] = useState(3);
    const [reviewFormOpen, setReviewFormOpen] = useState(false);
    const { user: customer } = useCustomer();
    const { register, handleSubmit, reset, formState: { errors } } = useForm<CommentFormData>({
        resolver: zodResolver(commentSchema)
    });

    useEffect(() => {
        async function fetchProduct() {
            try {
                // Server-rendered pages pass cached data; client navigations without it load here.
                const detail = initialData !== undefined ? initialData : await loadProductDetail(slug);
                if (!detail) return;

                const productWithVariants = detail.product as unknown as Product;
                setProduct(productWithVariants);
                setSimilarProducts(detail.similarProducts as unknown as Product[]);
                setRelatedCategories(detail.relatedCategories as Category[]);

                // Default selection: first available color and its first variant's size.
                const variants = productWithVariants.product_variants ?? [];
                const available = variants.filter((v: ProductVariant) => v.is_available !== false);
                const firstColorId = available.find((v: ProductVariant) => v.color_id)?.color_id;
                if (firstColorId) {
                    setSelectedColor(firstColorId);
                    const firstVariant = available.find((v: ProductVariant) => v.color_id === firstColorId);
                    if (firstVariant) {
                        setSelectedVariant(firstVariant);
                        if (firstVariant.size_id) setSelectedSize(firstVariant.size_id);
                    }
                } else {
                    const firstVariant = available.find((v: ProductVariant) => v.size_id) ?? available[0];
                    if (firstVariant) setSelectedVariant(firstVariant);
                    if (firstVariant?.size_id) setSelectedSize(firstVariant.size_id);
                }

                // Show the product now; reviews fill in below (they change often, so they aren't cached).
                setLoading(false);
                if (!SHOW_RATINGS) return;
                const reviewsData = await storefront<any[]>(`reviews?product_id=${productWithVariants.id}`);
                if (reviewsData) setReviews(reviewsData);
            } catch (error) {
                console.error('Error fetching product:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchProduct();
    }, [slug, initialData]);


    // Fetch category name if categorySlug is provided
    useEffect(() => {
        async function fetchCategoryName() {
            if (categorySlug) {
                try {
                    const data = (await getCategories()).find((category) => category.slug === categorySlug);
                    if (data) {
                        setCategoryName(getCategoryName(data, locale));
                    }
                } catch (error) {
                    console.error('Error fetching category:', error);
                }
            }
        }

        fetchCategoryName();
    }, [categorySlug, locale]);


    // Calculate average rating from reviews
    const averageRating = reviews.length > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
        : 0;
    const reviewCount = reviews.length;

    const onSubmitComment = async (data: CommentFormData) => {
        if (!product || !customer) return;

        // Zod validates name and comment; only guard rating here
        const rating = Number(selectedRating);
        if (!(rating >= 1 && rating <= 5)) {
            toast.error('Rating must be between 1 and 5.');
            return;
        }

        setSubmittingComment(true);
        try {
            // Posted under the account's own name (NestJS takes the user from the session).
            await accountApi('account/reviews', { body: { product_id: product.id, rating, comment: (data.comment || '').trim() } });

            // Refresh reviews
            const reviewsData = await storefront<any[]>(`reviews?product_id=${product.id}`);

            if (reviewsData) {
                setReviews(reviewsData);
            }

            // Reset form
            reset();
            setSelectedRating(5);
            setReviewFormOpen(false);
            // toast.success(text.commentSuccess);
            toast.success(text.commentSuccess);


        } catch (error) {
            console.error('Error submitting comment:', error);
            // toast.error(text.commentError)
            toast.error(text.commentError);

        } finally {
            setSubmittingComment(false);
        }
    };

    if (loading) {
        return <LoadingSpinner message={text.loading} />;
    }

    if (!product) {
        return (
            <>
                <div className="min-h-screen flex items-center justify-center">
                    <p className="text-xl text-gray-600">Product not found</p>
                </div>
            </>
        );
    }

    // Calculate price - use variant price if available, otherwise use product price
    const basePrice = selectedVariant?.price || product.base_price;
    const discountedPrice = product.discount_percent
        ? basePrice * (1 - product.discount_percent / 100)
        : basePrice;

    // Get images - use variant images if color is selected and variant has images
    let productImages: ProductImage[] = [];
    if (selectedVariant && selectedVariant.images && selectedVariant.images.length > 0) {
        productImages = selectedVariant.images.filter(img => img.url && img.url.trim() !== '');
    } else if (selectedVariant && selectedVariant.image_url && selectedVariant.image_url.trim() !== '') {
        productImages = [{ id: '1', url: selectedVariant.image_url, alt: product.name }];
    } else if (product.product_images && product.product_images.length > 0) {
        productImages = product.product_images.filter(img => img.url && img.url.trim() !== '');
    } else if (product.image_url && product.image_url.trim() !== '') {
        productImages = [{ id: '1', url: product.image_url, alt: product.name }];
    }

    // Fallback to logo if no valid images
    if (productImages.length === 0) {
        productImages = [{ id: '1', url: '/assets/images/logo.svg', alt: product.name }];
    }

    // Get available colors from variants (with joined color data)
    const availableColors = product.product_variants && product.product_variants.length > 0
        ? product.product_variants
            .filter(v => v.color_id && v.colors && (v.is_available !== false))
            .reduce((acc: Color[], v) => {
                if (v.colors && !acc.find(c => c.id === v.colors!.id)) {
                    acc.push(v.colors);
                }
                return acc;
            }, [])
        : [];

    // Get available sizes based on selected color
    const getAvailableSizes = (): Size[] => {
        if (!product.product_variants || product.product_variants.length === 0) {
            return [];
        }

        const variants = selectedColor
            ? product.product_variants.filter(v => v.color_id === selectedColor && v.size_id && v.sizes && (v.is_available !== false))
            : product.product_variants.filter(v => v.size_id && v.sizes && (v.is_available !== false));

        return variants.reduce((acc: Size[], v) => {
            if (v.sizes && !acc.find(s => s.id === v.sizes!.id)) {
                acc.push(v.sizes);
            }
            return acc;
        }, []);
    };

    const availableSizes = getAvailableSizes();

    // Handle color selection
    const handleColorSelect = (colorId: string) => {
        setSelectedColor(colorId);
        setSelectedImage(0); // Reset to first image

        // Find variant with this color
        if (product.product_variants && product.product_variants.length > 0) {
            const variant = product.product_variants.find(v => v.color_id === colorId && (v.is_available !== false));
            if (variant) {
                setSelectedVariant(variant);
                // Auto-select first available size for this color
                if (variant.size_id) {
                    setSelectedSize(variant.size_id);
                } else {
                    const sizesForColor = getAvailableSizes();
                    if (sizesForColor.length > 0) {
                        setSelectedSize(sizesForColor[0].id);
                    }
                }
            }
        }
    };

    // Handle size selection
    const handleSizeSelect = (sizeId: string) => {
        setSelectedSize(sizeId);

        // Find variant with this color and size
        if (product.product_variants && product.product_variants.length > 0) {
            const variant = product.product_variants.find(
                v => (selectedColor ? v.color_id === selectedColor : !v.color_id) && v.size_id === sizeId && (v.is_available !== false)
            );
            if (variant) {
                setSelectedVariant(variant);
                setSelectedImage(0); // Reset to first image
            }
        }
    };

    // Get current stock - use variant stock if available
    const currentStock = selectedVariant?.stock ?? product.stock ?? 0;
    const stockTracked = !!product.stock_tracked;
    // Out-of-stock items can still be ordered: they're made to order ("sur commande").
    const inStock = !stockTracked || currentStock > 0;
    const variantLabel = selectedVariant
        ? [selectedVariant.colors?.display_name || selectedVariant.colors?.name, selectedVariant.sizes?.name].filter(Boolean).join(' / ')
        : '';



    const rtl = isRTL(locale);
    const currency = product.currency || 'TND';
    const productName = getProductName(product, locale);
    const description = getProductDescription(product, locale);
    const hasDiscount = !!product.discount_percent && product.discount_percent > 0;
    const selectedColorObj = availableColors.find((c) => c.id === selectedColor);
    const selectedSizeObj = availableSizes.find((s) => s.id === selectedSize);
    const shippingCost = headerConfig.invoices.default_shipping_cost;
    const galleryImages = productImages.filter((img) => img.url && img.url.trim() !== '');
    const productUrl = `/${locale}/products/${slug}`;

    const Stars = ({ value, size = 'h-4 w-4' }: { value: number; size?: string }) => (
        <span className="flex gap-0.5 text-[var(--wool-camel)]" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} className={`${size} ${i <= Math.round(value) ? 'fill-current' : 'fill-[#e6ddd2]'}`} viewBox="0 0 20 20">
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                </svg>
            ))}
        </span>
    );

    return (
        <div dir={rtl ? 'rtl' : 'ltr'} className={`${reemKufi.variable} bg-white text-[var(--wool-ink)]`}>
            {/* Purchase: gallery and buy panel */}
            <div className="mx-auto max-w-7xl px-4 pt-6 pb-12 lg:pt-8 lg:pb-16">
                <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#8a7a70]">
                    <Link href={`/${locale}`} className="hover:text-[var(--wool-maroon)]">{text.home}</Link>
                    <span aria-hidden="true">/</span>
                    <Link href={`/${locale}/products`} className="hover:text-[var(--wool-maroon)]">{text.products}</Link>
                    {categorySlug && categoryName && (
                        <>
                            <span aria-hidden="true">/</span>
                            <Link href={`/${locale}/products?category=${categorySlug}`} className="hover:text-[var(--wool-maroon)]">{categoryName}</Link>
                        </>
                    )}
                    <span aria-hidden="true">/</span>
                    <span className="max-w-[40ch] truncate text-[var(--wool-ink)]" aria-current="page">{productName}</span>
                </nav>

                <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
                    {/* Gallery */}
                    <div
                        className="relative lg:sticky lg:top-6 lg:self-start"
                        onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
                        onTouchEnd={(e) => {
                            if (touchStartX === null || galleryImages.length < 2) return;
                            const dx = e.changedTouches[0].clientX - touchStartX;
                            setTouchStartX(null);
                            if (Math.abs(dx) < 40) return;
                            // Swiping toward the reading direction's start shows the next photo.
                            const forward = rtl ? dx > 0 : dx < 0;
                            setSelectedImage((i) => (i + (forward ? 1 : galleryImages.length - 1)) % galleryImages.length);
                        }}
                    >
                        {galleryImages.length > 1 && (
                            <span className="pointer-events-none absolute end-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white sm:hidden" dir="ltr">
                                {selectedImage + 1} / {galleryImages.length}
                            </span>
                        )}
                        <ImageLightbox
                            images={galleryImages.map((img) => ({ src: img.url, alt: img.alt || productName }))}
                            index={selectedImage}
                            className="rounded-[14px]! bg-[#f3efe9] shadow-none! hover:shadow-none!"
                        />
                        {galleryImages.length > 1 && (
                            <div className="mt-3 flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                                {galleryImages.slice(0, 8).map((img, index) => (
                                    <button
                                        key={`${img.id || img.url}-${index}`}
                                        type="button"
                                        onClick={() => setSelectedImage(index)}
                                        aria-label={`${productName} ${index + 1}`}
                                        aria-pressed={selectedImage === index}
                                        className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[10px] bg-[#f3efe9] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--wool-maroon)] ${selectedImage === index ? 'ring-2 ring-[var(--wool-maroon)] ring-offset-2' : 'opacity-75 hover:opacity-100'}`}
                                    >
                                        <Image src={img.url} alt="" fill sizes="80px" className="object-cover object-top" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Buy panel */}
                    <div className="lg:sticky lg:top-6 lg:self-start">
                        {categorySlug && categoryName && (
                            <Link href={`/${locale}/products?category=${categorySlug}`} className="text-sm font-medium text-[var(--wool-camel)] hover:underline underline-offset-4">
                                {categoryName}
                            </Link>
                        )}
                        <h1 className="mt-1 font-[family-name:var(--font-kufi)] text-3xl font-bold leading-tight sm:text-4xl">
                            {productName}
                        </h1>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                            {SHOW_RATINGS && (
                            <a href="#reviews" className="flex items-center gap-2 text-[#5b4a42] hover:text-[var(--wool-maroon)]">
                                <Stars value={averageRating} />
                                <span>{reviewCount > 0 ? `${averageRating.toFixed(1)} (${reviewCount} ${text.reviews})` : text.noRatingYet}</span>
                            </a>
                            )}
                            <span className={`inline-flex items-center gap-1.5 font-medium ${inStock ? 'text-[#3f7a3a]' : 'text-[#9a6200]'}`}>
                                <span className={`h-2 w-2 rounded-full ${inStock ? 'bg-[#3f7a3a]' : 'bg-[#c98a1a]'}`} aria-hidden="true" />
                                {inStock ? text.inStock : text.onOrder}
                            </span>
                        </div>
                        {!inStock && <p className="mt-2 text-sm text-[#6f5f57]">{text.onOrderNote}</p>}

                        {/* Price */}
                        <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1" dir="ltr">
                            <span className="text-3xl font-semibold text-[var(--wool-maroon)]">
                                {Math.round(discountedPrice)} {currency}
                            </span>
                            {hasDiscount && (
                                <>
                                    <span className="text-lg text-[#a3958c] line-through">{Math.round(basePrice)} {currency}</span>
                                    <span className="rounded-full bg-[var(--wool-maroon)]/10 px-2.5 py-0.5 text-sm font-medium text-[var(--wool-maroon)]">
                                        −{Math.round(product.discount_percent!)}% {text.off}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className="my-6 h-px bg-[#ece4da]" />

                        {/* Color */}
                        {availableColors.length > 0 && (
                            <fieldset className="mb-6">
                                <legend className="mb-3 text-sm text-[#5b4a42]">
                                    {text.color}{selectedColorObj && <>{text.colon}<span className="font-medium text-[var(--wool-ink)]">{selectedColorObj.display_name || selectedColorObj.name}</span></>}
                                </legend>
                                <div className="flex flex-wrap gap-3">
                                    {availableColors.map((color) => {
                                        const colorName = color.display_name || color.name;
                                        const selected = selectedColor === color.id;
                                        return (
                                            <button
                                                key={color.id}
                                                type="button"
                                                onClick={() => handleColorSelect(color.id)}
                                                aria-label={colorName}
                                                aria-pressed={selected}
                                                title={colorName}
                                                className={`relative h-10 w-10 rounded-full border border-black/10 outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--wool-maroon)] focus-visible:ring-offset-2 ${selected ? 'ring-2 ring-[var(--wool-maroon)] ring-offset-2' : 'hover:scale-105'}`}
                                                style={{ backgroundColor: color.hex_code || '#cccccc' }}
                                            >
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        )}

                        {/* Size */}
                        {availableSizes.length > 0 && (
                            <fieldset className="mb-6">
                                <legend className="mb-3 text-sm text-[#5b4a42]">
                                    {text.size}{selectedSizeObj && <>{text.colon}<span className="font-medium text-[var(--wool-ink)]">{selectedSizeObj.display_name || selectedSizeObj.name}</span></>}
                                </legend>
                                <div className="flex flex-wrap gap-2">
                                    {availableSizes.map((size) => {
                                        const isAvailable = !selectedColor || product.product_variants?.some((v) => v.color_id === selectedColor && v.size_id === size.id && v.is_available !== false);
                                        const selected = selectedSize === size.id;
                                        return (
                                            <button
                                                key={size.id}
                                                type="button"
                                                onClick={() => handleSizeSelect(size.id)}
                                                disabled={!isAvailable}
                                                aria-pressed={selected}
                                                className={`h-11 min-w-12 rounded-full border px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--wool-maroon)] focus-visible:ring-offset-2 ${selected
                                                    ? 'border-[var(--wool-ink)] bg-[var(--wool-ink)] text-white'
                                                    : isAvailable
                                                        ? 'border-[#d9cfc3] hover:border-[var(--wool-ink)]'
                                                        : 'cursor-not-allowed border-[#ece4da] text-[#c2b6aa] line-through'}`}
                                            >
                                                {size.code || size.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        )}

                        {/* Quantity and add to cart */}
                        <div ref={setBuyRowEl} className="flex gap-3">
                            <div className="inline-flex h-12 shrink-0 items-center rounded-full border border-[#d9cfc3]" role="group" aria-label={text.quantity}>
                                <button
                                    type="button"
                                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                    className="h-12 w-11 rounded-s-full text-lg outline-none hover:bg-[#f3efe9] focus-visible:ring-2 focus-visible:ring-[var(--wool-maroon)]"
                                    aria-label="−"
                                >
                                    −
                                </button>
                                <span className="w-8 text-center font-medium" aria-live="polite">{quantity}</span>
                                <button
                                    type="button"
                                    onClick={() => setQuantity(quantity + 1)}
                                    className="h-12 w-11 rounded-e-full text-lg outline-none hover:bg-[#f3efe9] focus-visible:ring-2 focus-visible:ring-[var(--wool-maroon)]"
                                    aria-label="+"
                                >
                                    +
                                </button>
                            </div>
                            <AddToCartButton
                                product={{
                                    id: product.id,
                                    name: product.name,
                                    name_ar: product.name_ar,
                                    name_fr: product.name_fr,
                                    variantId: selectedVariant?.id,
                                    variantLabel: variantLabel || undefined,
                                    price: Math.round(discountedPrice),
                                    image: selectedVariant?.image_url || productImages[0]?.url || product.image_url || '',
                                    rating: averageRating,
                                    reviewCount: reviewCount
                                }}
                                quantity={quantity}
                                className="h-12 flex-1 justify-center rounded-full! bg-[var(--wool-maroon)]! text-base hover:bg-[#6b2516]!"
                            />
                        </div>

                        {/* Phones: sticky buy bar while the row above is out of view */}
                        <div className="h-24 sm:hidden" aria-hidden="true" />
                        <div
                            className={`fixed inset-x-0 bottom-0 z-40 border-t border-[#ece4da] bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform duration-200 motion-reduce:transition-none sm:hidden ${
                                buyRowVisible ? "translate-y-full" : "translate-y-0"
                            }`}
                            aria-hidden={buyRowVisible}
                        >
                            <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-2" dir="ltr">
                                        <span className="text-lg font-semibold text-[var(--wool-maroon)]">{Math.round(discountedPrice)} {currency}</span>
                                        {hasDiscount && <span className="text-sm text-[#a3958c] line-through">{Math.round(basePrice)} {currency}</span>}
                                    </div>
                                    {variantLabel && <p className="truncate text-xs text-[#6f5f57]">{variantLabel}</p>}
                                </div>
                                <AddToCartButton
                                    product={{
                                        id: product.id,
                                        name: product.name,
                                        name_ar: product.name_ar,
                                        name_fr: product.name_fr,
                                        variantId: selectedVariant?.id,
                                        variantLabel: variantLabel || undefined,
                                        price: Math.round(discountedPrice),
                                        image: selectedVariant?.image_url || productImages[0]?.url || product.image_url || '',
                                        rating: averageRating,
                                        reviewCount: reviewCount
                                    }}
                                    quantity={quantity}
                                    className="h-12 w-auto! shrink-0 justify-center rounded-full! bg-[var(--wool-maroon)]! px-6! text-base hover:bg-[#6b2516]!"
                                />
                            </div>
                        </div>

                        {/* Ordering terms */}
                        <ul className="mt-6 space-y-3 rounded-[14px] bg-[#f7f3ee] p-4 text-sm text-[#5b4a42]">
                            <li className="flex items-start gap-3">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--wool-camel)]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                    <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.6" />
                                </svg>
                                {text.cashOnDelivery}
                            </li>
                            <li className="flex items-start gap-3">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--wool-camel)]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <path d="M2 5h10v8H2zM12 8h3.5L18 10.5V13h-6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                    <circle cx="5.5" cy="14.5" r="1.5" fill="currentColor" />
                                    <circle cx="14.5" cy="14.5" r="1.5" fill="currentColor" />
                                </svg>
                                <span>
                                    {shippingCost && text.deliveryCostLine.replace('{cost}', String(shippingCost))}
                                    {shippingCost && freeShippingThreshold && <br />}
                                    {freeShippingThreshold && text.freeFrom.replace('{amount}', String(freeShippingThreshold))}
                                </span>
                            </li>
                            <li className="flex items-start gap-3">
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--wool-camel)]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
                                    <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                </svg>
                                {product.shipping_info || text.deliveryTime}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="woven-band" aria-hidden="true" />

            {/* The piece: description and details */}
            <section className="mx-auto grid max-w-7xl gap-10 px-4 py-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14 lg:py-16">
                <div>
                    <h2 className="font-[family-name:var(--font-kufi)] text-2xl font-bold">{text.aboutPiece}</h2>
                    {description && (
                        <div className="mt-5 max-w-[68ch] whitespace-pre-line text-[15px] leading-7 text-[#5b4a42]">{description}</div>
                    )}
                </div>
                <aside className="space-y-8 lg:border-s lg:border-[#ece4da] lg:ps-10">
                    {product.product_details && product.product_details.length > 0 && (
                        <div>
                            <h3 className="font-semibold">{text.productDetails}</h3>
                            <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-[#5b4a42] marker:text-[var(--wool-camel)]">
                                {product.product_details.map((detail, i) => <li key={i}>{detail}</li>)}
                                {product.weight && <li>{product.weight} g</li>}
                            </ul>
                        </div>
                    )}
                    <div>
                        <h3 className="font-semibold">{text.shippingDetails}</h3>
                        <dl className="mt-3 space-y-2 text-sm text-[#5b4a42]">
                            {shippingCost && (
                                <div className="flex justify-between gap-4">
                                    <dt>{text.homeDelivery}</dt>
                                    <dd className="font-medium text-[var(--wool-ink)]" dir="ltr">{shippingCost} TND</dd>
                                </div>
                            )}
                            {freeShippingThreshold && <p>{text.freeFrom.replace('{amount}', String(freeShippingThreshold))}</p>}
                            <p>{product.shipping_info || text.deliveryTime}</p>
                        </dl>
                    </div>
                    <div>
                        <h3 className="font-semibold">{text.sellerDetails}</h3>
                        <div className="mt-3 flex items-center gap-3">
                            <Image src="/assets/images/logoKachabity.jpg" alt="" width={44} height={44} className="rounded-full" />
                            <div className="text-sm">
                                <p className="font-medium">Kachabity</p>
                                <a href={`tel:${headerConfig.contact.phone.replace(/\s+/g, '')}`} className="text-[var(--wool-maroon)] hover:underline underline-offset-4" dir="ltr">
                                    {text.callUs}: {headerConfig.contact.phone}
                                </a>
                            </div>
                        </div>
                    </div>
                </aside>
            </section>

            {SHOW_RATINGS && (
            <>
            {/* Reviews */}
            <section id="reviews" className="scroll-mt-6 bg-[#f7f3ee]">
                <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-14 lg:py-16">
                    <div>
                        <h2 className="font-[family-name:var(--font-kufi)] text-2xl font-bold">{text.reviewsTitle}</h2>
                        <div className="mt-4 flex items-center gap-3">
                            {reviewCount > 0 && <span className="text-4xl font-semibold" dir="ltr">{averageRating.toFixed(1)}</span>}
                            <div>
                                <Stars value={averageRating} size="h-5 w-5" />
                                <p className="mt-1 text-sm text-[#5b4a42]">{reviewCount > 0 ? text.basedOn.replace('{count}', String(reviewCount)) : text.noRatingYet}</p>
                            </div>
                        </div>

                        {!customer ? (
                            <div className="mt-6">
                                <p className="text-sm text-[#5b4a42]">{text.reviewLoginPrompt}</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Link href={authHref(locale, { redirect: productUrl, reason: "review" })} className="rounded-full bg-[var(--wool-maroon)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#6b2516]">
                                        {text.logIn}
                                    </Link>
                                    <Link href={authHref(locale, { redirect: productUrl, reason: "review", mode: "signup" })} className="rounded-full border border-[var(--wool-ink)]/25 px-5 py-2.5 text-sm font-medium hover:border-[var(--wool-ink)]">
                                        {text.createAccount}
                                    </Link>
                                </div>
                            </div>
                        ) : !reviewFormOpen ? (
                            <button type="button" onClick={() => setReviewFormOpen(true)} className="mt-6 rounded-full border border-[var(--wool-ink)]/25 px-5 py-2.5 text-sm font-medium hover:border-[var(--wool-ink)]">
                                {text.writeReview}
                            </button>
                        ) : (
                            <form onSubmit={handleSubmit(onSubmitComment)} className="mt-6 rounded-[14px] bg-white p-5">
                                <p className="text-sm text-[#5b4a42]">
                                    {text.postingAs} <span className="font-medium text-[var(--wool-ink)]">{customerName(customer)}</span>
                                </p>
                                <fieldset className="mt-4">
                                    <legend className="mb-2 text-sm font-medium">{text.yourRating}</legend>
                                    <div className="flex gap-1" dir="ltr">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                            <button key={star} type="button" onClick={() => setSelectedRating(star)} aria-label={`${star}/5`} aria-pressed={star === selectedRating} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--wool-maroon)]">
                                                <svg className={`h-7 w-7 ${star <= selectedRating ? 'fill-[var(--wool-camel)]' : 'fill-[#e6ddd2]'}`} viewBox="0 0 20 20">
                                                    <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                                                </svg>
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>
                                <div className="mt-4">
                                    <FormTextarea label={text.comments} name="comment" placeholder={text.commentPlaceholder} register={register} error={errors.comment} required rows={4} />
                                </div>
                                <div className="mt-4 flex gap-2">
                                    <button type="submit" disabled={submittingComment} className="rounded-full bg-[var(--wool-maroon)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#6b2516] disabled:cursor-not-allowed disabled:opacity-50">
                                        {submittingComment ? text.submittingComment : text.send}
                                    </button>
                                    <button type="button" onClick={() => setReviewFormOpen(false)} className="rounded-full px-5 py-2.5 text-sm font-medium text-[#5b4a42] hover:text-[var(--wool-ink)]">
                                        {text.cancel}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>

                    <div>
                        {reviews.length === 0 ? (
                            <p className="rounded-[14px] bg-white p-6 text-[#5b4a42]">{text.noReviews}</p>
                        ) : (
                            <ul className="space-y-4">
                                {reviews.slice(0, visibleComments).map((review) => {
                                    const displayName = review.users?.name || review.user_name || 'Anonymous';
                                    const initials = displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
                                    const reviewDate = new Date(review.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
                                    return (
                                        <li key={review.id} className="rounded-[14px] bg-white p-5">
                                            <div className="flex items-center gap-3">
                                                {review.users?.avatar_url ? (
                                                    <Image src={review.users.avatar_url} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                                                ) : (
                                                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--wool-undyed)] text-sm font-semibold text-[var(--wool-brown)]">{initials}</span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate font-medium">{displayName}</p>
                                                    <p className="text-xs text-[#8a7a70]">{reviewDate}</p>
                                                </div>
                                                <Stars value={review.rating} />
                                            </div>
                                            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#5b4a42]">{review.comment}</p>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {reviews.length > visibleComments && (
                            <button type="button" onClick={() => setVisibleComments((prev) => prev + 5)} className="mt-4 rounded-full border border-[var(--wool-ink)]/25 px-5 py-2.5 text-sm font-medium hover:border-[var(--wool-ink)]">
                                {text.seeMoreReviews}
                            </button>
                        )}
                    </div>
                </div>
            </section>
            </>
            )}

            {/* More to explore */}
            {(similarProducts.length > 0 || relatedCategories.length > 0) && (
                <section className="mx-auto max-w-7xl px-4 py-12 lg:py-16">
                    {similarProducts.length > 0 && (
                        <>
                            <h2 className="font-[family-name:var(--font-kufi)] text-2xl font-bold">{text.similarProducts}</h2>
                            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
                                {similarProducts.map((item) => {
                                    const itemPrice = item.discount_percent ? item.base_price * (1 - item.discount_percent / 100) : item.base_price;
                                    const itemName = getProductName(item, locale);
                                    return (
                                        <li key={item.id}>
                                            <Link href={`/${locale}/products/${item.slug}`} className="group block outline-none">
                                                <div className="relative aspect-[3/4] overflow-hidden rounded-[14px] bg-[#f3efe9] group-focus-visible:ring-2 group-focus-visible:ring-[var(--wool-maroon)] group-focus-visible:ring-offset-2">
                                                    <Image src={item.image_url || '/assets/images/logo.svg'} alt={itemName} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover object-top object-top" />
                                                </div>
                                                <p className="mt-3 line-clamp-2 text-sm font-medium group-hover:underline underline-offset-4">{itemName}</p>
                                                <p className="mt-1 text-sm" dir="ltr">
                                                    <span className="font-semibold text-[var(--wool-maroon)]">{Math.round(itemPrice)} {item.currency || 'TND'}</span>
                                                    {item.discount_percent ? <span className="ms-2 text-[#a3958c] line-through">{Math.round(item.base_price)}</span> : null}
                                                </p>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                    {relatedCategories.length > 0 && (
                        <div className={similarProducts.length > 0 ? 'mt-12' : ''}>
                            <h3 className="font-semibold">{text.relatedCategories}</h3>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {relatedCategories.map((cat) => (
                                    <Link key={cat.id} href={`/${locale}/products?category=${cat.slug}`} className="rounded-full border border-[#d9cfc3] px-4 py-2 text-sm hover:border-[var(--wool-maroon)] hover:text-[var(--wool-maroon)]">
                                        {getCategoryName(cat, locale)}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
