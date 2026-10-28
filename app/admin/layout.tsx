"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App, Layout, Menu, Typography, Button, ConfigProvider, Drawer, Grid } from "antd";
import { AntdAppBridge } from "@/components/admin/antd-app";
import { useMobileTableLabels } from "@/components/admin/mobile-table-labels";
import { installAdminFetchCache } from "@/components/admin/admin-fetch-cache";
import type { MenuProps } from "antd";
import {
    DashboardOutlined,
    ShoppingOutlined,
    PlusOutlined,
    UnorderedListOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    AppstoreOutlined,
    ShoppingCartOutlined,
    PercentageOutlined,
    PlayCircleOutlined,
    LogoutOutlined,
    ShopOutlined,
    InboxOutlined,
    HistoryOutlined,
    ReloadOutlined,
    SettingOutlined,
    TeamOutlined,
    DatabaseOutlined,
    BellOutlined,
    HomeOutlined,
    DeleteOutlined,
    CarOutlined,
    TrophyOutlined,
    CheckSquareOutlined,
    ContactsOutlined,
    MessageOutlined,
    FundOutlined,
    DollarOutlined,
    FileTextOutlined,
    BankOutlined,
    FileDoneOutlined,
    BookOutlined,
    FolderOpenOutlined,
    ExperimentOutlined,
    BarChartOutlined,
    NotificationOutlined,
    LineChartOutlined,
    AimOutlined,
    ControlOutlined,
} from "@ant-design/icons";
import { antdTheme } from "@/lib/antd-config";
import { AdminRoleProvider, useAdminRole } from "@/lib/admin-role-context";
import type { Permission } from "@/lib/admin-auth";
import { AdminI18nProvider, msg, useAdminT } from "@/lib/admin-i18n";
import AdminLanguageSwitcher from "@/components/admin/AdminLanguageSwitcher";
import NotificationBell from "@/components/admin/NotificationBell";
import enUS from "antd/locale/en_US";
import frFR from "antd/locale/fr_FR";
import arEG from "antd/locale/ar_EG";

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

type MenuItem = Required<MenuProps>["items"][number];

/**
 * The sidebar, in groups: the agents' daily work first (orders, customers, till), then each
 * management area. Entries a person can't open are hidden, and a group with nothing left goes too.
 */
