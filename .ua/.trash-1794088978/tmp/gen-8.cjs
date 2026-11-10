const fs=require('fs');const path=require('path');
const D=__dirname;
const r=require(path.join(D,'ua-file-extract-results-8.json'));const inp=require(path.join(D,'ua-file-analyzer-input-8.json'));
const imp=inp.batchImportData;
const F={
'components/admin/antd-app.tsx':["Bridges antd's App context so admin code can call a themed message API outside React components; exports AntdAppBridge and the message proxy used instead of antd's static API.",["utility","component","admin","antd","singleton"]],
'components/admin/delivery/DeliveryStatusTag.tsx':["Renders Colissimo parcel status tags and badges (paid, price change, etc.) for delivery rows in the admin.",["component","delivery","colissimo","admin","ui"]],
'components/admin/delivery/EditParcelModal.tsx':["Modal form for editing a Colissimo parcel's recipient, governorate, address and price through the delivery API, handling price-change requests for printed parcels.",["component","delivery","form","modal","colissimo"]],
'components/admin/delivery/OrderDeliveryCard.tsx':["Order-page card showing the order's Colissimo parcel, its status, and actions to send, edit, refresh or remove the parcel.",["component","delivery","order","admin","colissimo"]],
'components/admin/delivery/ParcelHistoryDrawer.tsx':["Drawer that loads and shows a parcel's tracking history from GET /api/delivery/history, with color mapping for portal statuses.",["component","delivery","tracking","drawer","colissimo"]],
'components/admin/delivery/ParcelLookup.tsx':["Check-a-parcel tool that looks up any Colissimo barcode without saving and can add a parcel created on Colissimo's site to the deliveries list.",["component","delivery","lookup","colissimo","admin"]],
'components/admin/delivery/ParcelProducts.tsx':["Editable product-line picker (product, variant, quantity, price) used by the New parcel and Edit order forms, with server quote previews.",["component","form","order-lines","delivery","admin"]],
'components/admin/delivery/SendParcelModal.tsx':["Modal for creating or sending a Colissimo parcel, prefilling fields from the order and optionally listing products priced by a server quote.",["component","delivery","modal","form","colissimo"]],
'components/admin/delivery/delivery-api.ts':["Typed client and shared types for the /api/delivery endpoints, plus rules for when a parcel can be edited or removed and a helper reporting Colissimo cancellation failures.",["service","api-client","delivery","type-definition","colissimo"]],
'components/admin/desktop-push.ts':["Browser-side Web Push helpers that register the admin service worker, subscribe with the VAPID public key, and save or remove push subscriptions.",["utility","push-notifications","service-worker","admin","browser"]],
'components/admin/erp/EditOrderModal.tsx':["Modal to edit an order still to confirm or confirmed (customer, amounts, notes and optionally its lines) via PATCH /api/sales/orders action edit.",["component","modal","order","form","erp"]],
'components/admin/erp/MonthGoalCard.tsx':["Card showing the business's monthly goal progress and pace with target bars, used on My day and the Business overview.",["component","erp","objectives","dashboard","admin"]],
'components/admin/erp/OrderPaymentsCard.tsx':["Order-page card listing order payments and refunds by account (cash, bank, carrier) and recording new ones.",["component","erp","payments","order","finance"]],
'components/admin/erp/OrderPipelineCard.tsx':["Order-page card for the sales pipeline: channel, assigned agent, campaign and confirmation actions.",["component","erp","order","pipeline","admin"]],
'components/admin/erp/QuickLinks.tsx':["Permission-aware grid of quick links to admin areas shown on the dashboard.",["component","navigation","dashboard","admin","permissions"]],
'components/admin/erp/charts.tsx':["Dependency-free SVG chart components (BarChart, BarList, TargetBar) for ERP admin screens.",["component","charts","svg","erp","data-visualization"]],
'components/admin/erp/erp-client.ts':["Shared ERP admin client: fetch wrapper with ApiError, a useApi data hook, and money/number/date/period formatting and download helpers.",["utility","api-client","hook","formatting","erp"]],
'components/admin/erp/purchase-items.ts':["React hook loading the purchasable items (variants and raw materials) used by purchase order lines.",["hook","purchasing","erp","data-loading","admin"]],
'components/admin/erp/ui.tsx':["Shared ERP admin UI kit: PageHeader, Kpi, ChannelTag, PeriodFilter, AgentSelect, CampaignSelect, ListRow, Help and the usePeriod/useTeam hooks.",["component","ui-kit","hook","erp","admin"]],
'components/admin/notification-item.tsx':["Renders one back-office notification with localized title/body and an icon by type, used by the bell and notifications page.",["component","notifications","i18n","admin","ui"]],
'components/admin/order-status.ts':["Order and payment status labels, colors and options for the admin, plus validateOrder which creates the Colissimo parcel and moves the order to processing.",["utility","order","status","constants","delivery"]],
'components/admin/pos/PosAnalyticsTab.tsx':["Point of sale Analytics tab showing shop sales KPIs and charts from GET /api/pos/analytics.",["component","pos","analytics","erp","admin"]],
'components/admin/pos/PosStockTab.tsx':["Point of sale Stock tab listing a shop's carried variants with low and out-of-stock flags based on the location's limit.",["component","pos","stock","inventory","admin"]],
'components/admin/select-search.ts':["Tiny antd Select filterOption helper matching options by their searchtext attribute.",["utility","antd","search","admin","select"]],
'lib/admin-i18n.tsx':["Admin EN/FR/AR translation context: AdminI18nProvider, useAdminT with placeholder interpolation, msg marker, and locale/date-locale constants.",["i18n","context-provider","hook","admin","rtl"]],
'lib/admin-role-context.tsx':["React context providing the signed-in back-office user's role and permissions from GET /api/admin/me, with a can(permission) helper.",["context-provider","hook","permissions","auth","admin"]],
'lib/colissimo-data.ts':["Shared Colissimo data: Tunisian governorates and matching, parcel status catalog and final statuses, customer-facing stage mapping, and parcelFromOrder to build parcel fields from an order.",["data-model","delivery","colissimo","constants","shared"]],
'lib/erp/constants.ts':["Shared ERP constants and translatable labels/colors: channels, customer stages, payment methods, money accounts, bill and treasury categories, PO statuses, journals, account types, documents and ticket statuses.",["constants","erp","type-definition","shared","i18n"]]};
const S={
AntdAppBridge:"Captures antd App context's message instance so the module-level message proxy is themed.",
ParcelBadges:"Shows extra parcel badges such as paid or pending price change.",
DeliveryStatusTag:"Colored tag for a parcel's Colissimo status label.",
EditParcelModal:"Edit form modal for a parcel, submitting edits or price-change requests.",
OrderDeliveryCard:"Delivery card on the order page with send, edit, refresh and remove parcel actions.",
portalStatusColor:"Maps Colissimo portal status text to a tag color.",
ParcelHistoryDrawer:"Drawer fetching and listing a parcel's tracking events.",
ParcelLookup:"Barcode lookup UI that tracks a parcel and can add it to deliveries.",
lineIsComplete:"Checks whether a product line has the product, variant and quantity it needs.",
ParcelProducts:"Editable list of product lines with variant selection and quote preview.",
initialValues:"Builds the send-parcel form's initial values from the order's parcel fields.",
SendParcelModal:"Modal to send an order's parcel or create a manual parcel with products.",
canEditParcel:"Whether a parcel's status still allows editing at Colissimo.",
canRemoveParcel:"Whether a parcel can still be removed.",
deliveryApi:"Calls /api/delivery with a given action and payload, throwing on errors.",
reportParcelCancellation:"Warns when Colissimo refused to delete a cancelled order's parcel.",
desktopSupported:"Detects Push API and service worker support.",
getDesktopState:"Returns whether desktop push is unsupported, denied, enabled or off.",
enableDesktop:"Requests permission, subscribes with the VAPID key and saves the subscription.",
disableDesktop:"Unsubscribes and removes the saved push subscription.",
refreshDesktop:"Re-saves an existing subscription so the server keeps it current.",
EditOrderModal:"Modal form editing an order's customer, amounts, notes and lines.",
MonthGoalCard:"Monthly business goal progress card with pace.",
OrderPaymentsCard:"Lists and records order payments and refunds.",
OrderPipelineCard:"Edits an order's channel, agent and campaign and confirms it.",
QuickLinks:"Renders quick links filtered by the user's permissions.",
BarChart:"SVG vertical bar chart with a rounded axis maximum.",
BarList:"Horizontal bar list ranking labeled values.",
TargetBar:"Progress bar against a target value.",
ApiError:"Error carrying the HTTP status and API error code.",
api:"JSON fetch wrapper for /api that throws ApiError on failure.",
useApi:"Data-loading hook with loading, error and reload state.",
formatMoney:"Formats amounts with 3 decimals.",
formatNumber:"Locale number formatting.",
formatDate:"Formats a date for display.",
percent:"Formats a ratio as a percentage.",
periodRange:"Computes from/to dates for a named period.",
day:"Returns a YYYY-MM-DD day string.",
download:"Downloads an API response as a file.",
usePurchaseItems:"Loads variants and raw materials as purchase line options.",
PageHeader:"Page title header with actions.",
Kpi:"KPI stat tile.",
ChannelTag:"Colored tag for a sales channel.",
PeriodFilter:"Period selector with custom date range.",
usePeriod:"State hook for a selected period range.",
useTeam:"Loads the back-office team for agent pickers.",
AgentSelect:"Select of team agents.",
CampaignSelect:"Select of marketing campaigns.",
ListRow:"Labeled value row for detail lists.",
Help:"Inline help tooltip icon.",
notificationText:"Picks a notification's title/body in the admin language.",
NotificationItem:"Renders a notification row with icon, text and time.",
orderStatusLabel:"Returns the display label for an order status.",
validateOrder:"Posts the validate action to /api/delivery for an order.",
errorCode:"Extracts an API error code from an error.",
PosAnalyticsTab:"POS analytics tab with KPIs and charts.",
isLowStock:"Whether a level is at or below the low-stock limit.",
isOutOfStock:"Whether a level is zero or less.",
PosStockTab:"POS shop stock list with filters.",
searchByText:"antd filterOption matching an option's searchtext.",
msg:"Marks a string for translation where it is displayed.",
AdminI18nProvider:"Provides the admin language, remembered per browser, and the translation function.",
useAdminT:"Hook returning the admin translator and language.",
AdminRoleProvider:"Loads /api/admin/me and provides role and permissions.",
useAdminRole:"Hook returning role, permissions and can().",
governorateOptions:"Select options for Tunisian governorates in Colissimo spelling.",
governorateLabel:"Localized label for a governorate.",
matchGovernorate:"Matches free-text input to a Colissimo governorate name.",
isFinalParcel:"Whether a parcel status is final.",
customerStage:"Maps a parcel status to the shopper-facing stage.",
statusInfo:"Looks up a Colissimo status's label and color.",
parcelFromOrder:"Builds Colissimo parcel fields from an order, flagging missing details."};
const nodes=[],edges=[];
const E=(s,t,type,w)=>edges.push({source:s,target:t,type,direction:'forward',weight:w});
for(const f of r.results){const p=f.path,fid='file:'+p,[sum,tags]=F[p];
const nl=f.nonEmptyLines;nodes.push({id:fid,type:'file',name:p.split('/').pop(),filePath:p,summary:sum,tags,complexity:nl<50?'simple':nl<=200?'moderate':'complex'});
const ex=new Set((f.exports||[]).map(e=>e.name));
const items=[...(f.functions||[]).map(x=>['function',x]),...(f.classes||[]).map(x=>['class',x])];
for(const[k,x]of items){const len=x.endLine-x.startLine+1;if(!(ex.has(x.name)||len>=10))continue;
const id=k+':'+p+':'+x.name;if(nodes.some(n=>n.id===id))continue;
const area=/colissimo|delivery/.test(p)?'delivery':(p.includes('erp')||p.includes('pos')?'erp':'frontend');
const kind=k==='class'?'error-handling':(/^use[A-Z]/.test(x.name)?'hook':(/^[A-Z]/.test(x.name)?'component':'utility'));
nodes.push({id,type:k,name:x.name,filePath:p,lineRange:[x.startLine,x.endLine],summary:S[x.name],tags:[kind,'admin',area],complexity:len>100?'complex':len>30?'moderate':'simple'});
E(fid,id,'contains',1.0);if(ex.has(x.name))E(fid,id,'exports',0.8);}
for(const t of imp[p]||[])E(fid,'file:'+t,'imports',0.7);}
E('function:components/admin/order-status.ts:validateOrder','function:components/admin/delivery/delivery-api.ts:deliveryApi','calls',0.8);
E('function:components/admin/delivery/SendParcelModal.tsx:SendParcelModal','function:components/admin/delivery/ParcelProducts.tsx:ParcelProducts','calls',0.8);
E('function:components/admin/erp/EditOrderModal.tsx:EditOrderModal','function:components/admin/delivery/ParcelProducts.tsx:ParcelProducts','calls',0.8);
E('function:components/admin/delivery/OrderDeliveryCard.tsx:OrderDeliveryCard','function:components/admin/delivery/SendParcelModal.tsx:SendParcelModal','calls',0.8);
E('function:components/admin/delivery/OrderDeliveryCard.tsx:OrderDeliveryCard','function:components/admin/delivery/EditParcelModal.tsx:EditParcelModal','calls',0.8);
E('function:components/admin/erp/MonthGoalCard.tsx:MonthGoalCard','function:components/admin/erp/charts.tsx:TargetBar','calls',0.8);
const ids=new Set(nodes.map(n=>n.id));
const bad=edges.filter(e=>!(ids.has(e.source))||!(ids.has(e.target)||e.target.startsWith('file:')));
const missing=nodes.filter(n=>!n.summary).map(n=>n.id);
const want=Object.values(imp).reduce((a,v)=>a+v.length,0),got=edges.filter(e=>e.type==='imports').length;
console.log('nodes',nodes.length,'edges',edges.length,'imports',got,'/',want,'bad',bad.length,'nosummary',missing);
if(nodes.length<=60&&edges.length<=120){fs.writeFileSync(path.join(D,'..','intermediate','batch-8.json'),JSON.stringify({nodes,edges},null,1));console.log('single');}
else{const parts=Math.ceil(Math.max(nodes.length/60,edges.length/120));const files=r.results.map(f=>f.path).sort();const sz=Math.ceil(files.length/parts);
for(let k=0;k<parts;k++){const fs2=new Set(files.slice(k*sz,(k+1)*sz));const pn=nodes.filter(n=>fs2.has(n.filePath));const pid=new Set(pn.map(n=>n.id));const pe=edges.filter(e=>pid.has(e.source));
fs.writeFileSync(path.join(D,'..','intermediate',`batch-8-part-${k+1}.json`),JSON.stringify({nodes:pn,edges:pe},null,1));console.log('part',k+1,pn.length,pe.length);}}
