// Public storefront reads served by the NestJS API (/api/storefront/*). On the server it calls
// NestJS directly (NEST_URL); in the browser it goes through the Next.js rewrite of the same path.
export async function storefront<T>(path: string): Promise<T> {
    const base = typeof window === 'undefined' ? process.env.NEST_URL ?? '' : '';
    const response = await fetch(`${base}/api/storefront/${path}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || `Storefront request failed (${response.status})`);
    return body.data as T;
}
