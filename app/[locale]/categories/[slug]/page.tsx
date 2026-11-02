"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ProductListCard from "@/components/products/ProductListCard";
import { storefront } from "@/lib/storefront-api";
import { getDescendantCategoryIds } from "@/lib/utils/product-utils";
import { getCategories } from "@/lib/categories-cache";
import Link from "next/link";
import { useQuickAdd } from "@/lib/quick-add";
import { toggleFavorite, getUserFavorites } from "@/lib/favorites";
import { getCustomer, goToLogin } from "@/lib/customer-auth";

interface Product {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    description?: string;
    base_price: number;
    currency?: string;
    discount_percent?: number;
    image_url?: string;
    stock: number;
    rating?: number;
    review_count?: number;
    category_id?: string;
    colors?: string[];
    sizes?: string[];
    product_images?: Array<{
        id: string;
        image_url: string;
        alt_text?: string;
        is_main: boolean;
        position: number;
    }>;
}

interface Category {
    id: string;
    name: string;
    slug: string;
    name_ar?: string;
    name_fr?: string;
    image_url?: string;
    parent_id?: string | null;
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

const content = {
    en: {
        loading: "Loading products...",
        noProducts: "No products found in this category",
        showingResults: "Showing {count} products",
        addToCart: "Add",
        pleaseLogin: "Please login to save favorites",
        previous: "Previous",
        next: "Next",
        backToCategories: "← Back to Categories"
    },
    fr: {
        loading: "Chargement des produits...",
        noProducts: "Aucun produit trouvé dans cette catégorie",
        showingResults: "Affichage de {count} produits",
        addToCart: "Ajouter",
        pleaseLogin: "Veuillez vous connecter pour enregistrer vos favoris",
        previous: "Précédent",
        next: "Suivant",
        backToCategories: "← Retour aux catégories"
    },
    ar: {
        loading: "جاري تحميل المنتجات...",
        noProducts: "لم يتم العثور على منتجات في هذه الفئة",
        showingResults: "عرض {count} منتجات",
        addToCart: "أضف",
        pleaseLogin: "يرجى تسجيل الدخول لحفظ المفضلة",
        previous: "السابق",
        next: "التالي",
        backToCategories: "← العودة إلى الفئات"
    }
};

export default function CategoryProductsPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const locale = (params.locale as string) || 'en';
    const categorySlug = params.slug as string;
    const text = content[locale as keyof typeof content] || content.en;

    const [products, setProducts] = useState<Product[]>([]);
    const [category, setCategory] = useState<Category | null>(null);
    const [subcategories, setSubcategories] = useState<Category[]>([]);
    const [categoryIds, setCategoryIds] = useState<string[]>([]);
    const quickAdd = useQuickAdd('');
    const [loading, setLoading] = useState(true);
    const [productsLoading, setProductsLoading] = useState(false);
    const [wishlist, setWishlist] = useState<Set<string>>(new Set());
    const [userId, setUserId] = useState<string | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const ITEMS_PER_PAGE = 20;

    // Fetch authenticated user and their favorites
    useEffect(() => {
        async function fetchUserAndFavorites() {
            try {
                const user = await getCustomer();
                if (user) {
                    setUserId(user.id);

                    // Fetch user's favorites
                    const { favorites } = await getUserFavorites(user.id);
                    const favoriteIds = new Set(favorites.map(fav => fav.product_id));
                    setWishlist(favoriteIds);
                }
            } catch (error) {
                console.error("Error fetching user favorites:", error);
            }
        }

        fetchUserAndFavorites();
    }, []);

    // Fetch category by slug
    useEffect(() => {
        async function fetchCategory() {
            try {
                // Load the whole tree once: the page lists products from sub-categories too.
                const data: Category[] = await getCategories();
                const current = (data || []).find((c: Category) => c.slug === categorySlug);
                if (current) {
                    setCategory(current);
                    setSubcategories((data || []).filter((c: Category) => c.parent_id === current.id));
                    setCategoryIds(getDescendantCategoryIds(current.id, data || []));
                }
            } catch (error) {
                console.error('Error fetching category:', error);
            }
        }

        if (categorySlug) {
            fetchCategory();
        }
    }, [categorySlug]);

    // Fetch products for this category
    async function fetchProducts() {
        if (!category) return;

        try {
            setProductsLoading(true);

            const params = new URLSearchParams({
                category_ids: (categoryIds.length ? categoryIds : [category.id]).join(','),
                page: String(currentPage),
                page_size: String(ITEMS_PER_PAGE),
            });
            const { rows, total } = await storefront<{ rows: Product[]; total: number }>(`products?${params}`);
            setProducts(rows);
            setTotalCount(total);
        } catch (error) {
            console.error('Error fetching products:', error);
        } finally {
            setProductsLoading(false);
            setLoading(false);
        }
    }

    useEffect(() => {
        if (category) {
            setCurrentPage(1);
            fetchProducts();
        }
    }, [category]);