const menuItems: MenuItem[] = [
    {
        type: "group",
        key: "g-work",
        label: msg("My work"),
        children: [
            { key: "/admin/dashboard", icon: <DashboardOutlined />, label: msg("Dashboard") },
            { key: "/admin/my-work", icon: <CheckSquareOutlined />, label: msg("My day") },
            { key: "/admin/orders", icon: <ShoppingCartOutlined />, label: msg("Orders") },
            { key: "/admin/orders/new", icon: <PlusOutlined />, label: msg("New order") },
            { key: "/admin/delivery", icon: <CarOutlined />, label: msg("Delivery") },
            { key: "/admin/customers", icon: <ContactsOutlined />, label: msg("Customers") },
            { key: "/admin/customers/inbox", icon: <MessageOutlined />, label: msg("Inbox") },
            { key: "/admin/pos", icon: <ShopOutlined />, label: msg("Point of sale") },
        ],
    },
    {
        type: "group",
        key: "g-owner",
        label: msg("Owner"),
        children: [
            { key: "/admin/overview", icon: <FundOutlined />, label: msg("Business overview") },
            { key: "/admin/colissimo-account", icon: <CarOutlined />, label: msg("Colissimo account") },
        ],
    },
    {
        type: "group",
        key: "g-money",
        label: msg("Money"),
        children: [
            { key: "/admin/finance/payments", icon: <DollarOutlined />, label: msg("Payments received") },
            { key: "/admin/finance/bills", icon: <FileTextOutlined />, label: msg("Bills & expenses") },
            { key: "/admin/finance/treasury", icon: <BankOutlined />, label: msg("Cash & bank") },
            { key: "/admin/finance/invoices", icon: <FileDoneOutlined />, label: msg("Invoices") },
            { key: "/admin/finance/accounting", icon: <BookOutlined />, label: msg("Accounting") },
            { key: "/admin/finance/documents", icon: <FolderOpenOutlined />, label: msg("Documents") },
            { key: "/admin/pos/sessions", icon: <HistoryOutlined />, label: msg("Till sessions") },
        ],
    },
    {
        type: "group",
        key: "g-catalog",
        label: msg("Catalog"),
        children: [
            {
                key: "products",
                icon: <ShoppingOutlined />,
                label: msg("Products"),
                children: [
                    { key: "/admin/products", icon: <UnorderedListOutlined />, label: msg("List") },
                    { key: "/admin/products/new", icon: <PlusOutlined />, label: msg("Create") },
                ],
            },
            {
                key: "categories",
                icon: <AppstoreOutlined />,
                label: msg("Categories"),
                children: [
                    { key: "/admin/categories", icon: <UnorderedListOutlined />, label: msg("List") },
                    { key: "/admin/categories/new", icon: <PlusOutlined />, label: msg("Create") },
                ],
            },
            { key: "/admin/variants", icon: <AppstoreOutlined />, label: msg("Variants") },
            { key: "/admin/promotions", icon: <PercentageOutlined />, label: msg("Product Discounts") },
        ],
    },
    {
        type: "group",
        key: "g-stock",
        label: msg("Stock & purchasing"),
        children: [
            {
                key: "stock",
                icon: <DatabaseOutlined />,
                label: msg("Stock"),
                children: [
                    { key: "/admin/stock", icon: <InboxOutlined />, label: msg("Inventory") },
                    { key: "/admin/stock/movements", icon: <HistoryOutlined />, label: msg("Movements") },
                    { key: "/admin/stock/restock", icon: <ReloadOutlined />, label: msg("Restock") },
                    { key: "/admin/stock/settings", icon: <SettingOutlined />, label: msg("Settings") },
                ],
            },
            { key: "/admin/purchasing", icon: <ShoppingOutlined />, label: msg("Purchase orders") },
            { key: "/admin/purchasing/suppliers", icon: <TeamOutlined />, label: msg("Suppliers") },
            { key: "/admin/purchasing/materials", icon: <ExperimentOutlined />, label: msg("Raw materials & costs") },
            { key: "/admin/purchasing/prices", icon: <BarChartOutlined />, label: msg("Price comparison") },
        ],
    },
    {
        type: "group",
        key: "g-marketing",
        label: msg("Marketing"),
        children: [
            { key: "/admin/marketing/campaigns", icon: <NotificationOutlined />, label: msg("Campaigns & ad spend") },
            { key: "/admin/landing", icon: <HomeOutlined />, label: msg("Landing page") },
            { key: "/admin/sale-banners", icon: <PercentageOutlined />, label: msg("Sale Banners") },
            { key: "/admin/reels", icon: <PlayCircleOutlined />, label: msg("Video Reels") },
            { key: "/admin/cart-analytics", icon: <LineChartOutlined />, label: msg("Cart analytics") },
        ],
    },
    {
        type: "group",
        key: "g-admin",
        label: msg("Administration"),
        children: [
            { key: "/admin/team", icon: <TeamOutlined />, label: msg("Team") },
            { key: "/admin/goals", icon: <AimOutlined />, label: msg("Objectives & commissions") },
            { key: "/admin/performance", icon: <TrophyOutlined />, label: msg("Agent performance") },
            { key: "/admin/settings", icon: <ControlOutlined />, label: msg("Business settings") },
            { key: "/admin/notifications", icon: <BellOutlined />, label: msg("Notifications") },
            { key: "/admin/activity", icon: <HistoryOutlined />, label: msg("Activity") },
            { key: "/admin/trash", icon: <DeleteOutlined />, label: msg("Deleted items") },
        ],
    },
];

// Page entries become real links: Next.js prefetches them, so clicking switches pages instantly.
// Labels are translated here, at render time.
function withLinks(items: MenuItem[], t: (text: string) => string): MenuItem[] {
    return items.map((item) => {
        if (!item || !("key" in item)) return item;
        const key = String(item.key);
        const children = "children" in item && item.children ? withLinks(item.children as MenuItem[], t) : undefined;
        const label = "label" in item && typeof item.label === "string" ? t(item.label) : null;
        return {
            ...item,
            label: key.startsWith("/") ? <Link href={key}>{label}</Link> : label,
            ...(children ? { children } : {}),
        } as MenuItem;
    });
}

// Installed at module load, before any admin page effect fetches its lookup lists.
installAdminFetchCache();

