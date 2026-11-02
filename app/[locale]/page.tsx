import { storefront } from "@/lib/storefront-api";
import { cachedCatalogQuery } from "@/lib/catalog-cache";
import HeroSection from "@/components/sections/HeroSection";
import TopProducts from "@/components/products/TopProducts";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { Fragment, Suspense } from "react";
import PromoProducts from "@/components/products/PromoProducts";
import CustomerFeedback from "@/components/reviews/CustomerFeedback";
import { SHOW_RATINGS } from "@/lib/config";
import SaleBanner from "@/components/sections/SaleBanner";
import Reels from "@/components/sections/Reels";
import ServiceHighlights from "@/components/services/ServiceHighlights";
import ProductGrid from "@/components/products/ProductGrid";
import FAQ from "@/components/sections/FAQ";
import ProductShowcase from "@/components/landing/ProductShowcase";
import NewArrivals from "@/components/landing/NewArrivals";
import CollectionSpotlight from "@/components/landing/CollectionSpotlight";
import HowToOrder from "@/components/landing/HowToOrder";
import type { LandingProduct, SpotlightCollection } from "@/lib/landing-products";
import { DEFAULT_LANDING_CONFIG, type HomeSectionKey, type LandingConfig } from "@/lib/landing-config";
import { getFeaturedCategories, getTopProducts, getPromoProducts, getSaleBanners, getReels, getLatestReviews } from "@/lib/home-data";

// The hero carousel is hidden until it has its own images; the product showcase leads the page meanwhile.
const SHOW_HERO_CAROUSEL = false;

interface LandingData {
  showcase: LandingProduct[];
  ringPicks: LandingProduct[];
  newArrivals: LandingProduct[];
  spotlight: SpotlightCollection | null;
  freeShippingThreshold: number | null;
  layout: LandingConfig['layout'];
}

// Section order and visibility, and the products of each list, are set by the admin
// (Admin → Landing page); NestJS assembles them per locale.
const loadLandingData = (locale: string) => storefront<LandingData>(`landing?locale=${encodeURIComponent(locale)}`);

// Product-driven landing sections, cached under the catalog tag like the hero rows.
// Errors are caught outside the cache so a failed load isn't cached.
async function getLandingData(locale: string): Promise<LandingData> {
  try {
    return await cachedCatalogQuery(`landing-v7-${locale}`, () => loadLandingData(locale))();
  } catch (error) {
    console.error('Error fetching landing page data:', error);
    return { showcase: [], ringPicks: [], newArrivals: [], spotlight: null, freeShippingThreshold: null, layout: DEFAULT_LANDING_CONFIG.layout };
  }
}

const RING_MAX = 16;
const RING_MIN = 8; // fewer cards look sparse, and the 3D ring needs at least 4

// The 3D ring: exactly the admin's ring picks, in order, repeated to fill the ring when there are
// few of them. With no picks, the showcase pieces then the newest products.
function ringProducts(data: LandingData): LandingProduct[] {
  const picked = data.ringPicks.filter((p) => p.image).slice(0, RING_MAX);
  if (picked.length > 0) {
    const cards = [...picked];
    while (cards.length < RING_MIN) cards.push(...picked);
    return cards;
  }
  const cards: LandingProduct[] = [];
  for (const product of [...data.showcase, ...data.newArrivals]) {
    if (cards.length === RING_MAX) break;
    if (product.image && !cards.some((p) => p.id === product.id)) cards.push(product);
  }
  return cards;
}

// Hero rows change rarely: serve them from the Next.js data cache.
const getHeroContent = cachedCatalogQuery("hero-content", () => storefront<{ heroData: any[]; smallCardsData: any[] }>("hero"));

async function HeroContent({ locale }: { locale: string }) {
  try {
    const { heroData, smallCardsData } = await getHeroContent();

    return (
      <HeroSection
        heroData={heroData}
        smallCardsData={smallCardsData}
      />
    );
  } catch (error) {
    console.error('Error fetching hero data:', error);
    const errorMessages = {
      en: {
        welcome: "Welcome to our traditional store",
        discover: "Discover our amazing handcrafted products"
      },
      fr: {
        welcome: "Bienvenue dans notre magasin traditionnel",
        discover: "Découvrez nos produits artisanaux étonnants"
      },
      ar: {
        welcome: "مرحباً بكم في متجرنا التقليدي",
        discover: "اكتشف منتجاتنا الحرفية الرائعة"
      }
    };
    const t = errorMessages[locale as keyof typeof errorMessages] || errorMessages.en;
    return (
      <div className="w-full py-8 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-[#2b1a16] mb-4">
            {t.welcome}
          </h2>
          <p className="text-[#7a3b2e]">
            {t.discover}
          </p>
        </div>
      </div>
    );
  }
}

// Each section falls back to fetching in the browser if its server data failed to load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are passed straight to the section components
async function getHomeSections(): Promise<Record<'categories' | 'topProducts' | 'promoProducts' | 'saleBanners' | 'reels' | 'reviews', any>> {
  const settle = async <T,>(p: Promise<T>) => { try { return await p; } catch (error) { console.error('Home section data failed:', error); return undefined; } };
  const [categories, top, promo, saleBanners, reels, reviews] = await Promise.all([
    settle(getFeaturedCategories()),
    settle(getTopProducts()),
    settle(getPromoProducts()),
    settle(getSaleBanners()),
    settle(getReels()),
    SHOW_RATINGS ? settle(getLatestReviews()) : Promise.resolve(null),
  ]);
  return { categories, topProducts: top?.products, promoProducts: promo?.products, saleBanners, reels, reviews };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  const locale = requestedLocale || 'ar';
  // All home sections come from the Next.js data cache and render in the first HTML
  // (instead of each section fetching after hydration).
  const [landing, home] = await Promise.all([getLandingData(locale), getHomeSections()]);

  const sections: Record<HomeSectionKey, React.ReactNode> = {
    showcase: (
      <ProductShowcase
        locale={locale}
        products={landing.showcase}
        ringProducts={ringProducts(landing)}
        collectionSlug={landing.spotlight?.slug ?? null}
        freeShippingThreshold={landing.freeShippingThreshold}
      />
    ),
    new_arrivals: <NewArrivals locale={locale} products={landing.newArrivals} />,
    services: <ServiceHighlights />,
    categories: <ProductGrid locale={locale} initialCategories={home.categories} />,
    top_products: <TopProducts locale={locale} initialProducts={home.topProducts} />,
    spotlight: <CollectionSpotlight locale={locale} collection={landing.spotlight} />,
    promo_products: <PromoProducts locale={locale} initialProducts={home.promoProducts} />,
    sale_banners: <SaleBanner initialPromotions={home.saleBanners} />,
    reels: <Reels initialReels={home.reels} />,
    reviews: SHOW_RATINGS ? <CustomerFeedback initialReviews={home.reviews} /> : null,
    how_to_order: <HowToOrder locale={locale} freeShippingThreshold={landing.freeShippingThreshold} />,
    faq: <FAQ />,
  };

  return (
    <ErrorBoundary>
      <main className="min-h-screen bg-white">
        {SHOW_HERO_CAROUSEL && <HeroContent locale={locale} />}
        <Suspense fallback={<LoadingSpinner />}>
          {landing.layout
            .filter((section) => section.visible)
            .map((section) => <Fragment key={section.key}>{sections[section.key]}</Fragment>)}
        </Suspense>
      </main>
    </ErrorBoundary>
  );
}