import { accountApi } from "./customer-auth";
import { getProductImageUrl } from "./product-images";

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";
const FALLBACK_IMAGE_URL = "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400";

export interface Favorite {
    id: string;
    user_id: string;
    product_id: string;
    created_at: string;
}

export interface FavoriteWithProduct {
    id: string;
    user_id: string;
    product_id: string;
    created_at: string;
    product: {
        id: string;
        name: string;
        name_ar?: string;
        name_fr?: string;
        title?: string;
        slug: string;
        price_cents: number;
        base_price?: number;
        currency: string;
        image_url: string;
        product_images?: Array<{ id: string; image_url: string; alt_text?: string | null; is_main: boolean; position: number }>;
        stock?: number | null;
        rating?: number;
        review_count?: number;
        discount_percent?: number;
    };
}

// The signed-in customer's favorites, through /api/account/favorites (NestJS). The API takes the
// user from the session; `userId` stays in the signatures for the existing callers.

export async function addToFavorites(_userId: string, productId: string): Promise<{ success: boolean; error: Error | null }> {
    try {
        await accountApi("account/favorites", { body: { product_id: productId } });
        return { success: true, error: null };
    } catch (error) {
        console.error("Error adding to favorites:", error);
        return { success: false, error: error as Error };
    }
}

export async function removeFromFavorites(_userId: string, productId: string): Promise<{ success: boolean; error: Error | null }> {
    try {
        await accountApi(`account/favorites?product_id=${encodeURIComponent(productId)}`, { method: "DELETE" });
        return { success: true, error: null };
    } catch (error) {
        console.error("Error removing from favorites:", error);
        return { success: false, error: error as Error };
    }
}

/** Callers pass the state they show, so no extra request is needed to know which way to go. */
export async function toggleFavorite(userId: string, productId: string, isFavorited?: boolean): Promise<{ isFavorited: boolean; error: Error | null }> {
    const favorited = isFavorited ?? (await getUserFavorites(userId)).favorites.some((fav) => fav.product_id === productId);
    const { error } = favorited ? await removeFromFavorites(userId, productId) : await addToFavorites(userId, productId);
    return { isFavorited: error ? favorited : !favorited, error };
}

type FavoriteRow = {
    id: string;
    user_id: string;
    product_id: string;
    created_at: string;
    products: any;
    discount_percent: number | null;
};

/** Favorites with product details and active discounts, newest first. */
export async function getUserFavorites(_userId: string): Promise<{ favorites: FavoriteWithProduct[]; error: Error | null }> {
    try {
        const rows = await accountApi<FavoriteRow[]>("account/favorites");
        const favorites: FavoriteWithProduct[] = rows.flatMap((fav) => {
            const product = transformProductForFavorite(fav.products, fav.discount_percent ? { discount_percent: fav.discount_percent } : null);
            if (!product) return [];
            return [{ id: fav.id, user_id: fav.user_id, product_id: fav.product_id, created_at: fav.created_at, product }];
        });
        return { favorites, error: null };
    } catch (error) {
        console.error("Error in getUserFavorites:", error);
        return { favorites: [], error: error as Error };
    }
}

function transformProductForFavorite(product: any, discount?: { discount_percent: number } | null) {
    if (!product) return null;

    const { rating, reviewCount } = calculateReviewStats(product.reviews);
    const imageUrl = getProductImageUrl(product) || FALLBACK_IMAGE_URL;
    const normalizedPrice = Number(product.base_price ?? 0);
    const discountPercent = discount?.discount_percent || undefined;

    return {
        id: product.id,
        name: product.name,
        title: product.name,
        slug: product.slug,
        base_price: normalizedPrice,
        price_cents: normalizedPrice,
        currency: DEFAULT_CURRENCY,
        image_url: imageUrl,
        product_images: product.product_images || [],
        stock: null,
        rating,
        review_count: reviewCount,
        discount_percent: discountPercent,
    };
}

function calculateReviewStats(reviews?: Array<{ rating?: number | null }>) {
    if (!reviews || reviews.length === 0) {
        return { rating: 0, reviewCount: 0 };
    }

    const ratedReviews = reviews.filter(
        (review) => typeof review?.rating === "number" && !Number.isNaN(Number(review.rating))
    );

    if (ratedReviews.length === 0) {
        return { rating: 0, reviewCount: 0 };
    }

    const total = ratedReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    const average = Number((total / ratedReviews.length).toFixed(1));

    return {
        rating: average,
        reviewCount: ratedReviews.length,
    };
}