// What each menu entry needs (middleware applies the same rules to the pages themselves):
// a permission, "admin" (owners and admins) or "owner".
const MENU_PERMISSIONS: Record<string, Permission | "admin" | "owner"> = {
    "/admin/overview": "owner",
    "/admin/colissimo-account": "owner",
    products: "products",
    categories: "products",
    "/admin/variants": "products",
    "/admin/orders": "orders",
    "/admin/orders/new": "orders",
    "/admin/delivery": "orders",
    "/admin/customers": "customers",
    "/admin/customers/inbox": "customers",
    "/admin/pos": "pos",
    "/admin/pos/sessions": "pos",
    stock: "stock",
    "/admin/purchasing": "purchasing",
    "/admin/purchasing/suppliers": "purchasing",
    "/admin/purchasing/materials": "purchasing",
    "/admin/purchasing/prices": "purchasing",
    "/admin/finance/payments": "finance",
    "/admin/finance/bills": "finance",
    "/admin/finance/treasury": "finance",
    "/admin/finance/invoices": "finance",
    "/admin/finance/accounting": "finance",
    "/admin/finance/documents": "finance",
    "/admin/promotions": "discounts",
    "/admin/marketing/campaigns": "marketing",
    "/admin/sale-banners": "marketing",
    "/admin/reels": "marketing",
    "/admin/landing": "marketing",
    "/admin/cart-analytics": "analytics",
    "/admin/team": "admin",
    "/admin/goals": "admin",
    "/admin/settings": "admin",
    "/admin/activity": "admin",
    "/admin/performance": "admin",
    "/admin/trash": "hard_delete",
};

// Every page entry of the menu, to highlight the right one on detail pages.
const MENU_KEYS: string[] = (function collect(items: MenuItem[]): string[] {
    return items.flatMap((item) => {
        if (!item || !("key" in item)) return [];
        const key = String(item.key);
        const children = "children" in item && item.children ? collect(item.children as MenuItem[]) : [];
        return key.startsWith("/") ? [key, ...children] : children;
    });
})(menuItems);

function menuFor(role: string | null, permissions: Permission[], t: (text: string) => string): MenuItem[] {
    const allowed = (key: string) => {
        const needed = MENU_PERMISSIONS[key];
        if (!needed) return true;
        if (needed === "owner") return role === "owner";
        if (role === "owner" || role === "admin") return true;
        return needed !== "admin" && permissions.includes(needed);
    };
    const keep = (items: MenuItem[]): MenuItem[] =>
        items.flatMap((item) => {
            if (!item || !("key" in item)) return [item];
            if (!allowed(String(item.key))) return [];
            if ("children" in item && item.children) {
                const children = keep(item.children as MenuItem[]);
                return children.length ? [{ ...item, children } as MenuItem] : [];
            }
            return [item];
        });
    return withLinks(keep(menuItems), t);
}

const ANTD_LOCALES = { en: enUS, fr: frFR, ar: arEG };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    return (
        <AdminI18nProvider>
            <AdminConfig>
                {pathname === "/admin/login" ? (
                    children
                ) : (
                    <AdminRoleProvider>
                        <AdminShell>{children}</AdminShell>
                    </AdminRoleProvider>
                )}
            </AdminConfig>
        </AdminI18nProvider>
    );
}

