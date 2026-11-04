"use client";

import { useState } from "react";
import { Card, Col, Row, Select, Space, Table } from "antd";
import { useAdminT } from "@/lib/admin-i18n";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/erp/constants";
import { Kpi, PeriodFilter, usePeriod } from "@/components/admin/erp/ui";
import { BarChart, BarList } from "@/components/admin/erp/charts";
import { day, formatDate, formatMoney, formatNumber, useApi } from "@/components/admin/erp/erp-client";

interface Analytics {
    totals: { sales: number; count: number; discounts: number; units: number };
    days: { day: string; sales: number; count: number }[];
    shops: { id: string; name: string; sales: number; count: number }[];
    methods: { method: string; amount: number }[];
    products: { name: string; units: number; sales: number }[];
    stock: { id: string; name: string; low_stock_limit: number | null; units: number; low: number; out_of_stock: number }[];
}

/** Admin → Point of sale → Analytics: till sales of a period and the stock of each shop. */
export function PosAnalyticsTab({ shops }: { shops: { id: string; name: string }[] }) {
    const { t, locale } = useAdminT();
    const { value, setValue, from, to } = usePeriod("30d");
    const [shop, setShop] = useState<string | null>(null);
    const { data, loading } = useApi<Analytics>(`/api/pos/analytics?from=${day(from)}&to=${day(to)}${shop ? `&location_id=${shop}` : ""}`);
    const money = (n: number) => formatMoney(n, locale);
    const totals = data?.totals;

    return (
        <div>
            <Space wrap style={{ marginBottom: 16 }}>
                <Select value={shop} onChange={setShop} style={{ minWidth: 180 }} options={[{ value: null, label: t("All shops") }, ...shops.map((s) => ({ value: s.id, label: s.name }))]} />
                <PeriodFilter value={value} onChange={setValue} />
            </Space>
            <Row gutter={[16, 16]}>
                <Col xs={12} md={6}><Kpi title={t("Sales")} value={money(totals?.sales ?? 0)} loading={loading} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Tickets")} value={formatNumber(totals?.count ?? 0, locale)} sub={totals?.count ? `${t("Average")}: ${money(totals.sales / totals.count)}` : undefined} loading={loading} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Units sold")} value={formatNumber(totals?.units ?? 0, locale)} loading={loading} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Discounts given")} value={money(totals?.discounts ?? 0)} loading={loading} /></Col>
                <Col xs={24}>
                    <Card title={t("Sales per day")}>
                        <BarChart
                            data={(data?.days ?? []).map((d) => ({ label: formatDate(d.day, locale), value: d.sales, tooltip: `${formatDate(d.day, locale)}: ${money(d.sales)} · ${d.count}` }))}
                            emptyText={t("No sales in this period.")}
                        />
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={t("Top products")}>
                        <BarList rows={(data?.products ?? []).map((p) => ({ key: p.name, label: p.name, value: p.units, sub: money(p.sales) }))} format={(n) => formatNumber(n, locale)} />
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={t("Sales per shop")} style={{ marginBottom: 16 }}>
                        <BarList rows={(data?.shops ?? []).map((s) => ({ key: s.id, label: s.name, value: s.sales, sub: formatNumber(s.count, locale) }))} format={money} />
                    </Card>
                    <Card title={t("Payment methods")}>
                        <BarList rows={(data?.methods ?? []).map((m) => ({ key: m.method, label: t(PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method), value: m.amount }))} format={money} />
                    </Card>
                </Col>
                <Col xs={24}>
                    <Card title={t("Stock per shop")}>
                        <Table
                            rowKey="id"
                            size="small"
                            loading={loading}
                            pagination={false}
                            dataSource={data?.stock ?? []}
                            scroll={{ x: "max-content" }}
                            columns={[
                                { title: t("Shop"), dataIndex: "name" },
                                { title: t("Units in stock"), dataIndex: "units", align: "right" },
                                { title: t("Low stock"), dataIndex: "low", align: "right" },
                                { title: t("Out of stock"), dataIndex: "out_of_stock", align: "right" },
                                { title: t("Alert at"), dataIndex: "low_stock_limit", align: "right", render: (v: number | null) => v ?? t("Reorder point") },
                            ]}
                        />
                    </Card>
                </Col>
            </Row>
        </div>
    );
}
