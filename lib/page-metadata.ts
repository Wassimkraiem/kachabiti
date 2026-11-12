import type { Metadata } from 'next';

/**
 * Title and description of the storefront's own pages (they render in the browser, so their
 * metadata comes from a small layout.tsx next to each). Without them every page took the home
 * page's title, and Google listed e.g. the settings page as a home sitelink. Private pages
 * (cart, checkout, account, sign-in) are noindex: they don't belong in search results.
 */
type Texts = Record<'ar' | 'fr' | 'en', [title: string, description?: string]>;

const PAGES = {
    products: {
        ar: ['المتجر: قشابية، برنوس ولباس تقليدي تونسي', 'كل منتجاتنا: قشابية صوف وكشمير، برنوس، دنقري، شاشية وقميص صلاة، مصنوعة يدوياً في تونس. الدفع عند الاستلام.'],
        fr: ['Boutique : kachabia, burnous et habits traditionnels', 'Tous nos produits : kachabia en laine et cachemire, burnous, dengri, chéchia et qamis, faits main en Tunisie. Paiement à la livraison.'],
        en: ['Shop: kachabia, burnous and traditional clothing', 'All our products: wool and cashmere kachabia, burnous, dengri, chechia and prayer qamis, handmade in Tunisia. Cash on delivery.'],
    },
    categories: {
        ar: ['أصناف المنتجات', 'تصفح أصنافنا: قشابية تونسية، برنوس، دنقري، بلوزة جربية، شاشية، قميص صلاة وعروض.'],
        fr: ['Catégories', 'Parcourez nos catégories : kachabia, burnous, dengri, blouza djerbienne, chéchia, qamis et packs.'],
        en: ['Categories', 'Browse our categories: kachabia, burnous, dengri, Djerbian blouza, chechia, prayer qamis and packs.'],
    },
    promotions: {
        ar: ['التخفيضات والعروض', 'منتجات تقليدية تونسية بأسعار مخفضة: قشابية، برنوس وأكثر. الكمية محدودة.'],
        fr: ['Promotions', 'Habits traditionnels tunisiens à prix réduit : kachabia, burnous et plus. Quantités limitées.'],
        en: ['Promotional products', 'Traditional Tunisian clothing at reduced prices: kachabia, burnous and more. Limited quantities.'],
    },
    faq: {
        ar: ['الأسئلة الشائعة', 'إجابات عن الطلب، التوصيل، الدفع عند الاستلام، المقاسات والإرجاع.'],
        fr: ['Questions fréquentes', 'Réponses sur la commande, la livraison, le paiement à la livraison, les tailles et les retours.'],
        en: ['Frequently asked questions', 'Answers about ordering, delivery, cash on delivery, sizes and returns.'],
    },
    contact: {
        ar: ['اتصل بنا', 'تواصل مع قشابيتي بالهاتف أو واتساب أو عبر النموذج.'],
        fr: ['Contact', 'Contactez Kachabiti par téléphone, WhatsApp ou via le formulaire.'],
        en: ['Contact us', 'Reach Kachabiti by phone, WhatsApp or the contact form.'],
    },
    about: {
        ar: ['من نحن', 'قشابيتي: لباس تقليدي تونسي مصنوع يدوياً على أيدي حرفيين.'],
        fr: ['À propos', 'Kachabiti : habits traditionnels tunisiens faits main par des artisans.'],
        en: ['About us', 'Kachabiti: traditional Tunisian clothing handmade by artisans.'],
    },
    shipping: {
        ar: ['التوصيل', 'التوصيل لكامل ولايات تونس، الآجال والأسعار والدفع عند الاستلام.'],
        fr: ['Livraison', 'Livraison partout en Tunisie : délais, frais et paiement à la livraison.'],
        en: ['Shipping and delivery', 'Delivery across Tunisia: times, costs and cash on delivery.'],
    },
    privacy: { ar: ['سياسة الخصوصية'], fr: ['Politique de confidentialité'], en: ['Privacy policy'] },
    terms: { ar: ['الشروط والأحكام'], fr: ['Conditions générales'], en: ['Terms and conditions'] },
    cart: { ar: ['السلة'], fr: ['Panier'], en: ['Cart'] },
    checkout: { ar: ['إتمام الطلب'], fr: ['Commande'], en: ['Checkout'] },
    auth: { ar: ['تسجيل الدخول'], fr: ['Connexion'], en: ['Sign in'] },
    settings: { ar: ['حسابي'], fr: ['Mon compte'], en: ['My account'] },
    orderConfirmation: { ar: ['تأكيد الطلب'], fr: ['Confirmation de commande'], en: ['Order confirmation'] },
} satisfies Record<string, Texts>;

const PRIVATE = new Set<keyof typeof PAGES>(['cart', 'checkout', 'auth', 'settings', 'orderConfirmation']);

/** generateMetadata for one page: `export const generateMetadata = pageMetadata('contact')`. */
export function pageMetadata(page: keyof typeof PAGES) {
    return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
        const { locale } = await params;
        const texts: Texts = PAGES[page];
        const [name, description] = texts[locale as keyof Texts] ?? texts.en;
        const title = `${name} | Kachabiti`;
        return {
            title,
            ...(description && { description }),
            openGraph: { title, ...(description && { description }) },
            twitter: { title, ...(description && { description }) },
            ...(PRIVATE.has(page) && { robots: { index: false, follow: true } }),
        };
    };
}
