/**
 * Addresses of the old WooCommerce shop (kachabiti.com before this site), still in Google's index.
 * Products and categories that live on are sent to their page here with a permanent redirect;
 * the rest (colour/size/age attribute archives, theme demo pages, plugin pages) answer 410 Gone
 * so they leave the index. The list comes from the Wayback Machine's captures of kachabiti.com;
 * new product slugs end with the old WooCommerce id (scripts/import-woocommerce.mjs).
 * Used by middleware.ts. Self-check: `node --experimental-strip-types scripts/check-legacy-redirects.mts`.
 */

// Old /produit/<slug> (decoded, lower case, no trailing slash) → new product slug, or
// `category:<slug>` when the old product has no single successor.
const PRODUCTS: Record<string, string> = {
    'burnous-homme-souf-tunisie-برنوس-تونسي': 'burnous-tunisien-laine-232',
    'kachabia-wbar': 'kachabia-poil-de-chameau-1853',
    'kathroun': 'kadroun-djerbien-laine-1801',
    'pack-antichar-luxe': 'pack-anticher-luxe-6415',
    'pack-العروس-التونسي': 'pack-marie-tunisien-5860',
    'pack-ولد-السلطان-2': 'pack-ould-essoltan-4975',
    'دنقري-ولد-السلطان-2': 'pack-ould-essoltan-4975',
    'qamis-nm': 'category:qamis-priere',
    'البرنوس-زوز-أكباش': 'burnous-tunisien-deux-beliers-3441',
    'البرنوس-زوز-أكباش-copie': 'burnous-tunisien-deux-beliers-3441',
    'برنوس-تونسي-زوز-أكباش': 'burnous-tunisien-deux-beliers-3441',
    'الدنقري-التونسي-المطروز-للأطفال': 'dengri-tunisien-brode-enfant-4681',
    'دنقري-منقوش-أطفال': 'dengri-tunisien-brode-enfant-4681',
    'الشاشية': 'chechia-tunisienne-2213',
    'القشابية-gris-uni': 'kachabia-laine-uni-gris-4496',
    'قشّابية-صوف-تونسية-uni-رمادي': 'kachabia-laine-uni-gris-4496',
    'القشابية-الرمضانية-blanche': 'category:kachabia-tunisienne',
    'القشابية-الصوف-الزمنية-raye': 'kachabia-zemnia-rayee-4952',
    'القشابية-المزركشة-raye': 'kachabia-mangouch-raye-3272',
    'القشابية-المغربية': 'category:kachabia-tunisienne',
    'القشابية-تيبار': 'kachabia-wazra-tibar-7018',
    'القشابية-تيبار-ستايل-مغربي': 'kachabia-wazra-tibar-7018',
    'القشابية-صوف-العربي': 'kachabia-chakhma-uni-3582',
    'القشابية-صوف-ستايل-مغربي': 'category:kachabia-laine',
    'القشابية-كشمير': 'kachabia-kachmir',
    'القشابية-كشمير-نصف': 'kachabia-demi-cachemire-3999',
    'القشابية-وزرة': 'kachabia-wazra-marron-3553',
    'القشابية-وزرة-مارون': 'kachabia-wazra-marron-3553',
    'القشابية-وزرة-1-gris': 'kachabia-gris-wazra-marron-4563',
    'القشابية-وزرة-2': 'category:kachabia-laine',
    'القشابية-وزرة-2-gris': 'category:kachabia-laine',
    'القشابية-وزرة-copie': 'category:kachabia-laine',
    'القميص-الملكي': 'qamis-priere-royal-1634',
    'بلغة-تونسية': 'balgha-tunisienne-5942',
    'بلغة-تونسية-luxe': 'balgha-tunisienne-luxe-6433',
    'بلوزة-جربية-التونسية-الأصلية': 'blouza-djerbienne-enfant-688',
    'دنقر-الاصلي': 'dengri-tunisien-homme-240',
    'دنقري-العروس': 'dengri-du-marie-5849',
    'قشابية-ألوان-demi': 'kachabia-couleurs-demi-2329',
    'قشابية-ألوان-demi-mouchete': 'kachabia-demi-mouchete-4755',
    'قشابية-النور-demi': 'kachabia-ennour-demi-4661',
    'قشابية-وزرة-بيضاء': 'kachabia-wazra-blanche-4443',
    'قشابية-ڨري-وزرة-demi': 'kachabia-gris-wazra-demi-4672',
    'قشابيةالصوف-زمنية': 'kachabia-laine-zemnia-homme-224',
    'قميص-الصلاة-copie': 'category:qamis-priere',
    'قميص-النور-الصيفي-للصلاة': 'qamis-priere-ennour-3831',
    'قميص-الوقار': 'qamis-priere-el-wakar-698',
    'قميص-صلاة-رجالي': 'category:qamis-priere',
    'مريول-المرسات': 'mariol-marsa-6301',
    'مريول-مارين': 'mariol-marine-5858',
    'مريول-متطروز': 'category:mariol',
    'مظلة-تونسية': 'mdhalla-chapeau-tunisien-6099',
    'مظلة-تونسية-اطفال': 'mdhalla-chapeau-tunisien-enfant-6113',
};