    // Refetch when page changes
    useEffect(() => {
        if (category) {
            fetchProducts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    const toggleWishlist = async (productId: string) => {
        if (!userId) {
            goToLogin(locale, "favorites");
            return;
        }

        // Optimistically update UI
        setWishlist(prev => {
            const newSet = new Set(prev);
            if (newSet.has(productId)) {
                newSet.delete(productId);
            } else {
                newSet.add(productId);
            }
            return newSet;
        });

        // Persist to database
        try {
            const { isFavorited, error } = await toggleFavorite(userId, productId, wishlist.has(productId));

            if (error) {
                console.error("Error toggling favorite:", error);
                // Revert optimistic update on error
                setWishlist(prev => {
                    const newSet = new Set(prev);
                    if (newSet.has(productId)) {
                        newSet.delete(productId);
                    } else {
                        newSet.add(productId);
                    }
                    return newSet;
                });
            }
        } catch (error) {
            console.error("Error in toggleWishlist:", error);
        }
    };

    if (loading || !category) {
        return (
            <>
                <LoadingSpinner message={text.loading} />
            </>
        );
    }

    return (
        <>
            <div className="min-h-screen bg-white py-8">
                <div className="max-w-7xl mx-auto px-4">
                    {/* Back Button and Category Header */}
                    <div className="mb-8">
                        <a
                            href={`/${locale}/categories`}
                            className="inline-flex items-center text-[#7a3b2e] hover:text-[#842E1B] mb-4 transition"
                        >
                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            {text.backToCategories}
                        </a>
                        <h1 className="text-4xl font-bold text-[#2b1a16] mb-2">
                            {getCategoryName(category, locale)}
                        </h1>
                        {subcategories.length > 0 && (
                            <div className="flex flex-wrap gap-2 my-4">
                                {subcategories.map((sub) => (
                                    <Link
                                        key={sub.id}
                                        href={`/${locale}/categories/${sub.slug}`}
                                        className="px-4 py-2 rounded-full border border-gray-300 text-sm text-[#2b1a16] hover:border-[#7a3b2e] hover:text-[#7a3b2e] transition"
                                    >
                                        {getCategoryName(sub, locale)}
                                    </Link>
                                ))}
                            </div>
                        )}
                        {!productsLoading && (
                            <p className="text-gray-600">
                                {text.showingResults.replace('{count}', products.length.toString())}
                            </p>
                        )}
                    </div>

                    {/* Products Grid */}
                    {productsLoading ? (
                        <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-3 xl:grid-cols-4">
                            {Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                                <div key={index} className="animate-pulse">
                                            <div className="aspect-[4/5] w-full rounded-2xl bg-gray-200" />
                                            <div className="space-y-2 pt-3">
                                                <div className="h-4 w-3/4 rounded bg-gray-200" />
                                                <div className="h-3 w-1/2 rounded bg-gray-200" />
                                                <div className="h-3 w-1/3 rounded bg-gray-200" />
                                            </div>
                                        </div>
                            ))}
                        </div>
                    ) : products.length === 0 ? (
                        <div className="text-center py-16">
                            <svg className="w-24 h-24 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                            </svg>
                            <h3 className="text-xl font-semibold text-gray-900 mb-2">{text.noProducts}</h3>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-3 xl:grid-cols-4 pb-4">
                                {products.map(product => (
                                    <ProductListCard
                                        key={product.id}
                                        product={product as any}
                                        locale={locale}
                                        isFavorite={wishlist.has(product.id)}
                                        onToggleFavorite={toggleWishlist}
                                        onAddToCart={(item) => quickAdd(item)}
                                    />
                                ))}
                            </div>

                            {/* Pagination */}
                            {!productsLoading && totalCount > ITEMS_PER_PAGE && (
                                <div className="mt-12 flex items-center justify-center gap-2">
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                        disabled={currentPage === 1}
                                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                    >
                                        {text.previous}
                                    </button>

                                    <div className="flex gap-1">
                                        {Array.from({ length: Math.ceil(totalCount / ITEMS_PER_PAGE) }, (_, i) => i + 1)
                                            .filter(page => {
                                                const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
                                                return page === 1 ||
                                                    page === totalPages ||
                                                    Math.abs(page - currentPage) <= 1;
                                            })
                                            .map((page, index, array) => {
                                                const showEllipsisBefore = index > 0 && array[index - 1] < page - 1;
                                                return (
                                                    <div key={page} className="flex items-center gap-1">
                                                        {showEllipsisBefore && <span className="px-2">...</span>}
                                                        <button
                                                            onClick={() => setCurrentPage(page)}
                                                            className={`w-10 h-10 rounded-lg transition ${currentPage === page
                                                                ? 'bg-[#842E1B] text-white'
                                                                : 'border border-gray-300 hover:bg-gray-50'
                                                                }`}
                                                        >
                                                            {page}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                    </div>

                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalCount / ITEMS_PER_PAGE), prev + 1))}
                                        disabled={currentPage >= Math.ceil(totalCount / ITEMS_PER_PAGE)}
                                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                    >
                                        {text.next}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

