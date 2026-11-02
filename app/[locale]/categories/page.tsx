"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCategories } from "@/lib/categories-cache";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

interface Category {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    image_url?: string;
    sort_order: number;
    is_featured?: boolean;
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
        title: "All Categories",
        subtitle: "Browse through our complete collection of categories",
        loading: "Loading categories...",
        noCategories: "No categories found",
        viewProducts: "View Products",
        seeMore: "See More Categories",
        previous: "Previous",
        next: "Next",
        showingResults: "Showing {count} categories"
    },
    fr: {
        title: "Toutes les catégories",
        subtitle: "Parcourez notre collection complète de catégories",
        loading: "Chargement des catégories...",
        noCategories: "Aucune catégorie trouvée",
        viewProducts: "Voir les produits",
        seeMore: "Voir plus de catégories",
        previous: "Précédent",
        next: "Suivant",
        showingResults: "Affichage de {count} catégories"
    },
    ar: {
        title: "جميع الفئات",
        subtitle: "تصفح مجموعتنا الكاملة من الفئات",
        loading: "جاري تحميل الفئات...",
        noCategories: "لم يتم العثور على فئات",
        viewProducts: "عرض المنتجات",
        seeMore: "عرض المزيد من الفئات",
        previous: "السابق",
        next: "التالي",
        showingResults: "عرض {count} فئات"
    }
};

export default function CategoriesPage() {
    const params = useParams();
    const locale = (params.locale as string) || 'en';
    const text = content[locale as keyof typeof content] || content.en;

    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const ITEMS_PER_PAGE = 12; // 12 categories per page (3x4 grid)

    useEffect(() => {
        async function fetchCategories() {
            try {
                setLoading(true);

                // Calculate pagination range
                const from = (currentPage - 1) * ITEMS_PER_PAGE;
                const to = from + ITEMS_PER_PAGE - 1;

                // Top-level only; sub-categories are shown on their parent's page.
                const all = (await getCategories()).filter((category) => !category.parent_id);
                const data = all.slice(from, to + 1);
                const count = all.length;

                if (data) {
                    setCategories(data);
                    setTotalCount(count || 0);
                }
            } catch (error) {
                console.error('Error fetching categories:', error);
                setCategories([]);
                setTotalCount(0);
            } finally {
                setLoading(false);
            }
        }

        fetchCategories();
    }, [currentPage]);

    // Scroll to top when page changes
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [currentPage]);

    if (loading) {
        return (
            <>
                <LoadingSpinner message={text.loading} />
            </>
        );
    }

    return (
        <>
            <div className="min-h-screen bg-white py-12">
                <div className="max-w-7xl mx-auto px-4">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <h1 className="text-4xl font-bold text-[#2b1a16] mb-4">
                            {text.title}
                        </h1>
                        <p className="text-gray-500 text-sm">
                            {text.subtitle}
                        </p>
                    </div>

                    {/* Results Count */}
                    {!loading && categories.length > 0 && (
                        <div className="mb-6">
                            <p className="text-sm text-gray-600">
                                {text.showingResults.replace('{count}', totalCount.toString())}
                            </p>
                        </div>
                    )}

                    {/* Categories Grid */}
                    {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                                <div key={index} className="w-full flex flex-col items-center">
                                    <div className="relative w-full aspect-square rounded-2xl bg-gray-200 animate-pulse mb-3" />
                                    <div className="w-24 h-4 bg-gray-200 animate-pulse rounded" />
                                </div>
                            ))}
                        </div>
                    ) : categories.length === 0 ? (
                        <div className="text-center py-16">
                            <svg className="w-24 h-24 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                            </svg>
                            <h3 className="text-xl font-semibold text-gray-900 mb-2">{text.noCategories}</h3>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                                {categories.map((category) => (
                                    <Link
                                        key={category.id}
                                        href={`/${locale}/products?category=${category.slug}`}
                                        className="group"
                                    >
                                        <div className="w-full flex flex-col items-center">
                                            <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-3 shadow-md group-hover:shadow-xl transition-shadow">
                                                <Image
                                                    src={category?.image_url || ""}
                                                    alt={getCategoryName(category, locale) || "category image"}
                                                    fill
                                                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                                                />
                                            </div>
                                            <h3 className="text-center font-medium text-[#2b1a16] text-sm group-hover:text-[#7a3b2e] transition">
                                                {getCategoryName(category, locale)}
                                            </h3>
                                        </div>
                                    </Link>
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalCount > ITEMS_PER_PAGE && (
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