// antd theme, its built-in texts (pagination, OK/Cancel, dates) and direction follow the admin language.
function AdminConfig({ children }: { children: React.ReactNode }) {
    const { locale, dir } = useAdminT();
    return (
        <ConfigProvider theme={antdTheme} locale={ANTD_LOCALES[locale]} direction={dir}>
            <App>
                <AntdAppBridge />
                <div dir={dir} lang={locale} className="admin-root">
                    {/* Phones: wide tables scroll inside their card instead of widening the page. */}
                    <style>{`
                        .admin-root .ant-table-content, .admin-root .ant-table-body { overflow-x: auto; }
                        .admin-root .ant-table-wrapper, .admin-root .ant-select, .admin-root .ant-picker { max-width: 100%; }
                        @media (max-width: 767px) {
                            .admin-root .ant-card-head { padding: 0 12px; }
                            .admin-root .ant-card-body { padding: 12px; }
                            .admin-root .ant-card-head-wrapper { flex-wrap: wrap; gap: 4px; }
                            .admin-root .ant-card-extra { margin-inline-start: 0; }
                            .admin-root h1.ant-typography, .admin-root h2.ant-typography { font-size: 22px; }
                            .admin-root .ant-statistic-content { font-size: 20px; }
                            .admin-root .ant-picker-dropdown .ant-picker-panels { flex-direction: column; }
                            /* Filter bars (className="admin-filters"): two per row, search and date range on their own. */
                            .admin-root .admin-filters > * { flex: 1 1 140px !important; width: auto !important; min-width: 0 !important; }
                            .admin-root .admin-filters > .ant-input-affix-wrapper, .admin-root .admin-filters > .ant-picker-range, .admin-root .admin-filters > div:not(.ant-select) { flex-basis: 100% !important; }
                        }
                        /* Phones: table rows become cards, each cell labelled with its column (see mobile-table-labels.ts). */
                        .admin-mobile .ant-table-content, .admin-mobile .ant-table-body { overflow: visible !important; }
                        .admin-mobile .ant-table table { width: 100% !important; min-width: 0 !important; table-layout: auto !important; }
                        .admin-mobile .ant-table colgroup, .admin-mobile .ant-table-thead, .admin-mobile .ant-table-measure-row { display: none; }
                        .admin-mobile .ant-table-tbody > tr:not(.ant-table-placeholder):not(.ant-table-measure-row) {
                            display: block; margin-bottom: 10px; padding: 6px 12px;
                            border: 1px solid #ececec; border-radius: 12px; background: #fff;
                        }
                        .admin-mobile .ant-table-tbody > tr.ant-table-expanded-row { margin-top: -6px; padding: 8px; background: #fafafa; }
                        .admin-mobile .ant-table-tbody > tr > td {
                            display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px;
                            padding: 7px 0 !important; border: none !important; border-bottom: 1px dashed #f0f0f0 !important;
                            text-align: end; position: static !important; width: auto !important; min-width: 0; word-break: break-word;
                        }
                        .admin-mobile .ant-table-tbody > tr > td:last-child { border-bottom: none !important; }
                        .admin-mobile .ant-table-tbody > tr > td::before {
                            content: attr(data-label); flex-shrink: 0; max-width: 45%;
                            color: #8c8c8c; font-size: 12px; text-align: start;
                        }
                        .admin-mobile .ant-table-tbody > tr > td[data-label=""]::before, .admin-mobile .ant-table-tbody > tr > td:not([data-label])::before { display: none; }
                        .admin-mobile .ant-table-tbody > tr > td[data-label=""] { justify-content: flex-end; }
                        .admin-mobile .ant-table-tbody > tr > td.ant-table-selection-column { justify-content: flex-start; border-bottom: none !important; padding-bottom: 0 !important; }
                        .admin-mobile .ant-table-tbody > tr.ant-table-expanded-row > td { display: block; text-align: start; }
                        .admin-mobile .ant-table-tbody > tr.ant-table-expanded-row > td::before { display: none; }
                        .admin-mobile .ant-table-tbody > tr > td > * { min-width: 0; max-width: 100%; margin-inline-start: auto; }
                        .admin-mobile .ant-table-tbody > tr > td .ant-space { flex-wrap: wrap; justify-content: flex-end; }
                        .admin-mobile .ant-table-cell-row-hover, .admin-mobile .ant-table-tbody > tr:hover > td { background: transparent !important; }
                        .admin-mobile .ant-table { background: transparent; }
                        .admin-mobile .ant-pagination { flex-wrap: wrap; row-gap: 8px; justify-content: center; }
                        .admin-mobile .ant-pagination-options { display: none; }
                        /* Pages that add their own 24px frame: the layout already pads on phones. */
                        .admin-mobile > div[style*="padding: 24px"], .admin-mobile > div[style*="padding:24px"],
                        .admin-mobile > .ant-spin-nested-loading > .ant-spin-container > div[style*="padding: 24px"],
                        .admin-mobile > .ant-spin-nested-loading > .ant-spin-container > div[style*="padding:24px"] {
                            padding: 0 !important; background: transparent !important; min-height: 0 !important;
                        }
                        /* Header rows (title + actions) wrap instead of squeezing. */
                        .admin-mobile [style*="justify-content: space-between"], .admin-mobile [style*="justify-content:space-between"] { flex-wrap: wrap; row-gap: 12px; }
                        .admin-mobile .ant-alert { flex-wrap: wrap; }
                        .admin-mobile .ant-alert-action, .admin-mobile .ant-alert-actions { margin-inline-start: 0; flex-basis: 100%; margin-top: 10px; padding-inline-start: 28px; }
                        .admin-mobile .ant-breadcrumb { font-size: 13px; }
                        .admin-mobile .ant-picker-range { width: 100%; }
                    `}</style>
                    {children}
                </div>
            </App>
        </ConfigProvider>
    );
}

