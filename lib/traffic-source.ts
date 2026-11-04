// Where a website shopper came from (Google, Facebook, Instagram, TikTok…), remembered in the
// browser and sent with the order (lib/orders.ts → orders.traffic_source). Relative imports only:
// the admin screens read the labels too.

const KEY = "kb_traffic_source";
const KEEP_MS = 30 * 24 * 3600 * 1000;

/** Shown in the admin; any other value is the referring site's address. */
export const TRAFFIC_SOURCE_LABELS: Record<string, string> = {
    google: "Google",
    facebook: "Facebook",
    instagram: "Instagram",
    tiktok: "TikTok",
    whatsapp: "WhatsApp",
    youtube: "YouTube",
    snapchat: "Snapchat",
    bing: "Bing",
    direct: "Direct",
};

// Referring sites and utm_source spellings → a source (first match wins).
const KNOWN: [RegExp, string][] = [
    [/(^|\.)instagram\.com$|^ig$|^insta/, "instagram"],
    [/(^|\.)(facebook|fb|messenger)\.(com|me)$|^fb$|^facebook|^meta$/, "facebook"],
    [/(^|\.)tiktok\.com$|^tt$|^tiktok/, "tiktok"],
    [/(^|\.)(whatsapp\.(com|net)|wa\.me)$|^wa$|^whatsapp/, "whatsapp"],
    [/(^|\.)(youtube\.com|youtu\.be)$|^yt$|^youtube/, "youtube"],
    [/(^|\.)snapchat\.com$|^snap/, "snapchat"],
    [/(^|\.)google\.[a-z.]+$|^google/, "google"],
    [/(^|\.)bing\.com$|^bing/, "bing"],
];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const known = (value: string) => KNOWN.find(([pattern]) => pattern.test(value))?.[1];

/**
 * The source of this visit: the link's utm_source (set it on ads and bio links), then the
 * referring site, then the click ids ad networks add, else "direct". Visits from our own pages
 * (another tab of the shop) are "direct" too.
 */
export function detectTrafficSource(search: string, referrer: string, ownHost: string): string {
    const params = new URLSearchParams(search);
    const utm = slug(params.get("utm_source") ?? "");
    if (utm) return known(utm) ?? utm;
    let host = "";
    try {
        host = referrer ? new URL(referrer).hostname.replace(/^(www|m|l|lm)\./, "") : "";
    } catch {
        // not a URL: no referrer
    }
    if (host && host !== ownHost.replace(/^www\./, "")) return known(host) ?? slug(host);
    if (params.has("gclid") || params.has("gbraid") || params.has("wbraid")) return "google";
    if (params.has("ttclid")) return "tiktok";
    if (params.has("fbclid")) return "facebook";
    return "direct";
}

/** Keeps the latest visit that came from somewhere (a later direct visit doesn't erase it). */
export function rememberTrafficSource() {
    try {
        const source = detectTrafficSource(window.location.search, document.referrer, window.location.hostname);
        const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as { source: string; at: number } | null;
        const fresh = stored && Date.now() - stored.at < KEEP_MS;
        if (source !== "direct" || !fresh) localStorage.setItem(KEY, JSON.stringify({ source, at: Date.now() }));
    } catch {
        // storage blocked: the order just has no source
    }
}

export function storedTrafficSource(): string | undefined {
    try {
        const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as { source: string; at: number } | null;
        return stored && Date.now() - stored.at < KEEP_MS ? stored.source : undefined;
    } catch {
        return undefined;
    }
}
