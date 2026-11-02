/**
 * OpenAPI entries for the ERP routes (sales pipeline, customers, till, purchasing, finance,
 * owner overview), merged into lib/openapi.ts. Every route answers { success, data } or
 * { success: false, error, code? }; middleware.ts gates each one by permission.
 */

type Op = Record<string, unknown>;

const json = (description: string) => ({
    description,
    content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: {}, error: { type: 'string', nullable: true }, code: { type: 'string', nullable: true } } } } },
});

const q = (name: string, description: string, type = 'string', format?: string) => ({ name, in: 'query', description, schema: { type, ...(format ? { format } : {}) } });

const body = (properties: Record<string, unknown>, required: string[] = []) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object', required, properties } } },
});

const op = (tag: string, summary: string, extra: Op = {}): Op => ({
    tags: [tag],
    summary,
    responses: { 200: json('OK'), 400: json('Invalid data'), 403: json('Not allowed'), 409: json('Refused (see error and code)') },
    ...extra,
});

const uuid = { type: 'string', format: 'uuid' };
const money = { type: 'number' };
const date = { type: 'string', format: 'date' };

export const erpTags = [
    { name: 'Sales', description: 'Manual orders, assignment, confirmation, duplicates, payments and carrier payouts (orders / finance)' },
    { name: 'Customers', description: 'CRM: customer records, conversations, follow-ups (customers permission)' },
    { name: 'Point of sale', description: 'Till sessions and sales (pos permission)' },
    { name: 'Purchasing', description: 'Purchase orders, receipts, raw materials, cost prices (purchasing permission)' },
    { name: 'Finance', description: 'Bills, cash and bank, invoices, accounting, reports, bank reconciliation, documents (finance permission)' },
    { name: 'Owner', description: 'Business overview (owners only) and objectives (owners and admins)' },
];

