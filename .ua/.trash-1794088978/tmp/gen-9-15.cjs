const fs=require('fs');
const OUT='../intermediate/';
const E=(s,t,type,w)=>({source:s,target:t,type,direction:'forward',weight:w});
const ex={},inp={};
for(const i of [9,10,11,12,13,14,15]){ex[i]=require('./ua-file-extract-results-'+i+'.json');inp[i]=require('./ua-file-analyzer-input-'+i+'.json');}
function lr(b,path,name){const f=ex[b].results.find(r=>r.path===path);const fn=(f.functions||[]).find(x=>x.name===name);return [fn.startLine,fn.endLine];}
function build(b,files,fns,extra){
  const nodes=[],edges=[];
  for(const [path,type,summary,tags,cx,notes] of files){
    const n={id:type+':'+path,type,name:path.split('/').pop(),filePath:path,summary,tags,complexity:cx};
    if(notes)n.languageNotes=notes;nodes.push(n);
    for(const t of (inp[b].batchImportData[path]||[]))edges.push(E('file:'+path,'file:'+t,'imports',0.7));
  }
  for(const [path,name,summary,tags,cx,exported] of fns){
    const id='function:'+path+':'+name;
    nodes.push({id,type:'function',name,filePath:path,lineRange:lr(b,path,name),summary,tags,complexity:cx});
    edges.push(E('file:'+path,id,'contains',1.0));
    if(exported)edges.push(E('file:'+path,id,'exports',0.8));
  }
  for(const e of extra||[])edges.push(E(...e));
  const ids=new Set(nodes.map(n=>n.id));if(ids.size!==nodes.length)throw new Error('dup '+b);
  for(const e of edges)if(e.source===e.target)throw new Error('self');
  let imp=0;for(const f of inp[b].batchFiles)imp+=(inp[b].batchImportData[f.path]||[]).length;
  if(edges.filter(e=>e.type==='imports').length!==imp)throw new Error('imports '+b);
  for(const f of inp[b].batchFiles)if(!nodes.some(n=>n.filePath===f.path))throw new Error('missing '+f.path);
  if(nodes.length>60||edges.length>120)throw new Error('split needed '+b);
  fs.writeFileSync(OUT+'batch-'+b+'.json',JSON.stringify({nodes,edges},null,1));
  console.log('batch-'+b,nodes.length,edges.length);
}
// ---- B9
const S='components/admin/stock/';
build(9,[
 ['app/admin/stock/movements/page.tsx','file','Admin stock movements page listing the append-only stock movement history with filters by type, location and date, plus CSV export.',['component','admin-page','stock','reporting'],'moderate'],
 ['app/admin/stock/page.tsx','file','Admin inventory page showing per-variant stock levels across locations with status filters, product variant drill-down and a movement modal for restocks, adjustments and transfers.',['component','admin-page','stock','inventory'],'complex'],
 ['app/admin/stock/restock/page.tsx','file','Admin restock page listing low-stock variants with a suggested reorder quantity and launching the movement modal to record restocks.',['component','admin-page','stock','restock'],'moderate'],
 [S+'MovementChart.tsx','file','Dependency-free SVG chart component plotting stock movement quantities over time by movement type for the admin stock screens.',['component','chart','stock','visualization'],'moderate'],
 [S+'MovementModal.tsx','file','Ant Design modal form for recording stock movements (restock, adjustment, transfer, count) for a variant and location through POST /api/stock/movements.',['component','form','stock','modal'],'complex'],
 [S+'ProductVariantsPanel.tsx','file','Panel showing the variants of a product with their per-location stock levels and tracking state in the admin inventory view.',['component','stock','inventory','admin'],'moderate'],
 [S+'StockOverview.tsx','file','Summary component showing stock KPIs and a movement chart for the admin dashboard and stock screens.',['component','dashboard','stock','kpi'],'moderate'],
 [S+'VariantThumb.tsx','file','Tiny component rendering a variant thumbnail image or placeholder.',['component','ui','stock'],'simple'],
 [S+'stock-client.ts','file','Client-side helpers for admin stock screens: status and movement color maps, variant label formatting, a JSON fetch wrapper with readable errors, and CSV download.',['utility','stock','api-client','admin'],'moderate'],
 ['lib/erp/db-messages.ts','file','Maps known Postgres exceptions raised by ERP database functions to user-facing messages and HTTP statuses, shared with the NestJS API error handling.',['utility','error-handling','erp','shared'],'moderate'],
 ['lib/stock.ts','file','Shared stock domain constants and helpers: movement types and labels, stock status computation, and translation of insufficient_stock database errors into readable messages.',['utility','stock','shared','validation'],'simple'],
],[
 ['app/admin/stock/movements/page.tsx','MovementsPage','Client page component that loads, filters and exports the stock movement history.',['component','admin-page','stock'],'moderate',true],
 ['app/admin/stock/page.tsx','InventoryPage','Main inventory page component handling level loading, filtering, permissions and movement modal state.',['component','admin-page','inventory'],'complex',true],
 ['app/admin/stock/restock/page.tsx','RestockPage','Restock page component listing variants below their reorder point with suggested quantities.',['component','admin-page','restock'],'moderate',true],
 [S+'MovementChart.tsx','MovementChart','Renders an SVG chart of movement quantities grouped by period and type.',['component','chart','visualization'],'moderate',true],
 [S+'MovementModal.tsx','MovementModal','Modal form that validates and submits a stock movement, including transfers and counts.',['component','form','modal'],'complex',true],
 [S+'ProductVariantsPanel.tsx','ProductVariantsPanel','Displays the variants of a product with stock per location, loading levels from the API.',['component','stock','inventory'],'moderate',true],
 [S+'StockOverview.tsx','StockOverview','Shows stock KPI tiles and the recent movement chart.',['component','dashboard','kpi'],'moderate',true],
 [S+'VariantThumb.tsx','VariantThumb','Renders a small variant image thumbnail.',['component','ui','image'],'simple',true],
 [S+'stock-client.ts','variantLabel','Formats a variant into a readable color/size label.',['utility','formatting','stock'],'simple',true],
 [S+'stock-client.ts','apiJson','Fetches an API endpoint and returns parsed JSON, throwing a readable error on failure.',['utility','api-client','fetch'],'simple',true],
 [S+'stock-client.ts','downloadCsv','Builds a CSV from rows and triggers a browser download.',['utility','export','csv'],'simple',true],
 ['lib/erp/db-messages.ts','knownDbError','Converts a known database exception into a message, HTTP status and code, or returns null if unknown.',['error-handling','utility','erp'],'moderate',true],
 ['lib/stock.ts','stockStatus','Computes in-stock, low-stock or out-of-stock status from quantity and reorder point.',['utility','stock','status'],'simple',true],
 ['lib/stock.ts','stockErrorMessage','Turns insufficient_stock and related database errors into readable stock messages.',['error-handling','stock','formatting'],'simple',true],
],[
 ['function:lib/erp/db-messages.ts:knownDbError','function:lib/stock.ts:stockErrorMessage','calls',0.8],
 ['function:app/admin/stock/movements/page.tsx:MovementsPage','function:'+S+'stock-client.ts:downloadCsv','calls',0.8],
 ['function:app/admin/stock/page.tsx:InventoryPage','function:'+S+'stock-client.ts:downloadCsv','calls',0.8],
 ['function:app/admin/stock/restock/page.tsx:RestockPage','function:'+S+'stock-client.ts:downloadCsv','calls',0.8],
 ['function:'+S+'ProductVariantsPanel.tsx:ProductVariantsPanel','function:'+S+'stock-client.ts:apiJson','calls',0.8],
]);
// ---- B10
const T='api/test/e2e/';
const suites=['auth','catalog','categories','colissimo','erp','files','objectives','stock','tickets'];
const suite=(f,s,tags,cx)=>[T+f+'.e2e.mjs','file',s,['test','e2e',...tags],cx];
build(10,[
 suite('auth','End-to-end suite for /api/auth: sign-up, confirmation, sign-in cookies, refresh, password change/reset and session revocation against the local Docker stack.',['auth','sessions'],'moderate'),
 suite('catalog','End-to-end suite exercising catalog product creation, update, storefront reads and soft deletion through the API.',['catalog','products'],'moderate'),
 suite('categories','End-to-end suite checking category CRUD and that anonymous users are denied write access.',['categories','access-control'],'simple'),
 suite('colissimo','End-to-end suite for Colissimo delivery: validating orders into parcels, tracking status changes and returns against the Colissimo mock service.',['delivery','colissimo'],'moderate'),
 suite('erp','End-to-end suite covering ERP flows: manual orders, order pipeline statuses, payments, customers, till sessions, purchasing and accounting.',['erp','orders'],'complex'),
 suite('files','End-to-end suite for image upload and private document storage through the S3-compatible file store.',['files','storage'],'moderate'),
 [T+'helpers.mjs','file','Shared e2e test helpers: API base URL, direct SQL access to the local database, assertion and summary helpers, and creation of signed-in test users with roles.',['test','e2e','utility','fixtures'],'simple'],
 suite('objectives','End-to-end suite verifying monthly business and agent goals, progress measurement and commission tiers in Tunis time.',['objectives','commissions'],'moderate'),
 suite('stock','End-to-end suite for stock movements: restocks, sales, transfers and the negative stock guard.',['stock','inventory'],'moderate'),
 suite('tickets','End-to-end suite for the team tickets board: creation, assignment, moves, comments with images, notifications and My day listing.',['tickets','team'],'moderate'),
],[
 [T+'auth.e2e.mjs','call','Performs an API request with a cookie jar, capturing Set-Cookie headers for session tests.',['test','http','helper'],'simple',false],
 [T+'helpers.mjs','user','Creates a test user with a role and permissions and signs it in, returning its session cookie.',['test','fixtures','auth'],'simple',true],
 [T+'helpers.mjs','sql','Runs a SQL statement against the local test database.',['test','database','helper'],'simple',true],
 [T+'helpers.mjs','ok','Records and prints a passing or failing assertion.',['test','assertion','helper'],'simple',true],
 [T+'helpers.mjs','done','Prints the suite summary and exits with a failure code if any check failed.',['test','reporting','helper'],'simple',true],
],suites.map(f=>['file:'+T+f+'.e2e.mjs','function:'+T+'helpers.mjs:ok','calls',0.8]));
// ---- B11
build(11,[
 ['app/admin/layout.tsx','file','Client-rendered admin shell: grouped, permission-filtered sidebar menu, header with notification bell and language switch, Ant Design theme/locale/RTL configuration, role context and fetch cache installation.',['component','layout','admin','navigation','access-control'],'complex','Ant Design ConfigProvider switches locale and direction per admin language, with dayjs following along.'],
 ['app/admin/login/page.tsx','file','Back-office sign-in page that authenticates through the customer auth API, checks the back-office role and redirects to a safe next path.',['component','auth','admin-page','login'],'moderate'],
 ['components/admin/AdminLanguageSwitcher.tsx','file','Selector that switches the admin UI language between English, French and Arabic.',['component','i18n','admin'],'simple'],
 ['components/admin/admin-fetch-cache.ts','file','Patches window.fetch in the admin to cache small lookup lists (categories, colors, sizes, suppliers, locations) for 5 minutes and clear entries on writes.',['utility','cache','performance','admin'],'moderate'],
 ['components/admin/mobile-table-labels.ts','file','Hook that labels Ant Design table cells with their column titles so tables render as cards on mobile.',['hook','responsive','admin','utility'],'simple'],
 ['lib/antd-config.ts','file','Ant Design theme token configuration for the admin dashboard.',['config','theme','admin'],'simple'],
],[
 ['app/admin/layout.tsx','AdminLayout','Root admin layout component that wraps pages with language and configuration providers.',['component','layout','admin'],'simple',true],
 ['app/admin/layout.tsx','AdminConfig','Configures Ant Design locale, direction and theme for the current admin language.',['component','config','i18n'],'moderate',false],
 ['app/admin/layout.tsx','AdminShell','Renders the sidebar, header and content area, loading the role and filtering menu entries.',['component','layout','navigation'],'complex',false],
 ['app/admin/layout.tsx','menuFor','Filters the grouped menu by role and permissions and drops empty groups.',['access-control','navigation','utility'],'simple',false],
 ['app/admin/layout.tsx','withLinks','Wraps menu item labels in Next.js links recursively.',['navigation','utility','menu'],'simple',false],
 ['app/admin/login/page.tsx','AdminLoginForm','Sign-in form that submits credentials, checks the back-office role and redirects.',['component','form','auth'],'moderate',false],
 ['app/admin/login/page.tsx','AdminLoginPage','Login page wrapper rendering the form inside Suspense.',['component','auth','page'],'simple',true],
 ['components/admin/AdminLanguageSwitcher.tsx','AdminLanguageSwitcher','Renders the admin language selector.',['component','i18n','ui'],'simple',true],
 ['components/admin/admin-fetch-cache.ts','installAdminFetchCache','Installs the caching fetch wrapper for admin lookup endpoints.',['cache','utility','fetch'],'moderate',true],
 ['components/admin/mobile-table-labels.ts','labelTables','Sets data-label attributes on table cells from header titles.',['utility','responsive','dom'],'simple',false],
 ['components/admin/mobile-table-labels.ts','useMobileTableLabels','Hook that observes DOM changes and keeps table cell labels current.',['hook','responsive','dom'],'simple',true],
],[
 ['function:app/admin/layout.tsx:AdminShell','function:app/admin/layout.tsx:menuFor','calls',0.8],
 ['function:components/admin/mobile-table-labels.ts:useMobileTableLabels','function:components/admin/mobile-table-labels.ts:labelTables','calls',0.8],
]);
// ---- B12
build(12,[
 ['instrumentation-client.ts','file','Browser Sentry initialization using shared options, exporting the router transition hook for navigation tracing.',['config','monitoring','sentry','entry-point'],'simple'],
 ['lib/app-env.ts','file','Exposes the deployment environment (APP_ENV, isProduction, isLocal) from NEXT_PUBLIC_APP_ENV instead of NODE_ENV.',['config','environment','utility'],'simple'],
 ['lib/sentry-options.ts','file','Shared Sentry options for browser, server and edge: environment tag, sample rates and a PII scrubber that strips customer data from events.',['config','monitoring','security','sentry'],'moderate'],
 ['sentry.edge.config.ts','file','Sentry initialization for edge runtime code such as middleware.',['config','monitoring','sentry'],'simple'],
 ['sentry.server.config.ts','file','Sentry initialization for the Node.js server runtime using the backend options.',['config','monitoring','sentry'],'simple'],
],[
 ['lib/sentry-options.ts','scrubEvent','Removes cookies, request data, user details and other PII from Sentry events before sending.',['security','privacy','monitoring'],'simple',false],
 ['lib/sentry-options.ts','createSentryOptions','Builds Sentry options enabled only in production with a DSN, with environment-based sample rates and the scrubber.',['factory','monitoring','config'],'simple',true],
],[
 ['function:lib/sentry-options.ts:createSentryOptions','function:lib/sentry-options.ts:scrubEvent','calls',0.8],
]);
// ---- B13
build(13,[
 ['.dockerignore','config','Excludes node_modules, build output, git data, env files, the API and migrations from the web image build context.',['configuration','containerization','build-system'],'simple'],
 ['Dockerfile','service','Single-stage Node 22 image that installs dependencies, builds the Next.js site with env passed as a build secret, and runs next start on port 3000 as a non-root user.',['containerization','infrastructure','nextjs','deployment'],'simple','Uses BuildKit --mount=type=secret so .env values never land in an image layer.'],
 ['docker-compose.yml','service','Local stack: web site, NestJS API, Postgres 17, SeaweedFS S3 storage with bucket bootstrap, a socat gateway and the Colissimo mock service.',['orchestration','infrastructure','local-development','docker'],'moderate'],
],[],[
 ['config:.dockerignore','service:Dockerfile','configures',0.6],
 ['service:docker-compose.yml','service:Dockerfile','depends_on',0.6],
 ['service:docker-compose.yml','service:api/Dockerfile','depends_on',0.6],
]);
// ---- B14
build(14,[
 ['api/Dockerfile','service','Multi-stage Alpine build of the NestJS API: compiles with the shared lib files, then a production image with runtime deps, migration scripts, migrations and the baseline schema, serving on port 4000.',['containerization','infrastructure','nestjs','deployment'],'simple','Multi-stage build keeps dev dependencies and sources out of the runtime image.'],
],[],[]);
// ---- B15
build(15,[
 ['.github/workflows/ci.yml','pipeline','CI workflow on PRs (also reusable): type-check and lint the site, lint and build the API, then run the end-to-end suites against the Docker stack with migrations applied.',['ci-cd','testing','github-actions','quality'],'moderate'],
 ['.github/workflows/deploy.yml','pipeline','Deploy workflow on push to main: runs CI, detects API changes, builds and pushes the API image to GHCR, then deploys over SSH with no downtime and checks health.',['ci-cd','deployment','github-actions','docker'],'moderate'],
],[],[
 ['pipeline:.github/workflows/deploy.yml','pipeline:.github/workflows/ci.yml','triggers',0.6],
 ['pipeline:.github/workflows/deploy.yml','service:api/Dockerfile','depends_on',0.6],
 ['pipeline:.github/workflows/ci.yml','service:docker-compose.yml','depends_on',0.6],
 ...suites.map(f=>['pipeline:.github/workflows/ci.yml','file:api/test/e2e/'+f+'.e2e.mjs','triggers',0.6]),
]);
