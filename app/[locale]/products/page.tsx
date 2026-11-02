"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ProductListCard from "@/components/products/ProductListCard";
import { getDescendantCategoryIds } from "@/lib/utils/product-utils";
import { getCategories } from "@/lib/categories-cache";
import { useQuickAdd } from "@/lib/quick-add";
import { toggleFavorite, getUserFavorites } from "@/lib/favorites";
import { getCustomer, goToLogin } from "@/lib/customer-auth";
import { isRTL } from "@/lib/language-utils";
import { storefront } from "@/lib/storefront-api";

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
}

const content = {
    en: {
        filter: "Filter",
        price: "Price",
        size: "Size",
        color: "Color",
        category: "Category",
        reviews: "reviews",
        addToCart: "Add",
        discount: "Discount",
        noProducts: "No products found",
        resultsFor: "Results for “{query}”",
        clearSearch: "Clear search",
        trySearch: "Check the spelling or try a shorter or more general word",
        showingResults: "Showing {count} products",
        applyFilters: "Filter",
        loadingProducts: "Loading products...",
        pleaseLogin: "Please login to save favorites",
        tryAdjustingFilters: "Try adjusting your filters",
        previous: "Previous",
        next: "Next"
    },
    fr: {
        filter: "Filtrer",
        price: "Prix",
        size: "Taille",
        color: "Couleur",
        category: "Catégorie",
        reviews: "avis",
        addToCart: "Ajouter",
        discount: "Réduction",
        noProducts: "Aucun produit trouvé",
        resultsFor: "Résultats pour « {query} »",
        clearSearch: "Effacer la recherche",
        trySearch: "Vérifiez l'orthographe ou essayez un mot plus court ou plus général",
        showingResults: "Affichage de {count} produits",
        applyFilters: "Filtrer",
        loadingProducts: "Chargement des produits...",
        pleaseLogin: "Veuillez vous connecter pour enregistrer vos favoris",
        tryAdjustingFilters: "Essayez d'ajuster vos filtres",
        previous: "Précédent",
        next: "Suivant"
    },
    ar: {
        filter: "تصفية",
        price: "السعر",
        size: "المقاس",
        color: "اللون",
        category: "الفئة",
        reviews: "تقييم",
        addToCart: "أضف",
        discount: "خصم",
        noProducts: "لم يتم العثور على منتجات",
        resultsFor: "نتائج البحث عن «{query}»",
        clearSearch: "مسح البحث",
        trySearch: "تحقق من الكتابة أو جرّب كلمة أقصر أو أعم",
        showingResults: "عرض {count} منتجات",
        applyFilters: "تصفية",
        loadingProducts: "جاري تحميل المنتجات...",
        pleaseLogin: "يرجى تسجيل الدخول لحفظ المفضلة",
        tryAdjustingFilters: "حاول تعديل المرشحات",
        previous: "السابق",
        next: "التالي"
    }
};

const SIZES = ["S", "M", "L", "XL", "XXL", "XXXL", "4XL"];

interface Color {
    id: string;
    name: string;
    hex_code?: string;
    rgb_code?: string;
    display_name?: string;
}

interface Size {
    id: string;
    name: string;
    display_name?: string;
    code?: string;
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

export default function ProductsPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const locale = (params.locale as string) || 'en';
    const text = content[locale as keyof typeof content] || content.en;
    const rtl = isRTL(locale);

