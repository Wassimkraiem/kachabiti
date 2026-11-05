/**
 * Values shared by the ERP API routes and admin pages. Labels are English, marked for the admin
 * translation table with msg(); pages show them with t(label). Values (keys) are data and are
 * never translated.
 */
const msg = (text: string) => text;

export const CHANNELS = ['website', 'facebook', 'instagram', 'tiktok', 'whatsapp', 'phone', 'store', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
    website: msg('Website'),
    facebook: msg('Facebook'),
    instagram: msg('Instagram'),
    tiktok: msg('TikTok'),
    whatsapp: msg('WhatsApp'),
    phone: msg('Phone'),
    store: msg('Shop (till)'),
    other: msg('Other'),
};

export const CHANNEL_COLORS: Record<Channel, string> = {
    website: 'geekblue',
    facebook: 'blue',
    instagram: 'magenta',
    tiktok: 'default',
    whatsapp: 'green',
    phone: 'cyan',
    store: 'gold',
    other: 'default',
};

/** Channels an agent can pick for an order typed in by hand (the till and the website set theirs). */
export const MANUAL_CHANNELS: Channel[] = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'phone', 'other'];

export const CUSTOMER_STAGES = ['new', 'interested', 'to_confirm', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

export const STAGE_LABELS: Record<CustomerStage, string> = {
    new: msg('New contact'),
    interested: msg('Interested'),
    to_confirm: msg('Order to confirm'),
    confirmed: msg('Order confirmed'),
    shipped: msg('Shipped'),
    delivered: msg('Delivered'),
    cancelled: msg('Cancelled'),
};

export const STAGE_COLORS: Record<CustomerStage, string> = {
    new: 'default',
    interested: 'purple',
    to_confirm: 'orange',
    confirmed: 'blue',
    shipped: 'cyan',
    delivered: 'green',
    cancelled: 'red',
};

export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'check', 'cod', 'mobile', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    cash: msg('Cash'),
    card: msg('Card'),
    bank_transfer: msg('Bank transfer'),
    check: msg('Cheque'),
    cod: msg('Cash on delivery'),
    mobile: msg('Mobile payment'),
    other: msg('Other'),
};

/** Where money sits: the till, the bank, or with the delivery company until it pays out. */
export const MONEY_ACCOUNTS = ['cash', 'bank', 'carrier'] as const;
export type MoneyAccount = (typeof MONEY_ACCOUNTS)[number];

export const MONEY_ACCOUNT_LABELS: Record<MoneyAccount, string> = {
    cash: msg('Cash register'),
    bank: msg('Bank'),
    carrier: msg('Held by the delivery company'),
};

export const BILL_CATEGORIES = [
    'purchase_goods', 'purchase_materials', 'rent', 'salaries', 'social_charges', 'utilities', 'packaging', 'delivery',
    'transport', 'telecom', 'bank_fees', 'insurance', 'maintenance', 'fees', 'taxes', 'other',
] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const BILL_CATEGORY_LABELS: Record<BillCategory, string> = {
    purchase_goods: msg('Goods for resale'),
    purchase_materials: msg('Raw materials'),
    rent: msg('Rent'),
    salaries: msg('Salaries'),
    social_charges: msg('Social charges (CNSS)'),
    utilities: msg('Water, electricity, fuel'),
    packaging: msg('Packaging and supplies'),
    delivery: msg('Delivery'),
    transport: msg('Transport'),
    telecom: msg('Phone and internet'),
    bank_fees: msg('Bank charges'),
    insurance: msg('Insurance'),
    maintenance: msg('Maintenance and repairs'),
    fees: msg('Professional fees'),
    taxes: msg('Taxes and duties'),
    other: msg('Other expenses'),
};

/** Expense account for each category (Tunisian SCE), as in private.bill_category_account. */
export const BILL_CATEGORY_ACCOUNTS: Record<BillCategory, string> = {
    purchase_goods: '607', purchase_materials: '601', rent: '613', salaries: '640', social_charges: '647',
    utilities: '6061', packaging: '6068', delivery: '6241', transport: '624', telecom: '626', bank_fees: '627',
    insurance: '616', maintenance: '615', fees: '622', taxes: '66', other: '628',
};

/** Categories that are usually the same every month. */
export const FIXED_CATEGORIES: BillCategory[] = ['rent', 'salaries', 'social_charges', 'insurance', 'telecom'];

export const TREASURY_CATEGORIES = [
    'opening_balance', 'owner_contribution', 'owner_withdrawal', 'transfer', 'loan', 'loan_repayment',
    'other_income', 'other_expense', 'pos_difference', 'other',
] as const;
export type TreasuryCategory = (typeof TREASURY_CATEGORIES)[number];

export const TREASURY_CATEGORY_LABELS: Record<TreasuryCategory, string> = {
    opening_balance: msg('Opening balance'),
    owner_contribution: msg('Owner puts money in'),
    owner_withdrawal: msg('Owner takes money out'),
    transfer: msg('Transfer cash ↔ bank'),
    loan: msg('Loan received'),
    loan_repayment: msg('Loan repayment'),
    other_income: msg('Other income'),
    other_expense: msg('Other expense'),
    pos_difference: msg('Till difference'),
    other: msg('Other'),
};

export const AD_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'influencer', 'other'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
    facebook: msg('Facebook'),
    instagram: msg('Instagram'),
    tiktok: msg('TikTok'),
    google: msg('Google'),
    whatsapp: msg('WhatsApp'),
    influencer: msg('Influencer'),
    other: msg('Other'),
};

export const PO_STATUSES = ['draft', 'rfq', 'ordered', 'partial', 'received', 'cancelled'] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
    draft: msg('Draft'),
    rfq: msg('Price request'),
    ordered: msg('Ordered'),
    partial: msg('Partly received'),
    received: msg('Received'),
    cancelled: msg('Cancelled'),
};

export const PO_STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
    draft: 'default',
    rfq: 'purple',
    ordered: 'blue',
    partial: 'orange',
    received: 'green',
    cancelled: 'red',
};

export const MATERIAL_UNITS = ['unit', 'm', 'cm', 'kg', 'g', 'l', 'ml', 'roll', 'pack'] as const;

export const JOURNALS = ['VT', 'AC', 'CA', 'BQ', 'OD'] as const;
export type Journal = (typeof JOURNALS)[number];

export const JOURNAL_LABELS: Record<Journal, string> = {
    VT: msg('Sales'),
    AC: msg('Purchases'),
    CA: msg('Cash'),
    BQ: msg('Bank'),
    OD: msg('Miscellaneous'),
};

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
    asset: msg('Asset'),
    liability: msg('Liability'),
    equity: msg('Equity'),
    income: msg('Income'),
    expense: msg('Expense'),
};

export const DOCUMENT_KINDS = ['contract', 'supplier_invoice', 'sales_invoice', 'delivery_note', 'certificate', 'receipt', 'tax', 'payroll', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
    contract: msg('Contract'),
    supplier_invoice: msg('Supplier invoice'),
    sales_invoice: msg('Sales invoice'),
    delivery_note: msg('Delivery note'),
    certificate: msg('Certificate'),
    receipt: msg('Receipt'),
    tax: msg('Tax'),
    payroll: msg('Payroll'),
    other: msg('Other'),
};

/** Orders still moving through the pipeline (a second one from the same phone is a possible duplicate). */
export const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped'] as const;

export const TICKET_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
    todo: msg('To do'),
    in_progress: msg('In progress'),
    done: msg('Done'),
};

export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
    low: msg('Low'),
    normal: msg('Normal'),
    high: msg('High'),
};
