import { ALL_PERMISSIONS } from '@/lib/admin-auth';
import { erpPaths, erpTags } from '@/lib/openapi-erp';

const serverUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

type SchemaObject = Record<string, unknown>;

const arrayResponse = (schemaRef: string, description: string): SchemaObject => ({
    description,
    content: {
        'application/json': {
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'array',
                        items: { $ref: schemaRef },
                    },
                    error: { type: 'string', nullable: true },
                },
            },
        },
    },
});

const objectResponse = (schemaRef: string, description: string): SchemaObject => ({
    description,
    content: {
        'application/json': {
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: schemaRef },
                    error: { type: 'string', nullable: true },
                },
            },
        },
    },
});

const messageResponse = (description: string): SchemaObject => ({
    description,
    content: {
        'application/json': {
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    error: { type: 'string', nullable: true },
                },
            },
        },
    },
});

const errorResponse = (_status: number, message = 'Unexpected error'): SchemaObject => ({
    description: message,
    content: {
        'application/json': {
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string' },
                },
            },
        },
    },
});

export const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Kachabity API',
        description: 'REST API powering the Kachabity storefront and admin dashboard.',
        version: '1.0.0',
        contact: {
            name: 'Kachabity Dev Team',
            url: serverUrl,
        },
    },
    servers: [
        { url: serverUrl, description: 'Current deployment' },
        { url: 'http://localhost:3000', description: 'Local development' },
    ],
    tags: [
        { name: 'Catalog', description: 'Products, categories, sizes, colors' },
        { name: 'Inventory', description: 'Variants and product images' },
        { name: 'Marketing', description: 'Newsletter and contact forms' },
        { name: 'Operations', description: 'Orders, uploads, and automations' },
        { name: 'Stock', description: 'Inventory per location, stock movements and stock settings (stock permission; costs need the costs permission)' },
        { name: 'Team', description: 'Back-office accounts and roles (admin only)' },
        ...erpTags,
    ],
    paths: {
        '/api/products': {
            get: {
                tags: ['Catalog'],
                summary: 'List active products',
                responses: {
                    200: arrayResponse('#/components/schemas/Product', 'Products fetched successfully'),
                    500: errorResponse(500, 'Failed to fetch products'),
                },
            },
            post: {
                tags: ['Catalog'],
                summary: 'Create a product with optional variants and images',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ProductInput' },
                        },
                    },
                },
                responses: {
                    201: objectResponse('#/components/schemas/Product', 'Product created'),
                    500: errorResponse(500, 'Failed to create product'),
                },
            },
            put: {
                tags: ['Catalog'],
                summary: 'Update a product',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                allOf: [
                                    { $ref: '#/components/schemas/ProductInput' },
                                    {
                                        type: 'object',
                                        required: ['id'],
                                        properties: {
                                            id: { type: 'string', description: 'Product ID' },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    200: objectResponse('#/components/schemas/Product', 'Product updated'),
                    400: errorResponse(400, 'Product ID missing'),
                    500: errorResponse(500, 'Failed to update product'),
                },
            },
            delete: {
                tags: ['Catalog'],
                summary: 'Soft-delete products (status archived + deleted_at)',
                parameters: [
                    {
                        name: 'id',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Product ID to delete',
                    },
                ],
                responses: {
                    200: messageResponse('Product deleted'),
                    400: errorResponse(400, 'Product ID missing'),
                    500: errorResponse(500, 'Failed to delete product'),
                },
            },
        },
        '/api/categories': {
            get: {
                tags: ['Catalog'],
                summary: 'List categories',
                responses: {
                    200: arrayResponse('#/components/schemas/Category', 'Categories fetched'),
                    500: errorResponse(500, 'Failed to fetch categories'),
                },
            },
            post: {
                tags: ['Catalog'],
                summary: 'Create category',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/CategoryInput' },
                        },
                    },
                },
                responses: {
                    201: objectResponse('#/components/schemas/Category', 'Category created'),
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Failed to create category'),
                },
            },
            put: {
                tags: ['Catalog'],
                summary: 'Update category',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                allOf: [
                                    { $ref: '#/components/schemas/CategoryInput' },
                                    {
                                        type: 'object',
                                        required: ['id'],
                                        properties: { id: { type: 'string' } },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    200: objectResponse('#/components/schemas/Category', 'Category updated'),
                    400: errorResponse(400, 'Category ID missing'),
                    500: errorResponse(500, 'Failed to update category'),
                },
            },
            delete: {
                tags: ['Catalog'],
                summary: 'Soft-delete categories (deleted_at)',
                parameters: [
                    { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    200: messageResponse('Category deleted'),
                    400: errorResponse(400, 'Category ID missing'),
                    500: errorResponse(500, 'Failed to delete category'),
                },
            },
        },
        '/api/colors': {
            get: {
                tags: ['Catalog'],
                summary: 'List colors',
                responses: {
                    200: arrayResponse('#/components/schemas/Color', 'Colors fetched'),
                    500: errorResponse(500, 'Failed to fetch colors'),
                },
            },
            post: {
                tags: ['Catalog'],
                summary: 'Create color',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ColorInput' },
                        },
                    },
                },
                responses: {
                    201: objectResponse('#/components/schemas/Color', 'Color created'),
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Failed to create color'),
                },
            },
            put: {
                tags: ['Catalog'],
                summary: 'Update color',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                allOf: [
                                    { $ref: '#/components/schemas/ColorInput' },
                                    {
                                        type: 'object',
                                        required: ['id'],
                                        properties: { id: { type: 'string' } },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    200: objectResponse('#/components/schemas/Color', 'Color updated'),
                    400: errorResponse(400, 'Color ID missing'),
                    500: errorResponse(500, 'Failed to update color'),
                },
            },
            delete: {
                tags: ['Catalog'],
                summary: 'Soft-delete colors (deleted_at)',
                parameters: [
                    { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    200: messageResponse('Color deleted'),
                    400: errorResponse(400, 'Color ID missing'),
                    500: errorResponse(500, 'Failed to delete color'),
                },
            },
        },
        '/api/sizes': {
            get: {
                tags: ['Catalog'],
                summary: 'List sizes',
                responses: {
                    200: arrayResponse('#/components/schemas/Size', 'Sizes fetched'),
                    500: errorResponse(500, 'Failed to fetch sizes'),
                },
            },
            post: {
                tags: ['Catalog'],
                summary: 'Create size',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/SizeInput' },
                        },
                    },
                },
                responses: {
                    201: objectResponse('#/components/schemas/Size', 'Size created'),
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Failed to create size'),
                },
            },
            put: {
                tags: ['Catalog'],
                summary: 'Update size',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                allOf: [
                                    { $ref: '#/components/schemas/SizeInput' },
                                    {
                                        type: 'object',
                                        required: ['id'],
                                        properties: { id: { type: 'string' } },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    200: objectResponse('#/components/schemas/Size', 'Size updated'),
                    400: errorResponse(400, 'Size ID missing'),
                    500: errorResponse(500, 'Failed to update size'),
                },
            },
            delete: {
                tags: ['Catalog'],
                summary: 'Soft-delete sizes (deleted_at)',
                parameters: [
                    { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    200: messageResponse('Size deleted'),
                    400: errorResponse(400, 'Size ID missing'),
                    500: errorResponse(500, 'Failed to delete size'),
                },
            },
        },
        '/api/variants': {
            get: {
                tags: ['Inventory'],
                summary: 'List variants for a product',
                parameters: [
                    {
                        name: 'product_id',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Product ID to filter variants',
                    },
                ],
                responses: {
                    200: arrayResponse('#/components/schemas/Variant', 'Variants fetched'),
                    400: errorResponse(400, 'Product ID missing'),
                    500: errorResponse(500, 'Failed to fetch variants'),
                },
            },
            post: {
                tags: ['Inventory'],
                summary: 'Create variant',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/VariantInput' },
                        },
                    },
                },
                responses: {
                    201: objectResponse('#/components/schemas/Variant', 'Variant created'),
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Failed to create variant'),
                },
            },
            put: {
                tags: ['Inventory'],
                summary: 'Update variant',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                allOf: [
                                    { $ref: '#/components/schemas/VariantInput' },
                                    {
                                        type: 'object',
                                        required: ['id'],
                                        properties: { id: { type: 'string' } },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    200: objectResponse('#/components/schemas/Variant', 'Variant updated'),
                    400: errorResponse(400, 'Variant ID missing'),
                    500: errorResponse(500, 'Failed to update variant'),
                },
            },
            delete: {
                tags: ['Inventory'],
                summary: 'Soft-delete a variant (deleted_at, unavailable) and its photos',
                parameters: [
                    { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    200: messageResponse('Variant deleted'),
                    400: errorResponse(400, 'Variant ID missing'),
                    500: errorResponse(500, 'Failed to delete variant'),
                },
            },
        },
        '/api/product-images': {
            get: {
                tags: ['Inventory'],
                summary: 'List product images',
                parameters: [
                    { name: 'product_id', in: 'query', required: false, schema: { type: 'string' } },
                    { name: 'variant_id', in: 'query', required: false, schema: { type: 'string' } },
                ],
                responses: {
                    200: arrayResponse('#/components/schemas/ProductImage', 'Images fetched'),
                    500: errorResponse(500, 'Failed to fetch images'),
                },
            },
            post: {
                tags: ['Inventory'],
                summary: 'Create product image',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ProductImageInput' },
                        },
                    },
                },
                responses: {
                    201: objectResponse('#/components/schemas/ProductImage', 'Image created'),
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Failed to create image'),
                },
            },
            put: {
                tags: ['Inventory'],
                summary: 'Update product image metadata',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                allOf: [
                                    { $ref: '#/components/schemas/ProductImageUpdate' },
                                    {
                                        type: 'object',
                                        required: ['id'],
                                        properties: { id: { type: 'string' } },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    200: objectResponse('#/components/schemas/ProductImage', 'Image updated'),
                    400: errorResponse(400, 'Image ID missing'),
                    500: errorResponse(500, 'Failed to update image'),
                },
            },
            delete: {
                tags: ['Inventory'],
                summary: 'Soft-delete a product image (deleted_at)',
                parameters: [
                    { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    200: messageResponse('Image deleted'),
                    400: errorResponse(400, 'Image ID missing'),
                    500: errorResponse(500, 'Failed to delete image'),
                },
            },
        },
        '/api/landing': {
            get: {
                tags: ['Marketing'],
                summary: 'Home page configuration: product picks per section, featured categories and landing_config (marketing permission)',
                responses: {
                    200: { description: '{ sections: Record<section, productId[]>, featuredCategories: categoryId[], config: { layout, lists, spotlightCategoryId } }' },
                    500: errorResponse(500, 'Failed to load'),
                },
            },
            put: {
                tags: ['Marketing'],
                summary: 'Save any combination of a section\'s picks, the config and the featured categories. Removed picks are soft-deleted.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    section: { type: 'string', enum: ['new_arrivals', 'showcase', 'ring', 'top_products', 'promo_products', 'spotlight'] },
                                    product_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                                    featured_category_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                                    config: {
                                        type: 'object',
                                        description: 'layout: [{ key, visible }] in display order; lists: { new_arrivals|top_products|promo_products|spotlight: { count (1-30), autofill } }; spotlightCategoryId: uuid or null',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: messageResponse('Saved'),
                    400: errorResponse(400, 'Invalid section or ids'),
                    500: errorResponse(500, 'Failed to save'),
                },
            },
        },
        '/api/admin/notifications': {
            get: {
                tags: ['Team'],
                summary: "The signed-in user's notifications (new orders, owner alerts)",
                parameters: ['limit', 'before', 'kind', 'unread'].map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
                responses: { 200: { description: '{ rows, unread, hasMore }; title/body are { en, fr, ar }' } },
            },
            put: {
                tags: ['Team'],
                summary: 'Mark notifications read: { ids: number[] } or { all: true }',
                responses: { 200: messageResponse('Marked read') },
            },
        },
        '/api/admin/notifications/push': {
            get: { tags: ['Team'], summary: 'Web Push public key for desktop notifications', responses: { 200: { description: '{ publicKey }' } } },
            post: { tags: ['Team'], summary: 'Register this browser: { subscription: PushSubscriptionJSON, locale }', responses: { 200: messageResponse('Saved') } },
            delete: { tags: ['Team'], summary: 'Stop desktop notifications for a browser: { endpoint } (soft delete)', responses: { 200: messageResponse('Removed') } },
        },
        '/api/admin/notifications/test': {
            post: { tags: ['Team'], summary: 'Send yourself a test notification (admin and desktop)', responses: { 200: messageResponse('Sent') } },
        },
        '/api/admin/activity': {
            get: {
                tags: ['Team'],
                summary: 'Back-office activity history (admin only, append-only log)',
                parameters: ['actor', 'entity', 'action', 'entityId', 'from', 'to', 'page', 'pageSize'].map((name) => ({
                    name, in: 'query', required: false, schema: { type: 'string' },
                })),
                responses: {
                    200: { description: '{ rows, total, actors }; actor=database lists direct database edits' },
                    403: errorResponse(403, 'Admins only'),
                },
            },
        },
        '/api/admin/trash': {
            get: {
                tags: ['Team'],
                summary: 'Deleted items: counts per table, or the soft-deleted rows of one table',
                description: 'Needs the hard_delete permission, plus the area permission of ?table= when given.',
                parameters: [{ name: 'table', in: 'query', required: false, schema: { type: 'string' }, description: 'products, orders, colors, … (omit for counts)' }],
                responses: {
                    200: { description: '{ counts } without table; { rows: [{ id, label, deleted_at }] } with table' },
                    400: errorResponse(400, 'Unknown table'),
                    403: errorResponse(403, 'Missing hard_delete or area permission'),
                },
            },
            delete: {
                tags: ['Team'],
                summary: 'Erase soft-deleted rows for good (rows that are not deleted are ignored)',
                description: 'Needs hard_delete plus the area permission of the table. Each erased row is recorded in the activity log (action purge).',
                parameters: [
                    { name: 'table', in: 'query', required: true, schema: { type: 'string' } },
                    { name: 'ids', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated ids' },
                ],
                responses: {
                    200: { description: '{ erased: number }' },
                    400: errorResponse(400, 'Unknown table or invalid ids'),
                    403: errorResponse(403, 'Missing hard_delete or area permission'),
                    409: errorResponse(409, 'IN_USE (still used by live records) or HAS_STOCK (variants still hold stock); nothing erased'),
                },
            },
        },
        '/api/upload/image': {
            post: {
                tags: ['Operations'],
                summary: 'Upload an image to the products bucket (R2)',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                required: ['file'],
                                properties: {
                                    file: {
                                        type: 'string',
                                        format: 'binary',
                                        description: 'JPEG, PNG, WebP, or GIF (max 5MB)',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Upload result',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        url: { type: 'string', format: 'uri' },
                                        fileName: { type: 'string' },
                                        error: { type: 'string', nullable: true },
                                    },
                                },
                            },
                        },
                    },
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Upload failed'),
                },
            },
            delete: {
                tags: ['Operations'],
                summary: 'Remove image from storage',
                parameters: [
                    {
                        name: 'fileName',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                    },
                ],
                responses: {
                    200: messageResponse('Image removed'),
                    400: errorResponse(400, 'File name missing'),
                    500: errorResponse(500, 'Failed to remove image'),
                },
            },
        },
        '/api/contact': {
            post: {
                tags: ['Marketing'],
                summary: 'Send contact form email',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ContactRequest' },
                        },
                    },
                },
                responses: {
                    200: messageResponse('Email sent'),
                    400: errorResponse(400, 'Validation error'),
                    500: errorResponse(500, 'Email service not configured or failed'),
                },
            },
        },
        '/api/newsletter/subscribe': {
            post: {
                tags: ['Marketing'],
                summary: 'Subscribe email to newsletter',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/NewsletterSubscribeRequest' },
                        },
                    },
                },
                responses: {
                    200: messageResponse('Subscription accepted'),
                    400: errorResponse(400, 'Invalid email address'),
                    500: errorResponse(500, 'Subscription failed'),
                },
            },
        },
        '/api/newsletter/unsubscribe': {
            get: {
                tags: ['Marketing'],
                summary: 'Unsubscribe email via magic link',
                parameters: [
                    {
                        name: 'email',
                        in: 'query',
                        required: true,
                        schema: { type: 'string', format: 'email' },
                    },
                ],
                responses: {
                    200: {
                        description: 'HTML confirmation page',
                        content: { 'text/html': { schema: { type: 'string' } } },
                    },
                    400: errorResponse(400, 'Email missing'),
                    500: errorResponse(500, 'Failed to unsubscribe'),
                },
            },
        },
        '/api/orders': {
            post: {
                tags: ['Operations'],
                summary: 'Place an order (checkout)',
                description: 'Prices are re-checked against the catalog; the confirmation email is sent server-side.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/CreateOrderRequest' },
                        },
                    },
                },
                responses: {
                    201: messageResponse('Order created'),
                    400: errorResponse(400, 'Invalid order data'),
                    409: errorResponse(409, 'Prices or totals are out of date (code: PRICES_CHANGED, TOTALS_CHANGED, PRODUCT_UNAVAILABLE, OUT_OF_STOCK, VARIANT_REQUIRED)'),
                    500: errorResponse(500, 'Unable to create order'),
                },
            },
        },
        '/api/stock/inventory': {
            get: { tags: ['Stock'], summary: 'Stock per variant and location', description: 'One row per live variant with levels per location, total, online stock and status.', responses: { 200: messageResponse('{ locations, rows }') } },
        },
        '/api/stock/movements': {
            get: {
                tags: ['Stock'],
                summary: 'Movement history, newest first',
                parameters: ['type', 'location_id', 'variant_id', 'search', 'limit', 'offset'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
                responses: { 200: messageResponse('Movements with total count') },
            },
            post: {
                tags: ['Stock'],
                summary: 'Record stock movements',
                description: 'type restock/return add, sale removes, adjustment is signed, transfer moves to to_location_id, count sets counted quantities (differences saved as adjustments). All lines succeed or none.',
                requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { type: { type: 'string', enum: ['restock', 'sale', 'return', 'adjustment', 'transfer', 'count'] }, location_id: { type: 'string', format: 'uuid' }, to_location_id: { type: 'string', format: 'uuid' }, items: { type: 'array', items: { type: 'object', properties: { variant_id: { type: 'string', format: 'uuid' }, quantity: { type: 'integer' } } } }, reference: { type: 'string' }, note: { type: 'string' }, track: { type: 'boolean', description: 'Start tracking these products on the website' } } } } } },
                responses: { 200: messageResponse('{ recorded }'), 400: errorResponse(400, 'Invalid movement data'), 409: errorResponse(409, 'Not enough stock') },
            },
        },
        '/api/stock/overview': {
            get: { tags: ['Stock'], summary: 'Dashboard figures and 30-day series', description: 'stock_value is null for staff.', responses: { 200: messageResponse('Overview') } },
        },
        '/api/stock/tracking': {
            put: { tags: ['Stock'], summary: 'Switch website stock tracking for products', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { product_ids: { type: 'array', items: { type: 'string', format: 'uuid' } }, tracked: { type: 'boolean' } } } } } }, responses: { 200: messageResponse('Updated') } },
        },
        '/api/delivery': {
            get: {
                tags: ['Operations'],
                summary: 'Colissimo parcels (orders permission)',
                description: 'Live parcels with their order (each with `paid`, the driver\'s live report `driver_status` / `driver_reason`, `manifest_id`, `handed_over_at` and a pending `price_change`), which Colissimo tokens are configured, and the last automatic check (`tracking`, every 15 minutes; null until the first one).',
                parameters: [{ name: 'order_id', in: 'query', schema: { type: 'string', format: 'uuid' } }],
                responses: { 200: messageResponse('{ rows, configured: { add, tracking }, tracking: { at, checked, changed, failures } | null }') },
            },
            post: {
                tags: ['Operations'],
                summary: 'Send an order to Colissimo, hand parcels over, edit them, look one up or add one by barcode, or refresh statuses',
                description: '`create` creates the parcel at Colissimo (with `order_id`, for that order, which it marks shipped; without, a parcel entered by hand); `create` with `items` and no `order_id` also creates an order for those products and validates it (they leave the stock); `quote` prices `items` from the catalog without saving; `validate` builds the parcel from the order, sends it and validates the order; `track` returns the Colissimo status of a barcode (status, reason, paid, driverStatus, driverReason) without saving; `import` adds an existing parcel after checking it with the tracking API; `refresh` asks Colissimo for the status of the given parcels (default: all that can still change; also done every 15 minutes). `handover` gives parcels waiting for pickup (`ids`) to Colissimo in a manifest: `{ manifests, accepted, refused: [{ barcode, reason }] }`. `edit` changes a parcel waiting for pickup (`id`, `parcel` with any of nom, tel, tel2, gouvernerat, ville, adresse, designation, nb_article, prix) at Colissimo, here and on its order; once printed, a price alone becomes a price change request. `price_change` asks Colissimo to change a parcel\'s price (`id`, `price`, `reason`); it answers later. Delivered parcels mark their order delivered; delivered and paid ("Livre paye", or "Livrer" with paid) records the cash held by the carrier.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['action'],
                                properties: {
                                    action: { type: 'string', enum: ['create', 'validate', 'quote', 'track', 'import', 'refresh', 'handover', 'edit', 'price_change'] },
                                    items: { type: 'array', description: 'create (without order_id) and quote: products of a parcel entered by hand', items: { type: 'object', properties: { product_id: { type: 'string', format: 'uuid' }, variant_id: { type: 'string', format: 'uuid', nullable: true }, quantity: { type: 'integer', minimum: 1 } } } },
                                    order_id: { type: 'string', format: 'uuid' },
                                    barcode: { type: 'string' },
                                    ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                                    id: { type: 'string', format: 'uuid', description: 'edit and price_change: the parcel' },
                                    price: { type: 'number', description: 'price_change: the new cash to collect (TND)' },
                                    reason: { type: 'string', description: 'price_change: why (sent to Colissimo, 255 characters)' },
                                    parcel: {
                                        type: 'object',
                                        description: 'Colissimo fields: nom, gouvernerat, ville, adresse, tel, tel2, designation, nb_article, prix, msg, echange (oui/non), article, nb_echange, ouvrir (0/1), fragile (0/1), type_colis (1-3)',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: messageResponse('Parcel or refresh summary'),
                    409: errorResponse(409, 'Order already has a parcel, or is cancelled'),
                    502: errorResponse(502, 'Colissimo refused the request or could not be reached; `code` is Colissimo\'s error_code when it gave one (e.g. ORDER_NOT_FOUND, ORDER_NOT_EDITABLE, ORDER_ALREADY_PRINTED, REQUEST_ALREADY_PENDING)'),
                    503: errorResponse(503, 'Colissimo tokens not configured'),
                },
            },
            delete: {
                tags: ['Operations'],
                summary: 'Remove parcels: deleted at Colissimo while waiting for pickup, then from the list (soft delete)',
                description: 'Parcels Colissimo already has (handed over, picked up, on the way) are kept, with the reason: removing them here would let the order be sent twice.',
                parameters: [{ name: 'ids', in: 'query', required: true, schema: { type: 'string' } }],
                responses: { 200: messageResponse('{ deleted, kept: [{ id, barcode, reason }] }') },
            },
        },
        '/api/stock/costs': {
            get: { tags: ['Stock'], summary: 'Purchase costs (admin)', responses: { 200: messageResponse('Costs'), 403: errorResponse(403, 'Admins only') } },
            put: { tags: ['Stock'], summary: 'Set or clear a product cost (admin)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { product_id: { type: 'string', format: 'uuid' }, cost: { type: 'number', nullable: true } } } } } }, responses: { 200: messageResponse('Saved'), 403: errorResponse(403, 'Admins only') } },
        },
        '/api/stock/locations': {
            get: { tags: ['Stock'], summary: 'List locations', responses: { 200: messageResponse('Locations') } },
            post: { tags: ['Stock'], summary: 'Create a location', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, sells_online: { type: 'boolean' } } } } } }, responses: { 200: messageResponse('Created'), 400: errorResponse(400, 'Invalid or duplicate name') } },
            put: { tags: ['Stock'], summary: 'Update a location', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, sells_online: { type: 'boolean' } } } } } }, responses: { 200: messageResponse('Updated') } },
            delete: { tags: ['Stock'], summary: 'Soft-delete a location (admin); refused while it sells online or holds stock', parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: messageResponse('Deleted'), 400: errorResponse(400, 'Still in use'), 403: errorResponse(403, 'Admins only') } },
        },
        '/api/stock/suppliers': {
            get: { tags: ['Stock'], summary: 'List suppliers', responses: { 200: messageResponse('Suppliers') } },
            post: { tags: ['Stock'], summary: 'Create a supplier', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, notes: { type: 'string' } } } } } }, responses: { 200: messageResponse('Created'), 400: errorResponse(400, 'Invalid or duplicate name') } },
            put: { tags: ['Stock'], summary: 'Update a supplier', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, notes: { type: 'string' } } } } } }, responses: { 200: messageResponse('Updated') } },
            delete: { tags: ['Stock'], summary: 'Soft-delete a supplier (admin)', parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: messageResponse('Deleted'), 400: errorResponse(400, 'Still in use'), 403: errorResponse(403, 'Admins only') } },
        },
        '/api/stock/collections': {
            get: { tags: ['Stock'], summary: 'List collections', responses: { 200: messageResponse('Collections') } },
            post: { tags: ['Stock'], summary: 'Create a collection', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } }, responses: { 200: messageResponse('Created'), 400: errorResponse(400, 'Invalid or duplicate name') } },
            put: { tags: ['Stock'], summary: 'Update a collection', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } } } }, responses: { 200: messageResponse('Updated') } },
            delete: { tags: ['Stock'], summary: 'Soft-delete a collection (admin)', parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: messageResponse('Deleted'), 400: errorResponse(400, 'Still in use'), 403: errorResponse(403, 'Admins only') } },
        },
        '/api/admin/me': {
            get: { tags: ['Team'], summary: 'Role and permissions of the signed-in back-office user', responses: { 200: messageResponse('{ role, email }') } },
        },
        '/api/admin/performance': {
            get: {
                tags: ['Team'],
                summary: 'Orders added per agent and how they ended (owners and admins)',
                description: 'One row per agent (agent_id null: website orders) over orders created in [from, to): orders, revenue (not cancelled), delivered, returned, cancelled, in progress, items. Default period: last 30 days.',
                parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }],
                responses: { 200: messageResponse('{ from, to, rows }'), 403: errorResponse(403, 'Admins only') },
            },
        },
        '/api/admin/team': {
            get: { tags: ['Team'], summary: 'List admins and staff', responses: { 200: messageResponse('Members') } },
            post: { tags: ['Team'], summary: 'Create a back-office account', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, role: { type: 'string', enum: ['admin', 'staff'] }, permissions: { type: 'array', items: { type: 'string', enum: ALL_PERMISSIONS }, description: 'Staff only; admins have every permission' } } } } } }, responses: { 200: messageResponse('Created'), 409: errorResponse(409, 'Account exists') } },
            put: { tags: ['Team'], summary: 'Change a role, or remove access with role null', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, role: { type: 'string', enum: ['admin', 'staff'], nullable: true }, permissions: { type: 'array', items: { type: 'string', enum: ALL_PERMISSIONS }, description: 'Staff only; admins have every permission' } } } } } }, responses: { 200: messageResponse('Updated') } },
        },
        '/api/cart/send-recovery-emails': {
            post: {
                tags: ['Operations'],
                summary: 'Trigger abandoned cart campaign',
                responses: {
                    200: {
                        description: 'Batch result',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        message: { type: 'string' },
                                        sent: { type: 'integer' },
                                        failed: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    500: errorResponse(500, 'Failed to send recovery emails'),
                },
            },
        },
        ...erpPaths,
    },
    components: {
        schemas: {
            Category: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    sort_order: { type: 'integer' },
                    is_featured: { type: 'boolean' },
                },
            },
            CategoryInput: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    sort_order: { type: 'integer', default: 0 },
                    is_featured: { type: 'boolean', default: false },
                },
            },
            Color: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    hex_code: { type: 'string' },
                    rgb_code: { type: 'string' },
                    display_name: { type: 'string' },
                    sort_order: { type: 'integer' },
                    description: { type: 'string' },
                },
            },
            ColorInput: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                    hex_code: { type: 'string', nullable: true },
                    rgb_code: { type: 'string', nullable: true },
                    display_name: { type: 'string', nullable: true },
                    sort_order: { type: 'integer', default: 0 },
                    description: { type: 'string', nullable: true },
                },
            },
            Size: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    display_name: { type: 'string' },
                    sort_order: { type: 'integer' },
                    description: { type: 'string' },
                },
            },
            SizeInput: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                    display_name: { type: 'string', nullable: true },
                    sort_order: { type: 'integer', default: 0 },
                    description: { type: 'string', nullable: true },
                },
            },
            Variant: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    product_id: { type: 'string' },
                    size_id: { type: 'string', nullable: true },
                    color_id: { type: 'string', nullable: true },
                    sku: { type: 'string', nullable: true },
                    price: { type: 'number', nullable: true },
                    stock: { type: 'integer' },
                    is_available: { type: 'boolean' },
                },
            },
            VariantInput: {
                type: 'object',
                required: ['product_id'],
                properties: {
                    product_id: { type: 'string' },
                    size_id: { type: 'string', nullable: true },
                    color_id: { type: 'string', nullable: true },
                    sku: { type: 'string', nullable: true },
                    price: { type: 'number', nullable: true },
                    price_cents: { type: 'number', nullable: true },
                    stock: { type: 'integer', default: 0 },
                    is_available: { type: 'boolean', default: true },
                },
            },
            ProductImage: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    product_id: { type: 'string' },
                    variant_id: { type: 'string', nullable: true },
                    image_url: { type: 'string' },
                    alt_text: { type: 'string', nullable: true },
                    is_main: { type: 'boolean' },
                    position: { type: 'integer' },
                },
            },
            ProductImageInput: {
                type: 'object',
                required: ['product_id', 'image_url'],
                properties: {
                    product_id: { type: 'string' },
                    variant_id: { type: 'string', nullable: true },
                    image_url: { type: 'string' },
                    alt_text: { type: 'string', nullable: true },
                    is_main: { type: 'boolean', default: false },
                    position: { type: 'integer', nullable: true },
                },
            },
            ProductImageUpdate: {
                type: 'object',
                properties: {
                    image_url: { type: 'string', nullable: true },
                    alt_text: { type: 'string', nullable: true },
                    is_main: { type: 'boolean', nullable: true },
                    position: { type: 'integer', nullable: true },
                },
            },
            Product: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    category_id: { type: 'string', nullable: true },
                    base_price: { type: 'number' },
                    status: { type: 'string', enum: ['active', 'inactive'] },
                    variants: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Variant' },
                    },
                    images: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ProductImage' },
                    },
                },
            },
            ProductInput: {
                type: 'object',
                required: ['name', 'base_price'],
                properties: {
                    name: { type: 'string' },
                    slug: { type: 'string', nullable: true },
                    description: { type: 'string', nullable: true },
                    category_id: { type: 'string', nullable: true },
                    base_price: { type: 'number' },
                    status: { type: 'string', enum: ['active', 'inactive'], default: 'active' },
                    variants: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/VariantInput' },
                    },
                    images: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ProductImageInput' },
                    },
                },
            },
            ContactRequest: {
                type: 'object',
                required: ['firstName', 'lastName', 'email', 'message'],
                properties: {
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    phone: { type: 'string', nullable: true },
                    message: { type: 'string' },
                    locale: { type: 'string', enum: ['en', 'fr', 'ar'], nullable: true },
                },
            },
            NewsletterSubscribeRequest: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { type: 'string', format: 'email' },
                },
            },
            CreateOrderRequest: {
                type: 'object',
                required: ['customerFirstName', 'customerLastName', 'customerPhone', 'items', 'subtotal', 'shippingCost', 'total'],
                properties: {
                    customerEmail: { type: 'string', format: 'email' },
                    customerFirstName: { type: 'string' },
                    customerLastName: { type: 'string' },
                    customerPhone: { type: 'string' },
                    shippingAddress: { type: 'string' },
                    shippingCity: { type: 'string' },
                    shippingState: { type: 'string' },
                    shippingZip: { type: 'string' },
                    shippingCountry: { type: 'string' },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'price', 'quantity'],
                            properties: {
                                id: { type: 'string', format: 'uuid' },
                                variantId: { type: 'string', format: 'uuid', nullable: true, description: 'Chosen size/color; required for tracked products with several variants' },
                                price: { type: 'number' },
                                quantity: { type: 'integer', minimum: 1 },
                            },
                        },
                    },
                    subtotal: { type: 'number' },
                    shippingCost: { type: 'number' },
                    total: { type: 'number' },
                    orderNotes: { type: 'string' },
                },
            },
        },
    },
} satisfies Record<string, unknown>;

export type OpenApiSpec = typeof openApiSpec;