function AdminShell({ children }: { children: React.ReactNode }) {
    const { t } = useAdminT();
    const pathname = usePathname();
    const { role, email, permissions } = useAdminRole();
    const items = useMemo(() => menuFor(role, permissions, t), [role, permissions, t]);
    const router = useRouter();
    const [collapsed, setCollapsed] = useState(false);
    const { dir } = useAdminT();
    // Phones (below md): the sidebar becomes a drawer and the header goes icon-only.
    const screens = Grid.useBreakpoint();
    const mobile = screens.md === false;
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
    useMobileTableLabels(contentEl, mobile);
    useEffect(() => setDrawerOpen(false), [pathname]);
    // Highlight the clicked entry immediately instead of waiting for navigation to finish.
    const [pendingKey, setPendingKey] = useState<string | null>(null);
    useEffect(() => setPendingKey(null), [pathname]);

    // Detail pages (an order, a customer...) highlight the closest menu entry above them.
    const selectedKeys = useMemo(() => {
        if (pendingKey) return [pendingKey];
        const best = MENU_KEYS.filter((key) => pathname === key || pathname?.startsWith(`${key}/`)).sort((a, b) => b.length - a.length)[0];
        return [best ?? pathname];
    }, [pendingKey, pathname]);

    const openKeys = useMemo(() => {
        if (pathname?.startsWith("/admin/products")) {
            return ["products"];
        }
        if (pathname?.startsWith("/admin/categories")) {
            return ["categories"];
        }
        if (pathname?.startsWith("/admin/stock")) {
            return ["stock"];
        }
        return [];
    }, [pathname]);

    const handleMenuClick = ({ key }: { key: string }) => {
        if (key.startsWith("/")) {
            setPendingKey(key); // the <Link> in the label does the navigation
        } else if (key === "products") {
            // If clicking on "Products" parent, navigate to products list
            router.push("/admin/products");
        } else if (key === "categories") {
            // If clicking on "Categories" parent, navigate to categories list
            router.push("/admin/categories");
        } else if (key === "stock") {
            router.push("/admin/stock");
        }
    };

    const handleSignOut = async () => {
        await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
        router.replace("/admin/login");
        router.refresh();
    };

    const brand = (
                    <div
                        style={{
                            height: 64,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: (collapsed && !mobile) ? "center" : "flex-start",
                            paddingInlineStart: (collapsed && !mobile) ? 0 : 24,
                            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                        }}
                    >
                        {(collapsed && !mobile) ? (
                            <div
                                style={{
                                    width: 32,
                                    height: 32,
                                    background: "linear-gradient(135deg, #ff9f7b 0%, #a13c24 100%)",
                                    borderRadius: 8,
                                }}
                            />
                        ) : (
                            <div>
                                <Title level={4} style={{ margin: 0, color: "#fff", fontWeight: 600, letterSpacing: 0.5 }}>
                                    {t("Kachabity")}
                                </Title>
                                <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                                    {t("Admin workspace")}
                                </div>
                            </div>
                        )}
                    </div>
    );
    const menu = (
                    <Menu
                        theme="dark"
                        mode="inline"
                        selectedKeys={selectedKeys}
                        openKeys={openKeys}
                        // Until permissions load, only unrestricted entries show, so nothing flashes and disappears.
                        items={items}
                        onClick={handleMenuClick}
                        onOpenChange={(keys) => {
                            // When submenu opens, if user clicked parent (not a child), navigate
                            const productsJustOpened = keys.includes("products") && !openKeys.includes("products");
                            const categoriesJustOpened = keys.includes("categories") && !openKeys.includes("categories");
                            const stockJustOpened = keys.includes("stock") && !openKeys.includes("stock");
                            if (stockJustOpened) {
                                setTimeout(() => {
                                    if (!pathname?.startsWith("/admin/stock")) router.push("/admin/stock");
                                }, 50);
                            }

                            if (productsJustOpened) {
                                // Small delay to check if a child was actually clicked
                                setTimeout(() => {
                                    // If we're still not on a products page, navigate to list
                                    if (pathname !== "/admin/products" && pathname !== "/admin/products/new") {
                                        router.push("/admin/products");
                                    }
                                }, 50);
                            }

                            if (categoriesJustOpened) {
                                // Small delay to check if a child was actually clicked
                                setTimeout(() => {
                                    // If we're still not on a categories page, navigate to list
                                    if (pathname !== "/admin/categories" && pathname !== "/admin/categories/new") {
                                        router.push("/admin/categories");
                                    }
                                }, 50);
                            }
                        }}
                        style={{
                            borderRight: 0,
                            height: mobile ? "auto" : "calc(100vh - 64px)",
                            overflowY: mobile ? undefined : "auto",
                            background: "#050f1f",
                        }}
                    />
    );
    const roleLabel = role === "owner" ? t("Owner") : role === "admin" ? t("Admin") : t("Staff");

    return (
            <Layout style={{ minHeight: "100vh" }}>
                {mobile ? (
                    // Phones: the menu lives in a drawer opened from the header.
                    <Drawer
                        open={drawerOpen}
                        onClose={() => setDrawerOpen(false)}
                        placement={dir === "rtl" ? "right" : "left"}
                        size={280}
                        closable={false}
                        styles={{ body: { padding: 0, background: "#050f1f" }, header: { display: "none" } }}
                    >
                        {brand}
                        {menu}
                        {role && (
                            <div style={{ padding: "16px 24px", color: "rgba(255,255,255,0.65)", fontSize: 13, borderTop: "1px solid rgba(255,255,255,0.08)", wordBreak: "break-all" }}>
                                {email} · {roleLabel}
                            </div>
                        )}
                    </Drawer>
                ) : (
                <Sider
                    collapsible
                    collapsed={collapsed}
                    onCollapse={setCollapsed}
                    breakpoint="lg"
                    width={250}
                    theme="dark"
                    style={{
                        background: "#050f1f",
                    }}
                >
                    {brand}
                    {menu}
                </Sider>
                )}
                <Layout style={{ minWidth: 0 }}>
                    <Header
                        style={{
                            background: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: mobile ? "0 8px" : "0 24px",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                            height: mobile ? 56 : 64,
                            position: mobile ? "sticky" : undefined,
                            top: 0,
                            zIndex: 20,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: mobile ? 4 : 16, minWidth: 0 }}>
                            <Button
                                type="text"
                                size={mobile ? "large" : "middle"}
                                aria-label={t("Menu")}
                                icon={mobile ? <MenuUnfoldOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                                onClick={() => (mobile ? setDrawerOpen(true) : setCollapsed((prev) => !prev))}
                            />
                            {!mobile && (
                                <Title level={4} style={{ margin: 0, fontWeight: 600, color: "#1c1d27" }}>
                                    {t("Admin Panel")}
                                </Title>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: mobile ? 4 : 8, alignItems: "center", minWidth: 0 }}>
                            <AdminLanguageSwitcher />
                            {role && <NotificationBell />}
                            {role && !mobile && (
                                <span style={{ color: "#6b7280", fontSize: 13, marginInlineEnd: 8 }}>
                                    {email} · {roleLabel}
                                </span>
                            )}
                            <Button
                                type="primary"
                                href="/"
                                target="_blank"
                                icon={mobile ? <ShopOutlined /> : undefined}
                                aria-label={t("View Store")}
                                style={{ background: "#7a3b2e", borderColor: "#7a3b2e" }}
                            >
                                {!mobile && t("View Store")}
                            </Button>
                            <Button icon={<LogoutOutlined />} onClick={handleSignOut} aria-label={t("Sign out")}>
                                {!mobile && t("Sign out")}
                            </Button>
                        </div>
                    </Header>
                    <Content
                        style={{
                            padding: mobile ? "16px 12px 40px" : "32px 32px 48px",
                            background: "#f5f6fa",
                            minHeight: "calc(100vh - 64px)",
                            minWidth: 0,
                        }}
                    >
                        <div ref={setContentEl} className={mobile ? "admin-mobile" : undefined} style={{ maxWidth: 1320, margin: "0 auto", minWidth: 0 }}>{children}</div>
                    </Content>
                </Layout>
            </Layout>
    );
}




