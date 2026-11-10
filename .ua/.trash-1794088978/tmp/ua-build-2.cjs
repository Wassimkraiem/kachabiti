const fs=require('fs');
process.chdir('C:/Users/Wassi/kachabity');
const B=JSON.parse(fs.readFileSync('.ua/intermediate/batches.json','utf8')).batches.find(x=>x.batchIndex===2);
const R=JSON.parse(fs.readFileSync('.ua/tmp/ua-file-extract-results-2.json','utf8')).results;
const F={
'components/landing/HowToOrder.tsx':['Landing-page section explaining the ordering steps in en/fr/ar, with RTL layout and a contact call-to-action from the header config.',['component','landing','i18n','section']],
'components/landing/LandingProductCard.tsx':['Image-led product card for landing sections showing a portrait photo, name, category and price.',['component','landing','product-card','presentational']],
'components/landing/NewArrivals.tsx':['Home-page "New arrivals" section that renders landing product picks as LandingProductCard tiles with a localized heading.',['component','landing','home-section','i18n']],
'components/landing/ProductRing3D.tsx':['Client wrapper that lazy-loads the three.js ring scene behind a WebGL/reduced-motion capability check, showing static photos until it is ready.',['component','3d','lazy-loading','progressive-enhancement']],
'components/landing/ProductShowcase.tsx':['Full-width landing header whose background is the 3D product ring (or a static photo backdrop), with localized heading, text and buttons on top.',['component','landing','hero','i18n']],
'components/landing/ring-scene.ts':['three.js scene for the landing header: product photos on a slowly turning, draggable curved ring with a woven kachabia-stripe ribbon; loaded on demand so three.js stays out of the first page load.',['3d','webgl','animation','factory'],'complex'],
'components/layout/MobileHeader.tsx':['Phone header: compact bar with menu drawer, logo and search panel, language switch, contact links and sign-out; cart and account live in the bottom tab bar.',['component','layout','navigation','mobile'],'complex'],
'components/layout/MobileTabBar.tsx':['Bottom tab bar on phones with cart count and account links, hidden on product and checkout pages, rendering a spacer to avoid covering content.',['component','layout','navigation','mobile']],
'components/layout/SearchBox.tsx':['Product search field with ranked suggestions from the storefront API, keyboard navigation and a see-all link, in light (desktop) or dark (mobile menu) style.',['component','search','autocomplete','api-client'],'complex'],
'components/layout/StaticHeader.tsx':['Main storefront header: logo, navigation, featured category menu with sub-categories, search, language switcher, account and cart button, delegating to MobileHeader on phones.',['component','layout','navigation','i18n'],'complex'],
'components/layout/TrafficSource.tsx':['Renderless client component that records the visit traffic source (Google, Facebook...) once on the landing page.',['component','analytics','tracking','renderless'],'simple'],
'components/products/ProductGrid.tsx':['Horizontally scrollable strip of featured categories with scroll buttons, using server-loaded categories or the shared categories cache.',['component','catalog','categories','carousel'],'complex'],
'components/products/ProductListCard.tsx':['Product card used in listings and carousels with localized name, sorted main image, price, discount and optional ratings, plus favorite and quick-add actions.',['component','product-card','catalog','presentational']],
'components/products/PromoProductCard.tsx':['Promotional product card with discounted price, countdown timer, stock progress and add-to-cart via quick add.',['component','product-card','promotion','cart']],
'components/products/PromoProducts.tsx':['Home-page promotions section listing discounted products as PromoProductCards, from server-loaded data or /api/products/promo.',['component','home-section','promotion','data-fetching']],
'components/products/TopProducts.tsx':['Home-page top-products carousel with review stats, favorites toggling for signed-in customers and quick add, from server-loaded data or /api/products/top.',['component','home-section','favorites','data-fetching'],'complex'],
'components/reviews/CustomerFeedback.tsx':['Customer reviews carousel fetched from the storefront API, combined with service highlight cards, carousel navigation and indicators.',['component','reviews','carousel','home-section']],
'components/reviews/ReviewCard.tsx':['Presentational card showing a customer review with star rating, author and date.',['component','reviews','presentational','rating']],
'components/sections/FAQ.tsx':['Localized FAQ accordion section that scrolls into view when the URL hash is #faqs.',['component','faq','i18n','accordion']],
'components/sections/HeroSection.tsx':['Home hero with side cards and a carousel driven by hero_sections sort order, picking per-locale text from database columns with a fallback translation map.',['component','hero','carousel','i18n'],'complex'],
'components/sections/NewsletterForm.tsx':['Newsletter sign-up form with email validation and localized status messages, posting to /api/newsletter/subscribe.',['component','form','newsletter','validation']],
'components/sections/Reels.tsx':['Video reels section loading /api/reels and embedding YouTube, TikTok or Facebook videos in a player, falling back to opening a new tab.',['component','video','embed','home-section'],'complex'],
'components/sections/SaleBanner.tsx':['Sale banner showing the currently running promotion (timed ones first) with a countdown, from server data or the storefront API.',['component','promotion','banner','countdown']],
'components/sections/SocialLinks.tsx':['Row of social media links built from the header configuration.',['component','social','presentational','config-driven'],'simple'],
'components/sections/TermsSection.tsx':['Simple titled section of paragraphs used on the terms page.',['component','presentational','legal','content'],'simple'],
'components/services/ServiceHighlightCard.tsx':['Small card showing one service highlight (icon, title, description).',['component','presentational','services','card'],'simple'],
'components/services/ServiceHighlights.tsx':['Service highlights section shown as a grid on desktop and an auto-advancing carousel on mobile.',['component','services','carousel','home-section'],'complex'],
'components/timers/CountdownTimer.tsx':['Countdown timer to an end date with days/hours/minutes/seconds display, used by the sale banner.',['component','timer','countdown','utility']],
'components/timers/PromoCountdownTimer.tsx':['Compact countdown timer variant for promotional product cards.',['component','timer','countdown','promotion']],
'components/ui/ErrorBoundary.tsx':['React class error boundary that catches render errors and shows a fallback UI.',['component','error-handling','react','ui']],
'components/ui/ImageLightbox.tsx':['Product photo that opens a portalled full-screen, keyboard- and swipe-navigable image gallery.',['component','gallery','lightbox','accessibility']],
'components/ui/LoadingSpinner.tsx':['Centered loading spinner for page-level loading states.',['component','ui','loading','presentational'],'simple'],
};
const FN={
'components/landing/ProductRing3D.tsx:canUse3D':'Checks reduced-motion preference, CPU cores and WebGL support to decide whether to render the 3D ring.',
'components/landing/ProductShowcase.tsx:StaticBackdrop':'Static full-bleed photo backdrop shown until the 3D ring loads or when 3D is disabled.',
'components/landing/ring-scene.ts:curvedCardGeometry':'Builds a curved plane geometry so each product card follows the ring radius.',
'components/landing/ring-scene.ts:createRingScene':'Creates the WebGL renderer, camera, textured card ring and ribbon with drag, auto-rotation and resize handling; returns a disposable scene handle.',
'components/layout/SearchBox.tsx:loadSuggestions':'Fetches ranked product matches from the storefront search API and maps them to localized suggestion items.',
'components/layout/StaticHeader.tsx:flattenCategoryTree':'Flattens featured top-level categories with their sub-categories depth-first for the menu.',
'components/products/ProductListCard.tsx:getProductImage':'Returns the main product image URL, sorted by position.',
'components/products/TopProducts.tsx:calculateReviewStats':'Computes average rating and review count for a product.',
'components/sections/FAQ.tsx:FAQItem':'Single collapsible FAQ question/answer row.',
'components/sections/HeroSection.tsx:getHeroText':'Picks the hero title/subtitle for the locale from database columns, falling back to a translation map.',
'components/sections/Reels.tsx:detectVideoPlatform':'Detects the video platform (YouTube, TikTok, Facebook) from a URL.',
'components/timers/CountdownTimer.tsx:CountdownDisplay':'Renders the day/hour/minute/second boxes of the countdown.',
'components/timers/CountdownTimer.tsx:calculateTimeLeft':'Computes remaining days, hours, minutes and seconds to the end date.',
'components/timers/PromoCountdownTimer.tsx:CountdownDisplay':'Renders the compact countdown segments.',
'components/timers/PromoCountdownTimer.tsx:calculateTimeLeft':'Computes remaining time to the promotion end.',
};
const nb={}; for(const arr of Object.values(B.neighborMap)) for(const n of arr) nb[n.path]=new Set(n.symbols);
const files={};
for(const f of R){
 const [s,tags,cx]=F[f.path]; const nodes=[],edges=[];
 const comp=cx||(f.nonEmptyLines<50?'simple':f.nonEmptyLines<=200?'moderate':'complex');
 const fid='file:'+f.path;
 nodes.push({id:fid,type:'file',name:f.path.split('/').pop(),filePath:f.path,summary:s,tags,complexity:comp});
 const exp=new Set((f.exports||[]).map(e=>e.name));
 const fnIds={};
 for(const fn of f.functions||[]){
  const len=fn.endLine-fn.startLine+1, isExp=exp.has(fn.name), key=f.path+':'+fn.name;
  if(!(len>=10||isExp)) continue;
  const id='function:'+key; fnIds[fn.name]=id;
  const sum=FN[key]||(isExp?`${fn.name} component. ${s}`:`Helper ${fn.name} in ${f.path.split('/').pop()}.`);
  nodes.push({id,type:'function',name:fn.name,filePath:f.path,lineRange:[fn.startLine,fn.endLine],summary:sum,tags:isExp?[...tags.slice(0,3),'exported']:['helper',...tags.slice(0,2)],complexity:len>150?'complex':len>40?'moderate':'simple'});
  edges.push({source:fid,target:id,type:'contains',direction:'forward',weight:1.0});
  if(isExp) edges.push({source:fid,target:id,type:'exports',direction:'forward',weight:0.8});
 }
 for(const c of f.classes||[]){
  const id=`class:${f.path}:${c.name}`;
  nodes.push({id,type:'class',name:c.name,filePath:f.path,lineRange:[c.startLine,c.endLine],summary:'React class component implementing getDerivedStateFromError and componentDidCatch to render a fallback when a child throws.',tags:['error-handling','react','class-component'],complexity:'simple'});
  edges.push({source:fid,target:id,type:'contains',direction:'forward',weight:1.0});
  edges.push({source:fid,target:id,type:'exports',direction:'forward',weight:0.8});
 }
 const imps=B.batchImportData[f.path]||[];
 for(const t of imps) edges.push({source:fid,target:'file:'+t,type:'imports',direction:'forward',weight:0.7});
 const seen=new Set();
 for(const c of f.callGraph||[]){
  const callee=c.callee.split('.')[0], src=fnIds[c.caller]; if(!src) continue;
  let tgt=null;
  if(fnIds[callee]&&fnIds[callee]!==src) tgt=fnIds[callee];
  else if(c.callee===callee) for(const p of imps) if(nb[p]&&nb[p].has(callee)){tgt=`function:${p}:${callee}`;break;}
  if(tgt&&!seen.has(src+tgt)){seen.add(src+tgt);edges.push({source:src,target:tgt,type:'calls',direction:'forward',weight:0.8});}
 }
 files[f.path]={nodes,edges};
}
for(const [p,fn] of [['components/sections/SaleBanner.tsx','SaleBanner'],['components/reviews/CustomerFeedback.tsx','CustomerFeedback'],['components/layout/SearchBox.tsx','loadSuggestions']]){
 const s=`function:${p}:${fn}`,t='function:lib/storefront-api.ts:storefront';
 if(nb['lib/storefront-api.ts']&&nb['lib/storefront-api.ts'].has('storefront')&&!files[p].edges.some(e=>e.source===s&&e.target===t)) files[p].edges.push({source:s,target:t,type:'calls',direction:'forward',weight:0.8});
}
files['components/landing/ProductRing3D.tsx'].edges.push({source:'function:components/landing/ProductRing3D.tsx:ProductRing3D',target:'function:components/landing/ring-scene.ts:createRingScene',type:'calls',direction:'forward',weight:0.8});
const paths=Object.keys(files).sort();
const allN=paths.flatMap(p=>files[p].nodes), allE=paths.flatMap(p=>files[p].edges);
const ids=new Set(allN.map(n=>n.id));
if(ids.size!==allN.length) throw new Error('dup ids');
const okFile=new Set([...paths,...Object.keys(nb),...Object.values(B.batchImportData).flat()]);
for(const e of allE){ if(e.source===e.target) throw new Error('self'); for(const x of [e.source,e.target]){ if(ids.has(x)) continue; let ok;
 if(x.startsWith('file:')) ok=okFile.has(x.slice(5)); else { const i=x.lastIndexOf(':'), p=x.slice(x.indexOf(':')+1,i), s=x.slice(i+1); ok=!!(nb[p]&&nb[p].has(s)); }
 if(!ok) throw new Error('bad edge '+JSON.stringify(e)); } }
const impSum=Object.values(B.batchImportData).reduce((a,b)=>a+b.length,0), impOut=allE.filter(e=>e.type==='imports').length;
if(impSum!==impOut) throw new Error('imports mismatch');
const parts=Math.max(1,Math.ceil(Math.max(allN.length/60,allE.length/120)));
const out=[];
if(parts===1){fs.writeFileSync('.ua/intermediate/batch-2.json',JSON.stringify({nodes:allN,edges:allE},null,1));out.push(['batch-2.json',allN.length,allE.length]);}
else{const sz=Math.ceil(paths.length/parts); for(let k=0;k<parts;k++){const ps=paths.slice(k*sz,(k+1)*sz), n=ps.flatMap(p=>files[p].nodes), e=ps.flatMap(p=>files[p].edges), nm=`batch-2-part-${k+1}.json`; fs.writeFileSync('.ua/intermediate/'+nm,JSON.stringify({nodes:n,edges:e},null,1)); out.push([nm,n.length,e.length]);}}
console.log(JSON.stringify(out),'total',allN.length,allE.length,'imports',impOut);