export const erpPaths: Record<string, Record<string, Op>> = {
    '/api/sales/orders': {
        get: op('Sales', 'Customer and orders in progress for a phone (duplicate check)', { parameters: [q('phone', 'Phone number', 'string'), q('exclude', 'Order id to leave out', 'string', 'uuid')] }),
        post: op('Sales', 'Create an order taken by an agent (priced from the catalog)', {
            requestBody: body({
                customer: { type: 'object', properties: { phone: { type: 'string' }, first_name: { type: 'string' }, last_name: { type: 'string' }, email: { type: 'string' }, governorate: { type: 'string' }, city: { type: 'string' }, address: { type: 'string' } } },
                items: { type: 'array', items: { type: 'object', properties: { product_id: uuid, variant_id: uuid, quantity: { type: 'integer' } } } },
                channel: { type: 'string', enum: ['facebook', 'instagram', 'tiktok', 'whatsapp', 'phone', 'other'] },
                campaign_id: uuid, shipping_cost: money, discount_amount: money, notes: { type: 'string' }, assigned_to: uuid, confirmed: { type: 'boolean' },
            }, ['customer', 'items', 'channel']),
        }),
        patch: op('Sales', 'assign (ids, user_id) | confirm (ids) | source (id, channel, campaign_id)', { requestBody: body({ action: { type: 'string', enum: ['assign', 'confirm', 'source'] } }, ['action']) }),
    },
    '/api/sales/payments': {
        get: op('Sales', 'Payments of an order (?order_id=) or the list (?account=&method=&from=&to=&open_carrier=1)'),
        post: op('Sales', 'Record money received for an order (negative amount: refund)', { requestBody: body({ order_id: uuid, amount: money, method: { type: 'string', enum: ['cash', 'card', 'bank_transfer', 'check', 'cod', 'mobile', 'other'] }, account: { type: 'string', enum: ['cash', 'bank', 'carrier'] }, received_at: { type: 'string', format: 'date-time' }, reference: { type: 'string' } }, ['order_id', 'amount', 'method']) }),
        delete: op('Sales', 'Remove a payment entered by mistake', { parameters: [q('id', 'Payment id', 'string', 'uuid')] }),
    },
    '/api/sales/remittances': {
        get: op('Sales', 'Carrier payouts and the payments the carrier still holds'),
        post: op('Sales', 'Record a carrier payout for some payments', { requestBody: body({ payment_ids: { type: 'array', items: uuid }, gross_amount: money, fees: money, received_on: date, account: { type: 'string', enum: ['bank', 'cash'] }, reference: { type: 'string' } }, ['payment_ids']) }),
        delete: op('Sales', 'Cancel a payout (its payments are owed again)', { parameters: [q('id', 'Payout id', 'string', 'uuid')] }),
    },
    '/api/customers': {
        get: op('Customers', 'Customer (?id=), duplicates (?duplicates=1) or list (?q=&stage=&channel=&assigned=me|none|<id>&page=&size=)'),
        post: op('Customers', 'Create a customer'),
        put: op('Customers', 'Update a customer'),
        patch: op('Customers', 'merge (keep_id, remove_id) | anonymize (id) | assign (ids, user_id)'),
        delete: op('Customers', 'Soft-delete a customer record', { parameters: [q('id', 'Customer id', 'string', 'uuid')] }),
    },
    '/api/crm/interactions': {
        get: op('Customers', "A customer's conversation (?customer_id=) or the inbox (?inbox=1&unread=1)"),
        post: op('Customers', 'Log a message, call or note; send: true replies on Messenger/Instagram/WhatsApp', { requestBody: body({ customer_id: uuid, channel: { type: 'string' }, direction: { type: 'string', enum: ['in', 'out', 'note'] }, body: { type: 'string' }, send: { type: 'boolean' } }, ['customer_id', 'channel', 'direction', 'body']) }),
        put: op('Customers', "Mark a customer's messages read", { requestBody: body({ customer_id: uuid }, ['customer_id']) }),
        delete: op('Customers', 'Remove a note', { parameters: [q('id', 'Note id', 'string', 'uuid')] }),
    },
    '/api/crm/tasks': {
        get: op('Customers', 'Follow-ups (?customer_id= | ?mine=1 | ?status=open|done|overdue)'),
        post: op('Customers', 'Create a follow-up', { requestBody: body({ title: { type: 'string' }, due_at: { type: 'string', format: 'date-time' }, customer_id: uuid, order_id: uuid, assigned_to: uuid, notes: { type: 'string' } }, ['title', 'due_at']) }),
        put: op('Customers', 'Update or tick a follow-up'),
        delete: op('Customers', 'Remove a follow-up', { parameters: [q('id', 'Task id', 'string', 'uuid')] }),
    },
    '/api/webhooks/meta': {
        get: op('Customers', "Meta webhook subscription check (hub.mode, hub.verify_token, hub.challenge). Public."),
        post: op('Customers', 'Messenger / Instagram / WhatsApp messages (signed with X-Hub-Signature-256). Public.'),
    },
    '/api/pos': {
        get: op('Point of sale', 'Open sessions and shops; ?catalog=1&location_id= products; ?session_id= a session; ?sessions=1 history; ?receipt=<order id>'),
        post: op('Point of sale', 'open (location_id, opening_float) | sale (session_id, items, discount_amount, customer, payments) | cash (session_id, direction, amount, label) | close (session_id, counted_cash)', { requestBody: body({ action: { type: 'string', enum: ['open', 'sale', 'cash', 'close'] } }, ['action']) }),
    },
    '/api/purchasing/orders': {
        get: op('Purchasing', 'Purchase order (?id=) or list (?status=&supplier_id=)'),
        post: op('Purchasing', 'Create or update a purchase order and its lines', { requestBody: body({ id: uuid, supplier_id: uuid, status: { type: 'string', enum: ['draft', 'rfq', 'ordered'] }, order_date: date, expected_date: date, location_id: uuid, lines: { type: 'array', items: { type: 'object', properties: { variant_id: uuid, material_id: uuid, description: { type: 'string' }, quantity: money, unit_cost: money, vat_rate: money } } } }, ['supplier_id', 'lines']) }),
        patch: op('Purchasing', 'Change status (rfq, ordered, received, cancelled, draft)'),
        delete: op('Purchasing', 'Delete a draft or price request', { parameters: [q('id', 'Purchase order id', 'string', 'uuid')] }),
    },
    '/api/purchasing/receipts': {
        get: op('Purchasing', 'Goods receipts (?purchase_order_id=&status=)'),
        post: op('Purchasing', 'Receive goods (accepted/rejected per line); validate: true adds accepted units to stock'),
        put: op('Purchasing', 'validate or cancel a pending receipt'),
    },
    '/api/purchasing/materials': {
        get: op('Purchasing', 'Raw materials (?id= with movements and purchases)'),
        post: op('Purchasing', 'Create a raw material'),
        put: op('Purchasing', 'Update a raw material'),
        patch: op('Purchasing', 'Stock movement: purchase (with unit_cost), consumption, adjustment, return'),
        delete: op('Purchasing', 'Soft-delete a raw material', { parameters: [q('id', 'Material id', 'string', 'uuid')] }),
    },
    '/api/purchasing/costing': {
        get: op('Purchasing', 'Cost price of every product; ?product_id= its bill of materials'),
        put: op('Purchasing', 'Save a product\'s bill of materials, labor and overhead'),
        post: op('Purchasing', 'Record a production run (variant_id, quantity, location_id)'),
    },
    '/api/purchasing/prices': {
        get: op('Purchasing', 'Prices per item and supplier (?variant_id=&material_id=)'),
    },
    '/api/finance/bills': {
        get: op('Finance', 'Bill (?id=) or list (?status=open|overdue|unpaid|partial|paid&category=&supplier_id=&from=&to=)'),
        post: op('Finance', 'Record a bill or expense (paid_now: pay it at once)'),
        put: op('Finance', 'Update a bill (rebooks its entry)'),
        patch: op('Finance', 'pay (bill_id, amount, paid_on, account, method) | unpay (payment_id)'),
        delete: op('Finance', 'Cancel an unpaid bill', { parameters: [q('id', 'Bill id', 'string', 'uuid')] }),
    },
    '/api/finance/treasury': {
        get: op('Finance', 'Balances and money movements (?account=cash|bank&from=&to=)'),
        post: op('Finance', 'kind movement (account, direction, amount, category, label) | transfer (from, amount)'),
        delete: op('Finance', 'Remove a movement (both sides of a transfer)', { parameters: [q('id', 'Movement id', 'string', 'uuid')] }),
    },
    '/api/finance/invoices': {
        get: op('Finance', 'Invoice (?id=) or list (?order_id=&kind=&from=&to=&q=)'),
        post: op('Finance', "Issue an order's invoice", { requestBody: body({ order_id: uuid, customer_tax_id: { type: 'string' }, invoice_date: date }, ['order_id']) }),
        patch: op('Finance', 'Cancel an invoice with a credit note', { requestBody: body({ id: uuid, reason: { type: 'string' } }, ['id']) }),
    },
    '/api/finance/accounting': {
        get: op('Finance', 'Entry (?id=) or journal (?journal=&status=&from=&to=&account=&q=&page=&size=)'),
        post: op('Finance', 'post (ids | until) | save (manual entry) | reverse (id) | discard (draft id) | stock_variation (date)'),
    },
    '/api/finance/accounts': {
        get: op('Finance', 'Chart of accounts; ?settings=1 the accounting settings'),
        post: op('Finance', 'Add an account'),
        put: op('Finance', 'Rename or (de)activate an account'),
        patch: op('Finance', 'Update the accounting settings'),
        delete: op('Finance', 'Remove an unused account', { parameters: [q('code', 'Account code')] }),
    },
    '/api/finance/reports': {
        get: op('Finance', 'report=trial|ledger|income|balance|vat|export (CSV) for from..to (&drafts=1, &account= for the ledger)'),
    },
    '/api/finance/bank': {
        get: op('Finance', 'Statement lines, unmatched bank lines of the books, balances'),
        post: op('Finance', 'Import statement lines (then auto-match)'),
        patch: op('Finance', 'match (statement_id, line_id) | unmatch (statement_id) | auto (days)'),
        delete: op('Finance', 'Remove a statement line', { parameters: [q('id', 'Line id', 'string', 'uuid')] }),
    },
    '/api/finance/documents': {
        get: op('Finance', 'Document (?id=, &download=1 for a 5-minute link) or list (?kind=&related_type=&related_id=&q=)'),
        post: op('Finance', 'Upload a document (multipart: file + kind, title, partner_name, document_date, expires_on, notes)'),
        put: op('Finance', "Update a document's details"),
        delete: op('Finance', 'Soft-delete a document', { parameters: [q('id', 'Document id', 'string', 'uuid')] }),
    },
    '/api/marketing/campaigns': {
        get: op('Owner', 'Campaigns with spend and results (?id= with spend lines, ?active=1 for pickers)'),
        post: op('Owner', 'Create a campaign, or { kind: "spend", campaign_id, spend_date, amount, account }'),
        put: op('Owner', 'Update a campaign'),
        delete: op('Owner', 'Delete a campaign (?id=) or a spend line (?spend_id=)'),
    },
    '/api/owner/overview': {
        get: op('Owner', 'Owner overview: delivered sales, margins, cash, debts, stock, channels, products, agents, campaigns', { parameters: [q('from', 'Start', 'string', 'date-time'), q('to', 'End', 'string', 'date-time'), q('channel', 'Channel'), q('agent', 'Agent id', 'string', 'uuid'), q('product', 'Product id', 'string', 'uuid'), q('campaign', 'Campaign id', 'string', 'uuid')] }),
    },
    '/api/owner/colissimo': {
        get: op('Owner', "Every parcel of the Colissimo account added in the period (2 months at most), read live from Colissimo's website, with our order when the barcode is known", { parameters: [q('from', 'Start (YYYY-MM-DD, default 30 days ago)'), q('to', 'End (YYYY-MM-DD, default today)')] }),
    },
    '/api/owner/colissimo/sync': {
        post: op('Owner', 'Add every parcel of the Colissimo account that deliveries does not have yet (never re-adds a removed one): { found, added }'),
    },
    '/api/delivery/history': {
        get: op('Owner', "One parcel's details, changes and status history from Colissimo's website (orders permission)", { parameters: [q('code', 'Barcode')] }),
    },
    '/api/admin/goals': {
        get: op('Owner', 'Objectives and results of a month (?month=YYYY-MM)'),
        post: op('Owner', "Set an agent's objective and commission (repeat_months to copy it)"),
        delete: op('Owner', 'Remove an objective', { parameters: [q('id', 'Objective id', 'string', 'uuid')] }),
    },
    '/api/admin/my-work': { get: op('Owner', "The signed-in agent's orders to confirm, follow-ups and month") },
    '/api/admin/staff': { get: op('Owner', 'Team members for assignment pickers') },
    '/api/admin/erp-settings': {
        get: op('Owner', 'Alert, duplicate and discount rules, and the usual delivery fee (delivery_fee)'),
        put: op('Owner', 'Update those rules; delivery_fee sets the fee charged in Tunisia (checkout and agents\' forms)'),
    },
    '/api/sales/orders/delivery-fee': {
        get: op('Sales', 'The usual delivery fee in Tunisia ({ fee }), the default on New order and New parcel'),
    },
};
