export interface CachedCategory {
    id: string;
    name: string;
    name_ar?: string;
    name_fr?: string;
    slug: string;
    image_url?: string;
    sort_order: number;
    is_featured?: boolean;
    parent_id?: string | null;
}

const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; promise: Promise<CachedCategory[]> } | null = null;

/**
 * All live categories, ordered by sort_order. Shared in memory for a few minutes so the
 * header, listing, category and product pages don't each refetch the same list on
 * every navigation. RLS already hides soft-deleted categories.
 */
export function getCategories(): Promise<CachedCategory[]> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
    const promise = (async () => {
        const body = await (await fetch('/api/categories')).json();
        if (!body.success) throw new Error(body.error);
        return body.data as CachedCategory[];
    })();
    cached = { at: Date.now(), promise };
    promise.catch(() => { cached = null; }); // don't cache failures
    return promise;
}
