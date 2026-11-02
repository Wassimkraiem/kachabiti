// Types of the product-led landing sections (showcase, ring, new arrivals, collection
// spotlight). The data comes from the NestJS API (GET /api/storefront/landing).

export interface LandingProduct {
    id: string;
    slug: string;
    name: string;
    image: string | null;
    price: number;
    originalPrice: number | null;
    discountPercent: number;
    categoryName: string | null;
}

export interface SpotlightCollection {
    name: string;
    slug: string;
    productCount: number;
    subcategories: { name: string; slug: string }[];
    products: LandingProduct[];
}