// Last segment of an old /categorie-produit/… path → new category slug. Unknown ones go to the product list.
const CATEGORIES: Record<string, string> = {
    'kachabia-demi-modern': 'kachabia-demi',
    'القشابية-demi': 'kachabia-demi',
    'القشابية': 'kachabia-tunisienne',
    'قشابية-تونسية': 'kachabia-tunisienne',
    'القشابي-طويلة': 'kachabia-longue',
    'قشابي-صوف': 'kachabia-laine',
    'قشابي-كشمير': 'kachabia-cachemire',
    'قشابي-ملف': 'kachabia-mlef',
    'البرنوس': 'burnous-tunisien',
    'برنوس-تونسي': 'burnous-tunisien',
    'البلوزة': 'blouza-djerbienne',
    'البلوزة-الجربية': 'blouza-djerbienne',
    'الدنقري': 'dengri-tunisien',
    'دنقري-تونسي': 'dengri-tunisien',
    'الشاشية': 'chechia-tunisienne',
    'شاشية-تونسية': 'chechia-tunisienne',
    'القميص': 'qamis-priere',
    'قميص-صلاة': 'qamis-priere',
    'الكذرون': 'kadroun-djerbien',
    'كدرون-جربي': 'kadroun-djerbien',
    'بلغة': 'balgha',
    'سعف': 'mdhalla',
    'مظلة': 'mdhalla',
    'عروضنا': 'packs',
    'مريول': 'mariol',
    'منتجا-اطفال': 'enfants',
};

// Old pages with nothing equivalent here (an unknown /produit/… is a theme demo or a deleted product).
const GONE = new Set(['color', 'size', 'age', 'author', 'woolentor-template', 'step', 'blog', 'evercompare', 'my-account', 'produit', '39-2']);

export type LegacyAnswer = { redirect: string } | { gone: true } | null;

/** What to do with a request path from the old shop; null when it isn't one. */
export function legacyAnswer(pathname: string): LegacyAnswer {
    let path = pathname;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        // a stray '%': match it as typed
    }
    const parts = path.toLowerCase().split('/').filter(Boolean);
    // The old shop's French copy lived under /fr/; everything else was Arabic.
    const locale = parts[0] === 'fr' && parts.length > 1 ? 'fr' : 'ar';
    if (locale === 'fr') parts.shift();
    const [first, second] = parts;
    if (!first) return null;
    const category = (slug?: string) => ({ redirect: slug ? `/${locale}/categories/${slug}` : `/${locale}/products` });

    if (first === 'shop') return category();
    if (first === 'accueil') return { redirect: `/${locale}` };
    if (first === 'فئات') return { redirect: `/${locale}/categories` };
    if (first === 'categorie-produit') return category(CATEGORIES[parts[parts.length - 1]]);
    const target = first === 'produit' && second ? PRODUCTS[second] : undefined;
    if (target?.startsWith('category:')) return category(target.slice('category:'.length));
    if (target) return { redirect: `/${locale}/products/${target}` };
    if (GONE.has(first)) return { gone: true };
    return null;
}