    const [products, setProducts] = useState<Product[]>([]);
    const quickAdd = useQuickAdd('');
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoriesLoaded, setCategoriesLoaded] = useState(false);
    const [availableColors, setAvailableColors] = useState<Color[]>([]);
    const [availableSizes, setAvailableSizes] = useState<Size[]>([]);
    const [loading, setLoading] = useState(true);
    const [productsLoading, setProductsLoading] = useState(false); // Separate loading for products
    const [wishlist, setWishlist] = useState<Set<string>>(new Set());
    const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map());
    const [userId, setUserId] = useState<string | null>(null);

    // Filter states
    const [priceRange, setPriceRange] = useState<[number, number]>([0, 10000]);
    const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
    const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const ITEMS_PER_PAGE = 20;

    // Mobile filter drawer state
    const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

    // Prevent body scroll when filter drawer is open
    useEffect(() => {
        if (typeof document === "undefined") return;

        if (isFilterDrawerOpen) {
            const originalStyle = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = originalStyle;
            };
        }
    }, [isFilterDrawerOpen]);

    // Get category from URL if present
    const urlCategory = searchParams.get('category');
    const promoOnly = searchParams.get('promo');
    const sortParam = searchParams.get('sort');
    const search = searchParams?.get('search') || "";
    const router = useRouter();

    // Drops ?search= and keeps the other filters.
    const clearSearch = () => {
        const params = new URLSearchParams(searchParams?.toString());
        params.delete('search');
        const rest = params.toString();
        router.push(`/${locale}/products${rest ? `?${rest}` : ''}`);
    };

    // Initialize: Fetch categories, colors, sizes and user favorites
    useEffect(() => {
        fetchCategories();
        fetchColors();
        fetchSizes();
        fetchUserAndFavorites();
    }, []);

    // Fetch authenticated user and their favorites
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

    // Handle URL category parameter and set selected category
    useEffect(() => {
        if (categories.length > 0 && urlCategory) {
            // Find category ID from slug
            const category = categories.find(cat => cat.slug === urlCategory);
            if (category) {
                setSelectedCategoryIds(new Set([category.id]));
            }
        }
    }, [urlCategory, categories]);

    async function fetchCategories() {
        try {
            const data = await getCategories();
            if (data) {
                setCategories(data);
                // Create a map of category_id -> slug for easy lookup
                const map = new Map<string, string>(data.map((cat: Category) => [cat.id, cat.slug]));
                setCategoryMap(map);
            }
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setCategoriesLoaded(true);
        }
    }

    async function fetchColors() {
        try {
            const { data } = await (await fetch('/api/colors')).json();
            setAvailableColors(data ?? []);
        } catch (error) {
            console.error('Error fetching colors:', error);
            // Fallback to empty array if colors table doesn't exist
            setAvailableColors([]);
        }
    }

    async function fetchSizes() {
        try {
            const { data } = await (await fetch('/api/sizes')).json();
            setAvailableSizes(data ?? []);
        } catch (error) {
            console.error('Error fetching sizes:', error);
            // Fallback to empty array if sizes table doesn't exist
            setAvailableSizes([]);
        }
    }

    async function fetchProducts() {
        try {
            setProductsLoading(true);

            // Filters run in the database (GET /api/storefront/products); a search without a sort
            // comes back ranked by relevance.
            const params = new URLSearchParams({ page: String(currentPage), page_size: String(ITEMS_PER_PAGE) });
            if (search) params.set('search', search);
            if (promoOnly) params.set('promo', '1');
            if (priceRange[0] > 0) params.set('price_min', String(priceRange[0]));
            if (priceRange[1] < 1000) params.set('price_max', String(priceRange[1]));
            if (sortParam) params.set('sort', sortParam);
            if (selectedCategoryIds.size > 0) {
                // A selected category also matches products in its sub-categories.
                const ids = new Set<string>();
                selectedCategoryIds.forEach((id) => getDescendantCategoryIds(id, categories).forEach((d) => ids.add(d)));
                params.set('category_ids', Array.from(ids).join(','));
            }
            if (selectedSizes.size > 0) {
                // Size buttons carry names ("S", "M"…): match them to the sizes' code, name or display name.
                const wanted = Array.from(selectedSizes).map((size) => size.toUpperCase());
                const sizeIds = availableSizes
                    .filter((size) => [size.code, size.name, size.display_name].some((v) => v && wanted.includes(v.toUpperCase())))
                    .map((size) => size.id);
                if (sizeIds.length === 0 && availableSizes.length > 0) {
                    setProducts([]);
                    setTotalCount(0);
                    return;
                }
                if (sizeIds.length) params.set('size_ids', sizeIds.join(','));
            }
            if (selectedColors.size > 0) params.set('color_ids', Array.from(selectedColors).join(','));

            const { rows, total } = await storefront<{ rows: Product[]; total: number }>(`products?${params}`);
            setProducts(rows);
            setTotalCount(total);
        } catch (error) {
            console.error('Error fetching products:', error);
        } finally {
            setProductsLoading(false);
            setLoading(false); // Initial page load complete
        }
    }

    // Fetch products initially and when filters change
    useEffect(() => {
        // Wait for categories (URL category filters need them), but not for there to be any.
        if (categoriesLoaded) {
            // Reset to page 1 when filters change
            setCurrentPage(1);
            fetchProducts();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [priceRange, selectedSizes, selectedColors, selectedCategoryIds, categoriesLoaded, sortParam, search]);




    const toggleWishlist = async (productId: string) => {
        // If user not logged in, show message or redirect
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

    const toggleSize = (size: string) => {
        setSelectedSizes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(size)) {
                newSet.delete(size);
            } else {
                newSet.add(size);
            }
            return newSet;
        });
    };

    const toggleColor = (color: string) => {
        setSelectedColors(prev => {
            const newSet = new Set(prev);
            if (newSet.has(color)) {
                newSet.delete(color);
            } else {
                newSet.add(color);
            }
            return newSet;
        });
    };

    const toggleCategory = (categoryId: string) => {
        setSelectedCategoryIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(categoryId)) {
                newSet.delete(categoryId);
            } else {
                newSet.add(categoryId);
            }
            return newSet;
        });
    };
    // Refetch when page changes
    useEffect(() => {
        fetchProducts();
        // Scroll to top when page changes
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, promoOnly, search, sortParam])    // 👈 added


    if (loading) {
        return <LoadingSpinner message={text.loadingProducts} />;
    }

    // Filter content component (reused in desktop and mobile)
    const FilterContent = () => (
        <>
            {/* Price Range */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-900">{text.price}</span>
                    <button className="text-gray-400 hover:text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1000"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([0, parseInt(e.target.value)])}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#842E1B]"
                />
                <div className="flex items-center justify-between mt-2 text-sm text-gray-600">
                    <span>{priceRange[0]}</span>
                    <span>{priceRange[1]}</span>
                </div>
            </div>

            {/* Size Filter */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-900">{text.size}</span>
                    <button className="text-gray-400 hover:text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {SIZES.map(size => (
                        <button
                            key={size}
                            onClick={() => toggleSize(size)}
                            className={`px-3 py-2 text-sm font-medium border rounded-lg transition ${selectedSizes.has(size)
                                ? 'bg-[#842E1B] text-white border-[#842E1B]'
                                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                                }`}
                        >
                            {size}
                        </button>
                    ))}
                </div>
            </div>

            {/* Color Filter */}
            {availableColors.length > 0 && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-900">{text.color}</span>
                        <button
                            className="text-gray-400 hover:text-gray-600"
                            onClick={() => setSelectedColors(new Set())}
                            disabled={selectedColors.size === 0}
                        >
                            {selectedColors.size > 0 && (
                                <span className="text-xs text-[#842E1B]">Clear</span>
                            )}
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {availableColors.map(color => (
                            <button
                                key={color.id}
                                onClick={() => toggleColor(color.id)}
                                className={`relative w-10 h-10 rounded-full border-2 transition-all hover:scale-105 ${selectedColors.has(color.id)
                                    ? 'border-[#842E1B] scale-110 ring-2 ring-[#842E1B] ring-offset-2'
                                    : 'border-gray-300 hover:border-gray-400'
                                    }`}
                                style={{ backgroundColor: color.hex_code || '#CCCCCC' }}
                                title={color.display_name || color.name}
                                aria-label={`Filter by ${color.display_name || color.name}`}
                            >
                                {selectedColors.has(color.id) && (
                                    <svg
                                        className="absolute inset-0 m-auto w-5 h-5 text-white drop-shadow-lg"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={3}
                                            d="M5 13l4 4L19 7"
                                        />
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>
                    {selectedColors.size > 0 && (
                        <div className="mt-2 text-xs text-gray-600">
                            {selectedColors.size} color{selectedColors.size > 1 ? 's' : ''} selected
                        </div>
                    )}
                </div>
            )}

            {/* Category Filter */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-900">{text.category}</span>
                    <button className="text-gray-400 hover:text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {categories.map(category => (
                        <label key={category.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selectedCategoryIds.has(category.id)}
                                onChange={() => toggleCategory(category.id)}
                                className="w-4 h-4 text-[#842E1B] border-gray-300 rounded focus:ring-[#842E1B]"
                            />
                            <span className="text-sm text-gray-700">{getCategoryName(category, locale)}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Filter Button */}
            <button
                onClick={() => {
                    // Filters are applied automatically via state
                    setIsFilterDrawerOpen(false); // Close drawer on mobile
                }}
                className="w-full py-3 bg-[#842E1B] text-white rounded-lg hover:bg-[#6b2516] transition font-medium"
            >
                {text.applyFilters}
            </button>
        </>
    );

    return (
        <>
            <div className="min-h-screen bg-white py-8">
                <div className="max-w-7xl mx-auto px-4">
                    {/* Mobile Filter Button */}
                    <div className="lg:hidden mb-4 flex items-center justify-between">
                        <p className="text-sm text-gray-600">
                            {!productsLoading && text.showingResults.replace('{count}', products.length.toString())}
                        </p>
                        <button
                            onClick={() => setIsFilterDrawerOpen(true)}
                            className="flex h-11 items-center gap-2 rounded-full border border-[#d9cfc3] bg-white px-4 text-sm font-medium text-[#2b1a16] transition hover:border-[#2b1a16]"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            {text.filter}
                        </button>
                    </div>

                    <div className="grid lg:grid-cols-4 gap-8">
                        {/* Left Sidebar - Filters (Desktop only) */}
                        <div className="hidden lg:block lg:col-span-1">
                            <div className="bg-white rounded-lg p-6 border border-gray-200 sticky top-4">
                                <h2 className="text-xl font-bold text-gray-900 mb-6">{text.filter}</h2>
                                <FilterContent />
                            </div>
                        </div>

                        {/* Right Side - Product Grid */}
                        <div className="lg:col-span-3">
                            {/* Search heading */}
                            {search && (
                                <div className="mb-4 flex flex-wrap items-center gap-3">
                                    <h1 className="text-xl font-semibold text-gray-900">
                                        {text.resultsFor.replace('{query}', search)}
                                    </h1>
                                    <button
                                        type="button"
                                        onClick={clearSearch}
                                        className="text-sm font-medium text-[#842E1B] underline underline-offset-4 hover:text-[#6b2516]"
                                    >
                                        {text.clearSearch}
                                    </button>
                                </div>
                            )}

                            {/* Results Count - Desktop only */}
                            {!productsLoading && (
                                <div className="mb-6 hidden lg:block">
                                    <p className="text-sm text-gray-600">
                                        {text.showingResults.replace('{count}', products.length.toString())}
                                    </p>
                                </div>
                            )}

                            {/* Loading Skeleton */}
                            {productsLoading ? (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-3">
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
                                    <p className="text-gray-600">{search ? text.trySearch : text.tryAdjustingFilters}</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-3 pb-4">
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
                            )}

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
                        </div>
                    </div>
                </div>
            </div>

            {/* Mobile Filter Drawer */}
            {isFilterDrawerOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
                        onClick={() => setIsFilterDrawerOpen(false)}
                    />
                    {/* Drawer */}
                    <div
                        className={`fixed inset-y-0 z-50 w-full max-w-sm bg-white shadow-xl transform transition-transform duration-300 ease-in-out lg:hidden overflow-y-auto ${isFilterDrawerOpen ? 'translate-x-0' : (rtl ? 'translate-x-full' : '-translate-x-full')}`}
                        style={{ [rtl ? 'right' : 'left']: 0 }}
                        dir={rtl ? 'rtl' : 'ltr'}
                    >
                        <div className={`sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10 `}>
                            <h2 className="text-xl font-bold text-gray-900">{text.filter}</h2>
                            <button
                                onClick={() => setIsFilterDrawerOpen(false)}
                                className="text-gray-400 hover:text-gray-600 transition p-2"
                                aria-label="Close filter"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-6">
                            <FilterContent />
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

