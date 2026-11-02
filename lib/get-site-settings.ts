// Shop-wide shipping and tax settings, as GET /api/storefront/settings returns them (NestJS).
export interface SiteSettings {
    global_free_shipping_threshold: number;
    free_shipping_enabled: boolean;
    default_shipping_cost: number;
    shipping_tax_rate: number;
    general_tax_rate: number;
}
