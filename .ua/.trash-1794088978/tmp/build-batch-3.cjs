const fs=require("fs");
process.chdir("C:/Users/Wassi/kachabity");
const R=JSON.parse(fs.readFileSync(".ua/tmp/ua-file-extract-results-3.json","utf8"));
const B=JSON.parse(fs.readFileSync(".ua/intermediate/batches.json","utf8")).batches.find(x=>x.batchIndex===3);
const F={
"components/ui/OrderTracking.tsx":["Client component showing a shopper's order progress as a four-step Colissimo tracker (placed, shipped, out for delivery, delivered) with localized status messages, tracking number and RTL support.",["component","delivery-tracking","i18n","storefront"],"moderate",{OrderTracking:["Renders the localized delivery stepper and status message for an order's parcel stage, barcode and last update.",["component","delivery-tracking","i18n"]]}],
"components/ui/SectionHeader.tsx":["Small presentational component rendering a centered section title with an optional subtitle.",["component","ui","presentational"],"simple",{SectionHeader:["Renders a centered h2 heading with an optional subtitle paragraph.",["component","ui","presentational"]]}],
"components/ui/StockProgress.tsx":["Client component drawing a sold-versus-in-stock progress bar used on promo product cards.",["component","ui","stock"],"simple",{StockProgress:["Computes the sold percentage and renders an accessible progress bar that turns red past 60%.",["component","ui","stock"]]}],
"hooks/useCarousel.ts":["React hook providing slide index state and navigation helpers for simple paginated carousels.",["hook","ui-state","carousel"],"simple",{useCarousel:["Tracks the current slide and returns next/prev/goTo handlers plus a helper slicing the items for the current slide.",["hook","carousel","ui-state"]]}],
"lib/cart-context.tsx":["Client-side shopping cart React context persisted in localStorage (key shopping_cart), with lines keyed by product and variant.",["context","state-management","cart","persistence"],"moderate",{cartLineKey:["Builds the cart line key from a product id and optional variant id.",["utility","cart"]],CartProvider:["Context provider holding cart items, totals and add/remove/update/clear actions, synced to localStorage.",["context","provider","cart","persistence"]],useCart:["Hook returning the cart context, throwing when used outside CartProvider.",["hook","cart","context"]]}],
"lib/catalog-cache.ts":["Server-side Next.js data cache for public catalog reads, tagging entries 'catalog' with a 5-minute safety revalidate and exposing invalidation for admin writes.",["cache","server","catalog","performance"],"simple",{cachedCatalogQuery:["Wraps a loader in unstable_cache under the catalog tag and revalidate window.",["cache","factory","catalog"]],invalidateCatalog:["Revalidates the catalog tag so storefront caches refresh after admin mutations.",["cache","invalidation","catalog"]]}],
"lib/categories-cache.ts":["Browser-side in-memory cache of the category list (5-minute TTL) shared by the header, listing, category and product pages.",["cache","client","categories","data-fetching"],"simple",{getCategories:["Fetches /api/categories once per TTL, sharing the in-flight promise and not caching failures.",["cache","data-fetching","categories"]]}],
"lib/config.ts":["Storefront configuration constants: ratings toggle, contact details, social links with SVG icons, navigation, languages and invoice/shipping defaults from NEXT_PUBLIC env vars.",["config","constants","storefront","environment"],"simple",{}],
"lib/customer-auth.ts":["Browser helpers for customer sessions: the NestJS account API client, the cached signed-in customer, auth change events, sign-out, login redirects and the useCustomer hook.",["authentication","client","hook","api-client","session"],"moderate",{
 accountApi:["Fetch wrapper for /api auth and account routes that returns data or throws an Error carrying the API code.",["api-client","authentication"]],
 getCustomer:["Returns the signed-in customer from /api/auth/me, memoized to one request per page load.",["authentication","session"]],
 announceAuthChange:["Updates the cached customer and dispatches an event so every useCustomer() refreshes.",["authentication","event-handler"]],
 signOut:["Calls the sign-out endpoint and announces the signed-out state.",["authentication","session"]],
 authHref:["Builds the localized login URL with an optional reason and return path.",["authentication","routing","utility"]],
 currentPath:["Returns the current browser path and query for redirect-back links.",["routing","utility"]],
 safeRedirect:["Validates a redirect target so only same-site relative paths are followed.",["security","validation","routing"]],
 useCustomer:["React hook exposing the signed-in customer and loading state, reacting to auth change events.",["hook","authentication","session"]],
 customerName:["Derives a display name for a customer from metadata or email.",["utility","formatting"]],
 goToLogin:["Navigates the browser to the login page with a reason and return path.",["authentication","routing"]]}],
"lib/favorites.ts":["Customer favorites client over /api/account/favorites: add, remove, toggle and list favorites, mapping product rows into display-ready favorite cards.",["favorites","api-client","storefront","data-model"],"moderate",{
 addToFavorites:["Adds a product to the signed-in customer's favorites via the account API.",["favorites","api-client"]],
 removeFromFavorites:["Removes a product from the customer's favorites via the account API.",["favorites","api-client"]],
 toggleFavorite:["Adds or removes a favorite depending on its current state.",["favorites","utility"]],
 getUserFavorites:["Loads the customer's favorites with products and transforms them for display.",["favorites","data-fetching"]],
 transformProductForFavorite:["Normalizes a favorite's product row: price, currency, image and review stats.",["serialization","favorites"]],
 calculateReviewStats:["Computes average rating and review count from a product's reviews.",["utility","reviews"]]}],
"lib/fonts.ts":["Self-hosted Reem Kufi variable font (Arabic and Latin) loaded with next/font/local for landing page headings.",["fonts","config","typography"],"simple",{}],
"lib/footer-config.ts":["Static footer configuration: brand, link sections, newsletter copy and copyright, plus FooterLink/FooterSection types.",["config","constants","footer"],"simple",{}],
"lib/get-site-settings.ts":["Type definition of the shop-wide shipping and tax settings returned by GET /api/storefront/settings.",["type-definition","settings","shipping"],"simple",{}],
"lib/home-data.ts":["Server-side home page loaders (top and promo products, featured categories, sale banners, reels, latest reviews) fetched from the NestJS storefront API and cached under the catalog tag.",["data-fetching","cache","home-page","server"],"simple",{}],
"lib/landing-products.ts":["Type definitions for the product-led landing sections (LandingProduct, SpotlightCollection) served by GET /api/storefront/landing.",["type-definition","landing-page","data-model"],"simple",{}],
"lib/language-context.tsx":["React context exposing the current route locale to client components and keeping <html lang> in sync.",["context","i18n","provider","hook"],"simple",{LanguageProvider:["Provides the locale and updates the document lang attribute on locale changes.",["provider","i18n","context"]],useLanguage:["Hook returning the language context, throwing outside LanguageProvider.",["hook","i18n"]],useLanguageSafe:["Hook returning the language context or a default when no provider is present.",["hook","i18n"]]}],
"lib/language-utils.ts":["Locale definitions and helpers: supported en/fr/ar languages with Arabic default, names, flags, RTL detection, Accept-Language parsing and locale validation.",["i18n","utility","rtl","constants"],"simple",{isRTL:["Returns whether a locale is right-to-left.",["i18n","rtl","utility"]],detectLanguageFromHeader:["Picks the best supported locale from an Accept-Language header, defaulting to Arabic.",["i18n","utility","middleware"]],isValidLocale:["Type guard checking a string is a supported locale.",["i18n","validation"]]}],
"lib/order-confirmation-email.ts":["Sends the order confirmation e-mail through nodemailer (Gmail or custom SMTP) with an HTML template built from the stored order and HTML-escaped customer text.",["email","notification","server","template"],"complex",{sendOrderConfirmationEmail:["Configures the SMTP transport and sends the confirmation e-mail for an order and its lines.",["email","notification","service"]],generateOrderConfirmationHTML:["Builds the HTML body of the confirmation e-mail with order lines, totals and shipping details.",["email","template","serialization"]]}],
"lib/order-types.ts":["Import-free Order and OrderItem row types shared between the storefront and the NestJS API.",["type-definition","orders","shared"],"simple",{}],
"lib/orders.ts":["Client checkout helper that posts orders to /api/orders with the stored traffic source and re-exports the shared Order types.",["api-client","checkout","orders"],"simple",{createOrder:["Posts the order payload (stripped of user ids) to /api/orders and returns the order or an error with the API code.",["api-client","checkout","orders"]]}],
"lib/product-detail.ts":["Loader for everything the product page needs (product, variants, images, similar products, related categories) from the NestJS storefront API.",["data-fetching","product","storefront"],"simple",{loadProductDetail:["Decodes the slug once and fetches the product detail payload from the storefront API.",["data-fetching","product"]]}],
"lib/product-images.ts":["ProductImage type and a helper choosing a product's main image URL with legacy fallbacks.",["utility","images","product","type-definition"],"simple",{getProductImageUrl:["Returns the main image URL from product_images, images or the legacy image_url field.",["utility","images"]]}],
"lib/product-search.ts":["Shared product search constant (minimum query length) documenting that matching and ranking run in Postgres search_products.",["search","constants","product"],"simple",{}],
"lib/quick-add.ts":["Client hook for adding products to the cart from product cards, opening the product page when a size/color must be chosen or stock is out.",["hook","cart","storefront","product"],"moderate",{useQuickAdd:["Returns an async handler that checks variants via the storefront API and either adds the line to the cart or navigates to the product page.",["hook","cart","event-handler"]]}],
"lib/schemas/auth-schema.ts":["Localized zod schemas (en/fr/ar messages) for sign-in, sign-up, forgot-password and new-password forms.",["validation","schema","authentication","i18n"],"moderate",{signInSchema:["Builds the localized sign-in schema (email and password).",["validation","authentication"]],signUpSchema:["Builds the localized sign-up schema with name, email, password and matching confirmation.",["validation","authentication"]],forgotPasswordSchema:["Builds the localized forgot-password schema (email).",["validation","authentication"]],newPasswordSchema:["Builds the localized new-password schema with confirmation matching.",["validation","authentication"]]}],
"lib/schemas/checkout-schema.ts":["Zod checkout form schema requiring name, Tunisian phone, Colissimo governorate, city and address, with optional email and postal fields.",["validation","schema","checkout"],"simple",{}],
"lib/service-highlights.ts":["Static service highlight cards (free shipping threshold, cash back, support) built from the header config.",["config","constants","marketing"],"simple",{getServiceHighlights:["Returns the service highlight cards, including the configured free-shipping threshold and currency.",["config","marketing"]]}],
"lib/storefront-api.ts":["Fetch helper for public NestJS storefront reads, calling NEST_URL on the server and the Next.js rewrite in the browser.",["api-client","utility","storefront"],"simple",{storefront:["Fetches /api/storefront/<path> without caching and returns its data or throws on failure.",["api-client","data-fetching"]]}],
"lib/traffic-source.ts":["Detects and remembers where a shopper came from (utm_source, referrer, ad click ids) for 30 days in the browser, and labels sources for the admin.",["analytics","utility","marketing","persistence"],"moderate",{detectTrafficSource:["Classifies a visit's source from utm_source, the referring host or ad click ids, else direct.",["analytics","utility"]],rememberTrafficSource:["Stores the latest non-direct traffic source in localStorage with a timestamp.",["analytics","persistence"]],storedTrafficSource:["Reads the remembered traffic source if it is still within 30 days.",["analytics","persistence"]]}],
"lib/utils/product-utils.ts":["Product helpers shared by storefront and API: localized names/descriptions/category names, descendant category ids, images, discounted price, stock status and product URLs.",["utility","product","i18n","shared"],"moderate",{getProductName:["Returns the product name in the locale, falling back to the base column.",["utility","i18n"]],getProductDescription:["Returns the localized product description with fallback.",["utility","i18n"]],getCategoryName:["Returns the localized category name with fallback.",["utility","i18n"]],getDescendantCategoryIds:["Collects a category id and all nested descendant ids for category filtering.",["utility","categories"]],getProductImageUrl:["Picks a product's main image URL with fallbacks.",["utility","images"]],calculateDiscountedPrice:["Computes the discounted price and savings from a base price and discount.",["utility","pricing"]],isProductInStock:["Returns whether a product has stock.",["utility","stock"]],getStockStatus:["Maps a stock quantity to a status label and color.",["utility","stock"]],getProductUrl:["Builds the localized product page URL.",["utility","routing"]],getSortedProductImages:["Returns product images sorted with the main image first, then by position.",["utility","images"]]}],
"types/product.ts":["Shared TypeScript types for products, variants, colors, sizes and promo products.",["type-definition","data-model","product"],"moderate",{}],
};
const files=B.files.map(f=>f.path).sort();
const res=Object.fromEntries(R.results.map(r=>[r.path,r]));
const nodes=[],edges=[];
const E=(s,t,type,w)=>edges.push({source:s,target:t,type,direction:"forward",weight:w});
const fnId=(p,n)=>`function:${p}:${n}`;
for(const p of files){
 if(!F[p]) throw new Error("missing "+p);
 const [summary,tags,complexity,fns]=F[p];
 nodes.push({id:`file:${p}`,type:"file",name:p.split("/").pop(),filePath:p,summary,tags,complexity});
 const r=res[p]; const exp=new Set((r.exports||[]).map(e=>e.name));
 for(const [n,[s,t]] of Object.entries(fns)){
  const fn=r.functions.find(x=>x.name===n); if(!fn) throw new Error(p+":"+n);
  const len=fn.endLine-fn.startLine+1;
  nodes.push({id:fnId(p,n),type:"function",name:n,filePath:p,lineRange:[fn.startLine,fn.endLine],summary:s,tags:t,complexity:len>60?"complex":len>25?"moderate":"simple"});
  E(`file:${p}`,fnId(p,n),"contains",1.0);
  if(exp.has(n)) E(`file:${p}`,fnId(p,n),"exports",0.8);
 }
 for(const t of B.batchImportData[p]||[]) E(`file:${p}`,`file:${t}`,"imports",0.7);
}
const C=[["components/ui/OrderTracking.tsx","OrderTracking","lib/language-utils.ts","isRTL"],
["lib/customer-auth.ts","getCustomer","lib/customer-auth.ts","accountApi"],["lib/customer-auth.ts","signOut","lib/customer-auth.ts","accountApi"],["lib/customer-auth.ts","signOut","lib/customer-auth.ts","announceAuthChange"],["lib/customer-auth.ts","useCustomer","lib/customer-auth.ts","getCustomer"],
["lib/favorites.ts","addToFavorites","lib/customer-auth.ts","accountApi"],["lib/favorites.ts","removeFromFavorites","lib/customer-auth.ts","accountApi"],["lib/favorites.ts","getUserFavorites","lib/customer-auth.ts","accountApi"],["lib/favorites.ts","toggleFavorite","lib/favorites.ts","addToFavorites"],["lib/favorites.ts","toggleFavorite","lib/favorites.ts","removeFromFavorites"],["lib/favorites.ts","getUserFavorites","lib/favorites.ts","transformProductForFavorite"],["lib/favorites.ts","transformProductForFavorite","lib/product-images.ts","getProductImageUrl"],
["lib/order-confirmation-email.ts","sendOrderConfirmationEmail","lib/order-confirmation-email.ts","generateOrderConfirmationHTML"],
["lib/orders.ts","createOrder","lib/traffic-source.ts","storedTrafficSource"],["lib/product-detail.ts","loadProductDetail","lib/storefront-api.ts","storefront"],
["lib/quick-add.ts","useQuickAdd","lib/storefront-api.ts","storefront"],["lib/quick-add.ts","useQuickAdd","lib/cart-context.tsx","useCart"],["lib/quick-add.ts","useQuickAdd","lib/language-context.tsx","useLanguage"]];
const ids=new Set(nodes.map(n=>n.id));
for(const [a,b,c,d] of C){const s=fnId(a,b),t=fnId(c,d); if(!ids.has(s)||!ids.has(t)) throw new Error(s+"->"+t); E(s,t,"calls",0.8);}
E("file:lib/home-data.ts","function:lib/catalog-cache.ts:cachedCatalogQuery","depends_on",0.6);
E("file:lib/home-data.ts","function:lib/storefront-api.ts:storefront","depends_on",0.6);
E("file:lib/catalog-cache.ts","function:lib/product-detail.ts:loadProductDetail","depends_on",0.6);
for(const e of edges) if(e.source===e.target) throw new Error("self "+e.source);
const imp=edges.filter(e=>e.type==="imports").length, expected=Object.values(B.batchImportData).reduce((a,v)=>a+v.length,0);
if(imp!==expected) throw new Error(`imports ${imp}!=${expected}`);
const allowed=new Set([...ids,...Object.values(B.batchImportData).flat().map(p=>"file:"+p)]);
for(const e of edges) if(!allowed.has(e.target)) throw new Error("bad target "+e.target);
const parts=Math.max(1,Math.ceil(Math.max(nodes.length/60,edges.length/120)));
const size=Math.ceil(files.length/parts);
fs.rmSync(".ua/intermediate/batch-3.json",{force:true});
for(let k=0;k<parts;k++){
 const pf=new Set(files.slice(k*size,(k+1)*size));
 const pn=nodes.filter(n=>pf.has(n.filePath)); const pid=new Set(pn.map(n=>n.id));
 const pe=edges.filter(e=>pid.has(e.source));
 const out=parts===1?".ua/intermediate/batch-3.json":`.ua/intermediate/batch-3-part-${k+1}.json`;
 fs.writeFileSync(out,JSON.stringify({nodes:pn,edges:pe},null,1));
 JSON.parse(fs.readFileSync(out,"utf8"));
 console.log(out,pn.length,pe.length);
}
console.log("total",nodes.length,edges.length,"imports",imp);
