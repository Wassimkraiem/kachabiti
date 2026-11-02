/**
 * Product Images Utility Functions
 * Helper functions for working with product_images table
 */

export interface ProductImage {
    id: string;
    product_id: string;
    variant_id?: string | null;
    image_url: string;
    alt_text?: string | null;
    is_main: boolean;
    position: number;
    created_at?: string;
    updated_at?: string;
}

/**
 * Helper to get image URL from product (with fallback)
 */
export function getProductImageUrl(product: {
    product_images?: Array<Pick<ProductImage, 'image_url' | 'is_main'>>;
    images?: Array<Pick<ProductImage, 'image_url' | 'is_main'>>;
    image_url?: string; // Legacy fallback
}): string | null {
    // Try product_images first (new schema)
    if (product.product_images && product.product_images.length > 0) {
        const mainImage = product.product_images.find(img => img.is_main);
        return mainImage ? mainImage.image_url : product.product_images[0].image_url;
    }

    // Try images alias (backward compatibility)
    if (product.images && product.images.length > 0) {
        const mainImage = product.images.find(img => img.is_main);
        return mainImage ? mainImage.image_url : product.images[0].image_url;
    }

    // Legacy fallback
    if (product.image_url) {
        return product.image_url;
    }

    return null;
}
