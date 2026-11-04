"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Col, Empty, Input, Row, Segmented, Table, Tag, Typography } from "antd";
import { ReloadOutlined, SearchOutlined, SwapOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { Kpi } from "@/components/admin/erp/ui";
import { formatMoney, formatNumber } from "@/components/admin/erp/erp-client";

const { Text } = Typography;

export interface ShopStockRow {
    product_id: string;
    variant_id: string | null;
    name: string;
    label: string;
    sku: string | null;
    code: string | null;
    price: number;
    stock: number | null;
    carried: boolean; // has a stock level at this shop
    low_stock_limit: number | null;
}

export const isLowStock = (r: ShopStockRow) => r.stock !== null && r.stock > 0 && r.stock <= (r.low_stock_limit ?? 0);
export const isOutOfStock = (r: ShopStockRow) => r.carried && r.stock === 0;

/** Admin → Point of sale → Stock: what the selected shop holds, lowest first. */
export function PosStockTab({ rows, loading, shop, onReload }: { rows: ShopStockRow[]; loading: boolean; shop?: string; onReload: () => void }) {
    const { t, locale } = useAdminT();
    const canMoveStock = useAdminRole().can("stock");
    const [show, setShow] = useState<"all" | "low" | "out">("all");
    const [search, setSearch] = useState("");

    const carried = useMemo(() => rows.filter((r) => r.carried), [rows]);
    const low = carried.filter(isLowStock);
    const out = carried.filter(isOutOfStock);
    const units = carried.reduce((sum, r) => sum + (r.stock ?? 0), 0);

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        const list = show === "low" ? low : show === "out" ? out : carried;
        return list
            .filter((r) => !term || [r.name, r.label, r.sku, r.code].some((v) => (v ?? "").toLowerCase().includes(term)))
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
    }, [carried, low, out, show, search]);

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><Kpi title={t("Units in stock")} value={formatNumber(units, locale)} loading={loading} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Items in this shop")} value={formatNumber(carried.length, locale)} loading={loading} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Low stock")} value={formatNumber(low.length, locale)} color={low.length ? "#d46b08" : undefined} loading={loading} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Out of stock")} value={formatNumber(out.length, locale)} color={out.length ? "#cf1322" : undefined} loading={loading} /></Col>
            </Row>
            <Card
                title={shop}
                extra={
                    <>
                        <Button type="text" icon={<ReloadOutlined />} onClick={onReload} aria-label={t("Refresh")} />
                        {canMoveStock && <Link href="/admin/stock/movements"><Button icon={<SwapOutlined />}>{t("Move stock")}</Button></Link>}
                    </>
                }
            >
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                    <Segmented
                        value={show}
                        onChange={setShow}
                        options={[
                            { value: "all", label: t("All") },
                            { value: "low", label: `${t("Low stock")} (${low.length})` },
                            { value: "out", label: `${t("Out of stock")} (${out.length})` },
                        ]}
                    />
                    <Input allowClear prefix={<SearchOutlined />} placeholder={t("Search product, size, colour or code")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
                </div>
                <Table
                    rowKey={(r) => `${r.product_id}:${r.variant_id}`}
                    size="small"
                    loading={loading}
                    dataSource={visible}
                    pagination={{ pageSize: 25, hideOnSinglePage: true }}
                    scroll={{ x: "max-content" }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No stock in this shop yet. Transfer stock to it to start selling.")} /> }}
                    columns={[
                        { title: t("Product"), key: "name", render: (_, r) => <span>{r.name}{r.label && <><br /><Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Text></>}</span> },
                        { title: t("SKU"), dataIndex: "sku" },
                        { title: t("Price"), dataIndex: "price", align: "right", render: (v: number) => formatMoney(v, locale, 0) },
                        { title: t("Stock"), dataIndex: "stock", align: "right", render: (v: number, r) => <Tag color={isOutOfStock(r) ? "red" : isLowStock(r) ? "orange" : "green"} style={{ marginInlineEnd: 0 }}>{v}</Tag> },
                        { title: t("Alert at"), dataIndex: "low_stock_limit", align: "right" },
                    ]}
                />
            </Card>
        </div>
    );
}
